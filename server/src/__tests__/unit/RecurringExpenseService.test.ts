jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));

import { normalizeRecurringExpenseProposalPayload } from "../../services/RecurringExpenseService";

describe("normalizeRecurringExpenseProposalPayload", () => {
  it("accepts the seven recurring expense categories and month range", () => {
    const payload = normalizeRecurringExpenseProposalPayload("recurring_expense.create", {
      member_user_id: "user-1",
      category: "車両ローン",
      title: "軽トラ #品川500",
      monthly_amount: 18000,
      effective_from: "2026-04",
      effective_until: "2028-03",
    });

    expect(payload).toEqual({
      member_user_id: "user-1",
      category: "車両ローン",
      title: "軽トラ #品川500",
      monthly_amount: 18000,
      effective_from: "2026-04",
      effective_until: "2028-03",
      expense_scope: "overhead",
    });
  });

  it("rejects invalid category and non-positive monthly amount", () => {
    expect(() =>
      normalizeRecurringExpenseProposalPayload("recurring_expense.create", {
        member_user_id: "user-1",
        category: "家賃",
        title: "office",
        monthly_amount: 1000,
        effective_from: "2026-04",
      }),
    ).toThrow("RECURRING_EXPENSE_CATEGORY_INVALID");

    expect(() =>
      normalizeRecurringExpenseProposalPayload("recurring_expense.create", {
        member_user_id: "user-1",
        category: "その他",
        title: "office",
        monthly_amount: 0,
        effective_from: "2026-04",
      }),
    ).toThrow("RECURRING_EXPENSE_AMOUNT_INVALID");
  });
});
