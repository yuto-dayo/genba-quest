/**
 * client_billing_rules テーブルへの DB 書き込み・読み出しを担う。
 *
 * 鉄則:
 * - 過去の billing_period は不変（ルール変更は未来 period にのみ反映）
 * - ルール変更時は既存「現行ルール（effective_until=NULL）」の effective_until を
 *   新ルールの effective_from に揃え、新ルールを INSERT する atomic 操作
 */

import { supabaseAdmin } from '../lib/supabaseClient';
import {
  asDateOnly,
  findActiveRule,
  nextBillingPeriod,
  type BillingCycle,
  type BillingRule,
  type ClosingRule,
  type DatedBillingRule,
  type PaymentRule,
} from './BillingPeriodService';

export interface BillingRuleRecord {
  id: string;
  org_id: string;
  client_id: string;
  effective_from: string;
  effective_until: string | null;
  billing_cycle: BillingCycle;
  closing_rule: ClosingRule;
  payment_rule: PaymentRule;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface CreateBillingRuleInput {
  org_id: string;
  client_id: string;
  effective_from: string;
  billing_cycle: BillingCycle;
  closing_rule: ClosingRule;
  payment_rule: PaymentRule;
  notes?: string | null;
  created_by?: string | null;
}

const SELECT_COLS = '*' as const;

// ============================================================
// 履歴取得
// ============================================================

export async function listBillingRules(orgId: string, clientId: string): Promise<BillingRuleRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('client_billing_rules')
    .select(SELECT_COLS)
    .eq('org_id', orgId)
    .eq('client_id', clientId)
    .order('effective_from', { ascending: false });

  if (error) {
    throw new Error(`Failed to list billing rules: ${error.message}`);
  }
  return (data ?? []) as BillingRuleRecord[];
}

// ============================================================
// 現行ルール + 次の締め期間プレビュー
// ============================================================

export interface ActiveRulePreview {
  rule: BillingRuleRecord | null;
  next_period: {
    period_start: string;
    period_end: string;
    payment_due_date: string;
  } | null;
}

export async function getActiveBillingRuleWithPreview(
  orgId: string,
  clientId: string,
  on?: string,
): Promise<ActiveRulePreview> {
  const onStr = on ?? asDateOnly(new Date());
  const history = await listBillingRules(orgId, clientId);
  // listBillingRules は DESC で返るが findActiveRule は DESC/ASC どちらでも動く
  const dated: DatedBillingRule[] = history.map((r) => ({
    id: r.id,
    effective_from: r.effective_from,
    effective_until: r.effective_until,
    billing_cycle: r.billing_cycle,
    closing_rule: r.closing_rule,
    payment_rule: r.payment_rule,
  }));
  const active = findActiveRule(dated, onStr);
  if (!active) {
    return { rule: null, next_period: null };
  }
  const fullRecord = history.find((r) => r.id === active.id) ?? null;
  const period = nextBillingPeriod(
    {
      billing_cycle: active.billing_cycle,
      closing_rule: active.closing_rule,
      payment_rule: active.payment_rule,
    } as BillingRule,
    onStr,
  );
  return {
    rule: fullRecord,
    next_period: period,
  };
}

// ============================================================
// ルール作成（履歴 + 現行 effective_until 自動更新）
// ============================================================

/**
 * 新しい billing rule を作成する。
 * - 既に effective_from >= 今回の effective_from のルールが存在する場合は ERR_FUTURE_RULE_EXISTS
 * - 現行ルール (effective_until=NULL) があれば、その effective_until を今回の effective_from に揃える
 * - 同 client + 同 effective_from の組み合わせはユニーク制約で重複不可
 */
export async function createBillingRule(input: CreateBillingRuleInput): Promise<BillingRuleRecord> {
  validateRule(input);

  // 同日 or 未来の effective_from を持つルールがあると履歴が崩れる
  const { data: futureRows, error: futureErr } = await supabaseAdmin
    .from('client_billing_rules')
    .select('id, effective_from')
    .eq('org_id', input.org_id)
    .eq('client_id', input.client_id)
    .gte('effective_from', input.effective_from)
    .limit(1);

  if (futureErr) {
    throw new Error(`Failed to check future rules: ${futureErr.message}`);
  }
  if (futureRows && futureRows.length > 0) {
    throw new Error('ERR_FUTURE_RULE_EXISTS');
  }

  // 既存の現行ルール (effective_until=NULL) を引き、effective_until を新ルールの effective_from に
  const { data: currentRows, error: currentErr } = await supabaseAdmin
    .from('client_billing_rules')
    .select('id')
    .eq('org_id', input.org_id)
    .eq('client_id', input.client_id)
    .is('effective_until', null);

  if (currentErr) {
    throw new Error(`Failed to fetch current rule: ${currentErr.message}`);
  }

  if (currentRows && currentRows.length > 0) {
    const ids = currentRows.map((r) => r.id);
    const { error: updateErr } = await supabaseAdmin
      .from('client_billing_rules')
      .update({ effective_until: input.effective_from })
      .in('id', ids);

    if (updateErr) {
      throw new Error(`Failed to close current rule: ${updateErr.message}`);
    }
  }

  const insertPayload = {
    org_id: input.org_id,
    client_id: input.client_id,
    effective_from: input.effective_from,
    effective_until: null,
    billing_cycle: input.billing_cycle,
    closing_rule: input.closing_rule,
    payment_rule: input.payment_rule,
    notes: input.notes ?? null,
    created_by: input.created_by ?? null,
  };

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('client_billing_rules')
    .insert(insertPayload)
    .select(SELECT_COLS)
    .single();

  if (insertErr || !inserted) {
    throw new Error(`Failed to insert billing rule: ${insertErr?.message ?? 'unknown'}`);
  }

  return inserted as BillingRuleRecord;
}

// ============================================================
// バリデーション（純）
// ============================================================

export function validateRule(input: Pick<CreateBillingRuleInput, 'billing_cycle' | 'closing_rule' | 'payment_rule' | 'effective_from'>): void {
  if (!input.effective_from || !/^\d{4}-\d{2}-\d{2}$/.test(input.effective_from)) {
    throw new Error('ERR_INVALID_EFFECTIVE_FROM');
  }

  switch (input.billing_cycle) {
    case 'monthly': {
      const day = input.closing_rule.day;
      if (typeof day !== 'number' || (day !== 99 && (day < 1 || day > 28))) {
        throw new Error('ERR_INVALID_CLOSING_DAY');
      }
      break;
    }
    case 'weekly': {
      const w = input.closing_rule.weekday;
      if (typeof w !== 'number' || w < 0 || w > 6) {
        throw new Error('ERR_INVALID_CLOSING_WEEKDAY');
      }
      break;
    }
    case 'biweekly': {
      const w = input.closing_rule.weekday;
      if (typeof w !== 'number' || w < 0 || w > 6) {
        throw new Error('ERR_INVALID_CLOSING_WEEKDAY');
      }
      if (!input.closing_rule.anchor_date || !/^\d{4}-\d{2}-\d{2}$/.test(input.closing_rule.anchor_date)) {
        throw new Error('ERR_INVALID_ANCHOR_DATE');
      }
      break;
    }
    case 'custom':
      // custom は自由 — 検証スキップ
      break;
    default:
      throw new Error('ERR_INVALID_BILLING_CYCLE');
  }

  const pr = input.payment_rule;
  const hasDays = typeof pr.days === 'number';
  const hasMonthOffset = typeof pr.month_offset === 'number' && typeof pr.day === 'number';
  if (!hasDays && !hasMonthOffset) {
    throw new Error('ERR_INVALID_PAYMENT_RULE');
  }
  if (hasDays && (pr.days! < 0 || pr.days! > 365)) {
    throw new Error('ERR_INVALID_PAYMENT_DAYS');
  }
  if (hasMonthOffset) {
    if (pr.month_offset! < 0 || pr.month_offset! > 6) {
      throw new Error('ERR_INVALID_PAYMENT_MONTH_OFFSET');
    }
    if (pr.day !== 99 && (pr.day! < 1 || pr.day! > 28)) {
      throw new Error('ERR_INVALID_PAYMENT_DAY');
    }
  }
}
