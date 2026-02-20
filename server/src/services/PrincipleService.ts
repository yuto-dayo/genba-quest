/**
 * Principle Service
 * Think Again × Thompson Sampling: 設計原則のベイズ的確信度管理
 *
 * 各設計原則に Beta分布パラメータ (α, β) を持たせ、
 * Proposalの成功/失敗を観測としてベイズ更新する。
 *
 * 確信度 = α / (α + β)
 * 不確実性 = αβ / ((α+β)²(α+β+1))
 *
 * 参照: docs/DESIGN_PHILOSOPHY.md
 */

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { ActorRef } from "./PolicyEngine";

// ============================================================
// Types
// ============================================================

export type PrincipleCategory = 'core' | 'policy' | 'architecture' | 'process';
export type PrincipleStatus = 'active' | 'under_review' | 'superseded';

export interface DesignPrinciple {
  id: string;
  org_id: string;
  name: string;
  description: string;
  category: PrincipleCategory;
  alpha: number;
  beta: number;
  status: PrincipleStatus;
  superseded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PrincipleConfidence {
  id: string;
  name: string;
  description: string;
  category: PrincipleCategory;
  status: PrincipleStatus;
  alpha: number;
  beta: number;
  confidence: number;        // α / (α + β)
  uncertainty: number;       // αβ / ((α+β)²(α+β+1))
  totalObservations: number; // α + β - 2 (事前分布のα=1,β=1を引く)
  dataLabel: 'insufficient' | 'moderate' | 'sufficient';
}

export interface PrincipleObservation {
  id: string;
  principle_id: string;
  proposal_id: string | null;
  outcome: boolean;
  reason: string;
  observed_by: ActorRef;
  alpha_before: number;
  beta_before: number;
  alpha_after: number;
  beta_after: number;
  created_at: string;
}

export interface RecordObservationInput {
  principleName: string;
  outcome: boolean;
  reason: string;
  observedBy: ActorRef;
  proposalId?: string;
}

// ============================================================
// Pure functions（テスト容易）
// ============================================================

/** Beta分布の期待値（確信度） */
export function calculateConfidence(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

/** Beta分布の分散（不確実性） */
export function calculateUncertainty(alpha: number, beta: number): number {
  const sum = alpha + beta;
  return (alpha * beta) / (sum * sum * (sum + 1));
}

/** 観測数に基づくデータ充足ラベル */
export function getDataLabel(alpha: number, beta: number): 'insufficient' | 'moderate' | 'sufficient' {
  const observations = alpha + beta - 2; // 事前分布 Beta(1,1) を引く
  if (observations < 3) return 'insufficient';
  if (observations < 10) return 'moderate';
  return 'sufficient';
}

/** DesignPrinciple → PrincipleConfidence への変換 */
export function toPrincipleConfidence(p: DesignPrinciple): PrincipleConfidence {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    status: p.status,
    alpha: p.alpha,
    beta: p.beta,
    confidence: calculateConfidence(p.alpha, p.beta),
    uncertainty: calculateUncertainty(p.alpha, p.beta),
    totalObservations: p.alpha + p.beta - 2,
    dataLabel: getDataLabel(p.alpha, p.beta),
  };
}

// ============================================================
// Service class
// ============================================================

export class PrincipleService {
  constructor(private readonly orgId: string) {}

  /** 全原則の確信度を取得 */
  async listPrinciples(statusFilter?: PrincipleStatus): Promise<PrincipleConfidence[]> {
    let query = supabaseAdmin
      .from('design_principles')
      .select('*')
      .eq('org_id', this.orgId)
      .order('category')
      .order('name');

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) throw new Error(`PRINCIPLE_LIST_FAILED: ${error.message}`);
    return (data as DesignPrinciple[]).map(toPrincipleConfidence);
  }

  /** 特定原則の確信度を取得 */
  async getPrinciple(name: string): Promise<PrincipleConfidence | null> {
    const { data, error } = await supabaseAdmin
      .from('design_principles')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('name', name)
      .maybeSingle();

    if (error) throw new Error(`PRINCIPLE_GET_FAILED: ${error.message}`);
    if (!data) return null;
    return toPrincipleConfidence(data as DesignPrinciple);
  }

  /** 観測を記録し α/β を更新 */
  async recordObservation(input: RecordObservationInput): Promise<PrincipleObservation> {
    // 1. 対象原則を取得
    const { data: principle, error: fetchErr } = await supabaseAdmin
      .from('design_principles')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('name', input.principleName)
      .single();

    if (fetchErr || !principle) {
      throw new Error('PRINCIPLE_NOT_FOUND');
    }

    const p = principle as DesignPrinciple;
    const alphaBefore = p.alpha;
    const betaBefore = p.beta;
    const alphaAfter = input.outcome ? alphaBefore + 1 : alphaBefore;
    const betaAfter = input.outcome ? betaBefore : betaBefore + 1;

    // 2. 観測を記録（追記のみ = Ledger的）
    const { data: observation, error: obsErr } = await supabaseAdmin
      .from('principle_observations')
      .insert({
        principle_id: p.id,
        proposal_id: input.proposalId || null,
        outcome: input.outcome,
        reason: input.reason,
        observed_by: input.observedBy,
        alpha_before: alphaBefore,
        beta_before: betaBefore,
        alpha_after: alphaAfter,
        beta_after: betaAfter,
      })
      .select()
      .single();

    if (obsErr) throw new Error(`OBSERVATION_INSERT_FAILED: ${obsErr.message}`);

    // 3. 原則の α/β を更新
    const { error: updateErr } = await supabaseAdmin
      .from('design_principles')
      .update({
        alpha: alphaAfter,
        beta: betaAfter,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id);

    if (updateErr) throw new Error(`PRINCIPLE_UPDATE_FAILED: ${updateErr.message}`);

    // 4. 確信度低下チェック → status を under_review に変更
    const newConfidence = calculateConfidence(alphaAfter, betaAfter);
    const totalObs = alphaAfter + betaAfter - 2;
    if (newConfidence < 0.4 && totalObs >= 5 && p.status === 'active') {
      await supabaseAdmin
        .from('design_principles')
        .update({ status: 'under_review', updated_at: new Date().toISOString() })
        .eq('id', p.id);
    }

    return observation as PrincipleObservation;
  }

  /** 特定原則の観測履歴を取得 */
  async getObservations(principleName: string, limit = 50): Promise<PrincipleObservation[]> {
    // 原則IDを取得
    const { data: principle, error: fetchErr } = await supabaseAdmin
      .from('design_principles')
      .select('id')
      .eq('org_id', this.orgId)
      .eq('name', principleName)
      .single();

    if (fetchErr || !principle) throw new Error('PRINCIPLE_NOT_FOUND');

    const { data, error } = await supabaseAdmin
      .from('principle_observations')
      .select('*')
      .eq('principle_id', principle.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(`OBSERVATIONS_LIST_FAILED: ${error.message}`);
    return data as PrincipleObservation[];
  }
}
