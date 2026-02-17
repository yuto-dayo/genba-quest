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

// ============================================================
// Types
// ============================================================

export interface CreateProposalInput {
  type: ProposalType;
  payload: Record<string, unknown>;
  description: string;
  created_by: ActorRef;
  org_id?: string;
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

// ============================================================
// Proposal Service
// ============================================================

export class ProposalService {
  private engine: PolicyEngine;
  private orgId: string;

  constructor(orgId: string = '00000000-0000-0000-0000-000000000001') {
    this.orgId = orgId;
    this.engine = new PolicyEngine(orgId);
  }

  /**
   * Proposal作成（draft状態）
   */
  async create(input: CreateProposalInput): Promise<Proposal> {
    const evaluation = await this.engine.evaluateProposal({
      type: input.type,
      payload: input.payload,
      created_by: input.created_by,
    });

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .insert({
        org_id: input.org_id || this.orgId,
        type: input.type,
        status: 'draft',
        created_by: input.created_by,
        payload: input.payload,
        description: input.description,
        policy_ref: evaluation.policy.name,
        required_approvals: evaluation.requiredApprovals,
        approvals: [],
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create proposal: ${error.message}`);
    }

    return data as Proposal;
  }

  /**
   * Proposal提出（draft → proposed）
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

    let newStatus: ProposalStatus = 'proposed';
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

    if (proposal.status !== 'proposed') {
      throw new Error('PROPOSAL_NOT_IN_PROPOSED_STATE');
    }

    return proposal;
  }

  private async assertCanApprove(proposal: Proposal, approver: ActorRef): Promise<void> {
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
      return null;
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
        return null;
      }

      // approve RPC 内の auto-execute 失敗は fallback で承認継続可能
      const executeFailureInApproveRpc =
        message.toLowerCase().includes('numeric field overflow') ||
        message.toLowerCase().includes('value overflows numeric') ||
        message.includes('JOURNAL_IMBALANCED');
      if (executeFailureInApproveRpc) {
        return null;
      }

      // 既知のビジネスエラーはそのまま投げる
      const knownErrors = [
        'PROPOSAL_NOT_FOUND',
        'PROPOSAL_NOT_IN_PROPOSED_STATE',
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
    const newStatus: ProposalStatus = isFullyApproved ? 'approved' : 'proposed';

    const { data, error } = await supabaseAdmin
      .from('proposals')
      .update({
        status: newStatus,
        approvals: updatedApprovals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', proposal.id)
      .eq('org_id', this.orgId)
      .select()
      .single();

    if (error) {
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

    if (proposal.status !== 'proposed') {
      throw new Error('PROPOSAL_NOT_IN_PROPOSED_STATE');
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
      return null;
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
        return null;
      }
      if (message.includes('PROPOSAL_NOT_FOUND')) {
        throw new Error('PROPOSAL_NOT_FOUND');
      }
      if (message.includes('PROPOSAL_NOT_IN_PROPOSED_STATE')) {
        throw new Error('PROPOSAL_NOT_IN_PROPOSED_STATE');
      }

      throw new Error(`Failed to reject proposal atomically: ${message}`);
    }

    const proposal = this.normalizeRpcProposal(data);
    if (!proposal) {
      throw new Error('Failed to reject proposal atomically: empty result');
    }

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
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to reject proposal: ${error.message}`);
    }

    const rejectedProposal = data as Proposal;
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
      return null;
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
      if (functionMissing) {
        return null;
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
      default:
        // Proposal/Eventが正本のため、他タイプは現時点で追加副作用なし
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
      .eq('id', siteId);

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
    return this.list({ status: 'proposed' });
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
}

// シングルトンエクスポート
export const proposalService = new ProposalService();
