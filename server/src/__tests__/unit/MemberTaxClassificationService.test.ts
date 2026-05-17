import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";
import { actors, TEST_ORG_ID } from "../helpers/fixtures";

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import {
  MemberTaxClassificationService,
  buildClassificationPayloadFromProposal,
} from "../../services/MemberTaxClassificationService";

const memberId = "11111111-1111-4111-8111-111111111111";
const proposalId = "22222222-2222-4222-8222-222222222222";

const checks = {
  q1_substitution: true,
  q2_time_freedom: true,
  q3_work_autonomy: true,
  q4_own_tools: true,
  q5_outcome_liability: false,
};

describe("MemberTaxClassificationService", () => {
  it("recordClassification closes the prior active row and inserts a new classification", async () => {
    const mockFrom = jest.fn();
    const service = new MemberTaxClassificationService({ from: mockFrom } as any);
    const existingByProposal = createChain({ data: null, error: null });
    const membership = createChain({ data: { user_id: memberId, status: "active" }, error: null });
    const closeActive = createChain({ data: null, error: null });
    const inserted = createChain({
      data: {
        id: "classification-1",
        org_id: TEST_ORG_ID,
        member_id: memberId,
        contract_type: "subcontract",
        tax_withholding_category: "none",
        custom_withholding_rate: null,
        classification_check_status: "verified",
        classification_check_results: checks,
        classification_notes: "契約書確認済み",
        effective_from: "2026-05-20",
        effective_until: null,
        decided_by: actors.human.id,
        decided_at: "2026-05-20T00:00:00Z",
        proposal_id: proposalId,
        created_at: "2026-05-20T00:00:00Z",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [existingByProposal, membership, closeActive, inserted]);

    const result = await service.recordClassification(
      {
        orgId: TEST_ORG_ID,
        memberId,
        contractType: "subcontract",
        taxWithholdingCategory: "none",
        classificationCheckResults: checks,
        classificationNotes: "契約書確認済み",
        effectiveFrom: "2026-05-20",
        proposalId,
      },
      actors.human,
    );

    expect(result.alreadyExisted).toBe(false);
    expect(closeActive.update).toHaveBeenCalledWith({ effective_until: "2026-05-20" });
    expect(closeActive.lt).toHaveBeenCalledWith("effective_from", "2026-05-20");
    expect(inserted.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: TEST_ORG_ID,
      member_id: memberId,
      contract_type: "subcontract",
      classification_check_status: "verified",
      invoice_registration_status: "unknown",
      invoice_registration_number: null,
      proposal_id: proposalId,
    }));
  });

  it("buildClassificationPayloadFromProposal rejects incomplete 5-item checks", () => {
    expect(() => buildClassificationPayloadFromProposal({
      id: proposalId,
      org_id: TEST_ORG_ID,
      type: "member.classification.update",
      status: "approved",
      created_by: actors.human,
      payload: {
        member_id: memberId,
        contract_type: "employee_like",
        tax_withholding_category: "none",
        classification_check_results: { q1_substitution: true },
        effective_from: "2026-05-20",
      },
      description: "契約区分を更新",
      approvals: [],
      required_approvals: 1,
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    })).toThrow("MEMBER_CLASSIFICATION_CHECK_RESULTS_INVALID");
  });

  it("buildClassificationPayloadFromProposal carries invoice registration fields", () => {
    const payload = buildClassificationPayloadFromProposal({
      id: proposalId,
      org_id: TEST_ORG_ID,
      type: "member.classification.update",
      status: "approved",
      created_by: actors.human,
      payload: {
        member_id: memberId,
        contract_type: "subcontract",
        tax_withholding_category: "none",
        classification_check_results: checks,
        invoice_registration_status: "registered",
        invoice_registration_number: "t1234567890123",
        effective_from: "2026-05-20",
      },
      description: "契約区分を更新",
      approvals: [],
      required_approvals: 1,
      created_at: "2026-05-20T00:00:00Z",
      updated_at: "2026-05-20T00:00:00Z",
    });

    expect(payload.invoiceRegistrationStatus).toBe("registered");
    expect(payload.invoiceRegistrationNumber).toBe("T1234567890123");
  });
});
