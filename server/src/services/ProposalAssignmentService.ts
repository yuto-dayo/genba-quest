/**
 * Proposal の承認担当をランダムに割り当てる service。
 *
 * 鉄則:
 * - 起票者は割当対象から除外（自分の経費を自分で承認しない）
 * - 直近 N 件の履歴で同じ人に当たらないよう緩く分散 (best-effort)
 * - 全ての割当は proposal_review_assignments に監査ログとして残る
 * - random_one モード以外 (all_members / majority) は PR #4 以降で実装
 */

import { supabaseAdmin } from '../lib/supabaseClient';

export type AssignmentReason = 'initial' | 'reassigned' | 'expired';

export interface ReviewAssignmentRecord {
  id: string;
  org_id: string;
  proposal_id: string;
  assigned_to: string;
  assigned_at: string;
  resolved_at: string | null;
  resolution: 'approved' | 'rejected' | 'reassigned' | 'expired' | null;
  is_active: boolean;
  reason: string | null;
  created_at: string;
}

export interface PickedReviewerInput {
  org_id: string;
  /** 起票者の user_id (除外対象)。起票者が AI/system の場合は null */
  creator_user_id: string | null;
  /** 直近 N 件で除外したい reviewer_id (連続割当を避けるため、空でも動く) */
  recent_reviewer_ids?: string[];
}

// ============================================================
// 純関数: 候補プールから1人をランダムに選ぶ
// ============================================================

export function pickFromPool(
  candidates: string[],
  recentReviewerIds: string[] = [],
  rng: () => number = Math.random,
): string | null {
  if (candidates.length === 0) return null;
  // 直近に当たった人を除く（そうすると候補が0になる場合は元のプールから選ぶ）
  const filtered = candidates.filter((id) => !recentReviewerIds.includes(id));
  const pool = filtered.length > 0 ? filtered : candidates;
  const idx = Math.floor(rng() * pool.length);
  return pool[idx];
}

// ============================================================
// DB 連動: 資格者プール取得
// ============================================================

/**
 * 組織のアクティブメンバー全員を取得し、起票者を除いた user_id 配列を返す。
 *
 * PolicyEngine の required_approvers は将来 'role:admin' 等で絞り込み可能だが、
 * MVP では「アクティブメンバー全員から起票者を除外」で十分。
 */
async function fetchEligibleReviewers(orgId: string, creatorUserId: string | null): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('org_memberships')
    .select('user_id')
    .eq('org_id', orgId)
    .eq('status', 'active');

  if (error) {
    throw new Error(`Failed to fetch eligible reviewers: ${error.message}`);
  }
  if (!data) return [];

  const userIds = data
    .map((row) => row.user_id as string)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  if (creatorUserId) {
    return userIds.filter((id) => id !== creatorUserId);
  }
  return userIds;
}

/**
 * 直近 N 件で割り当てられた reviewer_id を返す（連続割当防止用）。
 */
async function fetchRecentReviewers(orgId: string, limit = 5): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('proposal_review_assignments')
    .select('assigned_to')
    .eq('org_id', orgId)
    .order('assigned_at', { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to fetch recent reviewers: ${error.message}`);
  }
  return (data ?? [])
    .map((row) => row.assigned_to as string)
    .filter((id): id is string => typeof id === 'string');
}

export async function pickRandomReviewer(input: PickedReviewerInput): Promise<string | null> {
  const candidates = await fetchEligibleReviewers(input.org_id, input.creator_user_id);
  if (candidates.length === 0) return null;
  const recent = input.recent_reviewer_ids ?? (await fetchRecentReviewers(input.org_id));
  return pickFromPool(candidates, recent);
}

// ============================================================
// DB 書き込み: 割当を記録
// ============================================================

interface AssignReviewerInput {
  org_id: string;
  proposal_id: string;
  reviewer_id: string;
  reason: AssignmentReason;
  reassignment_count?: number;
}

export async function assignReviewer(input: AssignReviewerInput): Promise<ReviewAssignmentRecord> {
  // 既存のアクティブ割当（reassign の場合）を閉じる
  if (input.reason === 'reassigned' || input.reason === 'expired') {
    const { error: closeErr } = await supabaseAdmin
      .from('proposal_review_assignments')
      .update({
        is_active: false,
        resolved_at: new Date().toISOString(),
        resolution: input.reason,
      })
      .eq('proposal_id', input.proposal_id)
      .eq('is_active', true);
    if (closeErr) {
      throw new Error(`Failed to close prior assignment: ${closeErr.message}`);
    }
  }

  // 新規 active 割当を挿入
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('proposal_review_assignments')
    .insert({
      org_id: input.org_id,
      proposal_id: input.proposal_id,
      assigned_to: input.reviewer_id,
      reason: input.reason,
      is_active: true,
    })
    .select('*')
    .single();

  if (insertErr || !inserted) {
    throw new Error(`Failed to insert assignment: ${insertErr?.message ?? 'unknown'}`);
  }

  // proposals テーブルの assigned_reviewer_id / assigned_at / reassignment_count を更新
  const updatePayload: Record<string, unknown> = {
    assigned_reviewer_id: input.reviewer_id,
    assigned_at: new Date().toISOString(),
  };
  if (typeof input.reassignment_count === 'number') {
    updatePayload.reassignment_count = input.reassignment_count;
  }
  const { error: updateErr } = await supabaseAdmin
    .from('proposals')
    .update(updatePayload)
    .eq('id', input.proposal_id);

  if (updateErr) {
    throw new Error(`Failed to update proposal assignment: ${updateErr.message}`);
  }

  return inserted as ReviewAssignmentRecord;
}

/**
 * 承認/却下が成立したときに、active 割当を閉じる。
 * (random_one の場合は1件、all_members の場合は該当 reviewer の1件)
 */
export async function resolveAssignment(input: {
  proposal_id: string;
  reviewer_id: string;
  resolution: 'approved' | 'rejected';
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('proposal_review_assignments')
    .update({
      is_active: false,
      resolved_at: new Date().toISOString(),
      resolution: input.resolution,
    })
    .eq('proposal_id', input.proposal_id)
    .eq('assigned_to', input.reviewer_id)
    .eq('is_active', true);

  if (error) {
    throw new Error(`Failed to resolve assignment: ${error.message}`);
  }
}

// ============================================================
// 高レベル: submit 時の自動割当エントリ
// ============================================================

/**
 * proposal が submit されて pending 化したとき呼ぶ。
 * - org にメンバーが起票者しかいない場合は割当しない (assigned_reviewer_id=NULL のまま)
 * - 失敗しても submit 自体は成功扱い (呼び出し側でエラーログのみ)
 */
export async function assignOnSubmit(input: {
  org_id: string;
  proposal_id: string;
  creator_user_id: string | null;
}): Promise<ReviewAssignmentRecord | null> {
  const reviewerId = await pickRandomReviewer({
    org_id: input.org_id,
    creator_user_id: input.creator_user_id,
  });
  if (!reviewerId) return null;
  return assignReviewer({
    org_id: input.org_id,
    proposal_id: input.proposal_id,
    reviewer_id: reviewerId,
    reason: 'initial',
    reassignment_count: 0,
  });
}

/**
 * "他の人に回す" — 現在割当中の reviewer が別の reviewer に渡す。
 * 起票者と現在の割当先を除いてランダムに選び直す。
 */
export async function reassign(input: {
  org_id: string;
  proposal_id: string;
  current_reviewer_id: string;
  creator_user_id: string | null;
  current_reassignment_count: number;
}): Promise<ReviewAssignmentRecord | null> {
  const candidates = await fetchEligibleReviewers(input.org_id, input.creator_user_id);
  // 現在の割当先も除外（同じ人にループしない）
  const filtered = candidates.filter((id) => id !== input.current_reviewer_id);
  const recent = await fetchRecentReviewers(input.org_id);
  const reviewerId = pickFromPool(filtered, recent);
  if (!reviewerId) return null;
  return assignReviewer({
    org_id: input.org_id,
    proposal_id: input.proposal_id,
    reviewer_id: reviewerId,
    reason: 'reassigned',
    reassignment_count: input.current_reassignment_count + 1,
  });
}

// ============================================================
// 読み出し: ベルドロワー用「自分宛」一覧
// ============================================================

export interface AssignedProposalSummary {
  proposal_id: string;
  type: string;
  description: string;
  status: string;
  created_by: { type: string; id?: string; name?: string };
  assigned_at: string;
  reassignment_count: number;
  payload: Record<string, unknown>;
}

export async function listProposalsAssignedToUser(orgId: string, userId: string): Promise<AssignedProposalSummary[]> {
  const { data, error } = await supabaseAdmin
    .from('proposals')
    .select('id, type, description, status, created_by, assigned_at, reassignment_count, payload')
    .eq('org_id', orgId)
    .eq('assigned_reviewer_id', userId)
    .eq('status', 'pending')
    .order('assigned_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to list assigned proposals: ${error.message}`);
  }
  return (data ?? []).map((row) => ({
    proposal_id: row.id as string,
    type: row.type as string,
    description: row.description as string,
    status: row.status as string,
    created_by: row.created_by as AssignedProposalSummary['created_by'],
    assigned_at: row.assigned_at as string,
    reassignment_count: (row.reassignment_count as number) ?? 0,
    payload: (row.payload as Record<string, unknown>) ?? {},
  }));
}
