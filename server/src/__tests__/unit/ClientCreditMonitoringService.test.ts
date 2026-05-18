jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { ClientCreditMonitoringService } from "../../services/ClientCreditMonitoringService";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";

describe("ClientCreditMonitoringService", () => {
  it("lists client credit summaries from the security-invoker read model", async () => {
    const from = jest.fn();
    setupMockFrom(from, {
      v_client_credit_summary: createChain({
        data: [
          {
            org_id: "org-1",
            client_id: "client-warning",
            client_name: "警戒建設",
            as_of_date: "2026-05-18",
            accounts_receivable_balance: "3500000",
            overdue_count: 2,
            sales_90_days: "4500000",
            dso_days: "70.0",
            credit_tier: "warning",
            credit_tier_sort: 1,
          },
        ],
        error: null,
      }),
    });

    const service = new ClientCreditMonitoringService({ from });
    const result = await service.listAllClientsCreditSummary("org-1");

    expect(result).toEqual([
      expect.objectContaining({
        client_id: "client-warning",
        accounts_receivable_balance: 3500000,
        dso_days: 70,
        credit_tier: "warning",
      }),
    ]);
  });

  it("calculates DSO as null when recent sales are zero and keeps balance tiering", async () => {
    const from = jest.fn();
    setupMockFrom(from, {
      clients: createChain({
        data: { id: "client-1", org_id: "org-1", name: "大口元請" },
        error: null,
      }),
      accounting_transactions: createChain({ data: [], error: null }),
      accounting_invoices: createChain({
        data: [
          {
            id: "invoice-1",
            invoice_no: "INV-001",
            issue_date: "2026-05-01",
            due_date: "2026-05-10",
            transaction_id: "invoice-tx-1",
            source_transaction_id: "sale-tx-1",
            billing_name: "大口元請",
            created_at: "2026-05-01T00:00:00Z",
            source_transaction: {
              id: "sale-tx-1",
              client_id: "client-1",
              amount_total: "1200000",
              recorded_date: "2026-05-01",
            },
          },
        ],
        error: null,
      }),
      cash_receipts: createChain({ data: [], error: null }),
    });

    const service = new ClientCreditMonitoringService({ from });
    const result = await service.getClientCreditMetrics("org-1", "client-1", "2026-05-18");

    expect(result.dso_days).toBeNull();
    expect(result.accounts_receivable_balance).toBe(1200000);
    expect(result.overdue_count).toBe(1);
    expect(result.credit_tier).toBe("caution");
    expect(result.overdue_history[0]).toEqual(expect.objectContaining({
      invoice_no: "INV-001",
      overdue_days: 8,
    }));
  });
});
