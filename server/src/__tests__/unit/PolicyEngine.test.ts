import { createChain, setupMockFromSequence } from '../helpers/mockSupabase';
import { actors, policies, proposals, TEST_ORG_ID } from '../helpers/fixtures';

// supabaseAdmin をモジュールレベルでモック
jest.mock('../../lib/supabaseAdmin', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { PolicyEngine } from '../../services/PolicyEngine';

const mockFrom = supabaseAdmin.from as jest.Mock;

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeEach(() => {
    engine = new PolicyEngine(TEST_ORG_ID);
    jest.clearAllMocks();
  });

  // ============================================================
  // evaluateConditions (private, pure function)
  // ============================================================

  describe('evaluateConditions (via private access)', () => {
    const evaluate = (conditions: unknown[], proposal: Record<string, unknown>) =>
      (engine as any).evaluateConditions(conditions, proposal);

    it('空の条件配列は true を返す', () => {
      expect(evaluate([], {})).toBe(true);
    });

    it('null/undefined の条件は true を返す', () => {
      expect(evaluate(null as any, {})).toBe(true);
      expect(evaluate(undefined as any, {})).toBe(true);
    });

    describe('operator: eq', () => {
      it('一致する場合 true', () => {
        expect(evaluate(
          [{ field: 'type', operator: 'eq', value: 'expense.create' }],
          { type: 'expense.create' }
        )).toBe(true);
      });

      it('一致しない場合 false', () => {
        expect(evaluate(
          [{ field: 'type', operator: 'eq', value: 'expense.create' }],
          { type: 'income.create' }
        )).toBe(false);
      });
    });

    describe('operator: neq', () => {
      it('異なる場合 true', () => {
        expect(evaluate(
          [{ field: 'status', operator: 'neq', value: 'rejected' }],
          { status: 'draft' }
        )).toBe(true);
      });
    });

    describe('operator: gt / gte / lt / lte', () => {
      it('gt: 3000 > 2000 → true', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'gt', value: 2000 }],
          { payload: { amount: 3000 } }
        )).toBe(true);
      });

      it('gte: 5000 >= 5000 → true', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'gte', value: 5000 }],
          { payload: { amount: 5000 } }
        )).toBe(true);
      });

      it('lt: 1000 < 5000 → true', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'lt', value: 5000 }],
          { payload: { amount: 1000 } }
        )).toBe(true);
      });

      it('lte: 5000 <= 5000 → true', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'lte', value: 5000 }],
          { payload: { amount: 5000 } }
        )).toBe(true);
      });

      it('数値以外は false', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'gt', value: 100 }],
          { payload: { amount: 'not_a_number' } }
        )).toBe(false);
      });
    });

    describe('operator: contains', () => {
      it('文字列を含む場合 true', () => {
        expect(evaluate(
          [{ field: 'description', operator: 'contains', value: '資材' }],
          { description: 'テスト資材購入' }
        )).toBe(true);
      });

      it('文字列でない場合 false', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'contains', value: '100' }],
          { payload: { amount: 100 } }
        )).toBe(false);
      });
    });

    describe('operator: in', () => {
      it('配列に含まれる場合 true', () => {
        expect(evaluate(
          [{ field: 'type', operator: 'in', value: ['expense.create', 'expense.update'] }],
          { type: 'expense.create' }
        )).toBe(true);
      });

      it('配列に含まれない場合 false', () => {
        expect(evaluate(
          [{ field: 'type', operator: 'in', value: ['income.create'] }],
          { type: 'expense.create' }
        )).toBe(false);
      });
    });

    describe('ネストされたフィールド', () => {
      it('payload.amount のようなドットパスを解決する', () => {
        expect(evaluate(
          [{ field: 'payload.amount', operator: 'eq', value: 3000 }],
          { payload: { amount: 3000 } }
        )).toBe(true);
      });

      it('存在しないパスは undefined', () => {
        expect(evaluate(
          [{ field: 'payload.nonexistent.deep', operator: 'eq', value: 'x' }],
          { payload: {} }
        )).toBe(false);
      });
    });

    describe('複数条件 (AND)', () => {
      it('すべての条件を満たす場合 true', () => {
        expect(evaluate(
          [
            { field: 'type', operator: 'eq', value: 'expense.create' },
            { field: 'payload.amount', operator: 'lte', value: 5000 },
          ],
          { type: 'expense.create', payload: { amount: 3000 } }
        )).toBe(true);
      });

      it('1つでも満たさない場合 false', () => {
        expect(evaluate(
          [
            { field: 'type', operator: 'eq', value: 'expense.create' },
            { field: 'payload.amount', operator: 'lte', value: 5000 },
          ],
          { type: 'expense.create', payload: { amount: 10000 } }
        )).toBe(false);
      });
    });
  });

  // ============================================================
  // canApprove
  // ============================================================

  describe('canApprove', () => {
    it('AI が AI 作成 Proposal を承認 → AI_SELF_APPROVAL_PROHIBITED', async () => {
      const result = await engine.canApprove(proposals.aiCreated, actors.ai);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('AI_SELF_APPROVAL_PROHIBITED');
    });

    it('integration actor は常に承認不可', async () => {
      const result = await engine.canApprove(proposals.proposed, actors.integration);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('INTEGRATION_APPROVAL_PROHIBITED');
    });

    it('role 制約に合わない承認者は拒否される', async () => {
      const rolePolicy = {
        ...policies.requireOneApproval,
        required_approvers: [{ type: 'role' as const, value: 'manager' }],
      };

      const policyChain = createChain({ data: [rolePolicy], error: null });
      const roleChain = createChain({ data: [{ id: actors.human.id, role: 'member' }], error: null });
      setupMockFromSequence(mockFrom, [policyChain, roleChain]);

      const result = await engine.canApprove(proposals.proposed, actors.human);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('APPROVER_NOT_ALLOWED_BY_POLICY');
    });

    it('human が AI 作成 Proposal を承認 → 許可（ポリシーでAI承認不可でも human は通る）', async () => {
      const chain = createChain({ data: [policies.requireOneApproval], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.canApprove(proposals.aiCreated, actors.human);
      expect(result.allowed).toBe(true);
    });

    it('AI がポリシーで ai_can_approve=false の場合 → AI_APPROVAL_NOT_ALLOWED_BY_POLICY', async () => {
      const humanProposal = proposals.proposed; // created_by: human
      const chain = createChain({ data: [policies.requireOneApproval], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.canApprove(humanProposal, actors.ai);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('AI_APPROVAL_NOT_ALLOWED_BY_POLICY');
    });

    it('AI がポリシーで ai_can_approve=true の場合 → 許可', async () => {
      const humanProposal = proposals.proposed;
      const chain = createChain({ data: [policies.aiCanApprove], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.canApprove(humanProposal, actors.ai);
      expect(result.allowed).toBe(true);
    });

    it('既に承認済みのアクターが再承認 → ALREADY_APPROVED_BY_THIS_ACTOR', async () => {
      const alreadyApproved = {
        ...proposals.proposed,
        approvals: [{ actor: actors.human, decision: 'approve' as const, at: '2026-01-01T00:00:00Z' }],
      };
      const chain = createChain({ data: [policies.requireOneApproval], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.canApprove(alreadyApproved, actors.human);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('ALREADY_APPROVED_BY_THIS_ACTOR');
    });

    it('必要承認数に達している場合 → APPROVAL_COUNT_ALREADY_MET', async () => {
      const fullyApproved = {
        ...proposals.proposed,
        approvals: [{ actor: actors.human, decision: 'approve' as const, at: '2026-01-01T00:00:00Z' }],
      };
      const chain = createChain({ data: [policies.requireOneApproval], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.canApprove(fullyApproved, actors.humanB);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('APPROVAL_COUNT_ALREADY_MET');
    });
  });

  // ============================================================
  // canExecute
  // ============================================================

  describe('canExecute', () => {
    it('approved 状態 + 承認数充足 → 許可', async () => {
      const approved = {
        ...proposals.approved,
        approvals: [{ actor: actors.human, decision: 'approve' as const, at: '2026-01-01T00:00:00Z' }],
      };
      const chain = createChain({ data: [policies.requireOneApproval], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.canExecute(approved);
      expect(result.allowed).toBe(true);
    });

    it('proposed 状態 → PROPOSAL_NOT_APPROVED', async () => {
      const result = await engine.canExecute(proposals.proposed);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('PROPOSAL_NOT_APPROVED');
    });

    it('required_approvers を満たさない場合は実行不可', async () => {
      const approved = {
        ...proposals.approved,
        required_approvals: 2,
        approvals: [
          { actor: actors.human, decision: 'approve' as const, at: '2026-01-01T00:00:00Z' },
          { actor: actors.humanB, decision: 'approve' as const, at: '2026-01-01T00:10:00Z' },
        ],
      };

      const policyChain = createChain({ data: [policies.roleAndMemberApproval], error: null });
      const roleChain = createChain({
        data: [
          { id: actors.human.id, role: 'member' },
          { id: actors.humanB.id, role: 'member' },
        ],
        error: null,
      });
      setupMockFromSequence(mockFrom, [policyChain, roleChain]);

      const result = await engine.canExecute(approved);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('POLICY_APPROVER_REQUIREMENTS_NOT_MET');
    });
  });

  // ============================================================
  // evaluateProposal
  // ============================================================

  describe('evaluateProposal', () => {
    it('マッチするポリシーがない場合、デフォルトポリシーを返す', async () => {
      const chain = createChain({ data: [], error: null });
      mockFrom.mockReturnValue(chain);

      const result = await engine.evaluateProposal(proposals.draft);
      expect(result.matched).toBe(false);
      expect(result.policy.name).toBe('default_policy');
      expect(result.requiredApprovals).toBe(1);
      expect(result.autoApprove).toBe(false);
    });

    it('autoApprove ポリシーにマッチ → autoApprove: true', async () => {
      const chain = createChain({ data: [policies.autoApprove], error: null });
      mockFrom.mockReturnValue(chain);

      const proposal = { ...proposals.draft, payload: { amount: 3000 } };
      const result = await engine.evaluateProposal(proposal);
      expect(result.matched).toBe(true);
      expect(result.autoApprove).toBe(true);
    });

    it('all_members + required_count=0 はメンバー数から requiredApprovals を解決する', async () => {
      const policyChain = createChain({ data: [policies.allMembersApproval], error: null });
      const countChain = createChain({ data: null, error: null });
      (countChain as any)._result = { data: null, error: null, count: 3 };
      setupMockFromSequence(mockFrom, [policyChain, countChain]);

      const result = await engine.evaluateProposal(proposals.draft);
      expect(result.requiredApprovals).toBe(3);
    });

    it('Supabase エラー時はデフォルトポリシーを返す', async () => {
      const chain = createChain({ data: null, error: { message: 'DB error' } });
      mockFrom.mockReturnValue(chain);

      const result = await engine.evaluateProposal(proposals.draft);
      expect(result.matched).toBe(false);
    });
  });
});
