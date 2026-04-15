/**
 * LUQO Service
 * combo計算・報酬計算・スコア集計のビジネスロジック
 * 計算式: combo = S × V / 100 (技術×スピード乗算)
 */

import { supabaseAdmin } from '../lib/supabaseAdmin';

const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001';

// ============================================================
// Types
// ============================================================

export interface LUQOCategory {
  id: string;
  org_id: string;
  name: string;
  display_order: number;
  is_active: boolean;
  created_at: string;
}

export interface LUQOSkillItem {
  id: string;
  org_id: string;
  category_id: string;
  category?: LUQOCategory;
  name: string;
  is_speed: boolean;
  speed_threshold: number | null;
  speed_unit: string | null;
  points: number;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface LUQOStarAchievement {
  id: string;
  org_id: string;
  member_id: string;
  star_id: string;
  star?: LUQOSkillItem;
  achieved_at: string;
  proposal_id: string | null;
  revoked_at: string | null;
}

export interface LUQOPeriodScore {
  id: string;
  org_id: string;
  member_id: string;
  period: string;
  lu_score: number | null;
  q_score: number | null;
  o_score: number | null;
  luqo_score: number | null;
  tech_stars: number;
  speed_stars: number;
  combo: number | null;
  submission_rate: number | null;
  finalized: boolean;
}

export interface RewardMember {
  member_id: string;
  name: string;
  days: number;
  tech_stars: number;
  speed_stars: number;
}

export interface RewardBreakdownItem extends RewardMember {
  S: number;          // 技術力スコア 0-100
  V: number;          // 施工スピードスコア 0-100
  combo: number;      // S×V/100
  effort: number;     // days × combo
  ratio: number;      // effort / totalEffort
  amount: number;     // 支給額（円）
}

export interface RewardPreview {
  period: string;
  profit: number;
  company_rate: number;
  distributable: number;
  tech_max: number;   // 現在のカタログ技術項目合計
  speed_max: number;  // 現在のカタログスピード項目合計
  members: RewardBreakdownItem[];
  total_check: number; // 合計確認用（distributalbeに一致するはず）
}

// ============================================================
// LUQOService
// ============================================================

export class LUQOService {
  private orgId: string;

  constructor(orgId: string = DEFAULT_ORG_ID) {
    this.orgId = orgId;
  }

  // ============================================================
  // カタログ
  // ============================================================

  async getCategories(): Promise<LUQOCategory[]> {
    const { data, error } = await supabaseAdmin
      .from('luqo_categories')
      .select('*')
      .eq('org_id', this.orgId)
      .eq('is_active', true)
      .order('display_order');

    if (error) throw new Error(`Failed to fetch categories: ${error.message}`);
    return data ?? [];
  }

  async getCatalog(categoryId?: string): Promise<LUQOSkillItem[]> {
    let query = supabaseAdmin
      .from('luqo_skill_catalog')
      .select('*, category:luqo_categories(id, name, display_order)')
      .eq('org_id', this.orgId)
      .eq('is_active', true)
      .order('category_id')
      .order('is_speed')
      .order('points');

    if (categoryId) {
      query = query.eq('category_id', categoryId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch catalog: ${error.message}`);
    return (data ?? []) as unknown as LUQOSkillItem[];
  }

  /**
   * カタログから技術合計・スピード合計を取得（combo計算の基準値）
   */
  async getCatalogMaxPoints(): Promise<{ techMax: number; speedMax: number }> {
    const catalog = await this.getCatalog();
    const techMax = catalog
      .filter(i => !i.is_speed)
      .reduce((sum, i) => sum + i.points, 0);
    const speedMax = catalog
      .filter(i => i.is_speed)
      .reduce((sum, i) => sum + i.points, 0);
    return { techMax, speedMax };
  }

  // ============================================================
  // スター達成
  // ============================================================

  async getMemberAchievements(memberId: string): Promise<LUQOStarAchievement[]> {
    const { data, error } = await supabaseAdmin
      .from('luqo_star_achievements')
      .select('*, star:luqo_skill_catalog(id, name, is_speed, points, category_id)')
      .eq('org_id', this.orgId)
      .eq('member_id', memberId)
      .is('revoked_at', null)
      .order('achieved_at', { ascending: false });

    if (error) throw new Error(`Failed to fetch achievements: ${error.message}`);
    return (data ?? []) as unknown as LUQOStarAchievement[];
  }

  /**
   * メンバーの現在の技術スター合計・スピードスター合計を集計
   */
  async getMemberStarTotals(memberId: string): Promise<{ techStars: number; speedStars: number }> {
    const achievements = await this.getMemberAchievements(memberId);
    let techStars = 0;
    let speedStars = 0;
    for (const a of achievements) {
      if (a.star) {
        if (a.star.is_speed) {
          speedStars += a.star.points;
        } else {
          techStars += a.star.points;
        }
      }
    }
    return { techStars, speedStars };
  }

  // ============================================================
  // スコア
  // ============================================================

  async getPeriodScores(period?: string, memberId?: string): Promise<LUQOPeriodScore[]> {
    let query = supabaseAdmin
      .from('luqo_period_scores')
      .select('*')
      .eq('org_id', this.orgId)
      .order('period', { ascending: false });

    if (period) query = query.eq('period', period);
    if (memberId) query = query.eq('member_id', memberId);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch period scores: ${error.message}`);
    return (data ?? []) as LUQOPeriodScore[];
  }

  // ============================================================
  // Combo計算（コアロジック）
  // ============================================================

  /**
   * 技術×スピード乗算コンボを計算
   * S = (techStars / techMax) × 100
   * V = (speedStars / speedMax) × 100
   * combo = S × V / 100
   */
  calcCombo(
    techStars: number,
    speedStars: number,
    techMax: number,
    speedMax: number
  ): { S: number; V: number; combo: number } {
    const S = techMax > 0 ? Math.min(100, (techStars / techMax) * 100) : 0;
    const V = speedMax > 0 ? Math.min(100, (speedStars / speedMax) * 100) : 0;
    const combo = (S * V) / 100;
    return {
      S: Math.round(S * 10) / 10,
      V: Math.round(V * 10) / 10,
      combo: Math.round(combo * 10) / 10,
    };
  }

  // ============================================================
  // 報酬計算プレビュー
  // ============================================================

  /**
   * 報酬計算プレビューを生成（DB未確定・確認用）
   */
  async calcRewardPreview(
    period: string,
    profit: number,
    companyRate: number,
    members: RewardMember[]
  ): Promise<RewardPreview> {
    const { techMax, speedMax } = await this.getCatalogMaxPoints();
    const distributable = Math.round(profit * (1 - companyRate / 100));

    // combo & effort を計算
    const withCombo = members.map(m => {
      const scores = this.calcCombo(m.tech_stars, m.speed_stars, techMax, speedMax);
      return {
        ...m,
        ...scores,
        effort: m.days * scores.combo,
      };
    });

    const totalEffort = withCombo.reduce((s, m) => s + m.effort, 0);

    // ratio & amount
    let remaining = distributable;
    const result: RewardBreakdownItem[] = withCombo.map((m, idx) => {
      const ratio = totalEffort > 0 ? m.effort / totalEffort : 1 / withCombo.length;
      let amount: number;
      if (idx === withCombo.length - 1) {
        // 最後の人は端数調整
        amount = remaining;
      } else {
        amount = Math.round(distributable * ratio);
        remaining -= amount;
      }
      return { ...m, ratio: Math.round(ratio * 10000) / 10000, amount };
    });

    return {
      period,
      profit,
      company_rate: companyRate,
      distributable,
      tech_max: techMax,
      speed_max: speedMax,
      members: result,
      total_check: result.reduce((s, m) => s + m.amount, 0),
    };
  }

  // ============================================================
  // 報酬計算履歴
  // ============================================================

  async getRewardCalculations(period?: string) {
    let query = supabaseAdmin
      .from('luqo_reward_calculations')
      .select('*')
      .eq('org_id', this.orgId)
      .order('period', { ascending: false });

    if (period) query = query.eq('period', period);

    const { data, error } = await query;
    if (error) throw new Error(`Failed to fetch reward calculations: ${error.message}`);
    return data ?? [];
  }
}
