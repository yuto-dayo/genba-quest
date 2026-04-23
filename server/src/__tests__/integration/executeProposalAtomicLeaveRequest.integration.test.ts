import { randomInt, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

type RpcProposalResult = {
  status: string;
};

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('execute_proposal_atomic leave.request side effects integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let orgId: string;
  let reasonMarker: string;
  let userId: string;
  let startDate: string;
  let endDate: string;

  jest.setTimeout(30_000);

  beforeEach(async () => {
    orgId = randomUUID();
    reasonMarker = `leave-request-integration-${randomUUID()}`;
    ({ startDate, endDate } = buildFutureDateRange());
    userId = await createTestUser();
  });

  afterEach(async () => {
    const { error: scheduleDeleteError } = await supabase
      .from('personal_schedules')
      .delete()
      .eq('reason', reasonMarker);
    if (scheduleDeleteError) {
      throw new Error(`Failed to cleanup personal schedules: ${scheduleDeleteError.message}`);
    }

    const { error: ledgerEventDeleteError } = await supabase
      .from('ledger_events')
      .delete()
      .eq('org_id', orgId);
    if (ledgerEventDeleteError) {
      throw new Error(`Failed to cleanup ledger events: ${ledgerEventDeleteError.message}`);
    }

    const { error: proposalDeleteError } = await supabase
      .from('proposals')
      .delete()
      .eq('org_id', orgId);
    if (proposalDeleteError) {
      throw new Error(`Failed to cleanup proposals: ${proposalDeleteError.message}`);
    }

    const { error: userDeleteError } = await supabase.auth.admin.deleteUser(userId);
    if (userDeleteError) {
      throw new Error(`Failed to cleanup auth user: ${userDeleteError.message}`);
    }
  });

  it('leave.request execution writes approved personal_schedules and remains idempotent', async () => {
    const proposalId = randomUUID();
    const now = new Date().toISOString();

    const { error: proposalInsertError } = await supabase.from('proposals').insert({
      id: proposalId,
      org_id: orgId,
      type: 'leave.request',
      status: 'approved',
      created_by: {
        type: 'human',
        id: userId,
        name: 'Leave Request Integration Creator',
      },
      payload: {
        user_id: userId,
        start_date: startDate,
        end_date: endDate,
        leave_type: 'vacation',
        reason: reasonMarker,
      },
      description: reasonMarker,
      required_approvals: 1,
      approvals: [
        {
          actor: {
            type: 'human',
            id: userId,
            name: 'Leave Request Integration Approver',
          },
          decision: 'approve',
          reason: 'integration test approval',
          at: now,
        },
      ],
    });
    if (proposalInsertError) {
      throw new Error(`Failed to insert leave.request proposal: ${proposalInsertError.message}`);
    }

    const firstExecute = await executeProposalAtomic(orgId, proposalId);
    expect(firstExecute.error).toBeNull();

    const firstProposal = normalizeRpcProposal(firstExecute.data);
    expect(firstProposal?.status).toBe('executed');

    const firstEventType = await fetchLedgerEventType(orgId, proposalId);
    expect(firstEventType).toBe('leave.recorded');

    const firstScheduleCount = await countPersonalSchedules(userId, reasonMarker);
    expect(firstScheduleCount).toBe(1);

    const schedule = await fetchPersonalSchedule(userId, reasonMarker);
    expect(schedule.approved).toBe(true);
    expect(schedule.type).toBe('vacation');
    expect(schedule.start_date).toBe(startDate);
    expect(schedule.end_date).toBe(endDate);

    const secondExecute = await executeProposalAtomic(orgId, proposalId);
    expect(secondExecute.error).toBeNull();

    const secondProposal = normalizeRpcProposal(secondExecute.data);
    expect(secondProposal?.status).toBe('executed');

    const secondScheduleCount = await countPersonalSchedules(userId, reasonMarker);
    expect(secondScheduleCount).toBe(1);
  });

  async function createTestUser(): Promise<string> {
    const email = `integration-leave-${randomUUID()}@example.com`;
    const password = `P@ssword-${randomUUID()}-Aa1`;

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (error || !data.user?.id) {
      throw new Error(`Failed to create auth user: ${error?.message ?? 'unknown error'}`);
    }

    return data.user.id;
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

  async function countPersonalSchedules(testUserId: string, testReason: string): Promise<number> {
    const { count, error } = await supabase
      .from('personal_schedules')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', testUserId)
      .eq('reason', testReason);

    if (error) {
      throw new Error(`Failed to count personal schedules: ${error.message}`);
    }

    return count ?? 0;
  }

  async function fetchLedgerEventType(testOrgId: string, proposalId: string): Promise<string> {
    const { data, error } = await supabase
      .from('ledger_events')
      .select('event_type')
      .eq('org_id', testOrgId)
      .eq('proposal_id', proposalId)
      .single();

    if (error || !data?.event_type) {
      throw new Error(`Failed to fetch ledger event: ${error?.message ?? 'not found'}`);
    }

    return data.event_type;
  }

  async function fetchPersonalSchedule(testUserId: string, testReason: string) {
    const { data, error } = await supabase
      .from('personal_schedules')
      .select('approved, type, start_date, end_date')
      .eq('user_id', testUserId)
      .eq('reason', testReason)
      .single();

    if (error || !data) {
      throw new Error(`Failed to fetch personal schedule: ${error?.message ?? 'not found'}`);
    }

    return data;
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

function buildFutureDateRange(): { startDate: string; endDate: string } {
  const day = randomInt(1, 27);
  const nextDay = day + 1;

  return {
    startDate: `2099-12-${String(day).padStart(2, '0')}`,
    endDate: `2099-12-${String(nextDay).padStart(2, '0')}`,
  };
}
