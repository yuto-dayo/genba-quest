import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const shouldRunIntegration = process.env.RUN_DB_INTEGRATION_TESTS === '1';
const describeIntegration = shouldRunIntegration ? describe : describe.skip;

describeIntegration('pending status unification integration', () => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for integration tests');
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  let orgId: string;

  beforeEach(() => {
    orgId = randomUUID();
  });

  afterEach(async () => {
    const { error } = await supabase
      .from('proposals')
      .delete()
      .eq('org_id', orgId);

    if (error) {
      throw new Error(`Failed to cleanup proposals: ${error.message}`);
    }
  });

  it('accepts pending and rejects proposed status on proposals table', async () => {
    const pendingProposalId = randomUUID();
    const proposedProposalId = randomUUID();

    const pendingInsert = await supabase.from('proposals').insert({
      id: pendingProposalId,
      org_id: orgId,
      type: 'expense.create',
      status: 'pending',
      created_by: { type: 'human', id: randomUUID(), name: 'Integration Creator' },
      payload: { amount: '1000', category: 'material', description: 'pending status check' },
      description: 'pending status check',
      required_approvals: 1,
      approvals: [],
    });

    expect(pendingInsert.error).toBeNull();

    const proposedInsert = await supabase.from('proposals').insert({
      id: proposedProposalId,
      org_id: orgId,
      type: 'expense.create',
      status: 'proposed',
      created_by: { type: 'human', id: randomUUID(), name: 'Integration Creator' },
      payload: { amount: '1000', category: 'material', description: 'proposed status check' },
      description: 'proposed status check',
      required_approvals: 1,
      approvals: [],
    });

    expect(proposedInsert.error).not.toBeNull();
    expect(proposedInsert.error?.message ?? '').toMatch(/check constraint|violates|status/i);

    const { data: insertedPending, error: fetchError } = await supabase
      .from('proposals')
      .select('status')
      .eq('id', pendingProposalId)
      .single();

    expect(fetchError).toBeNull();
    expect(insertedPending?.status).toBe('pending');
  });
});
