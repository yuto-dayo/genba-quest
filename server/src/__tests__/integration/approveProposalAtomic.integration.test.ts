import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

type ActorRef = {
  type: 'human' | 'ai' | 'system' | 'integration';
  id: string;
  name: string;
};

type ApproveRpcResult = {
  proposal: {
    status: string;
    result_event_id: string | null;
    approvals?: Array<{ decision: string }>;
  };
  is_fully_approved: boolean;
  auto_executed: boolean;
};

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('approve_proposal_atomic integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;

  const firstApprover: ActorRef = {
    type: 'human',
    id: '22222222-2222-4222-8222-222222222222',
    name: 'First Approver',
  };
  const secondApprover: ActorRef = {
    type: 'human',
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Second Approver',
  };
  const aiApprover: ActorRef = {
    type: 'ai',
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Sherpa AI',
  };

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
  });

  it('final approval auto-executes proposal and creates exactly one ledger event', async () => {
    const proposalId = await insertProposedProposal({
      orgId,
      amount: '12000.00',
      requiredApprovals: 1,
      category: 'material',
      createdBy: {
        type: 'human',
        id: randomUUID(),
        name: 'Integration Creator',
      },
    });

    const result = await approveProposalAtomic(orgId, proposalId, firstApprover, 'integration approval');
    expect(result.error).toBeNull();

    const approved = normalizeApproveRpcResult(result.data);
    expect(approved?.is_fully_approved).toBe(true);
    expect(approved?.auto_executed).toBe(true);
    expect(approved?.proposal.status).toBe('executed');
    expect(approved?.proposal.result_event_id).toBeTruthy();

    const eventCount = await countLedgerEvents(orgId, proposalId);
    expect(eventCount).toBe(1);
  });

  it('keeps proposed state on partial approval, then executes on final approval', async () => {
    const proposalId = await insertProposedProposal({
      orgId,
      amount: '18000.00',
      requiredApprovals: 2,
      category: 'tool',
      createdBy: {
        type: 'human',
        id: randomUUID(),
        name: 'Integration Creator',
      },
    });

    const first = await approveProposalAtomic(orgId, proposalId, firstApprover, 'first approval');
    expect(first.error).toBeNull();

    const firstResult = normalizeApproveRpcResult(first.data);
    expect(firstResult?.is_fully_approved).toBe(false);
    expect(firstResult?.auto_executed).toBe(false);
    expect(firstResult?.proposal.status).toBe('proposed');

    const eventCountAfterFirst = await countLedgerEvents(orgId, proposalId);
    expect(eventCountAfterFirst).toBe(0);

    const second = await approveProposalAtomic(orgId, proposalId, secondApprover, 'final approval');
    expect(second.error).toBeNull();

    const secondResult = normalizeApproveRpcResult(second.data);
    expect(secondResult?.is_fully_approved).toBe(true);
    expect(secondResult?.auto_executed).toBe(true);
    expect(secondResult?.proposal.status).toBe('executed');
    expect(secondResult?.proposal.result_event_id).toBeTruthy();

    const eventCountAfterSecond = await countLedgerEvents(orgId, proposalId);
    expect(eventCountAfterSecond).toBe(1);
  });

  it('rejects AI self-approval and keeps proposal unchanged', async () => {
    const proposalId = await insertProposedProposal({
      orgId,
      amount: '9000.00',
      requiredApprovals: 1,
      category: 'travel',
      createdBy: {
        type: 'ai',
        id: randomUUID(),
        name: 'Sherpa AI Creator',
      },
    });

    const result = await approveProposalAtomic(orgId, proposalId, aiApprover, 'self-approval should fail');
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain('AI_SELF_APPROVAL_PROHIBITED');

    const proposal = await fetchProposalState(proposalId);
    expect(proposal.status).toBe('proposed');
    expect((proposal.approvals ?? []).length).toBe(0);
  });

  it('keeps approval when auto-execute fails with numeric overflow', async () => {
    const proposalId = await insertProposedProposal({
      orgId,
      amount: '99999999999999.99',
      requiredApprovals: 1,
      category: 'material',
      createdBy: {
        type: 'human',
        id: randomUUID(),
        name: 'Integration Creator',
      },
    });

    const result = await approveProposalAtomic(
      orgId,
      proposalId,
      firstApprover,
      'approval with expected execute failure'
    );
    expect(result.error).toBeNull();

    const approved = normalizeApproveRpcResult(result.data);
    expect(approved?.is_fully_approved).toBe(true);
    expect(approved?.auto_executed).toBe(false);
    expect(approved?.proposal.status).toBe('approved');
    expect(approved?.proposal.result_event_id).toBeNull();

    const eventCount = await countLedgerEvents(orgId, proposalId);
    expect(eventCount).toBe(0);

    const proposal = await fetchProposalState(proposalId);
    expect(proposal.status).toBe('approved');
    expect((proposal.approvals ?? []).length).toBe(1);
  });

  async function insertProposedProposal(params: {
    orgId: string;
    amount: string;
    requiredApprovals: number;
    category: string;
    createdBy: ActorRef;
  }): Promise<string> {
    const proposalId = randomUUID();
    const { error } = await supabase.from('proposals').insert({
      id: proposalId,
      org_id: params.orgId,
      type: 'expense.create',
      status: 'proposed',
      created_by: params.createdBy,
      payload: {
        amount: params.amount,
        category: params.category,
        description: 'approve_proposal_atomic integration test',
      },
      description: 'approve_proposal_atomic integration test',
      required_approvals: params.requiredApprovals,
      approvals: [],
    });

    if (error) {
      throw new Error(`Failed to insert test proposal: ${error.message}`);
    }

    return proposalId;
  }

  async function approveProposalAtomic(
    testOrgId: string,
    proposalId: string,
    approver: ActorRef,
    reason?: string
  ) {
    return supabase.rpc('approve_proposal_atomic', {
      p_org_id: testOrgId,
      p_proposal_id: proposalId,
      p_approver: approver,
      p_reason: reason ?? null,
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

  async function fetchProposalState(proposalId: string) {
    const { data, error } = await supabase
      .from('proposals')
      .select('status, approvals, result_event_id')
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

function normalizeApproveRpcResult(data: unknown): ApproveRpcResult | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return (data[0] ?? null) as ApproveRpcResult | null;
  }

  return data as ApproveRpcResult;
}
