/**
 * Proposal Service
 * DAO設計原則: 全状態変更はProposal経由で記録し監査可能に
 * 参照: docs/PROPOSAL_SYSTEM.md, docs/DESIGN_PHILOSOPHY.md
 */

import { supabaseAdmin } from "../lib/supabaseAdmin";
import {
  PolicyEngine,
  Proposal,
  ProposalType,
  ProposalStatus,
  ActorRef,
  Approval,
} from "./PolicyEngine";
import {
  BIG_SKILL_KEYS,
  BIG_SKILL_STATE_OPTIONS,
  PATH_LEVEL_OPTIONS,
  PROFILE_CERTIFICATION_STATUS_OPTIONS,
} from "./PathEvaluationService";
import { PathGovernedModuleService } from "./PathGovernedModuleService";
import { PathV31Service } from "./PathV31Service";
import { PathV32SimpleRewardService } from "./PathV32SimpleRewardService";
import { LUQOService } from "./LUQOService";
import { assignOnSubmit } from "./ProposalAssignmentService";
import { ProfileViewConsentService, profileViewConsentService } from "./ProfileViewConsentService";

// ============================================================
// Types
// ============================================================

export interface CreateProposalInput {
  id?: string;
  type: ProposalType;
  payload: Record<string, unknown>;
  description: string;
  created_by: ActorRef;
  org_id?: string;
  document_id?: string | null;
  site_id?: string | null;
  idempotency_key?: string | null;
}

export interface SubmitResult {
  proposal: Proposal;
  autoApproved: boolean;
  autoExecuted: boolean;
}

export interface ApprovalResult {
  proposal: Proposal;
  isFullyApproved: boolean;
  autoExecuted: boolean;
}

export interface BatchApprovalItemResult {
  proposalId: string;
  success: boolean;
  proposal?: Proposal;
  isFullyApproved?: boolean;
  autoExecuted?: boolean;
  error?: string;
}

export interface BatchApprovalResult {
  total: number;
  successCount: number;
  failedCount: number;
  results: BatchApprovalItemResult[];
}

export interface BatchRejectItemResult {
  proposalId: string;
  success: boolean;
  proposal?: Proposal;
  error?: string;
}

export interface BatchRejectResult {
  total: number;
  successCount: number;
  failedCount: number;
  results: BatchRejectItemResult[];
}

export interface LedgerEvent {
  id: string;
  org_id: string;
  event_type: string;
  proposal_id: string;
  payload: Record<string, unknown>;
  actor: ActorRef;
  created_at: string;
}

interface LedgerEntryDraft {
  accountCode: string;
  debitAmount: number;
  creditAmount: number;
  memo?: string;
}

const ACCOUNT_CODES = {
  cash: '1100',
  accountsReceivable: '1200',
  accruedRewards: '2130',
  sales: '4100',
  materials: '5100',
  tools: '5200',
  travel: '5300',
  food: '5400',
  rewardsExpense: '5500',
  otherExpense: '5900',
} as const;

const PERSONAL_SCHEDULE_TYPES = ['vacation', 'sick_leave', 'business_trip', 'training'] as const;
type PersonalScheduleType = typeof PERSONAL_SCHEDULE_TYPES[number];

function readUuidLike(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function resolveProposalAnchorFields(
  payload: Record<string, unknown>,
): Pick<
  Record<string, unknown>,
  'month_close_id' | 'revenue_basis_id' | 'adjusts_reward_run_id' | 'reward_rule_version_id' | 'calculation_system'
> {
  return {
    month_close_id: readUuidLike(payload.month_close_id),
    revenue_basis_id: readUuidLike(payload.revenue_basis_id),
    adjusts_reward_run_id: readUuidLike(payload.adjusts_reward_run_id ?? payload.reward_run_id),
    reward_rule_version_id: readUuidLike(payload.reward_rule_version_id),
    calculation_system:
      typeof payload.calculation_system === 'string' && payload.calculation_system.trim().length > 0
        ? payload.calculation_system.trim()
        : null,
  };
}

// ============================================================
// Proposal Service
// ============================================================

export class ProposalService {
  private engine: PolicyEngine;
  private orgId: string;
  private disableRpcFallback: boolean;
  private pathGovernedModuleService: PathGovernedModuleService;
  private pathV31Service: PathV31Service;
  private pathV32SimpleRewardService: PathV32SimpleRewardService;
  private profileViewConsentService: ProfileViewConsentService;

  constructor(orgId: string = '00000000-0000-0000-0000-000000000001') {
    this.orgId = orgId;
    this.engine = new PolicyEngine(orgId);
    this.pathGovernedModuleService = new PathGovernedModuleService(orgId);
    this.pathV31Service = new PathV31Service(orgId);
    this.pathV32SimpleRewardService = new PathV32SimpleRewardService(orgId);
    this.profileViewConsentService = profileViewConsentService;
    const fallbackMode = (process.env.PROPOSAL_RPC_FALLBACK_MODE || 'allow').toLowerCase();
    this.disableRpcFallback = ['disabled', 'deny', 'off'].includes(fallbackMode);
  }

  private fallbackToLegacyFlowOrThrow(): null {
    if (this.disableRpcFallback) {
      throw new Error('ATOMIC_RPC_REQUIRED');
    }
    return null;
  }

  /**
   * Proposal作成（draft状態）
   */
  async create(input: CreateProposalInput): Promise<Proposal> {
    if (input.type === 'luqo.reward.calculate') {
      const breakdown = Array.isArray(input.payload.breakdown)
        ? input.payload.breakdown
        : [];
      await new LUQOService(input.org_id || this.orgId).assertLegacyRewardMembers(
        breakdown as Array<{ member_id: string; name: string }>,
      );
    }

    const evaluation = await this.engine.evaluateProposal({
      type: input.type,
      payload: input.payload,
      created_by: input.created_by,
    });

    const insertPayload: Record<string, unknown> = {
      org_id: input.org_id || this.orgId,
      type: input.type,
      status: 'draft',
      document_id: input.document_id || null,
      site_id: input.site_id || null,
      created_by: input.created_by,
      payload: input.payload,
      description: input.description,
      policy_ref: evaluation.policy.name,
      required_approvals: evaluation.requiredApprovals,
      approvals: [],
      idempotency_key: input.idempotency_key ?? null,
      ...resolveProposalAnchorFields(input.payload),
    };
    if (input.id) {
      insertPayload.id = input.id;
    }

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create proposal: ${error.message}`);
    }

    const createdProposal = data as Proposal;
    await this.recordGovernanceEvent(createdProposal, 'governance.proposal.created', input.created_by, {
      lifecycle_status: createdProposal.status,
    });

    return createdProposal;
  }

  /**
   * Proposal提出（draft → pending）
   * 自動承認の場合は即時 approved/executed に遷移
   */
  async submit(proposalId: string, submitter: ActorRef): Promise<SubmitResult> {
    const proposal = await this.getById(proposalId);

    if (!proposal) {
      throw new Error('PROPOSAL_NOT_FOUND');
    }

    if (proposal.status !== 'draft') {
      throw new Error('PROPOSAL_ALREADY_SUBMITTED');
    }

    // ポリシー評価
    const evaluation = await this.engine.evaluateProposal(proposal);

    let newStatus: ProposalStatus = 'pending';
    let autoApproved = false;
    let autoExecuted = false;

    // 自動承認チェック
    if (evaluation.autoApprove) {
      newStatus = 'approved';
      autoApproved = true;
    }

    // 更新
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({
        status: newStatus,
        policy_ref: evaluation.policy.name,
        required_approvals: evaluation.requiredApprovals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .eq('org_id', this.orgId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to submit proposal: ${error.message}`);
    }

    let updatedProposal = data as Proposal;

    // 自動承認の場合は即時実行
    if (autoApproved) {
      const executeResult = await this.execute(proposalId, {
        type: 'system',
        id: 'system',
        name: 'System Auto-Execute',
      });
      updatedProposal = executeResult;
      autoExecuted = true;
    } else if (newStatus === 'pending') {
      // pending 化したらランダムに承認担当を割り当てる (random_one モード)
      // 失敗しても submit 自体は成功扱い
      try {
        const creatorUserId =
          submitter.type === 'human' && typeof submitter.id === 'string' ? submitter.id : null;
        await assignOnSubmit({
          org_id: this.orgId,
          proposal_id: proposalId,
          creator_user_id: creatorUserId,
        });
      } catch (assignErr) {
        console.error('[ProposalService] Failed to auto-assign reviewer:', assignErr);
      }
    }

    return {
      proposal: updatedProposal,
      autoApproved,
      autoExecuted,
    };
  }

  /**
   * Proposal作成と即時提出（便利メソッド）
   */
  async createAndSubmit(input: CreateProposalInput): Promise<SubmitResult> {
    const proposal = await this.create(input);
    return this.submit(proposal.id, input.created_by);
  }

  /**
   * 承認
   * Phase A-1: DB関数での原子実行を優先（approve+execute を1トランザクション）
   */
  async approve(
    proposalId: string,
    approver: ActorRef,
    reason?: string
  ): Promise<ApprovalResult> {
    const proposal = await this.getProposalForApproval(proposalId);
    await this.assertCanApprove(proposal, approver);

    // Phase A-1: 原子RPC を優先試行
    const atomicResult = await this.tryApproveAtomicRpc(proposalId, approver, reason);
    if (atomicResult) {
      return atomicResult;
    }

    // Fallback: 従来のマルチステップ実行
    return this.approveFallback(proposal, approver, reason);
  }

  private async getProposalForApproval(proposalId: string): Promise<Proposal> {
    const proposal = await this.getById(proposalId);

    if (!proposal) {
      throw new Error('PROPOSAL_NOT_FOUND');
    }

    if (proposal.status !== 'pending') {
      throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
    }

    return proposal;
  }

  private async assertCanApprove(proposal: Proposal, approver: ActorRef): Promise<void> {
    // ドメインゲート: profile.view_request は「本人 (target_user_id) のみ」が承認できる。
    // PolicyEngine の specific spec はポリシー定義時点の静的 value しか受け付けないため、
    // payload に紐づく動的な承認者制約はここで強制する。
    if (proposal.type === 'profile.view_request') {
      const targetId =
        typeof proposal.payload?.target_user_id === 'string'
          ? proposal.payload.target_user_id
          : null;
      if (!targetId) {
        throw new Error('PROFILE_VIEW_REQUEST_TARGET_MISSING');
      }
      if (approver.type !== 'human') {
        throw new Error('PROFILE_VIEW_REQUEST_APPROVER_MUST_BE_HUMAN');
      }
      if (approver.id !== targetId) {
        throw new Error('PROFILE_VIEW_REQUEST_APPROVER_MUST_BE_TARGET_USER');
      }
    }

    const canApproveResult = await this.engine.canApprove(proposal, approver);
    if (!canApproveResult.allowed) {
      throw new Error(canApproveResult.reason || 'APPROVAL_NOT_ALLOWED');
    }
  }

  private async tryApproveAtomicRpc(
    proposalId: string,
    approver: ActorRef,
    reason?: string,
  ): Promise<ApprovalResult | null> {
    const rpcClient = supabaseAdmin as unknown as {
      rpc?: (
        fn: string,
        args?: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    if (typeof rpcClient.rpc !== 'function') {
      return this.fallbackToLegacyFlowOrThrow();
    }

    const { data, error } = await rpcClient.rpc('approve_proposal_atomic', {
      p_org_id: this.orgId,
      p_proposal_id: proposalId,
      p_approver: approver,
      p_reason: reason || null,
    });

    if (error) {
      const message = error.message || '';

      // RPC関数が存在しない場合はfallbackへ
      const functionMissing =
        message.includes('approve_proposal_atomic') &&
        (message.includes('does not exist') || message.includes('Could not find the function'));
      if (functionMissing) {
        return this.fallbackToLegacyFlowOrThrow();
      }

      // approve RPC 内の auto-execute 失敗は fallback で承認継続可能
      const executeFailureInApproveRpc =
        message.toLowerCase().includes('numeric field overflow') ||
        message.toLowerCase().includes('value overflows numeric') ||
        message.includes('JOURNAL_IMBALANCED');
      if (executeFailureInApproveRpc) {
        return this.fallbackToLegacyFlowOrThrow();
      }

      if (
        message.includes('PROPOSAL_NOT_IN_PENDING_STATE') ||
        message.includes('PROPOSAL_NOT_IN_PROPOSED_STATE')
      ) {
        throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
      }

      // 既知のビジネスエラーはそのまま投げる
      const knownErrors = [
        'PROPOSAL_NOT_FOUND',
        'AI_SELF_APPROVAL_PROHIBITED',
        'AI_APPROVAL_NOT_ALLOWED_BY_POLICY',
        'INTEGRATION_APPROVAL_PROHIBITED',
        'APPROVER_NOT_ALLOWED_BY_POLICY',
        'ALREADY_APPROVED_BY_THIS_ACTOR',
        'APPROVAL_COUNT_ALREADY_MET',
      ];
      for (const errCode of knownErrors) {
        if (message.includes(errCode)) {
          throw new Error(errCode);
        }
      }

      throw new Error(`Failed to approve proposal atomically: ${message}`);
    }

    const result = this.normalizeApproveRpcResult(data);
    if (!result) {
      throw new Error('Failed to approve proposal atomically: empty result');
    }

    if (result.isFullyApproved) {
      await this.recordGovernanceEvent(
        result.proposal,
        'governance.proposal.approved',
        approver,
        { auto_executed: result.autoExecuted },
      );
    }

    if (result.autoExecuted) {
      await this.handleExecutedProposalSideEffects(result.proposal, approver);
    }

    // 通知を送信（DB関数はアプリ層通知を行わないため）
    await this.sendApprovalNotifications(result.proposal, result.isFullyApproved, result.autoExecuted);

    return result;
  }

  private normalizeApproveRpcResult(data: unknown): ApprovalResult | null {
    if (!data) {
      return null;
    }

    const obj = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
    if (!obj) {
      return null;
    }

    const proposal = obj.proposal as Proposal | undefined;
    if (!proposal) {
      return null;
    }

    return {
      proposal,
      isFullyApproved: obj.is_fully_approved === true,
      autoExecuted: obj.auto_executed === true,
    };
  }

  private async approveFallback(
    proposal: Proposal,
    approver: ActorRef,
    reason?: string
  ): Promise<ApprovalResult> {
    // 承認を追加
    const newApproval: Approval = {
      actor: approver,
      decision: 'approve',
      reason,
      at: new Date().toISOString(),
    };

    const updatedApprovals = [...proposal.approvals, newApproval];
    const approvalCount = updatedApprovals.filter(a => a.decision === 'approve').length;

    // 必要承認数に達したかチェック
    const isFullyApproved = approvalCount >= proposal.required_approvals;
    const newStatus: ProposalStatus = isFullyApproved ? 'approved' : 'pending';

    // 楽観的ロック: 承認中にステータスが変わっていないことを確認
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({
        status: newStatus,
        approvals: updatedApprovals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposal.id)
      .eq('org_id', this.orgId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) {
      // 楽観的ロック失敗: 別リクエストが先に承認/却下した可能性
      if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
        throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
      }
      throw new Error(`Failed to approve proposal: ${error.message}`);
    }

    let finalProposal = data as Proposal;
    let autoExecuted = false;

    // 最終承認時はサーバー側で自動実行（レースコンディション回避）
    if (isFullyApproved) {
      try {
        finalProposal = await this.execute(proposal.id, {
          type: 'system',
          id: 'system',
          name: 'System Auto-Execute',
        });
        autoExecuted = true;
      } catch (executeError) {
        // 承認自体は成功済み。executeは冪等なのでクライアントがリトライ可能
        console.error(`[ProposalService] Auto-execute after approval failed:`, executeError);
      }

      await this.recordGovernanceEvent(finalProposal, 'governance.proposal.approved', approver, {
        auto_executed: autoExecuted,
      });
    }

    await this.sendApprovalNotifications(finalProposal, isFullyApproved, autoExecuted);

    return {
      proposal: finalProposal,
      isFullyApproved,
      autoExecuted,
    };
  }

  private async sendApprovalNotifications(
    proposal: Proposal,
    isFullyApproved: boolean,
    autoExecuted: boolean,
  ): Promise<void> {
    if (!isFullyApproved) {
      const currentApprovals = proposal.approvals.filter(a => a.decision === 'approve').length;
      await this.notifyProposalStatusChange(proposal, {
        title: 'Proposal 承認進行中',
        message: `${proposal.description} が承認されました（${currentApprovals}/${proposal.required_approvals}）`,
        data: {
          stage: 'partial_approval',
          approved_count: currentApprovals,
          required_approvals: proposal.required_approvals,
        },
      });
    }

    if (isFullyApproved && !autoExecuted) {
      await this.notifyProposalStatusChange(proposal, {
        title: 'Proposal 承認完了',
        message: `${proposal.description} は承認済みです。実行待ち状態です。`,
        data: {
          stage: 'approved_pending_execute',
        },
      });
    }
  }

  /**
   * 却下
   */
  async reject(
    proposalId: string,
    rejector: ActorRef,
    reason: string
  ): Promise<Proposal> {
    const proposal = await this.getById(proposalId);

    if (!proposal) {
      throw new Error('PROPOSAL_NOT_FOUND');
    }

    if (proposal.status !== 'pending') {
      throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
    }

    const atomicResult = await this.tryRejectAtomicRpc(proposalId, rejector, reason);
    if (atomicResult) {
      await this.notifyProposalStatusChange(atomicResult, {
        title: 'Proposal が却下されました',
        message: `${atomicResult.description} は却下されました。理由: ${reason}`,
        data: {
          stage: 'rejected',
          rejection_reason: reason,
        },
      });
      return atomicResult;
    }

    return this.rejectFallback(proposal, rejector, reason);
  }

  private async tryRejectAtomicRpc(
    proposalId: string,
    rejector: ActorRef,
    reason: string
  ): Promise<Proposal | null> {
    const rpcClient = supabaseAdmin as unknown as {
      rpc?: (
        fn: string,
        args?: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    if (typeof rpcClient.rpc !== 'function') {
      return this.fallbackToLegacyFlowOrThrow();
    }

    const { data, error } = await rpcClient.rpc('reject_proposal_atomic', {
      p_org_id: this.orgId,
      p_proposal_id: proposalId,
      p_rejector: rejector,
      p_reason: reason,
    });

    if (error) {
      const message = error.message || '';
      const functionMissing =
        message.includes('reject_proposal_atomic') &&
        (message.includes('does not exist') || message.includes('Could not find the function'));
      if (functionMissing) {
        return this.fallbackToLegacyFlowOrThrow();
      }
      if (message.includes('PROPOSAL_NOT_FOUND')) {
        throw new Error('PROPOSAL_NOT_FOUND');
      }
      if (
        message.includes('PROPOSAL_NOT_IN_PENDING_STATE') ||
        message.includes('PROPOSAL_NOT_IN_PROPOSED_STATE')
      ) {
        throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
      }

      throw new Error(`Failed to reject proposal atomically: ${message}`);
    }

    const proposal = this.normalizeRpcProposal(data);
    if (!proposal) {
      throw new Error('Failed to reject proposal atomically: empty result');
    }

    await this.recordGovernanceEvent(proposal, 'governance.proposal.rejected', rejector, {
      rejection_reason: reason,
    });

    return proposal;
  }

  private async rejectFallback(
    proposal: Proposal,
    rejector: ActorRef,
    reason: string
  ): Promise<Proposal> {
    const newApproval: Approval = {
      actor: rejector,
      decision: 'reject',
      reason,
      at: new Date().toISOString(),
    };

    // 楽観的ロック: 却下中にステータスが変わっていないことを確認
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({
        status: 'rejected',
        approvals: [...proposal.approvals, newApproval],
        rejection_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposal.id)
      .eq('org_id', this.orgId)
      .eq('status', 'pending')
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116' || error.message?.includes('0 rows')) {
        throw new Error('PROPOSAL_NOT_IN_PENDING_STATE');
      }
      throw new Error(`Failed to reject proposal: ${error.message}`);
    }

    const rejectedProposal = data as Proposal;
    await this.recordGovernanceEvent(rejectedProposal, 'governance.proposal.rejected', rejector, {
      rejection_reason: reason,
    });
    await this.notifyProposalStatusChange(rejectedProposal, {
      title: 'Proposal が却下されました',
      message: `${rejectedProposal.description} は却下されました。理由: ${reason}`,
      data: {
        stage: 'rejected',
        rejection_reason: reason,
      },
    });

    return rejectedProposal;
  }

  /**
   * Proposal一括承認
   */
  async approveBatch(
    proposalIds: string[],
    approver: ActorRef,
    reason?: string
  ): Promise<BatchApprovalResult> {
    const uniqueProposalIds = Array.from(new Set(proposalIds.filter(Boolean)));
    const results: BatchApprovalItemResult[] = [];

    for (const proposalId of uniqueProposalIds) {
      try {
        const approved = await this.approve(proposalId, approver, reason);
        results.push({
          proposalId,
          success: true,
          proposal: approved.proposal,
          isFullyApproved: approved.isFullyApproved,
          autoExecuted: approved.autoExecuted,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          proposalId,
          success: false,
          error: message,
        });
      }
    }

    const successCount = results.filter((result) => result.success).length;
    return {
      total: uniqueProposalIds.length,
      successCount,
      failedCount: uniqueProposalIds.length - successCount,
      results,
    };
  }

  /**
   * Proposal一括却下
   */
  async rejectBatch(
    proposalIds: string[],
    rejector: ActorRef,
    reason: string
  ): Promise<BatchRejectResult> {
    const uniqueProposalIds = Array.from(new Set(proposalIds.filter(Boolean)));
    const results: BatchRejectItemResult[] = [];

    for (const proposalId of uniqueProposalIds) {
      try {
        const rejected = await this.reject(proposalId, rejector, reason);
        results.push({
          proposalId,
          success: true,
          proposal: rejected,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          proposalId,
          success: false,
          error: message,
        });
      }
    }

    const successCount = results.filter((result) => result.success).length;
    return {
      total: uniqueProposalIds.length,
      successCount,
      failedCount: uniqueProposalIds.length - successCount,
      results,
    };
  }

  /**
   * 実行（approved → executed）
   * LedgerEventを生成
   */
  async execute(proposalId: string, executor: ActorRef): Promise<Proposal> {
    const proposal = await this.getById(proposalId);

    if (!proposal) {
      throw new Error('PROPOSAL_NOT_FOUND');
    }

    // 冪等性: 既に実行済みならそのまま返す
    if (proposal.status === 'executed') {
      return proposal;
    }

    if (proposal.status !== 'approved') {
      throw new Error('PROPOSAL_NOT_APPROVED');
    }

    const canExecuteResult = await this.engine.canExecute(proposal);
    if (!canExecuteResult.allowed) {
      throw new Error(canExecuteResult.reason || 'EXECUTION_NOT_ALLOWED');
    }

    // Phase A-1: DB関数での原子実行を優先
    const atomicallyExecuted = await this.tryExecuteAtomicRpc(proposalId, executor);
    if (atomicallyExecuted) {
      await this.handleExecutedProposalSideEffects(atomicallyExecuted, executor);
      await this.notifyProposalStatusChange(atomicallyExecuted, {
        title: 'Proposal 実行完了',
        message: `${atomicallyExecuted.description} が実行されました。`,
        data: {
          stage: 'executed',
          result_event_id: atomicallyExecuted.result_event_id || null,
        },
      });
      return atomicallyExecuted;
    }

    // 1. 既存Event再利用 or 新規作成（再実行時の重複生成を回避）
    const event = await this.findOrCreateLedgerEvent(proposal, executor);

    // 2. 実際のデータ変更を適用（type別のハンドラー）
    await this.applyStateChange(proposal, event);

    // 3. Proposalをexecutedに更新
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({
        status: 'executed',
        executed_at: new Date().toISOString(),
        executed_by: executor,
        result_event_id: event.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposalId)
      .eq('org_id', this.orgId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to execute proposal: ${error.message}`);
    }

    const executedProposal = data as Proposal;
    await this.handleExecutedProposalSideEffects(executedProposal, executor);
    await this.notifyProposalStatusChange(executedProposal, {
      title: 'Proposal 実行完了',
      message: `${executedProposal.description} が実行されました。`,
      data: {
        stage: 'executed',
        result_event_id: executedProposal.result_event_id || null,
      },
    });

    return executedProposal;
  }

  private async tryExecuteAtomicRpc(
    proposalId: string,
    executor: ActorRef
  ): Promise<Proposal | null> {
    const rpcClient = supabaseAdmin as unknown as {
      rpc?: (
        fn: string,
        args?: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };

    if (typeof rpcClient.rpc !== 'function') {
      return this.fallbackToLegacyFlowOrThrow();
    }

    const { data, error } = await rpcClient.rpc('execute_proposal_atomic', {
      p_org_id: this.orgId,
      p_proposal_id: proposalId,
      p_executor: executor,
    });

    if (error) {
      const message = error.message || '';
      const functionMissing =
        message.includes('execute_proposal_atomic') &&
        (message.includes('does not exist') || message.includes('Could not find the function'));
      const unsupportedByAtomicRpc =
        message.includes('REWARD_CALCULATE_PATH_V22_REQUIRED') ||
        message.includes('REWARD_ADJUST_PATH_V22_REQUIRED');
      if (functionMissing) {
        return this.fallbackToLegacyFlowOrThrow();
      }
      if (unsupportedByAtomicRpc) {
        return this.fallbackToLegacyFlowOrThrow();
      }
      if (message.includes('PROPOSAL_NOT_FOUND')) {
        throw new Error('PROPOSAL_NOT_FOUND');
      }
      if (message.includes('PROPOSAL_NOT_APPROVED')) {
        throw new Error('PROPOSAL_NOT_APPROVED');
      }
      if (message.includes('INSUFFICIENT_APPROVALS')) {
        throw new Error('INSUFFICIENT_APPROVALS');
      }
      throw new Error(`Failed to execute proposal atomically: ${message}`);
    }

    const proposal = this.normalizeRpcProposal(data);
    if (!proposal) {
      throw new Error('Failed to execute proposal atomically: empty result');
    }

    return proposal;
  }

  private normalizeRpcProposal(data: unknown): Proposal | null {
    if (!data) {
      return null;
    }

    if (Array.isArray(data)) {
      return (data[0] || null) as Proposal | null;
    }

    return data as Proposal;
  }

  /**
   * ProposalTypeからEventTypeへのマッピング
   */
  private mapProposalTypeToEventType(type: ProposalType): string {
    const mapping: Record<string, string> = {
      'expense.create': 'expense_recorded',
      'expense.update': 'expense_recorded',
      'expense.void': 'expense_voided',
      'income.create': 'income_recorded',
      'income.update': 'income_recorded',
      'invoice.create': 'invoice_issued',
      'invoice.send': 'invoice_sent',
      'invoice.mark_paid': 'payment_received',
      'reward.calculate': 'reward_calculated',
      'reward.adjust': 'reward_adjusted',
      'skill.achieve': 'skill_achieved',
      'skill.revoke': 'skill_revoked',
      'evaluation.finalize': 'evaluation_finalized',
      'assignment.create': 'assignment.scheduled',
      'assignment.update': 'assignment.rescheduled',
      'assignment.cancel': 'assignment.cancelled',
      'leave.request': 'leave.recorded',
      'communication.review': 'communication.review_recorded',
      'communication.task': 'communication.task_recorded',
      'task.revision.request': 'task.revision_requested',
      'site.create': 'site.created',
      'site.close.finalize': 'site.close.finalized',
      'site.close.reopen': 'site.close.reopened',
      'profile.view_request': 'profile.view_granted',
    };
    return mapping[type] || 'internal_transfer';
  }

  /**
   * 状態変更を適用
   */
  private async applyStateChange(proposal: Proposal, event: LedgerEvent): Promise<void> {
    // 1) Ledger仕訳を自動生成（対象イベントのみ）
    await this.ensureLedgerJournal(proposal, event);

    // 2) ドメイン状態を更新（A-0で必要な範囲）
    switch (proposal.type) {
      case 'assignment.create':
        await this.applyAssignmentCreate(proposal.payload);
        break;
      case 'leave.request':
        await this.applyLeaveRequest(proposal);
        break;
      case 'evaluation.finalize':
        await this.applyEvaluationFinalize(proposal.payload, event.actor);
        break;
      case 'skill.achieve':
        await this.applySkillCertification(proposal.payload, event.actor, 'verified');
        break;
      case 'skill.revoke':
        await this.applySkillCertification(proposal.payload, event.actor, 'revoked');
        break;
      case 'site.close.finalize':
      case 'site.close.reopen':
      default:
        // A-1 boundary: assignment.update / assignment.cancel は event log のみ、
        // site.complete は completion fact/RPC を正系とするため、ここでは副作用を持たせない。
        break;
    }

    console.log(`[ProposalService] Applied ${proposal.type}: ${event.id}`);
  }

  private async findOrCreateLedgerEvent(
    proposal: Proposal,
    executor: ActorRef
  ): Promise<LedgerEvent> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('ledger_events')
      .select('*')
      .eq('proposal_id', proposal.id)
      .eq('org_id', proposal.org_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch existing ledger event: ${existingError.message}`);
    }

    if (existing) {
      return existing as LedgerEvent;
    }

    const eventType = this.mapProposalTypeToEventType(proposal.type);
    const { data: created, error: createError } = await supabaseAdmin
      .from('ledger_events')
      .insert({
        org_id: proposal.org_id,
        event_type: eventType,
        proposal_id: proposal.id,
        payload: proposal.payload,
        actor: executor,
      })
      .select()
      .single();

    if (createError) {
      throw new Error(`Failed to create ledger event: ${createError.message}`);
    }

    return created as LedgerEvent;
  }

  private async ensureLedgerJournal(proposal: Proposal, event: LedgerEvent): Promise<void> {
    const lines = this.buildLedgerEntries(proposal, event);
    if (!lines || lines.length === 0) {
      return;
    }

    const transaction = await this.findOrCreateLedgerTransaction(proposal, event);
    await this.insertLedgerEntriesIfNeeded(transaction.id, lines);
  }

  private async findOrCreateLedgerTransaction(
    proposal: Proposal,
    event: LedgerEvent
  ): Promise<{ id: string }> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('ledger_transactions')
      .select('id')
      .eq('event_id', event.id)
      .eq('org_id', proposal.org_id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch ledger transaction: ${existingError.message}`);
    }

    if (existing) {
      return existing as { id: string };
    }

    const description =
      this.getPayloadString(proposal.payload, ['description', 'memo']) ||
      proposal.description ||
      proposal.type;
    const transactionDate =
      this.getPayloadString(proposal.payload, ['recorded_date', 'date', 'transaction_date']) ||
      event.created_at.slice(0, 10);

    const currency =
      (this.getPayloadString(proposal.payload, ['currency']) || 'JPY').toUpperCase();

    const { data: created, error: createError } = await supabaseAdmin
      .from('ledger_transactions')
      .insert({
        org_id: proposal.org_id,
        event_id: event.id,
        transaction_date: transactionDate,
        description,
        currency,
      })
      .select('id')
      .single();

    if (createError) {
      throw new Error(`Failed to create ledger transaction: ${createError.message}`);
    }

    return created as { id: string };
  }

  private async insertLedgerEntriesIfNeeded(
    transactionId: string,
    lines: LedgerEntryDraft[]
  ): Promise<void> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from('ledger_entries')
      .select('id')
      .eq('transaction_id', transactionId)
      .limit(1);

    if (existingError) {
      throw new Error(`Failed to check existing ledger entries: ${existingError.message}`);
    }

    if (existing && existing.length > 0) {
      return;
    }

    const totalDebit = lines.reduce((sum, line) => sum + line.debitAmount, 0);
    const totalCredit = lines.reduce((sum, line) => sum + line.creditAmount, 0);
    if (!this.isBalanced(totalDebit, totalCredit)) {
      throw new Error(
        `JOURNAL_IMBALANCED: debit=${totalDebit.toFixed(2)}, credit=${totalCredit.toFixed(2)}`
      );
    }

    const rows = lines.map((line, index) => ({
      transaction_id: transactionId,
      account_code: line.accountCode,
      debit_amount: Number(line.debitAmount.toFixed(2)),
      credit_amount: Number(line.creditAmount.toFixed(2)),
      memo: line.memo,
      line_number: index + 1,
    }));

    const { error: insertError } = await supabaseAdmin
      .from('ledger_entries')
      .insert(rows);

    if (insertError) {
      throw new Error(`Failed to create ledger entries: ${insertError.message}`);
    }
  }

  private buildLedgerEntries(
    proposal: Proposal,
    event: LedgerEvent
  ): LedgerEntryDraft[] | null {
    const amount = this.extractAmount(proposal.payload);
    if (amount === null || amount <= 0) {
      return null;
    }

    const memo =
      this.getPayloadString(proposal.payload, ['description', 'memo']) || proposal.description;

    switch (event.event_type) {
      case 'expense_recorded': {
        const expenseAccount = this.resolveExpenseAccountCode(proposal.payload);
        return [
          { accountCode: expenseAccount, debitAmount: amount, creditAmount: 0, memo },
          { accountCode: ACCOUNT_CODES.cash, debitAmount: 0, creditAmount: amount, memo },
        ];
      }
      case 'expense_voided': {
        const expenseAccount = this.resolveExpenseAccountCode(proposal.payload);
        return [
          { accountCode: ACCOUNT_CODES.cash, debitAmount: amount, creditAmount: 0, memo },
          { accountCode: expenseAccount, debitAmount: 0, creditAmount: amount, memo },
        ];
      }
      case 'income_recorded':
      case 'invoice_issued':
        return [
          { accountCode: ACCOUNT_CODES.accountsReceivable, debitAmount: amount, creditAmount: 0, memo },
          { accountCode: ACCOUNT_CODES.sales, debitAmount: 0, creditAmount: amount, memo },
        ];
      case 'payment_received':
        return [
          { accountCode: ACCOUNT_CODES.cash, debitAmount: amount, creditAmount: 0, memo },
          { accountCode: ACCOUNT_CODES.accountsReceivable, debitAmount: 0, creditAmount: amount, memo },
        ];
      case 'reward_calculated':
      case 'reward_adjusted':
        return [
          { accountCode: ACCOUNT_CODES.rewardsExpense, debitAmount: amount, creditAmount: 0, memo },
          { accountCode: ACCOUNT_CODES.accruedRewards, debitAmount: 0, creditAmount: amount, memo },
        ];
      case 'internal_transfer': {
        const debitAccount = this.getPayloadString(proposal.payload, ['debit_account_code', 'debit_account']);
        const creditAccount = this.getPayloadString(proposal.payload, ['credit_account_code', 'credit_account']);
        if (!debitAccount || !creditAccount) {
          return null;
        }
        return [
          { accountCode: debitAccount, debitAmount: amount, creditAmount: 0, memo },
          { accountCode: creditAccount, debitAmount: 0, creditAmount: amount, memo },
        ];
      }
      default:
        return null;
    }
  }

  private async applyAssignmentCreate(payload: Record<string, unknown>): Promise<void> {
    const siteId = this.getPayloadString(payload, ['site_id', 'siteId', 'target_site_id']);
    if (!siteId || !this.isUuid(siteId)) {
      console.warn('[ProposalService] assignment.create skipped: valid site_id not found');
      return;
    }

    const workerIds = this.extractWorkerIds(payload).filter(id => this.isUuid(id));
    if (workerIds.length === 0) {
      console.warn('[ProposalService] assignment.create skipped: worker ids not found');
      return;
    }

    const { data: site, error: siteError } = await supabaseAdmin
      .from('sites')
      .select('id, assigned_users')
      .eq('id', siteId)
      .eq('org_id', this.orgId)
      .maybeSingle();

    if (siteError) {
      throw new Error(`Failed to fetch site for assignment.create: ${siteError.message}`);
    }

    if (!site) {
      console.warn(`[ProposalService] assignment.create skipped: site not found (${siteId})`);
      return;
    }

    const currentAssigned = Array.isArray(site.assigned_users)
      ? site.assigned_users.filter((value: unknown): value is string => typeof value === 'string')
      : [];
    const mergedAssigned = Array.from(new Set([...currentAssigned, ...workerIds]));

    const { error: updateSiteError } = await supabaseAdmin
      .from('sites')
      .update({ assigned_users: mergedAssigned })
      .eq('id', siteId)
      .eq('org_id', this.orgId);

    if (updateSiteError) {
      throw new Error(`Failed to update site assignment: ${updateSiteError.message}`);
    }

    const { error: updateProfileError } = await supabaseAdmin
      .from('profiles')
      .update({ current_site_id: siteId })
      .in('id', workerIds);

    if (updateProfileError) {
      throw new Error(`Failed to update worker assignment: ${updateProfileError.message}`);
    }
  }

  private async applyEvaluationFinalize(
    payload: Record<string, unknown>,
    actor: ActorRef
  ): Promise<void> {
    const memberId = this.getPayloadString(payload, ['member_id', 'memberId', 'target_member_id']);
    const month = this.getPayloadString(payload, ['month', 'review_month']);
    const statesCandidate = (
      payload.confirmed_big_skill_states ||
      payload.big_skill_states ||
      payload.states
    );
    const currentLevel = this.getPayloadString(payload, ['current_level', 'level']);
    const comment = this.getPayloadString(payload, ['comment', 'reason_summary']) || '';
    const workDays = this.toNumber(payload.work_days ?? payload.workDays) ?? 0;
    const scoreA = this.toNumber(payload.A ?? payload.a_score ?? payload.a) ?? 1;
    const scoreR = this.toNumber(payload.R ?? payload.r_score ?? payload.r) ?? 1;
    const scoreQ = this.toNumber(payload.Q ?? payload.q_score ?? payload.q) ?? 1;

    if (!memberId || !this.isUuid(memberId)) {
      console.warn('[ProposalService] evaluation.finalize skipped: valid member_id not found');
      return;
    }

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      console.warn('[ProposalService] evaluation.finalize skipped: valid month not found');
      return;
    }

    const normalizedStates =
      statesCandidate && typeof statesCandidate === 'object' && !Array.isArray(statesCandidate)
        ? Object.entries(statesCandidate as Record<string, unknown>).reduce<Record<string, string>>(
            (acc, [key, value]) => {
              if (
                BIG_SKILL_KEYS.includes(key as (typeof BIG_SKILL_KEYS)[number]) &&
                typeof value === 'string' &&
                BIG_SKILL_STATE_OPTIONS.includes(value as (typeof BIG_SKILL_STATE_OPTIONS)[number])
              ) {
                acc[key] = value;
              }
              return acc;
            },
            {}
          )
        : {};

    if (Object.keys(normalizedStates).length === 0 && !currentLevel) {
      console.warn('[ProposalService] evaluation.finalize skipped: no confirmed states/current level');
      return;
    }

    const now = new Date().toISOString();
    const profileUpdate: Record<string, unknown> = {
      org_id: this.orgId,
      member_id: memberId,
      updated_at: now,
    };

    for (const [key, value] of Object.entries(normalizedStates)) {
      profileUpdate[`${key}_status`] = value;
    }

    if (currentLevel && PATH_LEVEL_OPTIONS.includes(currentLevel as (typeof PATH_LEVEL_OPTIONS)[number])) {
      profileUpdate.current_level = currentLevel;
      profileUpdate.current_level_since = now;
    }

    const { error: profileError } = await supabaseAdmin
      .from('member_skill_profiles')
      .upsert(profileUpdate, { onConflict: 'org_id,member_id' });

    if (profileError) {
      throw new Error(`Failed to upsert member skill profile: ${profileError.message}`);
    }

    const confirmationRows = Object.entries(normalizedStates).map(([key, value]) => ({
      org_id: this.orgId,
      month,
      member_id: memberId,
      target_type: 'big_skill',
      target_key: key,
      confirmation_status: value,
      comment,
      confirmed_by: actor,
      confirmed_at: now,
      updated_at: now,
    }));

    if (confirmationRows.length > 0) {
      const { error: confirmationError } = await supabaseAdmin
        .from('monthly_evaluation_confirmations')
        .upsert(confirmationRows, {
          onConflict: 'org_id,month,member_id,target_type,target_key',
        });

      if (confirmationError) {
        throw new Error(
          `Failed to upsert monthly evaluation confirmations: ${confirmationError.message}`
        );
      }
    }

    const finalizedBy = actor;
    const { error: finalizationError } = await supabaseAdmin
      .from('monthly_evaluation_finalizations')
      .upsert(
        {
          org_id: this.orgId,
          month,
          member_id: memberId,
          proposal_id: this.getPayloadString(payload, ['proposal_id']) ?? null,
          confirmed_big_skill_states: normalizedStates,
          work_days: Number.isFinite(workDays) && workDays >= 0 ? Math.floor(workDays) : 0,
          A: Number.isFinite(scoreA) ? Math.max(0, Math.min(2, Math.floor(scoreA))) : 1,
          R: Number.isFinite(scoreR) ? Math.max(0, Math.min(2, Math.floor(scoreR))) : 1,
          Q: Number.isFinite(scoreQ) ? Math.max(0, Math.min(2, Math.floor(scoreQ))) : 1,
          current_level:
            currentLevel && PATH_LEVEL_OPTIONS.includes(currentLevel as (typeof PATH_LEVEL_OPTIONS)[number])
              ? currentLevel
              : null,
          comment,
          finalized_by: finalizedBy,
          finalized_at: now,
          updated_at: now,
        },
        { onConflict: 'org_id,month,member_id' }
      );

    if (finalizationError) {
      throw new Error(
        `Failed to upsert monthly evaluation finalization: ${finalizationError.message}`
      );
    }
  }

  private async applySkillCertification(
    payload: Record<string, unknown>,
    actor: ActorRef,
    defaultStatus: 'verified' | 'revoked'
  ): Promise<void> {
    const memberId = this.getPayloadString(payload, ['member_id', 'memberId', 'target_member_id']);
    const skillKey = this.getPayloadString(payload, ['skill_key', 'skillKey', 'target_key']);
    const category = this.getPayloadString(payload, ['category', 'skill_category']);
    const status =
      this.getPayloadString(payload, ['status', 'certification_status']) || defaultStatus;
    const note = this.getPayloadString(payload, ['note', 'comment', 'reason']) || '';
    const lastSiteId = this.getPayloadString(payload, ['last_site_id', 'lastSiteId']);
    const evidenceCount = this.toNumber(payload.evidence_count ?? payload.evidenceCount) ?? 0;
    const reviewRequiredFlag = Boolean(
      payload.review_required_flag ?? payload.reviewRequiredFlag ?? false
    );

    if (!memberId || !this.isUuid(memberId)) {
      console.warn('[ProposalService] skill certification skipped: valid member_id not found');
      return;
    }

    if (!skillKey || !category) {
      console.warn('[ProposalService] skill certification skipped: skill_key/category not found');
      return;
    }

    if (
      !PROFILE_CERTIFICATION_STATUS_OPTIONS.includes(
        status as (typeof PROFILE_CERTIFICATION_STATUS_OPTIONS)[number]
      )
    ) {
      console.warn('[ProposalService] skill certification skipped: invalid status');
      return;
    }

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('member_skill_certifications')
      .upsert(
        {
          org_id: this.orgId,
          member_id: memberId,
          skill_key: skillKey,
          category,
          status,
          verified_by: actor,
          verified_at: now,
          evidence_count: Math.max(0, Math.round(evidenceCount)),
          last_site_id: lastSiteId && this.isUuid(lastSiteId) ? lastSiteId : null,
          note,
          review_required_flag: reviewRequiredFlag,
          updated_at: now,
        },
        { onConflict: 'org_id,member_id,skill_key' }
      );

    if (error) {
      throw new Error(`Failed to upsert member skill certification: ${error.message}`);
    }
  }

  private async applyLeaveRequest(proposal: Proposal): Promise<void> {
    const payload = proposal.payload;
    const createdByUserId =
      proposal.created_by.type === 'human' && this.isUuid(proposal.created_by.id)
        ? proposal.created_by.id
        : null;
    const userId =
      this.getPayloadString(payload, ['user_id', 'userId', 'target_user_id', 'targetUserId']) ||
      createdByUserId;
    if (!userId || !this.isUuid(userId)) {
      console.warn('[ProposalService] leave.request skipped: valid user_id not found');
      return;
    }

    const startDate = this.normalizeDateString(
      this.getPayloadString(payload, ['start_date', 'startDate', 'date']),
    );
    const endDate =
      this.normalizeDateString(this.getPayloadString(payload, ['end_date', 'endDate'])) || startDate;
    if (!startDate || !endDate || startDate > endDate) {
      console.warn('[ProposalService] leave.request skipped: invalid start_date/end_date');
      return;
    }

    const scheduleType = this.resolvePersonalScheduleType(payload);
    if (!scheduleType) {
      console.warn('[ProposalService] leave.request skipped: unsupported leave_type');
      return;
    }

    const reason =
      this.getPayloadString(payload, ['reason', 'note']) ||
      this.getPayloadString(payload, ['description']) ||
      proposal.description;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('personal_schedules')
      .select('id, approved')
      .eq('user_id', userId)
      .eq('start_date', startDate)
      .eq('end_date', endDate)
      .eq('type', scheduleType)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to lookup leave request schedule: ${existingError.message}`);
    }

    if (existing) {
      if (existing.approved === true) {
        return;
      }

      const updatePayload: Record<string, unknown> = {
        approved: true,
        updated_at: new Date().toISOString(),
      };
      if (reason) {
        updatePayload.reason = reason;
      }

      const { error: updateError } = await supabaseAdmin
        .from('personal_schedules')
        .update(updatePayload)
        .eq('id', existing.id);

      if (updateError) {
        throw new Error(`Failed to approve existing leave schedule: ${updateError.message}`);
      }
      return;
    }

    const insertPayload: Record<string, unknown> = {
      user_id: userId,
      start_date: startDate,
      end_date: endDate,
      type: scheduleType,
      approved: true,
      updated_at: new Date().toISOString(),
    };
    if (reason) {
      insertPayload.reason = reason;
    }

    const { error: insertError } = await supabaseAdmin
      .from('personal_schedules')
      .insert(insertPayload);

    if (insertError) {
      throw new Error(`Failed to create leave schedule: ${insertError.message}`);
    }
  }

  private resolvePersonalScheduleType(payload: Record<string, unknown>): PersonalScheduleType | null {
    const rawType =
      this.getPayloadString(payload, ['leave_type', 'leaveType', 'schedule_type', 'scheduleType', 'type']) ||
      'vacation';
    const normalized = rawType.toLowerCase();

    if (PERSONAL_SCHEDULE_TYPES.includes(normalized as PersonalScheduleType)) {
      return normalized as PersonalScheduleType;
    }

    if (['leave', 'holiday'].includes(normalized)) {
      return 'vacation';
    }
    if (['sick', 'sickleave'].includes(normalized)) {
      return 'sick_leave';
    }
    if (['trip', 'business-trip', 'businesstrip'].includes(normalized)) {
      return 'business_trip';
    }

    return null;
  }

  private normalizeDateString(value: string | null): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return null;
    }
    return normalized;
  }

  private extractWorkerIds(payload: Record<string, unknown>): string[] {
    const directKeys = ['worker_id', 'workerId', 'user_id', 'userId', 'assignee_id', 'member_id'];
    const arrayKeys = ['worker_ids', 'workerIds', 'user_ids', 'userIds', 'assignee_ids', 'member_ids'];
    const collected: string[] = [];

    for (const key of directKeys) {
      const value = payload[key];
      if (typeof value === 'string' && value.length > 0) {
        collected.push(value);
      }
    }

    for (const key of arrayKeys) {
      const value = payload[key];
      if (Array.isArray(value)) {
        for (const id of value) {
          if (typeof id === 'string' && id.length > 0) {
            collected.push(id);
          }
        }
      }
    }

    const assignments = payload.assignments;
    if (Array.isArray(assignments)) {
      for (const assignment of assignments) {
        if (!assignment || typeof assignment !== 'object') {
          continue;
        }
        const item = assignment as Record<string, unknown>;
        const id =
          this.getPayloadString(item, ['worker_id', 'workerId', 'user_id', 'userId', 'assignee_id']) ||
          null;
        if (id) {
          collected.push(id);
        }
      }
    }

    return Array.from(new Set(collected));
  }

  private resolveExpenseAccountCode(payload: Record<string, unknown>): string {
    const explicit = this.getPayloadString(payload, ['expense_account_code', 'account_code']);
    if (explicit) {
      return explicit;
    }

    const category = (this.getPayloadString(payload, ['category']) || '').toLowerCase();
    const categoryMap: Record<string, string> = {
      material: ACCOUNT_CODES.materials,
      materials: ACCOUNT_CODES.materials,
      tool: ACCOUNT_CODES.tools,
      tools: ACCOUNT_CODES.tools,
      travel: ACCOUNT_CODES.travel,
      transportation: ACCOUNT_CODES.travel,
      food: ACCOUNT_CODES.food,
    };

    return categoryMap[category] || ACCOUNT_CODES.otherExpense;
  }

  private extractAmount(payload: Record<string, unknown>): number | null {
    const amountKeys = ['amount', 'amount_total', 'total_amount', 'total', 'value'];
    for (const key of amountKeys) {
      const amount = this.toNumber(payload[key]);
      if (amount !== null && amount !== 0) {
        return Math.abs(amount);
      }
    }

    const subtotal = this.toNumber(payload.amount_subtotal);
    const taxAmount = this.toNumber(payload.tax_amount);
    if (subtotal !== null || taxAmount !== null) {
      return Math.abs((subtotal || 0) + (taxAmount || 0));
    }

    return null;
  }

  private getPayloadString(payload: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
    }
    return null;
  }

  private toNumber(value: unknown): number | null {
    if (typeof value === 'number') {
      return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
      const normalized = value.replace(/[,\s¥￥]/g, '');
      if (!normalized) {
        return null;
      }
      const parsed = Number(normalized);
      return Number.isFinite(parsed) ? parsed : null;
    }

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const innerValue = (value as Record<string, unknown>).value;
      return this.toNumber(innerValue);
    }

    return null;
  }

  private isBalanced(totalDebit: number, totalCredit: number): boolean {
    return Math.round(totalDebit * 100) === Math.round(totalCredit * 100);
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  private async resolveNotificationRecipientUserId(proposal: Proposal): Promise<string | null> {
    if (proposal.created_by?.type !== 'human') {
      return null;
    }

    const userId = proposal.created_by.id;
    if (!this.isUuid(userId)) {
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      console.warn(`[ProposalService] Failed to resolve notification recipient: ${error.message}`);
      return null;
    }

    return data?.id ? userId : null;
  }

  private async notifyProposalStatusChange(
    proposal: Proposal,
    params: {
      title: string;
      message: string;
      data?: Record<string, unknown>;
    }
  ): Promise<void> {
    const recipientId = await this.resolveNotificationRecipientUserId(proposal);
    if (!recipientId) {
      return;
    }

    const payload = {
      proposal_id: proposal.id,
      proposal_type: proposal.type,
      proposal_status: proposal.status,
      ...params.data,
    };

    const { error } = await supabaseAdmin
      .from('notifications')
      .insert({
        user_id: recipientId,
        type: 'approval_result',
        title: params.title,
        message: params.message,
        data: payload,
      });

    if (error) {
      console.warn(`[ProposalService] Failed to create notification: ${error.message}`);
    }
  }

  /**
   * IDでProposalを取得
   */
  async getById(id: string): Promise<Proposal | null> {
    const { data, error } = await supabaseAdmin
      .from('proposals')
      .select('*')
      .eq('id', id)
      .eq('org_id', this.orgId)
      .single();

    if (error) {
      return null;
    }

    return data as Proposal;
  }

  /**
   * 一覧取得（フィルター付き）
   */
  async list(options: {
    status?: ProposalStatus | ProposalStatus[];
    type?: ProposalType | ProposalType[];
    siteId?: string | null;
    limit?: number;
    offset?: number;
  } = {}): Promise<Proposal[]> {
    let query = supabaseAdmin
      .from('proposals')
      .select('*')
      .eq('org_id', this.orgId)
      .order('created_at', { ascending: false });

    if (options.status) {
      if (Array.isArray(options.status)) {
        query = query.in('status', options.status);
      } else {
        query = query.eq('status', options.status);
      }
    }

    if (options.type) {
      if (Array.isArray(options.type)) {
        query = query.in('type', options.type);
      } else {
        query = query.eq('type', options.type);
      }
    }

    if (options.siteId) {
      query = query.eq('site_id', options.siteId);
    }

    if (options.limit) {
      query = query.limit(options.limit);
    }

    if (options.offset) {
      query = query.range(options.offset, options.offset + (options.limit || 10) - 1);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to list proposals: ${error.message}`);
    }

    return (data || []) as Proposal[];
  }

  /**
   * 承認待ちProposalを取得
   */
  async getPendingApprovals(): Promise<Proposal[]> {
    return this.list({ status: 'pending' });
  }

  /**
   * draft状態のProposalを削除
   */
  async delete(proposalId: string): Promise<void> {
    const proposal = await this.getById(proposalId);

    if (!proposal) {
      throw new Error('PROPOSAL_NOT_FOUND');
    }

    if (proposal.status !== 'draft') {
      throw new Error('CAN_ONLY_DELETE_DRAFT_PROPOSALS');
    }

    const { error } = await supabaseAdmin
      .from('proposals')
      .delete()
      .eq('id', proposalId)
      .eq('org_id', this.orgId);

    if (error) {
      throw new Error(`Failed to delete proposal: ${error.message}`);
    }
  }

  private async handleExecutedProposalSideEffects(
    proposal: Proposal,
    actor: ActorRef,
  ): Promise<void> {
    const eventType = this.mapExecutedProposalToGovernanceEvent(proposal);
    await this.recordGovernanceEvent(proposal, eventType, actor, {
      result_event_id: proposal.result_event_id ?? null,
    });

    if (
      proposal.type === 'evaluation.finalize' ||
      proposal.type === 'skill.achieve' ||
      proposal.type === 'skill.revoke' ||
      proposal.type === 'policy.update' ||
      (proposal.type === 'reward.calculate' && proposal.payload?.calculation_system === 'path_v22') ||
      (proposal.type === 'reward.adjust' && proposal.payload?.calculation_system === 'path_v22')
    ) {
      await this.pathGovernedModuleService.syncProjectionFromExecutedProposal(proposal);
    }

    if (proposal.type === 'site.close.finalize' && proposal.payload?.path_module_version === 'v3.1') {
      await this.pathV31Service.syncSiteCloseFromExecutedProposal(proposal);
    }

    if (proposal.type === 'site.close.reopen' && proposal.payload?.path_module_version === 'v3.1') {
      await this.pathV31Service.syncSiteCloseReopenFromExecutedProposal(proposal);
    }

    if (proposal.type === 'reward.calculate' && proposal.payload?.calculation_system === 'path_v31') {
      await this.pathV31Service.syncMonthlyDistributionFromExecutedProposal(proposal);
    }

    if (proposal.type === 'reward.calculate' && proposal.payload?.calculation_system === 'path_v32_simple') {
      await this.pathV32SimpleRewardService.syncMonthlyDistributionFromExecutedProposal(proposal);
    }

    if (proposal.type === 'path.level.update' && proposal.payload?.calculation_system === 'path_v32_simple') {
      await this.pathV32SimpleRewardService.syncLevelUpdateFromExecutedProposal(proposal);
    }

    // profile.view_request: 本人承認の結果として閲覧チケット (profile_view_grants) を発行する。
    // 仕訳発生も金額もないが、grant 行と governance event でアクセス権の発生を追跡する。
    if (proposal.type === 'profile.view_request') {
      await this.profileViewConsentService.createGrantFromExecutedProposal(proposal);
    }
  }

  private mapExecutedProposalToGovernanceEvent(proposal: Proposal): string {
    if (proposal.type === 'policy.update' && proposal.payload?.module === 'path') {
      return 'governance.policy.published';
    }

    if (proposal.type === 'site.close.finalize' && proposal.payload?.path_module_version === 'v3.1') {
      return 'path.site_close.finalized';
    }

    if (proposal.type === 'site.close.reopen' && proposal.payload?.path_module_version === 'v3.1') {
      return 'path.site_close.reopened';
    }

    if (proposal.type === 'evaluation.finalize' && proposal.payload?.path_module_version === 'v2.2') {
      return 'finance.month.closed';
    }

    if (
      (proposal.type === 'skill.achieve' || proposal.type === 'skill.revoke') &&
      proposal.payload?.path_module_version === 'v2.2'
    ) {
      return 'path.skill_certification.decided';
    }

    if (proposal.type === 'reward.calculate' && proposal.payload?.calculation_system === 'path_v22') {
      return 'path.reward_run.approved';
    }

    if (proposal.type === 'reward.calculate' && proposal.payload?.calculation_system === 'path_v31') {
      return 'path.monthly_distribution.finalized';
    }

    if (proposal.type === 'reward.calculate' && proposal.payload?.calculation_system === 'path_v32_simple') {
      return 'path.monthly_distribution.finalized';
    }

    if (proposal.type === 'reward.pool.adjust' && proposal.payload?.calculation_system === 'path_v32_simple') {
      return 'path.reward_pool.adjusted';
    }

    if (proposal.type === 'path.level.update' && proposal.payload?.calculation_system === 'path_v32_simple') {
      return 'path.member_level.updated';
    }

    if (
      proposal.type === 'reward.adjust' &&
      proposal.payload?.calculation_system === 'path_v22'
    ) {
      return proposal.payload?.run_type === 'reversal'
        ? 'finance.journal.entry_reversed'
        : 'finance.journal.adjustment_posted';
    }

    if (proposal.type === 'profile.view_request') {
      return 'governance.profile_view.granted';
    }

    return 'governance.proposal.executed';
  }

  private async recordGovernanceEvent(
    proposal: Proposal,
    eventType: string,
    actor: ActorRef,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (!this.shouldRecordGovernanceEvent(proposal)) {
      return;
    }

    const dedupeKey = `${proposal.id}:${eventType}`;
    const aggregateType =
      proposal.type === 'policy.update'
        ? 'policy_bundle'
        : proposal.type.startsWith('reward.')
          ? 'reward_run'
          : proposal.type.startsWith('skill.')
            ? 'trade_endorsement'
            : proposal.type === 'evaluation.finalize'
              ? 'month_close'
              : 'proposal';

    const aggregateId =
      typeof proposal.payload?.member_id === 'string'
        ? proposal.payload.member_id
        : proposal.id;

    const policyContext =
      typeof proposal.payload?.policy_context === 'object' && proposal.payload.policy_context !== null
        ? (proposal.payload.policy_context as Record<string, unknown>)
        : {
            policy_ref: proposal.policy_ref ?? null,
            required_approvals: proposal.required_approvals,
          };

    const { error } = await supabaseAdmin
      .from('governance_events')
      .upsert(
        {
          org_id: this.orgId,
          proposal_id: proposal.id,
          aggregate_type: aggregateType,
          aggregate_id: aggregateId,
          event_type: eventType,
          dedupe_key: dedupeKey,
          payload,
          policy_context: policyContext,
          actor,
        },
        { onConflict: 'org_id,dedupe_key' },
      );

    if (error) {
      throw new Error(`Failed to record governance event: ${error.message}`);
    }
  }

  private shouldRecordGovernanceEvent(proposal: Proposal): boolean {
    if (proposal.type === 'policy.update') {
      return true;
    }

    if (proposal.type === 'evaluation.finalize') {
      return proposal.payload?.path_module_version === 'v2.2';
    }

    if (proposal.type === 'site.close.finalize' || proposal.type === 'site.close.reopen') {
      return proposal.payload?.path_module_version === 'v3.1';
    }

    if (proposal.type === 'skill.achieve' || proposal.type === 'skill.revoke') {
      return proposal.payload?.path_module_version === 'v2.2';
    }

    if (proposal.type === 'reward.calculate' || proposal.type === 'reward.adjust') {
      const calculationSystem = proposal.payload?.calculation_system;
      return calculationSystem === 'path_v22' || calculationSystem === 'path_v31' || calculationSystem === 'path_v32_simple';
    }

    if (proposal.type === 'reward.pool.adjust' || proposal.type === 'path.level.update') {
      return proposal.payload?.calculation_system === 'path_v32_simple';
    }

    // profile.view_request はすべての lifecycle (created/approved/rejected/executed) を
    // 監査対象として記録する。admin が「いつ・誰に対して・なぜ拡張情報を覗いたか」を
    // 後から第三者がトレース可能であることが本 Proposal の存在意義。
    if (proposal.type === 'profile.view_request') {
      return true;
    }

    return false;
  }
}

// シングルトンエクスポート
export const proposalService = new ProposalService();
