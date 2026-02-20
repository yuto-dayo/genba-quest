import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

type ActorRef = {
  type: 'human' | 'ai' | 'system' | 'integration';
  id: string;
  name: string;
};

type RejectedProposal = {
  status: string;
  rejection_reason: string | null;
  approvals?: Array<{ decision: string }>;
};

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('reject_proposal_atomic integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;

  const rejector: ActorRef = {
    type: 'human',
    id: '55555555-5555-4555-8555-555555555555',
    name: 'Rejector',
  };

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
  });

  it('rejects pending proposal atomically and records rejection reason', async () => {
    const proposalId = await insertProposal({
      orgId,
      status: 'pending',
      amount: '8000.00',
    });

    const result = await rejectProposalAtomic(orgId, proposalId, rejector, 'integration rejection');
    expect(result.error).toBeNull();

    const rejected = normalizeRejectedProposal(result.data);
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.rejection_reason).toBe('integration rejection');
    expect(rejected?.approvals?.some((item) => item.decision === 'reject')).toBe(true);
  });

  it('returns PROPOSAL_NOT_IN_PENDING_STATE for approved proposal', async () => {
    const proposalId = await insertProposal({
      orgId,
      status: 'approved',
      amount: '12000.00',
    });

    const result = await rejectProposalAtomic(orgId, proposalId, rejector, 'should fail');
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain('PROPOSAL_NOT_IN_PENDING_STATE');

    const proposal = await fetchProposalState(proposalId);
    expect(proposal.status).toBe('approved');
    expect(proposal.rejection_reason).toBeNull();
  });

  it('returns PROPOSAL_NOT_FOUND for unknown proposal id', async () => {
    const result = await rejectProposalAtomic(orgId, randomUUID(), rejector, 'missing');
    expect(result.error).not.toBeNull();
    expect(result.error?.message).toContain('PROPOSAL_NOT_FOUND');
  });

  async function insertProposal(params: {
    orgId: string;
    status: 'pending' | 'approved';
    amount: string;
  }): Promise<string> {
    const proposalId = randomUUID();
    const { error } = await supabase.from('proposals').insert({
      id: proposalId,
      org_id: params.orgId,
      type: 'expense.create',
      status: params.status,
      created_by: {
        type: 'human',
        id: randomUUID(),
        name: 'Integration Creator',
      },
      payload: {
        amount: params.amount,
        category: 'material',
        description: 'reject_proposal_atomic integration test',
      },
      description: 'reject_proposal_atomic integration test',
      required_approvals: 1,
      approvals: [],
    });

    if (error) {
      throw new Error(`Failed to insert test proposal: ${error.message}`);
    }

    return proposalId;
  }

  async function rejectProposalAtomic(
    testOrgId: string,
    proposalId: string,
    actor: ActorRef,
    reason: string
  ) {
    return supabase.rpc('reject_proposal_atomic', {
      p_org_id: testOrgId,
      p_proposal_id: proposalId,
      p_rejector: actor,
      p_reason: reason,
    });
  }

  async function fetchProposalState(proposalId: string) {
    const { data, error } = await supabase
      .from('proposals')
      .select('status, rejection_reason')
      .eq('id', proposalId)
      .single();

    if (error) {
      throw new Error(`Failed to fetch proposal state: ${error.message}`);
    }

    return data;
  }

  async function cleanupOrgData(testOrgId: string): Promise<void> {
    const { error: proposalDeleteError } = await supabase
      .from('proposals')
      .delete()
      .eq('org_id', testOrgId);
    if (proposalDeleteError) {
      throw new Error(`Failed to cleanup proposals: ${proposalDeleteError.message}`);
    }
  }
});

function normalizeRejectedProposal(data: unknown): RejectedProposal | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return (data[0] ?? null) as RejectedProposal | null;
  }

  return data as RejectedProposal;
}
