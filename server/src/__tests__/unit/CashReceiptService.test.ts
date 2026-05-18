jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { rpc: jest.fn() },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import {
  CashReceiptService,
  buildCashReceiptLedgerEntries,
} from "../../services/CashReceiptService";
import { actors, makeProposal, TEST_ORG_ID, TEST_PROPOSAL_ID } from "../helpers/fixtures";

const mockRpc = (supabaseAdmin as unknown as { rpc: jest.Mock }).rpc;

describe("buildCashReceiptLedgerEntries", () => {
  it("balances a fee deduction receipt against accounts receivable", () => {
    const entries = buildCashReceiptLedgerEntries({
      client_id: "11111111-1111-4111-8111-111111111111",
      received_date: "2026-05-26",
      received_amount: 100000,
      variance_reason: "fee_deduction",
      allocations: [
        {
          invoice_transaction_id: "22222222-2222-4222-8222-222222222222",
          allocated_amount: 99560,
        },
      ],
    });

    expect(entries).toEqual([
      { display_label: "普通預金", debit_amount: 99560 },
      { display_label: "売掛金", credit_amount: 99560 },
      { display_label: "支払手数料", debit_amount: 440 },
      { display_label: "売掛金", credit_amount: 440 },
    ]);
  });

  it("keeps partial payments as the remaining accounts receivable balance", () => {
    const entries = buildCashReceiptLedgerEntries({
      client_id: "11111111-1111-4111-8111-111111111111",
      received_date: "2026-05-26",
      received_amount: 50000,
      variance_reason: "partial_payment",
      allocations: [
        {
          invoice_transaction_id: "22222222-2222-4222-8222-222222222222",
          allocated_amount: 50000,
        },
      ],
    });

    expect(entries).toEqual([
      { display_label: "普通預金", debit_amount: 50000 },
      { display_label: "売掛金", credit_amount: 50000 },
    ]);
  });
});

describe("CashReceiptService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("executes cash_receipt.record through the atomic RPC", async () => {
    const executed = makeProposal({
      id: TEST_PROPOSAL_ID,
      org_id: TEST_ORG_ID,
      type: "cash_receipt.record",
      status: "executed",
      payload: {
        client_id: "11111111-1111-4111-8111-111111111111",
        received_date: "2026-05-26",
        received_amount: 50000,
        variance_reason: "partial_payment",
        allocations: [
          {
            invoice_transaction_id: "22222222-2222-4222-8222-222222222222",
            allocated_amount: 50000,
          },
        ],
      },
    });
    mockRpc.mockResolvedValue({ data: executed, error: null });

    const result = await new CashReceiptService(TEST_ORG_ID).executeCashReceiptRecord(
      executed,
      actors.human,
    );

    expect(result).toBe(executed);
    expect(mockRpc).toHaveBeenCalledWith("rpc_execute_cash_receipt_record", {
      p_org_id: TEST_ORG_ID,
      p_proposal_id: TEST_PROPOSAL_ID,
      p_executor: actors.human,
    });
  });
});
