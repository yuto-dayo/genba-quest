/**
 * Policy Engine
 * DAO設計原則: 承認ルールはポリシーとして外部化し、PolicyEngineで評価
 * 参照: docs/PROPOSAL_SYSTEM.md, docs/DESIGN_PHILOSOPHY.md
 */

import { supabaseAdmin } from "../lib/supabaseAdmin";

// ============================================================
// Types
// ============================================================

export type ProposalType =
  // 経費・売上
  | 'expense.create'
  | 'expense.update'
  | 'expense.void'
  | 'income.create'
  | 'income.update'
  // 請求
  | 'invoice.create'
  | 'invoice.send'
  | 'invoice.mark_paid'
  // 報酬
  | 'reward.calculate'
  | 'reward.adjust'
  | 'reward.pool.adjust'
  | 'path.level.update'
  | 'level.objection'
  // スキル・評価
  | 'skill.achieve'
  | 'skill.revoke'
  | 'evaluation.submit'
  | 'evaluation.finalize'
  // アサイン
  | 'assignment.create'
  | 'assignment.update'
  | 'assignment.cancel'
  | 'leave.request'
  // コミュニケーション
  | 'communication.review'
  | 'communication.task'
  | 'task.revision.request'
  // 現場
  | 'site.create'
  | 'site.complete'
  | 'site.close.finalize'
  | 'site.close.reopen'
  // ポリシー
  | 'policy.update'
  // プロフィール閲覧の本人承認 (Phase 2-1)
  | 'profile.view_request'
  // 本人主導の請求書発行 (Phase 2-2a)
  | 'invoice.member_issue'
  // LUQO評価システム
  | 'luqo.catalog.add'
  | 'luqo.star.achieve'
  | 'luqo.score.update'
  | 'luqo.reward.calculate';

export type ProposalStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'executed';

export type ActorType = 'human' | 'ai' | 'system' | 'integration';

export interface ActorRef {
  type: ActorType;
  id: string;
  name: string;
}

export interface Approval {
  actor: ActorRef;
  decision: 'approve' | 'reject';
  reason?: string;
  at: string;
}

export interface Proposal {
  id: string;
  org_id: string;
  type: ProposalType;
  status: ProposalStatus;
  document_id?: string | null;
  site_id?: string | null;
  created_by: ActorRef;
  payload: Record<string, unknown>;
  description: string;
  policy_ref?: string;
  approvals: Approval[];
  required_approvals: number;
  executed_at?: string;
  executed_by?: ActorRef;
  result_event_id?: string;
  rejection_reason?: string;
  created_at: string;
  updated_at: string;
}

export interface PolicyCondition {
  field: string;
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'contains' | 'in';
  value: unknown;
}

export interface ApproverSpec {
  type: 'role' | 'specific' | 'any_member' | 'all_members' | 'ai';
  value?: string;
}

export interface Policy {
  id: string;
  org_id: string;
  name: string;
  description?: string;
  proposal_type?: string;
  conditions: PolicyCondition[];
  required_approvers: ApproverSpec[];
  required_count: number;
  auto_approve: boolean;
  ai_can_approve: boolean;
  priority: number;
  is_active: boolean;
}

export interface PolicyEvaluationResult {
  policy: Policy;
  matched: boolean;
  autoApprove: boolean;
  requiredApprovals: number;
  aiCanApprove: boolean;
  requiredApprovers: ApproverSpec[];
}

// ============================================================
// Policy Engine
// ============================================================

export class PolicyEngine {
  private orgId: string;

  constructor(orgId: string = '00000000-0000-0000-0000-000000000001') {
    this.orgId = orgId;
  }

  /**
   * Proposalに適用するポリシーを取得
   */
  async getApplicablePolicy(proposal: Partial<Proposal>): Promise<Policy | null> {
    const { data: policies, error } = await supabaseAdmin
      .from('policies')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (error || !policies) {
      console.error('Failed to fetch policies:', error);
      return null;
    }

    // 優先度順にマッチするポリシーを探す
    for (const policy of policies) {
      // proposal_typeが指定されている場合はマッチ確認
      if (policy.proposal_type && policy.proposal_type !== proposal.type) {
        continue;
      }

      // 条件評価
      if (this.evaluateConditions(policy.conditions as PolicyCondition[], proposal)) {
        return policy as Policy;
      }
    }

    return null;
  }

  /**
   * 条件を評価
   */
  private evaluateConditions(conditions: PolicyCondition[], proposal: Partial<Proposal>): boolean {
    if (!conditions || conditions.length === 0) {
      return true;
    }

    // すべての条件がANDで結合
    return conditions.every(condition => this.evaluateSingleCondition(condition, proposal));
  }

  /**
   * 単一条件を評価
   */
  private evaluateSingleCondition(condition: PolicyCondition, proposal: Partial<Proposal>): boolean {
    const value = this.getNestedValue(proposal, condition.field);

    switch (condition.operator) {
      case 'eq':
        return value === condition.value;
      case 'neq':
        return value !== condition.value;
      case 'gt':
        return typeof value === 'number' && value > (condition.value as number);
      case 'gte':
        return typeof value === 'number' && value >= (condition.value as number);
      case 'lt':
        return typeof value === 'number' && value < (condition.value as number);
      case 'lte':
        return typeof value === 'number' && value <= (condition.value as number);
      case 'contains':
        return typeof value === 'string' && value.includes(condition.value as string);
      case 'in':
        return Array.isArray(condition.value) && condition.value.includes(value);
      default:
        return false;
    }
  }

  /**
   * ネストされたプロパティを取得
   */
  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  /**
   * ポリシーを評価してProposalに適用
   */
  async evaluateProposal(proposal: Partial<Proposal>): Promise<PolicyEvaluationResult> {
    const policy = await this.getApplicablePolicy(proposal);

    if (!policy) {
      const defaultApprovers: ApproverSpec[] = [{ type: 'any_member' }];
      // デフォルト: 1名承認、AI不可
      return {
        policy: {
          id: 'default',
          org_id: this.orgId,
          name: 'default_policy',
          conditions: [],
          required_approvers: defaultApprovers,
          required_count: 1,
          auto_approve: false,
          ai_can_approve: false,
          priority: 0,
          is_active: true,
        },
        matched: false,
        autoApprove: false,
        requiredApprovals: 1,
        aiCanApprove: false,
        requiredApprovers: defaultApprovers,
      };
    }

    const requiredApprovers = this.normalizeRequiredApprovers(policy.required_approvers);
    const requiredApprovals = await this.resolveRequiredApprovals(policy, proposal, requiredApprovers);

    return {
      policy,
      matched: true,
      autoApprove: policy.auto_approve,
      requiredApprovals,
      aiCanApprove: policy.ai_can_approve,
      requiredApprovers,
    };
  }

  /**
   * 承認可能かどうかをチェック
   * AI自己承認禁止ゲートを含む
   */
  async canApprove(
    proposal: Proposal,
    approver: ActorRef
  ): Promise<{ allowed: boolean; reason?: string }> {
    // 1. AI自己承認禁止チェック
    if (proposal.created_by.type === 'ai' && approver.type === 'ai') {
      return {
        allowed: false,
        reason: 'AI_SELF_APPROVAL_PROHIBITED',
      };
    }

    // 2. integration は作成専用。承認不可
    if (approver.type === 'integration') {
      return {
        allowed: false,
        reason: 'INTEGRATION_APPROVAL_PROHIBITED',
      };
    }

    // 2. ポリシー評価
    const evaluation = await this.evaluateProposal(proposal);

    // 3. AIが承認可能かチェック
    if (approver.type === 'ai' && !evaluation.aiCanApprove) {
      return {
        allowed: false,
        reason: 'AI_APPROVAL_NOT_ALLOWED_BY_POLICY',
      };
    }

    // 4. required_approvers に適合するかチェック
    const approverAllowed = await this.isApproverAllowedByPolicy(
      approver,
      evaluation.requiredApprovers
    );
    if (!approverAllowed) {
      return {
        allowed: false,
        reason: 'APPROVER_NOT_ALLOWED_BY_POLICY',
      };
    }

    // 5. 既に承認済みかチェック
    const alreadyApproved = proposal.approvals.some(
      a => a.actor.id === approver.id && a.decision === 'approve'
    );
    if (alreadyApproved) {
      return {
        allowed: false,
        reason: 'ALREADY_APPROVED_BY_THIS_ACTOR',
      };
    }

    // 6. 必要承認数に達しているかチェック
    const currentApprovals = proposal.approvals.filter(a => a.decision === 'approve').length;
    const requiredApprovals = proposal.required_approvals > 0
      ? proposal.required_approvals
      : evaluation.requiredApprovals;
    if (currentApprovals >= requiredApprovals) {
      return {
        allowed: false,
        reason: 'APPROVAL_COUNT_ALREADY_MET',
      };
    }

    return { allowed: true };
  }

  /**
   * 承認後、実行可能かどうかをチェック
   */
  async canExecute(proposal: Proposal): Promise<{ allowed: boolean; reason?: string }> {
    if (proposal.status !== 'approved') {
      return {
        allowed: false,
        reason: 'PROPOSAL_NOT_APPROVED',
      };
    }

    const evaluation = await this.evaluateProposal(proposal);
    const approveDecisions = proposal.approvals.filter(a => a.decision === 'approve');
    const currentApprovals = approveDecisions.length;
    const requiredApprovals = proposal.required_approvals > 0
      ? proposal.required_approvals
      : evaluation.requiredApprovals;

    if (currentApprovals < requiredApprovals) {
      return {
        allowed: false,
        reason: 'INSUFFICIENT_APPROVALS',
      };
    }

    const requirementsMet = await this.areApproverRequirementsMet(
      proposal,
      approveDecisions,
      evaluation.requiredApprovers
    );
    if (!requirementsMet) {
      return {
        allowed: false,
        reason: 'POLICY_APPROVER_REQUIREMENTS_NOT_MET',
      };
    }

    return { allowed: true };
  }

  private normalizeRequiredApprovers(requiredApprovers: unknown): ApproverSpec[] {
    if (!Array.isArray(requiredApprovers)) {
      return [];
    }

    const allowedTypes = new Set<ApproverSpec['type']>([
      'role',
      'specific',
      'any_member',
      'all_members',
      'ai',
    ]);

    return requiredApprovers.reduce<ApproverSpec[]>((acc, item) => {
      if (!item || typeof item !== 'object') {
        return acc;
      }

      const candidate = item as Record<string, unknown>;
      if (!allowedTypes.has(candidate.type as ApproverSpec['type'])) {
        return acc;
      }

      const spec: ApproverSpec = {
        type: candidate.type as ApproverSpec['type'],
      };

      if (typeof candidate.value === 'string' && candidate.value.length > 0) {
        spec.value = candidate.value;
      }

      acc.push(spec);
      return acc;
    }, []);
  }

  private async resolveRequiredApprovals(
    policy: Policy,
    proposal: Partial<Proposal>,
    requiredApprovers: ApproverSpec[]
  ): Promise<number> {
    if (policy.auto_approve) {
      return 0;
    }

    if (policy.required_count > 0) {
      return policy.required_count;
    }

    if (requiredApprovers.some(spec => spec.type === 'all_members')) {
      const memberCount = await this.countHumanMembers(proposal);
      return Math.max(memberCount, 1);
    }

    if (requiredApprovers.length > 0) {
      return 1;
    }

    return 1;
  }

  private async countHumanMembers(proposal: Partial<Proposal>): Promise<number> {
    let query = supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true });

    const proposerId = proposal.created_by?.type === 'human' ? proposal.created_by.id : null;
    if (typeof proposerId === 'string' && proposerId.length > 0) {
      query = query.neq('id', proposerId);
    }

    const { count, error } = await query;
    if (error) {
      console.error('Failed to count human members:', error);
      return 1;
    }

    return typeof count === 'number' ? count : 1;
  }

  private async isApproverAllowedByPolicy(
    approver: ActorRef,
    requiredApprovers: ApproverSpec[]
  ): Promise<boolean> {
    if (requiredApprovers.length === 0) {
      return approver.type === 'human' || approver.type === 'system';
    }

    if (requiredApprovers.some(spec => spec.type === 'all_members')) {
      return approver.type === 'human';
    }

    const roleMap = await this.loadRolesForActors([approver.id]);
    return requiredApprovers.some(spec => this.matchesApproverSpec(approver, spec, roleMap));
  }

  private async areApproverRequirementsMet(
    proposal: Proposal,
    approvals: Approval[],
    requiredApprovers: ApproverSpec[]
  ): Promise<boolean> {
    if (requiredApprovers.length === 0) {
      return approvals.length > 0 || proposal.required_approvals === 0;
    }

    if (requiredApprovers.some(spec => spec.type === 'all_members')) {
      const requiredMembers = await this.countHumanMembers(proposal);
      const approvedHumans = new Set(
        approvals
          .filter(approval => approval.actor.type === 'human')
          .map(approval => approval.actor.id)
      );
      return approvedHumans.size >= requiredMembers;
    }

    const uniqueApprovals = approvals.filter(
      (approval, index, arr) =>
        arr.findIndex(other => other.actor.id === approval.actor.id) === index
    );

    const roleMap = await this.loadRolesForActors(uniqueApprovals.map(approval => approval.actor.id));
    const remaining = [...uniqueApprovals];

    for (const spec of requiredApprovers) {
      const matchIndex = remaining.findIndex(approval =>
        this.matchesApproverSpec(approval.actor, spec, roleMap)
      );

      if (matchIndex === -1) {
        return false;
      }

      remaining.splice(matchIndex, 1);
    }

    return true;
  }

  private async loadRolesForActors(actorIds: string[]): Promise<Record<string, string>> {
    const uniqueIds = Array.from(
      new Set(actorIds.filter((id): id is string => typeof id === 'string' && id.length > 0))
    );
    if (uniqueIds.length === 0) {
      return {};
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, role')
      .in('id', uniqueIds);

    if (error || !data) {
      console.error('Failed to load actor roles:', error);
      return {};
    }

    return data.reduce<Record<string, string>>((acc, row) => {
      if (typeof row.id === 'string' && typeof row.role === 'string') {
        acc[row.id] = row.role;
      }
      return acc;
    }, {});
  }

  private matchesApproverSpec(
    approver: ActorRef,
    spec: ApproverSpec,
    roleMap: Record<string, string>
  ): boolean {
    switch (spec.type) {
      case 'any_member':
        return approver.type === 'human';
      case 'all_members':
        return approver.type === 'human';
      case 'ai':
        return approver.type === 'ai';
      case 'specific':
        return typeof spec.value === 'string' && approver.id === spec.value;
      case 'role':
        return (
          approver.type === 'human' &&
          typeof spec.value === 'string' &&
          roleMap[approver.id] === spec.value
        );
      default:
        return false;
    }
  }
}

// シングルトンエクスポート
export const policyEngine = new PolicyEngine();
