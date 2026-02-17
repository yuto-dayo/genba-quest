import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

type RpcProposalResult = {
  status: string;
  result_event_id: string | null;
};

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';

const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('execute_proposal_atomic integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
  });

  it('approved proposal is executed atomically and stays idempotent on re-run', async () => {
    const proposalId = await insertApprovedProposal({
      orgId,
      amount: '3200.00',
      requiredApprovals: 1,
      approvalCount: 1,
      category: 'material',
    });

    const first = await executeProposalAtomic(orgId, proposalId);
    expect(first.error).toBeNull();

    const firstProposal = normalizeRpcProposal(first.data);
    expect(firstProposal?.status).toBe('executed');
    expect(firstProposal?.result_event_id).toBeTruthy();

    const eventCountAfterFirst = await countLedgerEvents(orgId, proposalId);
    expect(eventCountAfterFirst).toBe(1);

    const second = await executeProposalAtomic(orgId, proposalId);
    expect(second.error).toBeNull();

    const secondProposal = normalizeRpcProposal(second.data);
    expect(secondProposal?.status).toBe('executed');
    expect(secondProposal?.result_event_id).toBe(firstProposal?.result_event_id ?? null);

    const eventCountAfterSecond = await countLedgerEvents(orgId, proposalId);
    expect(eventCountAfterSecond).toBe(1);

    const transactionId = await findSingleTransactionId(orgId, firstProposal?.result_event_id ?? '');
    const entryCount = await countLedgerEntries(transactionId);
    expect(entryCount).toBe(2);
  });

  it('returns INSUFFICIENT_APPROVALS and leaves no ledger side-effects', async () => {
    const proposalId = await insertApprovedProposal({
      orgId,
      amount: '12000.00',
      requiredApprovals: 2,
      approvalCount: 1,
      category: 'tool',
    });

    const result = await executeProposalAtomic(orgId, proposalId);
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain('INSUFFICIENT_APPROVALS');

    const eventCount = await countLedgerEvents(orgId, proposalId);
    expect(eventCount).toBe(0);

    const proposal = await fetchProposalState(proposalId);
    expect(proposal.status).toBe('approved');
    expect(proposal.executed_at).toBeNull();
    expect(proposal.result_event_id).toBeNull();
  });

  it('rolls back inserted event/transaction when amount overflows numeric(15,2)', async () => {
    const proposalId = await insertApprovedProposal({
      orgId,
      amount: '99999999999999.99',
      requiredApprovals: 1,
      approvalCount: 1,
      category: 'material',
    });

    const result = await executeProposalAtomic(orgId, proposalId);
    expect(result.error).not.toBeNull();

    const errorText = `${result.error?.message ?? ''} ${result.error?.details ?? ''}`;
    expect(errorText.toLowerCase()).toMatch(/overflow|precision|numeric/);

    const eventCount = await countLedgerEvents(orgId, proposalId);
    expect(eventCount).toBe(0);

    const transactionCount = await countLedgerTransactions(orgId);
    expect(transactionCount).toBe(0);

    const proposal = await fetchProposalState(proposalId);
    expect(proposal.status).toBe('approved');
    expect(proposal.executed_at).toBeNull();
    expect(proposal.result_event_id).toBeNull();
  });

  async function insertApprovedProposal(params: {
    orgId: string;
    amount: string;
    requiredApprovals: number;
    approvalCount: number;
    category: string;
  }): Promise<string> {
    const proposalId = randomUUID();
    const now = new Date().toISOString();
    const approvals = Array.from({ length: params.approvalCount }, (_, index) => ({
      actor: {
        type: 'human',
        id: randomUUID(),
        name: `Approver ${index + 1}`,
      },
      decision: 'approve',
      reason: 'integration test approval',
      at: now,
    }));

    const { error } = await supabase.from('proposals').insert({
      id: proposalId,
      org_id: params.orgId,
      type: 'expense.create',
      status: 'approved',
      created_by: {
        type: 'human',
        id: randomUUID(),
        name: 'Integration Test Creator',
      },
      payload: {
        amount: params.amount,
        category: params.category,
        description: 'execute_proposal_atomic integration test',
      },
      description: 'execute_proposal_atomic integration test',
      required_approvals: params.requiredApprovals,
      approvals,
    });

    if (error) {
      throw new Error(`Failed to insert test proposal: ${error.message}`);
    }

    return proposalId;
  }

  async function executeProposalAtomic(testOrgId: string, proposalId: string) {
    return supabase.rpc('execute_proposal_atomic', {
      p_org_id: testOrgId,
      p_proposal_id: proposalId,
      p_executor: {
        type: 'system',
        id: 'integration-test-runner',
        name: 'Integration Test Runner',
      },
    });
  }

  async function countLedgerEvents(testOrgId: string, proposalId: string): Promise<number> {
    const { count, error } = await supabase
      .from('ledger_events')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', testOrgId)
      .eq('proposal_id', proposalId);

    if (error) {
      throw new Error(`Failed to count ledger events: ${error.message}`);
    }

    return count ?? 0;
  }

  async function countLedgerTransactions(testOrgId: string): Promise<number> {
    const { count, error } = await supabase
      .from('ledger_transactions')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', testOrgId);

    if (error) {
      throw new Error(`Failed to count ledger transactions: ${error.message}`);
    }

    return count ?? 0;
  }

  async function findSingleTransactionId(testOrgId: string, eventId: string): Promise<string> {
    const { data, error } = await supabase
      .from('ledger_transactions')
      .select('id')
      .eq('org_id', testOrgId)
      .eq('event_id', eventId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch ledger transaction: ${error.message}`);
    }

    if (!data?.id) {
      throw new Error('Expected one ledger transaction but found none');
    }

    return data.id;
  }

  async function countLedgerEntries(transactionId: string): Promise<number> {
    const { count, error } = await supabase
      .from('ledger_entries')
      .select('*', { count: 'exact', head: true })
      .eq('transaction_id', transactionId);

    if (error) {
      throw new Error(`Failed to count ledger entries: ${error.message}`);
    }

    return count ?? 0;
  }

  async function fetchProposalState(proposalId: string) {
    const { data, error } = await supabase
      .from('proposals')
      .select('status, executed_at, result_event_id')
      .eq('id', proposalId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch proposal state: ${error.message}`);
    }

    return data;
  }

  async function cleanupOrgData(testOrgId: string): Promise<void> {
    const { error: ledgerEventDeleteError } = await supabase
      .from('ledger_events')
      .delete()
      .eq('org_id', testOrgId);
    if (ledgerEventDeleteError) {
      throw new Error(`Failed to cleanup ledger events: ${ledgerEventDeleteError.message}`);
    }

    const { error: proposalDeleteError } = await supabase
      .from('proposals')
      .delete()
      .eq('org_id', testOrgId);
    if (proposalDeleteError) {
      throw new Error(`Failed to cleanup proposals: ${proposalDeleteError.message}`);
    }
  }
});

function normalizeRpcProposal(data: unknown): RpcProposalResult | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return (data[0] ?? null) as RpcProposalResult | null;
  }

  return data as RpcProposalResult;
}
