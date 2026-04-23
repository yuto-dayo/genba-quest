/**
 * テストフィクスチャ
 * ProposalService / PolicyEngine のテスト用データ定義
 */

import type { ActorRef, Proposal, Policy, PolicyCondition } from '../../services/PolicyEngine';

// ============================================================
// Actor fixtures
// ============================================================

export const actors = {
  human: { type: 'human' as const, id: 'user-001', name: 'テスト太郎' },
  ai: { type: 'ai' as const, id: 'sherpa-001', name: 'Sherpa' },
  system: { type: 'system' as const, id: 'system', name: 'System Auto-Execute' },
  integration: { type: 'integration' as const, id: 'gmail-001', name: 'Gmail Watcher' },
  humanB: { type: 'human' as const, id: 'user-002', name: 'テスト花子' },
  manager: { type: 'human' as const, id: 'user-003', name: '管理者次郎' },
} satisfies Record<string, ActorRef>;

// ============================================================
// Org / ID constants
// ============================================================

export const TEST_ORG_ID = '00000000-0000-0000-0000-000000000001';
export const TEST_PROPOSAL_ID = 'pppp0000-0000-0000-0000-000000000001';
export const TEST_EVENT_ID = 'eeee0000-0000-0000-0000-000000000001';
export const TEST_TRANSACTION_ID = 'tttt0000-0000-0000-0000-000000000001';
export const TEST_SITE_ID = 'ssss0000-0000-0000-0000-000000000001';
export const TEST_ASSIGNMENT_ID = 'aaaa0000-0000-4000-8000-000000000001';
export const TEST_WORKER_ID = '11111111-1111-4111-8111-111111111111';
export const TEST_TARGET_SITE_ID = '22222222-2222-4222-8222-222222222222';
export const TEST_PREVIOUS_SITE_ID = '33333333-3333-4333-8333-333333333333';

// ============================================================
// Proposal fixtures
// ============================================================

const baseProposal = {
  org_id: TEST_ORG_ID,
  type: 'expense.create' as const,
  created_by: actors.human,
  payload: { amount: 3000, category: 'material', description: 'テスト資材購入' },
  description: 'テスト資材購入 ¥3,000',
  approvals: [],
  required_approvals: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

export function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: TEST_PROPOSAL_ID,
    ...baseProposal,
    ...overrides,
  } as Proposal;
}

export const proposals = {
  draft: makeProposal({ status: 'draft' }),
  pending: makeProposal({ status: 'pending' }),
  approved: makeProposal({ status: 'approved' }),
  executed: makeProposal({
    status: 'executed',
    executed_at: '2026-01-02T00:00:00Z',
    executed_by: actors.system,
    result_event_id: TEST_EVENT_ID,
  }),
  rejected: makeProposal({
    status: 'rejected',
    rejection_reason: 'テスト却下理由',
  }),
  aiCreated: makeProposal({
    status: 'pending',
    created_by: actors.ai,
  }),
};

// ============================================================
// Proposal payload fixtures
// ============================================================

export const proposalPayloads = {
  assignmentUpdate: {
    assignment_id: TEST_ASSIGNMENT_ID,
    user_id: TEST_WORKER_ID,
    site_id: TEST_TARGET_SITE_ID,
    date: '2026-04-21',
    previous_site_id: TEST_PREVIOUS_SITE_ID,
    previous_date: '2026-04-18',
    reason: 'Rain delay reassign',
  },
  assignmentCancel: {
    assignment_id: TEST_ASSIGNMENT_ID,
    user_id: TEST_WORKER_ID,
    site_id: TEST_TARGET_SITE_ID,
    date: '2026-04-18',
    reason: 'Site closed due to inspection',
  },
  siteComplete: {
    site_id: TEST_TARGET_SITE_ID,
    effective_completed_at: '2026-04-18T09:30:00Z',
  },
} as const;

// ============================================================
// Policy fixtures
// ============================================================

export const policies = {
  autoApprove: {
    id: 'policy-auto',
    org_id: TEST_ORG_ID,
    name: 'auto_approve_small',
    description: '5000円以下は自動承認',
    proposal_type: 'expense.create',
    conditions: [{ field: 'payload.amount', operator: 'lte', value: 5000 }] as PolicyCondition[],
    required_approvers: [{ type: 'any_member' as const }],
    required_count: 0,
    auto_approve: true,
    ai_can_approve: false,
    priority: 10,
    is_active: true,
  } satisfies Policy,

  requireOneApproval: {
    id: 'policy-one',
    org_id: TEST_ORG_ID,
    name: 'require_one_approval',
    description: '1名承認必要',
    proposal_type: undefined,
    conditions: [],
    required_approvers: [{ type: 'any_member' as const }],
    required_count: 1,
    auto_approve: false,
    ai_can_approve: false,
    priority: 5,
    is_active: true,
  } satisfies Policy,

  aiCanApprove: {
    id: 'policy-ai',
    org_id: TEST_ORG_ID,
    name: 'ai_can_approve',
    description: 'AI承認許可',
    proposal_type: undefined,
    conditions: [],
    required_approvers: [{ type: 'ai' as const }],
    required_count: 1,
    auto_approve: false,
    ai_can_approve: true,
    priority: 5,
    is_active: true,
  } satisfies Policy,

  roleAndMemberApproval: {
    id: 'policy-role-member',
    org_id: TEST_ORG_ID,
    name: 'role_and_member_approval',
    description: '管理者1名 + 任意メンバー1名',
    proposal_type: undefined,
    conditions: [],
    required_approvers: [{ type: 'role' as const, value: 'manager' }, { type: 'any_member' as const }],
    required_count: 2,
    auto_approve: false,
    ai_can_approve: false,
    priority: 5,
    is_active: true,
  } satisfies Policy,

  allMembersApproval: {
    id: 'policy-all-members',
    org_id: TEST_ORG_ID,
    name: 'all_members_approval',
    description: '全員承認',
    proposal_type: undefined,
    conditions: [],
    required_approvers: [{ type: 'all_members' as const }],
    required_count: 0,
    auto_approve: false,
    ai_can_approve: false,
    priority: 5,
    is_active: true,
  } satisfies Policy,
};

// ============================================================
// Ledger fixtures
// ============================================================

export const ledgerEvent = {
  id: TEST_EVENT_ID,
  org_id: TEST_ORG_ID,
  event_type: 'expense_recorded',
  proposal_id: TEST_PROPOSAL_ID,
  payload: { amount: 3000, category: 'material' },
  actor: actors.system,
  created_at: '2026-01-02T00:00:00Z',
};
