import {
  calculatePaymentDueDate,
  nextBillingPeriod,
  generateUpcomingPeriods,
  findActiveRule,
  asDateOnly,
  parseDateOnly,
  type BillingRule,
  type DatedBillingRule,
} from '../../services/BillingPeriodService';

describe('BillingPeriodService', () => {
  // ============================================================
  // 日付ユーティリティ
  // ============================================================
  describe('asDateOnly / parseDateOnly', () => {
    it('Date を YYYY-MM-DD 文字列に変換する', () => {
      expect(asDateOnly(new Date(2026, 5, 30))).toBe('2026-06-30');
      expect(asDateOnly(new Date(2026, 0, 1))).toBe('2026-01-01');
    });

    it('YYYY-MM-DD 文字列を Date に戻す（タイムゾーン非依存）', () => {
      const d = parseDateOnly('2026-06-30');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(5);
      expect(d.getDate()).toBe(30);
    });

    it('不正な日付文字列でエラー', () => {
      expect(() => parseDateOnly('invalid')).toThrow();
      expect(() => parseDateOnly('2026-99-99')).not.toThrow(); // JS Date は受け付けてしまう
    });
  });

  // ============================================================
  // calculatePaymentDueDate
  // ============================================================
  describe('calculatePaymentDueDate', () => {
    it('{days: 7} 締め日 + 7日', () => {
      expect(calculatePaymentDueDate('2026-06-19', { days: 7 })).toBe('2026-06-26');
    });

    it('{days: 45} 末締め45日後 (6/30 → 8/14)', () => {
      expect(calculatePaymentDueDate('2026-06-30', { days: 45 })).toBe('2026-08-14');
    });

    it('{days: 60} 末締め60日後 (6/30 → 8/29)', () => {
      expect(calculatePaymentDueDate('2026-06-30', { days: 60 })).toBe('2026-08-29');
    });

    it('{month_offset: 1, day: 99} 末締め翌月末払い (6/30 → 7/31)', () => {
      expect(calculatePaymentDueDate('2026-06-30', { month_offset: 1, day: 99 })).toBe('2026-07-31');
    });

    it('{month_offset: 1, day: 99} 20日締め翌月末払い (6/20 → 7/31)', () => {
      expect(calculatePaymentDueDate('2026-06-20', { month_offset: 1, day: 99 })).toBe('2026-07-31');
    });

    it('{month_offset: 1, day: 25} 末締め翌月25日払い (6/30 → 7/25)', () => {
      expect(calculatePaymentDueDate('2026-06-30', { month_offset: 1, day: 25 })).toBe('2026-07-25');
    });

    it('{month_offset: 0, day: 25} 同月25日払い (6/20 → 6/25)', () => {
      expect(calculatePaymentDueDate('2026-06-20', { month_offset: 0, day: 25 })).toBe('2026-06-25');
    });

    it('2月末払い：閏年でない 2027-01-31 + month_offset 1 day 99 → 2027-02-28', () => {
      expect(calculatePaymentDueDate('2027-01-31', { month_offset: 1, day: 99 })).toBe('2027-02-28');
    });

    it('2月末払い：閏年 2027-12-31 → 2028-02-29', () => {
      expect(calculatePaymentDueDate('2027-12-31', { month_offset: 2, day: 99 })).toBe('2028-02-29');
    });

    it('payment_rule が空でエラー', () => {
      expect(() => calculatePaymentDueDate('2026-06-30', {})).toThrow();
    });
  });

  // ============================================================
  // nextBillingPeriod - monthly
  // ============================================================
  describe('nextBillingPeriod monthly 末締め翌月末払い (末末)', () => {
    const rule: BillingRule = {
      billing_cycle: 'monthly',
      closing_rule: { day: 99 },
      payment_rule: { month_offset: 1, day: 99 },
    };

    it('月中 (6/15): 6/1 - 6/30 締め、7/31 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-15');
      expect(r.period_start).toBe('2026-06-01');
      expect(r.period_end).toBe('2026-06-30');
      expect(r.payment_due_date).toBe('2026-07-31');
    });

    it('締め日当日 (6/30): 6/1 - 6/30 締め、7/31 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-30');
      expect(r.period_start).toBe('2026-06-01');
      expect(r.period_end).toBe('2026-06-30');
      expect(r.payment_due_date).toBe('2026-07-31');
    });

    it('翌月初 (7/1): 7/1 - 7/31 締め、8/31 入金', () => {
      const r = nextBillingPeriod(rule, '2026-07-01');
      expect(r.period_start).toBe('2026-07-01');
      expect(r.period_end).toBe('2026-07-31');
      expect(r.payment_due_date).toBe('2026-08-31');
    });
  });

  describe('nextBillingPeriod monthly 末締め45日後払い', () => {
    const rule: BillingRule = {
      billing_cycle: 'monthly',
      closing_rule: { day: 99 },
      payment_rule: { days: 45 },
    };

    it('6/15 → 6/1-6/30 締め、8/14 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-15');
      expect(r.period_start).toBe('2026-06-01');
      expect(r.period_end).toBe('2026-06-30');
      expect(r.payment_due_date).toBe('2026-08-14');
    });
  });

  describe('nextBillingPeriod monthly 20日締め翌月末払い', () => {
    const rule: BillingRule = {
      billing_cycle: 'monthly',
      closing_rule: { day: 20 },
      payment_rule: { month_offset: 1, day: 99 },
    };

    it('6/15: 5/21 - 6/20 締め、7/31 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-15');
      expect(r.period_start).toBe('2026-05-21');
      expect(r.period_end).toBe('2026-06-20');
      expect(r.payment_due_date).toBe('2026-07-31');
    });

    it('6/21 (締め日翌日): 6/21 - 7/20 締め、8/31 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-21');
      expect(r.period_start).toBe('2026-06-21');
      expect(r.period_end).toBe('2026-07-20');
      expect(r.payment_due_date).toBe('2026-08-31');
    });

    it('6/20 (締め日当日): 5/21 - 6/20 締め、7/31 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-20');
      expect(r.period_start).toBe('2026-05-21');
      expect(r.period_end).toBe('2026-06-20');
      expect(r.payment_due_date).toBe('2026-07-31');
    });
  });

  // ============================================================
  // nextBillingPeriod - weekly
  // ============================================================
  describe('nextBillingPeriod weekly 金曜締め翌週金曜払い', () => {
    const rule: BillingRule = {
      billing_cycle: 'weekly',
      closing_rule: { weekday: 5 }, // Friday
      payment_rule: { days: 7 },
    };

    // 2026-06-15 は月曜（カレンダー確認: 6/15/2026 = Monday）
    it('月曜 (6/15): 6/13(土) - 6/19(金) 締め、6/26(金) 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-15');
      expect(r.period_end).toBe('2026-06-19');
      expect(r.period_start).toBe('2026-06-13');
      expect(r.payment_due_date).toBe('2026-06-26');
    });

    it('金曜当日 (6/19): 6/13 - 6/19 締め、6/26 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-19');
      expect(r.period_end).toBe('2026-06-19');
      expect(r.period_start).toBe('2026-06-13');
      expect(r.payment_due_date).toBe('2026-06-26');
    });

    it('土曜 (6/20、締め翌日): 6/20 - 6/26 締め、7/3 入金', () => {
      const r = nextBillingPeriod(rule, '2026-06-20');
      expect(r.period_end).toBe('2026-06-26');
      expect(r.period_start).toBe('2026-06-20');
      expect(r.payment_due_date).toBe('2026-07-03');
    });
  });

  // ============================================================
  // nextBillingPeriod - biweekly
  // ============================================================
  describe('nextBillingPeriod biweekly 隔週金曜締め', () => {
    const rule: BillingRule = {
      billing_cycle: 'biweekly',
      closing_rule: { weekday: 5, anchor_date: '2026-06-19' }, // 6/19 を起点
      payment_rule: { days: 14 },
    };

    it('アンカー日当日 (6/19): その日が締め', () => {
      const r = nextBillingPeriod(rule, '2026-06-19');
      expect(r.period_end).toBe('2026-06-19');
      expect(r.period_start).toBe('2026-06-06'); // 13日前
      expect(r.payment_due_date).toBe('2026-07-03');
    });

    it('アンカー翌日 (6/20): 次の隔週金 7/3 が締め', () => {
      const r = nextBillingPeriod(rule, '2026-06-20');
      expect(r.period_end).toBe('2026-07-03');
      expect(r.period_start).toBe('2026-06-20');
      expect(r.payment_due_date).toBe('2026-07-17');
    });

    it('anchor_date なしでエラー', () => {
      const ruleNoAnchor: BillingRule = {
        billing_cycle: 'biweekly',
        closing_rule: { weekday: 5 },
        payment_rule: { days: 14 },
      };
      expect(() => nextBillingPeriod(ruleNoAnchor, '2026-06-15')).toThrow(/anchor_date/);
    });
  });

  // ============================================================
  // generateUpcomingPeriods
  // ============================================================
  describe('generateUpcomingPeriods', () => {
    it('末末を 2026-06-15 から 3期分生成', () => {
      const rule: BillingRule = {
        billing_cycle: 'monthly',
        closing_rule: { day: 99 },
        payment_rule: { month_offset: 1, day: 99 },
      };
      const periods = generateUpcomingPeriods(rule, '2026-06-15', 3);
      expect(periods).toHaveLength(3);
      expect(periods[0]).toEqual({ period_start: '2026-06-01', period_end: '2026-06-30', payment_due_date: '2026-07-31' });
      expect(periods[1]).toEqual({ period_start: '2026-07-01', period_end: '2026-07-31', payment_due_date: '2026-08-31' });
      expect(periods[2]).toEqual({ period_start: '2026-08-01', period_end: '2026-08-31', payment_due_date: '2026-09-30' });
    });

    it('毎週金曜を 2026-06-15 から 4期分生成', () => {
      const rule: BillingRule = {
        billing_cycle: 'weekly',
        closing_rule: { weekday: 5 },
        payment_rule: { days: 7 },
      };
      const periods = generateUpcomingPeriods(rule, '2026-06-15', 4);
      expect(periods).toHaveLength(4);
      expect(periods.map((p) => p.period_end)).toEqual([
        '2026-06-19',
        '2026-06-26',
        '2026-07-03',
        '2026-07-10',
      ]);
    });

    it('count <= 0 で空配列', () => {
      const rule: BillingRule = {
        billing_cycle: 'monthly',
        closing_rule: { day: 99 },
        payment_rule: { days: 30 },
      };
      expect(generateUpcomingPeriods(rule, '2026-06-15', 0)).toEqual([]);
      expect(generateUpcomingPeriods(rule, '2026-06-15', -1)).toEqual([]);
    });
  });

  // ============================================================
  // findActiveRule
  // ============================================================
  describe('findActiveRule', () => {
    const history: DatedBillingRule[] = [
      {
        id: 'r1',
        effective_from: '2025-01-01',
        effective_until: '2026-04-01',
        billing_cycle: 'monthly',
        closing_rule: { day: 99 },
        payment_rule: { month_offset: 1, day: 99 },
      },
      {
        id: 'r2',
        effective_from: '2026-04-01',
        effective_until: null,
        billing_cycle: 'weekly',
        closing_rule: { weekday: 5 },
        payment_rule: { days: 7 },
      },
    ];

    it('過去の日付では古いルールを返す', () => {
      const r = findActiveRule(history, '2026-03-15');
      expect(r?.id).toBe('r1');
    });

    it('切替日（境界）では新しいルールを返す', () => {
      const r = findActiveRule(history, '2026-04-01');
      expect(r?.id).toBe('r2');
    });

    it('現在 (effective_until=NULL) のルールを返す', () => {
      const r = findActiveRule(history, '2026-06-15');
      expect(r?.id).toBe('r2');
    });

    it('全ルールより前ならnull', () => {
      const r = findActiveRule(history, '2024-12-31');
      expect(r).toBeNull();
    });

    it('空履歴でnull', () => {
      expect(findActiveRule([], '2026-06-15')).toBeNull();
    });
  });

  // ============================================================
  // 過去不変原則の検証
  // ============================================================
  describe('過去不変原則', () => {
    it('同じルール + 同じ on で常に同じ結果', () => {
      const rule: BillingRule = {
        billing_cycle: 'monthly',
        closing_rule: { day: 20 },
        payment_rule: { month_offset: 1, day: 99 },
      };
      const a = nextBillingPeriod(rule, '2026-06-15');
      const b = nextBillingPeriod(rule, '2026-06-15');
      expect(a).toEqual(b);
    });
  });
});
