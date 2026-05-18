jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import {
  buildWithholdingDecisionSnapshotPayload,
  WithholdingDecisionSnapshotService,
} from "../../services/WithholdingDecisionSnapshotService";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";

const mockFrom = supabaseAdmin.from as jest.Mock;
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const CLASSIFICATION_ID = "33333333-3333-4333-8333-333333333333";

describe("WithholdingDecisionSnapshotService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds a frozen snapshot from the active member tax classification", async () => {
    const chain = createChain({
      data: {
        id: CLASSIFICATION_ID,
        org_id: ORG_ID,
        member_id: MEMBER_ID,
        contract_type: "subcontract",
        tax_withholding_category: "none",
        custom_withholding_rate: null,
        classification_check_results: {
          q1_substitution: true,
          q2_time_freedom: true,
          q3_work_autonomy: true,
          q4_own_tools: true,
          q5_outcome_liability: false,
        },
        invoice_registration_status: "registered",
        invoice_registration_number: "T1234567890123",
        effective_from: "2026-06-01",
        effective_until: null,
        decided_by: "44444444-4444-4444-8444-444444444444",
        decided_at: "2026-05-31T10:00:00.000Z",
      },
      error: null,
    });
    setupMockFrom(mockFrom, { member_tax_classifications: chain });

    const snapshot = await new WithholdingDecisionSnapshotService(ORG_ID).buildSnapshot(MEMBER_ID, "2026-06");

    expect(snapshot).toEqual(
      expect.objectContaining({
        decided_at: "2026-05-31T10:00:00.000Z",
        decided_by: "44444444-4444-4444-8444-444444444444",
        classification_id_used: CLASSIFICATION_ID,
        contract_type: "subcontract",
        tax_withholding_category: "none",
        invoice_registration_status: "registered",
        invoice_registration_number: "T1234567890123",
      }),
    );
    expect(snapshot.reasoning).toBe(
      "5項目チェック [4YES/5]、subcontract 判定、適格請求書登録あり (T1234567890123)、よって 源泉徴収対象外 (所基通204関連、限定列挙非該当)",
    );
    expect(chain.lte).toHaveBeenCalledWith("effective_from", "2026-06-30");
  });

  it("builds a multi-member payload bundle without mutating snapshot contents", () => {
    const snapshot = {
      decided_at: "2026-05-31T10:00:00.000Z",
      decided_by: "44444444-4444-4444-8444-444444444444",
      classification_id_used: CLASSIFICATION_ID,
      contract_type: "subcontract" as const,
      tax_withholding_category: "none" as const,
      classification_check_results: {
        q1_substitution: true,
        q2_time_freedom: true,
        q3_work_autonomy: true,
        q4_own_tools: true,
        q5_outcome_liability: false,
      },
      invoice_registration_status: "unknown" as const,
      reasoning: "reason",
    };

    const payload = buildWithholdingDecisionSnapshotPayload([
      { member_id: MEMBER_ID, snapshot },
      { member_id: "55555555-5555-4555-8555-555555555555", snapshot },
    ]);

    expect(payload.tax_withholding_decision_snapshot).toEqual({
      scope: "multi_member",
      member_snapshots: payload.tax_withholding_decision_snapshots,
    });
  });
});
