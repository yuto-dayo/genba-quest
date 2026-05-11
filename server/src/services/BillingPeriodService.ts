/**
 * 締め払いルールに基づき、締め期間（billing_period）と入金予定日を計算する純関数群。
 *
 * 鉄則：
 * - 過去の billing_period は不変。ルール変更は未来の period にのみ反映
 * - 日付は YYYY-MM-DD 文字列で扱う（タイムゾーン排除）
 * - DB I/O はこの service には含まない（呼び出し側でやる）
 */

export type BillingCycle = 'weekly' | 'biweekly' | 'monthly' | 'custom';

export interface ClosingRule {
  /** monthly: 1-28 または 99 (= 末日) */
  day?: number;
  /** weekly/biweekly: 0=日 ... 6=土 */
  weekday?: number;
  /** biweekly のアンカー日（YYYY-MM-DD）。この日からN週間ごとに締め */
  anchor_date?: string;
}

export interface PaymentRule {
  /** 締め日からN日後 */
  days?: number;
  /** 締め日のN月後の指定日（month_offset+day をセットで使う） */
  month_offset?: number;
  /** 1-28 または 99 (= 末日) */
  day?: number;
}

export interface BillingRule {
  billing_cycle: BillingCycle;
  closing_rule: ClosingRule;
  payment_rule: PaymentRule;
}

export interface BillingPeriodResult {
  period_start: string;
  period_end: string;
  payment_due_date: string;
}

// ============================================================
// 日付ユーティリティ（タイムゾーン排除のため YYYY-MM-DD 文字列で）
// ============================================================

export function asDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateOnly(s: string): Date {
  const parts = s.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    throw new Error(`Invalid date string: ${s}`);
  }
  const [y, m, d] = parts;
  return new Date(y, m - 1, d);
}

function lastDayOfMonth(year: number, monthIndex: number): number {
  // monthIndex は 0-indexed
  return new Date(year, monthIndex + 1, 0).getDate();
}

function buildMonthDate(year: number, monthIndex: number, day: number): Date {
  const actualDay = day === 99 ? lastDayOfMonth(year, monthIndex) : Math.min(day, lastDayOfMonth(year, monthIndex));
  return new Date(year, monthIndex, actualDay);
}

function addDays(date: Date, days: number): Date {
  const r = new Date(date);
  r.setDate(date.getDate() + days);
  return r;
}

// ============================================================
// 入金予定日計算
// ============================================================

export function calculatePaymentDueDate(periodEnd: string, paymentRule: PaymentRule): string {
  const end = parseDateOnly(periodEnd);

  if (typeof paymentRule.days === 'number') {
    return asDateOnly(addDays(end, paymentRule.days));
  }

  if (typeof paymentRule.month_offset === 'number' && typeof paymentRule.day === 'number') {
    const targetMonth = end.getMonth() + paymentRule.month_offset;
    return asDateOnly(buildMonthDate(end.getFullYear(), targetMonth, paymentRule.day));
  }

  throw new Error(
    `Invalid payment_rule: must specify either {days:N} or {month_offset:N, day:N}. Got: ${JSON.stringify(paymentRule)}`,
  );
}

// ============================================================
// 締め日計算（cycle ごと）
// ============================================================

function nextMonthlyClosingEnd(onDate: Date, closingRule: ClosingRule): Date {
  const day = closingRule.day ?? 99;
  // 当月の締め日
  let candidate = buildMonthDate(onDate.getFullYear(), onDate.getMonth(), day);
  if (candidate.getTime() < onDate.getTime()) {
    // 当月の締め日はもう過ぎてる → 翌月
    candidate = buildMonthDate(onDate.getFullYear(), onDate.getMonth() + 1, day);
  }
  return candidate;
}

function nextWeeklyClosingEnd(onDate: Date, closingRule: ClosingRule): Date {
  const targetWeekday = closingRule.weekday ?? 5; // default Friday
  const onWeekday = onDate.getDay();
  let daysAhead = targetWeekday - onWeekday;
  if (daysAhead < 0) daysAhead += 7;
  return addDays(onDate, daysAhead);
}

function nextBiweeklyClosingEnd(onDate: Date, closingRule: ClosingRule): Date {
  // anchor_date を起点に 14 日周期で締める
  if (!closingRule.anchor_date) {
    throw new Error('biweekly cycle requires closing_rule.anchor_date');
  }
  const anchor = parseDateOnly(closingRule.anchor_date);
  const onTime = onDate.getTime();
  const dayMs = 86_400_000;
  const diffDays = Math.floor((onTime - anchor.getTime()) / dayMs);
  const cyclesPassed = Math.floor(diffDays / 14);
  let candidate = addDays(anchor, cyclesPassed * 14);
  if (candidate.getTime() < onDate.getTime()) {
    candidate = addDays(candidate, 14);
  }
  return candidate;
}

// ============================================================
// 期間開始日の計算（period_end → period_start）
// ============================================================

function periodStartFromEnd(periodEnd: Date, rule: BillingRule): Date {
  switch (rule.billing_cycle) {
    case 'weekly':
      return addDays(periodEnd, -6);
    case 'biweekly':
      return addDays(periodEnd, -13);
    case 'monthly': {
      const day = rule.closing_rule.day ?? 99;
      let prevEnd: Date;
      if (day === 99) {
        // 前月末日
        prevEnd = new Date(periodEnd.getFullYear(), periodEnd.getMonth(), 0);
      } else {
        // 前月の同日
        prevEnd = buildMonthDate(periodEnd.getFullYear(), periodEnd.getMonth() - 1, day);
      }
      return addDays(prevEnd, 1);
    }
    case 'custom':
      throw new Error('custom cycle: period_start cannot be derived automatically');
  }
}

// ============================================================
// メインAPI
// ============================================================

/**
 * 指定日 (on) 時点で「次の or 今の」締め期間を計算する。
 * - on が period 内にあるなら、その period を返す
 * - on が締め日当日なら、その当日を period_end とする period を返す
 * - on が period 外（過ぎた）なら、次の period を返す
 */
export function nextBillingPeriod(rule: BillingRule, on: string | Date): BillingPeriodResult {
  const onDate = typeof on === 'string' ? parseDateOnly(on) : on;

  let periodEnd: Date;
  switch (rule.billing_cycle) {
    case 'monthly':
      periodEnd = nextMonthlyClosingEnd(onDate, rule.closing_rule);
      break;
    case 'weekly':
      periodEnd = nextWeeklyClosingEnd(onDate, rule.closing_rule);
      break;
    case 'biweekly':
      periodEnd = nextBiweeklyClosingEnd(onDate, rule.closing_rule);
      break;
    case 'custom':
      throw new Error('custom cycle: nextBillingPeriod requires explicit period');
  }

  const periodStart = periodStartFromEnd(periodEnd, rule);
  const periodEndStr = asDateOnly(periodEnd);
  const paymentDueDate = calculatePaymentDueDate(periodEndStr, rule.payment_rule);

  return {
    period_start: asDateOnly(periodStart),
    period_end: periodEndStr,
    payment_due_date: paymentDueDate,
  };
}

/**
 * 指定日から前を向いて N 期分の billing_period を生成する。
 * 取引先設定変更時に「向こう3期分まとめ生成」のような用途。
 */
export function generateUpcomingPeriods(
  rule: BillingRule,
  startOn: string | Date,
  count: number,
): BillingPeriodResult[] {
  if (count <= 0) return [];
  const results: BillingPeriodResult[] = [];
  let cursor = typeof startOn === 'string' ? parseDateOnly(startOn) : new Date(startOn);

  for (let i = 0; i < count; i += 1) {
    const period = nextBillingPeriod(rule, cursor);
    results.push(period);
    // 次の周回は period_end の翌日からスタート
    cursor = addDays(parseDateOnly(period.period_end), 1);
  }
  return results;
}

/**
 * 取引先の billing_rule 履歴から、指定日に有効なルールを抽出する。
 * 履歴は effective_from 昇順で渡されている前提（呼び出し側で sort）。
 */
export interface DatedBillingRule extends BillingRule {
  id: string;
  effective_from: string;
  effective_until: string | null;
}

export function findActiveRule(
  history: DatedBillingRule[],
  on: string | Date,
): DatedBillingRule | null {
  const onStr = typeof on === 'string' ? on : asDateOnly(on);
  for (const rule of history) {
    if (rule.effective_from > onStr) continue;
    if (rule.effective_until !== null && rule.effective_until <= onStr) continue;
    if (rule.effective_from <= onStr && (rule.effective_until === null || rule.effective_until > onStr)) {
      // 該当。複数ヒットしたら一番新しい effective_from を使うため上書き継続
      // ただし history が effective_from 昇順なら最後に見つかったのが最新
    }
  }
  // 上のループで最後に該当したルールを返す（最新優先）
  let active: DatedBillingRule | null = null;
  for (const rule of history) {
    if (rule.effective_from <= onStr && (rule.effective_until === null || rule.effective_until > onStr)) {
      active = rule;
    }
  }
  return active;
}
