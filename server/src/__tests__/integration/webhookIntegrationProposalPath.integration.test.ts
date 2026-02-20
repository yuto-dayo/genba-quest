import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';
import { __webhooksTestables } from '../../routes/webhooks';
import { ProposalService } from '../../services/ProposalService';
import { ActorRef } from '../../services/PolicyEngine';

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('Webhook integration proposal path integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;
  let proposalService: ProposalService;

  const integrationApprover: ActorRef = {
    type: 'integration',
    id: 'integration:gmail',
    name: 'Gmail Watcher',
  };
  const humanApprover: ActorRef = {
    type: 'human',
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Human Approver',
  };
  const humanRejector: ActorRef = {
    type: 'human',
    id: '22222222-2222-4222-8222-222222222222',
    name: 'Human Rejector',
  };

  jest.setTimeout(30_000);

  beforeEach(() => {
    orgId = randomUUID();
    proposalService = new ProposalService(orgId);
  });

  afterEach(async () => {
    await cleanupOrgData(orgId);
  });

  it('deduplicates integration proposals by source+externalId and keeps one record', async () => {
    const externalId = `${randomUUID()}:attachment-1`;
    const first = await __webhooksTestables.createOrReuseIntegrationProposal({
      orgId,
      type: 'expense.create',
      payload: {
        amount: 12000,
        category: 'material',
        description: 'webhook dedupe integration first',
      },
      description: 'webhook dedupe integration first',
      source: 'gmail',
      externalId,
      integrationName: 'Gmail Watcher',
      submit: true,
    });

    expect(first.deduplicated).toBe(false);
    expect(first.status).toBe('pending');

    const second = await __webhooksTestables.createOrReuseIntegrationProposal({
      orgId,
      type: 'expense.create',
      payload: {
        amount: 12000,
        category: 'material',
        description: 'webhook dedupe integration second',
      },
      description: 'webhook dedupe integration second',
      source: 'gmail',
      externalId,
      integrationName: 'Gmail Watcher',
      submit: true,
    });

    expect(second.deduplicated).toBe(true);
    expect(second.proposalId).toBe(first.proposalId);
    expect(second.status).toBe('pending');

    const proposalCount = await countProposal(orgId, first.proposalId);
    expect(proposalCount).toBe(1);
  });

  it('blocks integration actor approval and allows human approval', async () => {
    const created = await __webhooksTestables.createOrReuseIntegrationProposal({
      orgId,
      type: 'expense.create',
      payload: {
        amount: 18000,
        category: 'tool',
        description: 'webhook integration approval policy',
      },
      description: 'webhook integration approval policy',
      source: 'gmail',
      externalId: `${randomUUID()}:attachment-2`,
      integrationName: 'Gmail Watcher',
      submit: true,
    });

    expect(created.status).toBe('pending');

    await expect(
      proposalService.approve(created.proposalId, integrationApprover, 'integration actor approval attempt')
    ).rejects.toThrow('INTEGRATION_APPROVAL_PROHIBITED');

    const approved = await proposalService.approve(
      created.proposalId,
      humanApprover,
      'human approval for integration proposal'
    );
    expect(approved.isFullyApproved).toBe(true);
    expect(approved.proposal.status === 'approved' || approved.proposal.status === 'executed').toBe(true);
  });

  it('supports human rejection for pending integration proposal', async () => {
    const created = await __webhooksTestables.createOrReuseIntegrationProposal({
      orgId,
      type: 'expense.create',
      payload: {
        amount: 22000,
        category: 'material',
        description: 'webhook integration reject path',
      },
      description: 'webhook integration reject path',
      source: 'gmail',
      externalId: `${randomUUID()}:attachment-3`,
      integrationName: 'Gmail Watcher',
      submit: true,
    });

    expect(created.status).toBe('pending');

    const rejected = await proposalService.reject(
      created.proposalId,
      humanRejector,
      'manual reject from pending queue'
    );

    expect(rejected.status).toBe('rejected');
    expect(rejected.rejection_reason).toBe('manual reject from pending queue');
    expect(rejected.approvals.some((item) => item.decision === 'reject')).toBe(true);
  });

  async function countProposal(testOrgId: string, proposalId: string): Promise<number> {
    const { count, error } = await supabase
      .from('proposals')
      .select('*', { count: 'exact', head: true })
      .eq('org_id', testOrgId)
      .eq('id', proposalId);
    if (error) {
      throw new Error(`Failed to count proposals: ${error.message}`);
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
