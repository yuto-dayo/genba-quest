jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import {
  BIG_SKILL_KEYS,
  PathEvaluationService,
  PROFILE_CERTIFICATION_STATUS_OPTIONS,
  REVIEW_STATUS_OPTIONS,
  normalizeEvaluationFinalizeProposalInput,
  normalizeMonthlyEvaluationAiReviewInput,
  normalizeMonthlyEvaluationConfirmationInput,
  normalizeMonthlyEvaluationFormInput,
  normalizeSkillCertificationProposalInput,
} from "../../services/PathEvaluationService";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const mockFrom = supabaseAdmin.from as jest.Mock;

describe("PathEvaluationService helpers", () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it("normalizes month-end form input", () => {
    const normalized = normalizeMonthlyEvaluationFormInput({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      selected_big_skill_states: {
        cross_work: "conditional",
        site_trust: "stable_independent",
      },
      selected_roles: ["主担当", "主担当", "段取り"],
      site_ids: ["site-1", "site-1", "site-2"],
      photo_flag: true,
      rework_flag: "minor",
      comment: "  今月は応援現場が多かった  ",
    });

    expect(normalized).toEqual({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      selected_big_skill_states: {
        cross_work: "conditional",
        site_trust: "stable_independent",
      },
      work_days: 0,
      A: 1,
      R: 1,
      Q: 1,
      current_level: "L1",
      selected_roles: ["主担当", "段取り"],
      site_ids: ["site-1", "site-2"],
      photo_flag: true,
      rework_flag: "minor",
      comment: "今月は応援現場が多かった",
    });
  });

  it("rejects unknown big skill keys", () => {
    expect(() =>
      normalizeMonthlyEvaluationFormInput({
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        selected_big_skill_states: {
          unknown_skill: "conditional",
        } as any,
      }),
    ).toThrow("INVALID_BIG_SKILL_STATES");
  });

  it("normalizes AI review input", () => {
    const normalized = normalizeMonthlyEvaluationAiReviewInput({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      monthly_summary: "  月内後半で品質安定が改善  ",
      candidate_states: {
        quality_stability: "near_independent",
      },
      candidate_skill_tags: ["joint_finish", "joint_finish", "ceiling_work"],
      profile_update_candidates: [{ type: "skill", skill_key: "joint_finish" }],
      promotion_candidate_flag: true,
      reasons: ["手直し減少", { source: "site_review" }],
      evidence_summary: [{ site_id: "site-1" }],
      unknown_points: ["特殊部位は未確認"],
      review_required_flag: true,
    });

    expect(normalized).toEqual({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      monthly_summary: "月内後半で品質安定が改善",
      candidate_states: {
        quality_stability: "near_independent",
      },
      candidate_skill_tags: ["joint_finish", "ceiling_work"],
      profile_update_candidates: [{ type: "skill", skill_key: "joint_finish" }],
      promotion_candidate_flag: true,
      reasons: ["手直し減少", { source: "site_review" }],
      evidence_summary: [{ site_id: "site-1" }],
      unknown_points: ["特殊部位は未確認"],
      review_required_flag: true,
    });
  });

  it("keeps the expected canonical big skill keys", () => {
    expect(BIG_SKILL_KEYS).toEqual([
      "cross_work",
      "putty_foundation",
      "planning_preparation",
      "quality_stability",
      "site_trust",
      "education_support",
    ]);
  });

  it("normalizes confirmation input", () => {
    const normalized = normalizeMonthlyEvaluationConfirmationInput({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      target_type: "big_skill",
      target_key: " cross_work ",
      confirmation_status: "conditional",
      comment: "  熟練者確認済み  ",
    });

    expect(normalized).toEqual({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      target_type: "big_skill",
      target_key: "cross_work",
      confirmation_status: "conditional",
      comment: "熟練者確認済み",
    });
  });

  it("normalizes evaluation finalize proposal input", () => {
    const normalized = normalizeEvaluationFinalizeProposalInput({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      confirmed_states: {
        cross_work: "near_independent",
      },
      work_days: 20,
      A: 2,
      R: 1,
      Q: 2,
      current_level: "L3",
      comment: "  4月レビュー  ",
    });

    expect(normalized).toEqual({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      confirmed_states: {
        cross_work: "near_independent",
      },
      work_days: 20,
      A: 2,
      R: 1,
      Q: 2,
      current_level: "L3",
      comment: "4月レビュー",
    });
  });

  it("normalizes skill certification proposal input", () => {
    const normalized = normalizeSkillCertificationProposalInput({
      member_id: "11111111-1111-4111-8111-111111111111",
      skill_key: " joint_finish ",
      category: " finish ",
      evidence_count: 3,
      note: "  実績あり  ",
      review_required_flag: true,
    });

    expect(normalized).toEqual({
      member_id: "11111111-1111-4111-8111-111111111111",
      skill_key: "joint_finish",
      category: "finish",
      status: "verified",
      evidence_count: 3,
      last_site_id: null,
      note: "実績あり",
      review_required_flag: true,
    });
  });

  it("keeps the expected canonical review option sets", () => {
    expect(REVIEW_STATUS_OPTIONS).toEqual(["confirmed", "review_required", "unverified"]);
    expect(PROFILE_CERTIFICATION_STATUS_OPTIONS).toEqual([
      "candidate",
      "verified",
      "review_required",
      "revoked",
    ]);
  });

  it("falls back to executed evaluation.finalize proposals when finalization read model is unavailable", async () => {
    const service = new PathEvaluationService("org-1");
    const missingReadModelChain = createChain({
      data: null,
      error: {
        message:
          "Could not find the table 'public.monthly_evaluation_finalizations' in the schema cache",
      },
    });
    const proposalFallbackChain = createChain({
      data: [
        {
          id: "proposal-latest",
          payload: {
            month: "2026-04",
            member_id: "11111111-1111-4111-8111-111111111111",
            confirmed_big_skill_states: {
              cross_work: "near_independent",
              site_trust: "stable_independent",
            },
            work_days: "19",
            A: "2",
            R: 1,
            Q: 2,
            current_level: "L3",
            comment: "  月次レビュー  ",
          },
          executed_by: {
            type: "human",
            id: "22222222-2222-4222-8222-222222222222",
            name: "管理者",
          },
          executed_at: "2026-04-30T09:00:00Z",
          updated_at: "2026-04-30T09:00:00Z",
        },
        {
          id: "proposal-older",
          payload: {
            month: "2026-04",
            member_id: "11111111-1111-4111-8111-111111111111",
            confirmed_big_skill_states: {
              cross_work: "conditional",
            },
            work_days: 8,
            A: 1,
            R: 1,
            Q: 1,
            current_level: "L2",
            comment: "older",
          },
          executed_by: null,
          executed_at: "2026-04-12T09:00:00Z",
          updated_at: "2026-04-12T09:00:00Z",
        },
      ],
      error: null,
    });

    setupMockFromSequence(mockFrom, [missingReadModelChain, proposalFallbackChain]);

    await expect(
      service.listFinalizations({
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        limit: 5,
      }),
    ).resolves.toEqual([
      {
        id: "proposal-latest",
        org_id: "org-1",
        month: "2026-04",
        member_id: "11111111-1111-4111-8111-111111111111",
        proposal_id: "proposal-latest",
        confirmed_big_skill_states: {
          cross_work: "near_independent",
          site_trust: "stable_independent",
        },
        work_days: 19,
        A: 2,
        R: 1,
        Q: 2,
        current_level: "L3",
        comment: "月次レビュー",
        finalized_by: {
          type: "human",
          id: "22222222-2222-4222-8222-222222222222",
          name: "管理者",
        },
        finalized_at: "2026-04-30T09:00:00Z",
        updated_at: "2026-04-30T09:00:00Z",
      },
    ]);
  });

  it("keeps throwing when finalization query fails for non-cache reasons", async () => {
    const service = new PathEvaluationService("org-1");
    const failingChain = createChain({
      data: null,
      error: {
        message: "permission denied for table monthly_evaluation_finalizations",
      },
    });

    setupMockFromSequence(mockFrom, [failingChain]);

    await expect(service.listFinalizations()).rejects.toThrow(
      "Failed to fetch monthly evaluation finalizations: permission denied for table monthly_evaluation_finalizations",
    );
  });
});
