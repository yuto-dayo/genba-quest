import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";
import { TEST_ORG_ID } from "../helpers/fixtures";

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { InvoiceRegistrationService } from "../../services/InvoiceRegistrationService";

const memberA = "11111111-1111-4111-8111-111111111111";
const memberB = "22222222-2222-4222-8222-222222222222";

describe("InvoiceRegistrationService", () => {
  it("returns member invoice status with the transitional rate", async () => {
    const mockFrom = jest.fn();
    const service = new InvoiceRegistrationService({ from: mockFrom } as any);
    const classification = createChain({
      data: {
        invoice_registration_status: "exempt",
        invoice_registration_number: null,
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [classification]);

    const result = await service.getMemberInvoiceStatus({
      orgId: TEST_ORG_ID,
      memberId: memberA,
      asOf: "2026-10-01",
    });

    expect(result).toEqual({
      status: "exempt",
      registration_number: null,
      deduction_rate: 0.8,
      transitional_phase: "phase1-80",
    });
  });

  it("sums monthly deductible amount by member invoice status", async () => {
    const mockFrom = jest.fn();
    const service = new InvoiceRegistrationService({ from: mockFrom } as any);
    const monthlyClose = createChain({
      data: {
        lines: [
          { member_id: memberA, total_pay_amount: 10000 },
          { member_id: memberB, total_pay_amount: 10000 },
        ],
      },
      error: null,
    });
    const memberAStatus = createChain({
      data: { invoice_registration_status: "registered", invoice_registration_number: "T1234567890123" },
      error: null,
    });
    const memberBStatus = createChain({
      data: { invoice_registration_status: "exempt", invoice_registration_number: null },
      error: null,
    });
    setupMockFromSequence(mockFrom, [monthlyClose, memberAStatus, memberBStatus]);

    const result = await service.getMonthlyDeductibleAmount({
      orgId: TEST_ORG_ID,
      month: "2026-10",
    });

    expect(result.gross_subject_amount).toBe(20000);
    expect(result.deductible_amount).toBe(18000);
    expect(result.effective_deduction_rate).toBe(0.9);
    expect(result.transitional_rate).toBe(0.8);
    expect(result.member_count).toBe(2);
  });
});
