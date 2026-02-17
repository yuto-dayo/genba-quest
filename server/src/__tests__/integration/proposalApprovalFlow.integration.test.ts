import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { ProposalService } from '../../services/ProposalService';
import { ActorRef } from '../../services/PolicyEngine';

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('Proposal approval flow integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;
  let proposalService: ProposalService;

  const creator: ActorRef = {
    type: 'human',
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Integration Creator',
  };
  const approver: ActorRef = {
    type: 'human',
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Integration Approver',
  };
  const rejector: ActorRef = {
    type: 'human',
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Integration Rejector',
  };

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
    proposalService = new ProposalService(orgId);
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
  });

  it('final approve auto-executes proposal and creates exactly one ledger event', async () => {
    const submitted = await proposalService.createAndSubmit({
      org_id: orgId,
      type: 'expense.create',
      payload: {
        amount: 12000,
        category: 'material',
        description: 'approval-flow integration: auto execute',
      },
      description: 'approval-flow integration: auto execute',
      created_by: creator,
    });

    expect(submitted.proposal.status).toBe('proposed');
    expect(submitted.autoApproved).toBe(false);
    expect(submitted.autoExecuted).toBe(false);

    const approved = await proposalService.approve(
      submitted.proposal.id,
      approver,
      'integration approval'
    );

    expect(approved.isFullyApproved).toBe(true);
    expect(approved.autoExecuted).toBe(true);
    expect(approved.proposal.status).toBe('executed');
    expect(approved.proposal.result_event_id).toBeTruthy();

    const ledgerEventCount = await countLedgerEvents(orgId, submitted.proposal.id);
    expect(ledgerEventCount).toBe(1);
  });

  it('approve remains successful when auto-execute fails, and proposal stays approved', async () => {
    const submitted = await proposalService.createAndSubmit({
      org_id: orgId,
      type: 'expense.create',
      payload: {
        amount: '99999999999999.99',
        category: 'material',
        description: 'approval-flow integration: overflow',
      },
      description: 'approval-flow integration: overflow',
      created_by: creator,
    });

    expect(submitted.proposal.status).toBe('proposed');

    const approved = await proposalService.approve(
      submitted.proposal.id,
      approver,
      'integration approval with expected execute failure'
    );

    expect(approved.isFullyApproved).toBe(true);
    expect(approved.autoExecuted).toBe(false);
    expect(approved.proposal.status).toBe('approved');
    expect(approved.proposal.result_event_id).toBeFalsy();

    const ledgerEventCount = await countLedgerEvents(orgId, submitted.proposal.id);
    expect(ledgerEventCount).toBe(0);
  });

  it('reject transitions proposed proposal to rejected with rejection reason', async () => {
    const submitted = await proposalService.createAndSubmit({
      org_id: orgId,
      type: 'expense.create',
      payload: {
        amount: 8000,
        category: 'tool',
        description: 'approval-flow integration: reject',
      },
      description: 'approval-flow integration: reject',
      created_by: creator,
    });

    expect(submitted.proposal.status).toBe('proposed');

    const rejected = await proposalService.reject(
      submitted.proposal.id,
      rejector,
      'integration rejection'
    );

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection_reason).toBe('integration rejection');
    expect(rejected.approvals.some((item) => item.decision === 'reject')).toBe(true);
  });

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
