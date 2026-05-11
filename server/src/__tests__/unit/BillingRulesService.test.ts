jest.mock('../../lib/supabaseClient', () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { validateRule } from '../../services/BillingRulesService';

describe('BillingRulesService.validateRule', () => {
  describe('effective_from', () => {
    it('YYYY-MM-DD 形式OK', () => {
      expect(() =>
        validateRule({
          effective_from: '2026-06-01',
          billing_cycle: 'monthly',
          closing_rule: { day: 99 },
          payment_rule: { days: 30 },
        }),
      ).not.toThrow();
    });

    it('不正な形式でエラー', () => {
      expect(() =>
        validateRule({
          effective_from: '2026/06/01',
          billing_cycle: 'monthly',
          closing_rule: { day: 99 },
          payment_rule: { days: 30 },
        }),
      ).toThrow('ERR_INVALID_EFFECTIVE_FROM');
      expect(() =>
        validateRule({
          effective_from: '',
          billing_cycle: 'monthly',
          closing_rule: { day: 99 },
          payment_rule: { days: 30 },
        }),
      ).toThrow('ERR_INVALID_EFFECTIVE_FROM');
    });
  });

  describe('monthly closing_rule.day', () => {
    const baseRule = {
      effective_from: '2026-06-01',
      billing_cycle: 'monthly' as const,
      payment_rule: { days: 30 },
    };

    it('day=1-28 OK', () => {
      for (const d of [1, 15, 20, 28]) {
        expect(() => validateRule({ ...baseRule, closing_rule: { day: d } })).not.toThrow();
      }
    });

    it('day=99 (末日) OK', () => {
      expect(() => validateRule({ ...baseRule, closing_rule: { day: 99 } })).not.toThrow();
    });

    it('day=29 ~ 98 はNG (月末判定の曖昧さ排除)', () => {
      for (const d of [29, 30, 31, 50]) {
        expect(() => validateRule({ ...baseRule, closing_rule: { day: d } })).toThrow('ERR_INVALID_CLOSING_DAY');
      }
    });

    it('day 未指定 NG', () => {
      expect(() => validateRule({ ...baseRule, closing_rule: {} })).toThrow('ERR_INVALID_CLOSING_DAY');
    });
  });

  describe('weekly closing_rule.weekday', () => {
    const baseRule = {
      effective_from: '2026-06-01',
      billing_cycle: 'weekly' as const,
      payment_rule: { days: 7 },
    };

    it('0-6 OK', () => {
      for (const w of [0, 3, 6]) {
        expect(() => validateRule({ ...baseRule, closing_rule: { weekday: w } })).not.toThrow();
      }
    });

    it('範囲外 NG', () => {
      expect(() => validateRule({ ...baseRule, closing_rule: { weekday: 7 } })).toThrow('ERR_INVALID_CLOSING_WEEKDAY');
      expect(() => validateRule({ ...baseRule, closing_rule: { weekday: -1 } })).toThrow('ERR_INVALID_CLOSING_WEEKDAY');
    });
  });

  describe('biweekly anchor_date', () => {
    const baseRule = {
      effective_from: '2026-06-01',
      billing_cycle: 'biweekly' as const,
      payment_rule: { days: 14 },
    };

    it('anchor_date と weekday 両方OK', () => {
      expect(() =>
        validateRule({
          ...baseRule,
          closing_rule: { weekday: 5, anchor_date: '2026-06-19' },
        }),
      ).not.toThrow();
    });

    it('anchor_date なし NG', () => {
      expect(() =>
        validateRule({
          ...baseRule,
          closing_rule: { weekday: 5 },
        }),
      ).toThrow('ERR_INVALID_ANCHOR_DATE');
    });
  });

  describe('payment_rule', () => {
    const monthlyBase = {
      effective_from: '2026-06-01',
      billing_cycle: 'monthly' as const,
      closing_rule: { day: 99 },
    };

    it('{days:N} OK', () => {
      expect(() => validateRule({ ...monthlyBase, payment_rule: { days: 0 } })).not.toThrow();
      expect(() => validateRule({ ...monthlyBase, payment_rule: { days: 365 } })).not.toThrow();
    });

    it('{days:負} NG', () => {
      expect(() => validateRule({ ...monthlyBase, payment_rule: { days: -1 } })).toThrow('ERR_INVALID_PAYMENT_DAYS');
    });

    it('{days:>365} NG', () => {
      expect(() => validateRule({ ...monthlyBase, payment_rule: { days: 366 } })).toThrow('ERR_INVALID_PAYMENT_DAYS');
    });

    it('{month_offset, day} OK', () => {
      expect(() => validateRule({ ...monthlyBase, payment_rule: { month_offset: 1, day: 99 } })).not.toThrow();
      expect(() => validateRule({ ...monthlyBase, payment_rule: { month_offset: 0, day: 25 } })).not.toThrow();
    });

    it('month_offset 範囲外 NG', () => {
      expect(() => validateRule({ ...monthlyBase, payment_rule: { month_offset: -1, day: 99 } })).toThrow();
      expect(() => validateRule({ ...monthlyBase, payment_rule: { month_offset: 7, day: 99 } })).toThrow();
    });

    it('payment_rule 空 NG', () => {
      expect(() => validateRule({ ...monthlyBase, payment_rule: {} })).toThrow('ERR_INVALID_PAYMENT_RULE');
    });
  });
});
