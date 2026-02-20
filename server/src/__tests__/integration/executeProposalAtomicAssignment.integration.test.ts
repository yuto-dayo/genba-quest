import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

type RpcProposalResult = {
  status: string;
};

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('execute_proposal_atomic assignment side effects integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;
  let siteId: string;

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
    siteId = randomUUID();
  });

  afterEach(async () => {
    const { error: proposalDeleteError } = await supabase
      .from('proposals')
      .delete()
      .eq('org_id', orgId);
    if (proposalDeleteError) {
      throw new Error(`Failed to cleanup proposals: ${proposalDeleteError.message}`);
    }

    const { error: siteDeleteError } = await supabase
      .from('sites')
      .delete()
      .eq('id', siteId);
    if (siteDeleteError) {
      throw new Error(`Failed to cleanup sites: ${siteDeleteError.message}`);
    }
  });

  it('assignment.create execution updates sites.assigned_users', async () => {
    const workerId = randomUUID();
    const proposalId = randomUUID();
    const now = new Date().toISOString();

    const { error: siteInsertError } = await supabase.from('sites').insert({
      id: siteId,
      name: 'execute_proposal_atomic assignment integration site',
      status: 'active',
    });
    if (siteInsertError) {
      throw new Error(`Failed to insert site: ${siteInsertError.message}`);
    }

    const { error: proposalInsertError } = await supabase.from('proposals').insert({
      id: proposalId,
      org_id: orgId,
      type: 'assignment.create',
      status: 'approved',
      created_by: {
        type: 'human',
        id: randomUUID(),
        name: 'Assignment Integration Creator',
      },
      payload: {
        site_id: siteId,
        worker_ids: [workerId],
        description: 'execute_proposal_atomic assignment integration test',
      },
      description: 'execute_proposal_atomic assignment integration test',
      required_approvals: 1,
      approvals: [
        {
          actor: { type: 'human', id: randomUUID(), name: 'Assignment Integration Approver' },
          decision: 'approve',
          reason: 'integration test approval',
          at: now,
        },
      ],
    });
    if (proposalInsertError) {
      throw new Error(`Failed to insert assignment proposal: ${proposalInsertError.message}`);
    }

    const result = await supabase.rpc('execute_proposal_atomic', {
      p_org_id: orgId,
      p_proposal_id: proposalId,
      p_executor: {
        type: 'system',
        id: 'integration-test-runner',
        name: 'Integration Test Runner',
      },
    });

    expect(result.error).toBeNull();

    const executed = normalizeRpcProposal(result.data);
    expect(executed?.status).toBe('executed');

    const { data: siteAfter, error: siteFetchError } = await supabase
      .from('sites')
      .select('assigned_users')
      .eq('id', siteId)
      .single();
    if (siteFetchError) {
      throw new Error(`Failed to fetch updated site: ${siteFetchError.message}`);
    }

    const assignedUsers = Array.isArray(siteAfter.assigned_users)
      ? siteAfter.assigned_users.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    expect(assignedUsers).toContain(workerId);
  });
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
