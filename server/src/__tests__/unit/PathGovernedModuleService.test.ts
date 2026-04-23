jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

const mockPreviewMonthlyDistribution = jest.fn();

jest.mock("../../services/PathV31Service", () => ({
  PathV31Service: jest.fn().mockImplementation(() => ({
    previewMonthlyDistribution: mockPreviewMonthlyDistribution,
  })),
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { PathGovernedModuleService } from "../../services/PathGovernedModuleService";
import { createChain, setupMockFrom } from "../helpers/mockSupabase";

describe("PathGovernedModuleService", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const service = new PathGovernedModuleService(orgId);

  beforeEach(() => {
    jest.clearAllMocks();
    mockPreviewMonthlyDistribution.mockResolvedValue({
      month: "2026-04",
      path_rule_version: "path_v31",
      path_rule_fingerprint: "fp-v31",
      calculation_snapshot: {
        site_closes: [
          {
            site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            distributable_profit: 120000,
            share_snapshot: [
              {
                member_id: "11111111-1111-4111-8111-111111111111",
                result_share: 0.6,
                credited_units: 12,
              },
              {
                member_id: "22222222-2222-4222-8222-222222222222",
                result_share: 0.4,
                credited_units: 8,
              },
            ],
          },
        ],
      },
      members: [
        {
          member_id: "11111111-1111-4111-8111-111111111111",
          total_pay: 160000,
          floor_pay: 90000,
          result_pay: 70000,
          correction: 0,
          floor_units: 12,
          raw_result_weight: 1.2,
          boosted_result_weight: 1.3,
        },
      ],
    });
  });

  it("calculates v2.2 reward preview from package points and guarantee floor", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      policy_bundle_versions: createChain({ data: [], error: null }),
    });

    const preview = await service.calculateRewardPreview({
      month: "2026-04",
      close_id: null,
      pool: {
        recognized_revenue: 600000,
        direct_costs: 250000,
        overhead_allocated: 50000,
        rule_reserve: 20000,
        prior_period_adjustments: 10000,
      },
      members: [
        {
          member_id: "11111111-1111-4111-8111-111111111111",
          name: "田中",
          role_level: "L3",
          credited_units: 20,
          A: 2,
          R: 2,
          Q: 1,
          package_contributions: [
            {
              package_id: "pkg-1",
              trade_family: "wall_finish",
              std_hours: 16,
              difficulty_band: "S2",
              responsibility_share: 0.7,
              role_type: "lead",
              quality_result: "pass",
              rated_units: 8,
            },
          ],
        },
        {
          member_id: "22222222-2222-4222-8222-222222222222",
          name: "山田",
          role_level: "L1",
          credited_units: 12,
          guaranteed_pay: 70000,
          A: 1,
          R: 1,
          Q: 1,
          package_contributions: [
            {
              package_id: "pkg-2",
              trade_family: "floor_finish",
              std_hours: 10,
              difficulty_band: "S1",
              responsibility_share: 0.8,
              role_type: "support",
              quality_result: "minor_fix",
              rated_units: 6,
            },
          ],
        },
      ],
    });

    expect(preview.calculation_system).toBe("path_v22");
    expect(preview.closed_profit).toBe(290000);
    expect(preview.path_pool_amount).toBe(0);
    expect(preview.base_pool_amount + preview.variable_pool_amount).toBe(290000);
    expect(preview.members).toHaveLength(2);
    expect(preview.explanation_snapshots).toHaveLength(2);
    expect(preview.members[1]?.final_pay).toBeGreaterThanOrEqual(70000);
    expect(preview.members[0]?.variable_weight).toBeGreaterThan(preview.members[1]?.variable_weight ?? 0);
    expect(preview.explanation_snapshots[0]).toEqual(
      expect.objectContaining({
        member_id: "11111111-1111-4111-8111-111111111111",
        package_contributions: [
          expect.objectContaining({
            package_id: "pkg-1",
            package_points: expect.any(Number),
            member_points: expect.any(Number),
          }),
        ],
      }),
    );
  });

  it("marks stable_independent endorsement as manual approval required", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      policy_bundle_versions: createChain({ data: [], error: null }),
    });

    const payload = await service.buildTradeEndorsementProposalPayload({
      member_id: "11111111-1111-4111-8111-111111111111",
      trade_family: "wall_finish",
      skill_status: "stable_independent",
      confidence_class: "high",
      freshness_status: "current",
      evidence_ids: ["evidence-1"],
      origin_event_ids: ["origin-1"],
      assignment_restriction: null,
    });

    expect(payload.manual_approval_required).toBe(true);
  });

  it("rejects same-month correction for closed reward runs", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_reward_runs: createChain({
        data: {
          id: "run-1",
          month: "2026-04",
          status: "approved",
          policy_fingerprint: "fp",
          policy_bundle_version_id: "bundle-1",
        },
        error: null,
      }),
      policy_bundle_versions: createChain({ data: [], error: null }),
    });

    await expect(
      service.buildRewardAdjustmentProposalPayload(
        {
          reward_run_id: "11111111-1111-4111-8111-111111111111",
          correction_month: "2026-04",
          mode: "adjustment",
          reason_code: "late_quality_fix",
          member_adjustments: [
            {
              member_id: "22222222-2222-4222-8222-222222222222",
              amount: 1000,
              explanation: {},
            },
          ],
        },
        {
          type: "human",
          id: "33333333-3333-4333-8333-333333333333",
          name: "管理者",
        },
      ),
    ).rejects.toThrow("CLOSED_PERIOD_MUTATION_PROHIBITED");
  });

  it("carries month_close_id into reward adjustment payload", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_reward_runs: createChain({
        data: {
          id: "run-1",
          month: "2026-04",
          status: "approved",
          policy_fingerprint: "fp",
          policy_bundle_version_id: "bundle-1",
          reward_payload: {
            month_close_id: "44444444-4444-4444-8444-444444444444",
          },
        },
        error: null,
      }),
      policy_bundle_versions: createChain({ data: [], error: null }),
    });

    const payload = await service.buildRewardAdjustmentProposalPayload(
      {
        reward_run_id: "11111111-1111-4111-8111-111111111111",
        correction_month: "2026-05",
        mode: "reversal",
        reason_code: "late_quality_fix",
        member_adjustments: [
          {
            member_id: "22222222-2222-4222-8222-222222222222",
            amount: 1000,
            explanation: {},
          },
        ],
      },
      {
        type: "human",
        id: "33333333-3333-4333-8333-333333333333",
        name: "管理者",
      },
    );

    expect(payload).toEqual(
      expect.objectContaining({
        month_close_id: "44444444-4444-4444-8444-444444444444",
      }),
    );
  });

  it("queries reward explanation with org scope", async () => {
    const explanationChain = createChain({
      data: { id: "ex-1", member_id: "11111111-1111-4111-8111-111111111111" },
      error: null,
    });
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_explanation_snapshots: explanationChain,
    });

    const result = await service.getMemberRewardExplanation(
      "11111111-1111-4111-8111-111111111111",
      "2026-04",
    );

    expect(explanationChain.eq).toHaveBeenNthCalledWith(1, "org_id", orgId);
    expect(explanationChain.eq).toHaveBeenNthCalledWith(
      2,
      "member_id",
      "11111111-1111-4111-8111-111111111111",
    );
    expect(explanationChain.eq).toHaveBeenNthCalledWith(3, "month", "2026-04");
    expect(result).toEqual(expect.objectContaining({ id: "ex-1" }));
  });

  it("attaches selected site ids to reward explanation", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_explanation_snapshots: createChain({
        data: { id: "ex-1", member_id: "11111111-1111-4111-8111-111111111111" },
        error: null,
      }),
      path_monthly_close_inputs: createChain({
        data: { selected_site_ids: ["site-1", "site-2"] },
        error: null,
      }),
    });

    const result = await service.getMemberRewardExplanation(
      "11111111-1111-4111-8111-111111111111",
      "2026-04",
    );

    expect(result).toEqual(
      expect.objectContaining({
        id: "ex-1",
        selected_site_ids: ["site-1", "site-2"],
        site_allocations: [],
      }),
    );
  });

  it("builds site allocations for reward explanation package contributions", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_explanation_snapshots: createChain({
        data: {
          id: "ex-1",
          member_id: "11111111-1111-4111-8111-111111111111",
          explanation_json: {
            variable_amount: 90000,
            variable_weight: 10,
            package_contributions: [
              {
                package_id: "pkg-wall-1",
                trade_family: "wall_finish",
                std_hours: 10,
                difficulty_band: "S2",
                responsibility_share: 1,
                role_type: "lead",
                quality_result: "pass",
                rated_units: 8,
                package_points: 20,
                member_points: 20,
              },
              {
                package_id: "pkg-floor-1",
                trade_family: "floor_finish",
                std_hours: 5,
                difficulty_band: "S1",
                responsibility_share: 1,
                role_type: "support",
                quality_result: "pass",
                rated_units: 4,
                package_points: 5,
                member_points: 5,
              },
            ],
          },
        },
        error: null,
      }),
      path_monthly_close_inputs: createChain({
        data: { selected_site_ids: ["site-1"] },
        error: null,
      }),
      path_work_packages: createChain({
        data: [
          { package_key: "pkg-wall-1", site_id: "site-1" },
          { package_key: "pkg-floor-1", site_id: "site-2" },
        ],
        error: null,
      }),
      sites: createChain({
        data: [
          { id: "site-1", name: "渋谷マンション" },
          { id: "site-2", name: "代々木ビル" },
        ],
        error: null,
      }),
      policy_bundle_versions: createChain({ data: [], error: null }),
    });

    const result = await service.getMemberRewardExplanation(
      "11111111-1111-4111-8111-111111111111",
      "2026-04",
    );

    expect(result).toEqual(
      expect.objectContaining({
        allocation_basis: "package_points.variable_only",
        site_allocations: [
          expect.objectContaining({
            site_id: "site-1",
            site_name: "渋谷マンション",
            site_selected: true,
            variable_amount_allocated: 72000,
          }),
          expect.objectContaining({
            site_id: "site-2",
            site_name: "代々木ビル",
            site_selected: false,
            variable_amount_allocated: 18000,
          }),
        ],
      }),
    );
  });

  it("filters pending proposal queue to PATH module proposals only", async () => {
    const proposalsChain = createChain({
      data: [
        {
          id: "path-policy",
          type: "policy.update",
          status: "pending",
          payload: { module: "path", bundle_key: "path_core_v22" },
        },
        {
          id: "generic-policy",
          type: "policy.update",
          status: "pending",
          payload: { module: "finance", bundle_key: "finance.default" },
        },
        {
          id: "path-reward",
          type: "reward.calculate",
          status: "pending",
          payload: { path_module_version: "v2.2", calculation_system: "path_v22" },
        },
        {
          id: "generic-reward",
          type: "reward.calculate",
          status: "pending",
          payload: { calculation_system: "legacy_reward_v1" },
        },
      ],
      error: null,
    });
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      proposals: proposalsChain,
    });

    const result = await service.listPendingProposalQueue(10);

    expect(proposalsChain.in).toHaveBeenCalledWith("type", [
      "policy.update",
      "evaluation.finalize",
      "reward.calculate",
      "reward.adjust",
      "skill.achieve",
      "skill.revoke",
    ]);
    expect(result.map((item) => item.id)).toEqual(["path-policy", "path-reward"]);
  });

  it("merges selected site ids into month close summary rows", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_month_closes: createChain({
        data: [
          {
            id: "close-1",
            month: "2026-04",
            member_id: "11111111-1111-4111-8111-111111111111",
          },
        ],
        error: null,
      }),
      path_reward_runs: createChain({
        data: [],
        error: null,
      }),
      path_monthly_close_inputs: createChain({
        data: [
          {
            member_id: "11111111-1111-4111-8111-111111111111",
            selected_site_ids: ["site-1"],
          },
        ],
        error: null,
      }),
    });

    const result = await service.getMonthCloseSummary("2026-04");

    expect(result).toEqual(
      expect.objectContaining({
        month: "2026-04",
        closes: [
          expect.objectContaining({
            id: "close-1",
            selected_site_ids: ["site-1"],
          }),
        ],
      }),
    );
  });

  it("falls back to accounting rollup when site item snapshots are missing", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_site_item_profit_snapshots: createChain({ data: [], error: null }),
      revenue_basis: createChain({ data: [], error: null }),
      proposals: createChain({ data: [], error: null }),
      accounting_transactions: createChain({
        data: [
          {
            id: "sale-1",
            kind: "sale",
            site_id: "11111111-1111-4111-8111-111111111111",
            site: { id: "11111111-1111-4111-8111-111111111111", org_id: orgId },
            cost_center: "SITE",
            category: null,
            expense_item_code: null,
            description: "4月売上",
            amount_total: 300000,
            recorded_date: "2026-04-10",
          },
          {
            id: "expense-1",
            kind: "expense",
            site_id: "11111111-1111-4111-8111-111111111111",
            site: { id: "11111111-1111-4111-8111-111111111111", org_id: orgId },
            cost_center: "SITE",
            category: "material",
            expense_item_code: null,
            description: "石膏ボード",
            amount_total: 50000,
            recorded_date: "2026-04-11",
          },
          {
            id: "expense-2",
            kind: "expense",
            site_id: "11111111-1111-4111-8111-111111111111",
            site: { id: "11111111-1111-4111-8111-111111111111", org_id: orgId },
            cost_center: "SITE",
            category: "travel",
            expense_item_code: null,
            description: "高速代",
            amount_total: 12000,
            recorded_date: "2026-04-12",
          },
          {
            id: "expense-3",
            kind: "expense",
            site_id: null,
            site: null,
            cost_center: "HQ",
            category: "other",
            expense_item_code: null,
            description: "共通原価",
            amount_total: 8000,
            recorded_date: "2026-04-13",
          },
          {
            id: "expense-4",
            kind: "expense",
            site_id: "11111111-1111-4111-8111-111111111111",
            site: { id: "11111111-1111-4111-8111-111111111111", org_id: orgId },
            cost_center: "SITE",
            category: "other",
            expense_item_code: "subcontract",
            description: "外注応援",
            amount_total: 20000,
            recorded_date: "2026-04-14",
          },
        ],
        error: null,
      }),
    });

    const result = await service.listSiteItemProfitSummary({ month: "2026-04" });

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        item_name: "会計自動集計",
        revenue: 300000,
        material_cost: 50000,
        subcontract_cost: 20000,
        direct_cost: 12000,
        metadata: expect.objectContaining({
          source_kind: "accounting_transactions_rollup",
          auto_profit_inputs: expect.objectContaining({
            sales: 300000,
            materials_cost: 50000,
            outsourcing_cost: 20000,
            transport_cost: 12000,
            common_cost: 0,
          }),
        }),
      }),
    );
  });

  it("prefers canonical site completion revenue over accounting sales fallback", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      path_site_item_profit_snapshots: createChain({ data: [], error: null }),
      revenue_basis: createChain({
        data: [
          {
            id: "basis-1",
            site_id: "11111111-1111-4111-8111-111111111111",
            recognition_date: "2026-04-18",
            site: {
              id: "11111111-1111-4111-8111-111111111111",
              org_id: orgId,
              revenue: 280000,
              name: "渋谷マンション",
            },
          },
        ],
        error: null,
      }),
      proposals: createChain({
        data: [
          {
            revenue_basis_id: "basis-1",
            payload: { amount: 280000 },
          },
        ],
        error: null,
      }),
      accounting_transactions: createChain({
        data: [
          {
            id: "sale-1",
            kind: "sale",
            site_id: "11111111-1111-4111-8111-111111111111",
            site: { id: "11111111-1111-4111-8111-111111111111", org_id: orgId },
            cost_center: "SITE",
            category: null,
            expense_item_code: null,
            description: "会計売上 fallback",
            amount_total: 310000,
            recorded_date: "2026-04-10",
          },
          {
            id: "expense-1",
            kind: "expense",
            site_id: "11111111-1111-4111-8111-111111111111",
            site: { id: "11111111-1111-4111-8111-111111111111", org_id: orgId },
            cost_center: "SITE",
            category: "material",
            expense_item_code: null,
            description: "石膏ボード",
            amount_total: 50000,
            recorded_date: "2026-04-11",
          },
        ],
        error: null,
      }),
    });

    const result = await service.listSiteItemProfitSummary({ month: "2026-04" });

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(
      expect.objectContaining({
        item_name: "渋谷マンション",
        revenue: 280000,
        material_cost: 0,
        metadata: expect.objectContaining({
          source_kind: "revenue_basis_income_create",
          source_label: "完了現場売上",
          revenue_basis_ids: ["basis-1"],
        }),
      }),
    );
    expect(result[1]).toEqual(
      expect.objectContaining({
        item_name: "会計コスト自動集計",
        revenue: 0,
        material_cost: 50000,
        metadata: expect.objectContaining({
          source_kind: "accounting_cost_rollup",
          canonical_revenue_sales: 280000,
          accounting_sales_fallback: 310000,
          auto_profit_inputs: expect.objectContaining({
            sales: 280000,
            materials_cost: 50000,
          }),
        }),
      }),
    );
  });

  it("builds reward confirmation summary even when explanation snapshot is missing", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      monthly_distribution_closes: createChain({ data: null, error: null }),
      profiles: createChain({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            full_name: "田中 太郎",
            username: "tanaka",
          },
        ],
        error: null,
      }),
      path_explanation_snapshots: createChain({ data: null, error: null }),
      path_monthly_close_inputs: createChain({ data: null, error: null }),
      proposals: createChain({ data: [], error: null }),
      sites: createChain({
        data: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "渋谷マンション",
          },
        ],
        error: null,
      }),
      policy_bundle_versions: createChain({ data: [], error: null }),
    });
    mockPreviewMonthlyDistribution
      .mockResolvedValueOnce({
        month: "2026-04",
        path_rule_version: "path_v31",
        path_rule_fingerprint: "fp-v31",
        calculation_snapshot: {
          site_closes: [
            {
              site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              distributable_profit: 120000,
              share_snapshot: [
                {
                  member_id: "11111111-1111-4111-8111-111111111111",
                  result_share: 0.6,
                  credited_units: 12,
                },
                {
                  member_id: "22222222-2222-4222-8222-222222222222",
                  result_share: 0.4,
                  credited_units: 8,
                },
              ],
            },
          ],
        },
        members: [
          {
            member_id: "11111111-1111-4111-8111-111111111111",
            total_pay: 160000,
            floor_pay: 90000,
            result_pay: 70000,
            correction: 0,
            floor_units: 12,
            raw_result_weight: 1.2,
            boosted_result_weight: 1.3,
          },
        ],
      })
      .mockResolvedValueOnce({
        month: "2026-03",
        path_rule_version: "path_v31",
        path_rule_fingerprint: "fp-v31-prev",
        calculation_snapshot: {
          site_closes: [],
        },
        members: [],
      });

    const result = await service.getRewardConfirmationSummary(
      "2026-04",
      "11111111-1111-4111-8111-111111111111",
    );

    expect(result).toEqual(
      expect.objectContaining({
        month: "2026-04",
        status: "試算中",
        explanation_missing: true,
        explanation_missing_message: "詳細な説明データがまだ揃っていません",
        delta_amount: 160000,
        delta_empty_state: null,
      }),
    );
    expect(result.site_breakdown).toEqual([
      expect.objectContaining({
        site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        site_name: "渋谷マンション",
      }),
    ]);
  });

  it("returns grounded QA output for correction questions", async () => {
    setupMockFrom((supabaseAdmin.from as jest.Mock), {
      monthly_distribution_closes: createChain({ data: null, error: null }),
      profiles: createChain({
        data: [
          {
            id: "11111111-1111-4111-8111-111111111111",
            full_name: "田中 太郎",
            username: "tanaka",
          },
        ],
        error: null,
      }),
      path_explanation_snapshots: createChain({ data: null, error: null }),
      path_monthly_close_inputs: createChain({ data: null, error: null }),
      proposals: createChain({
        data: [
          {
            id: "proposal-1",
            type: "reward.adjust",
            status: "executed",
            created_at: "2026-04-20T00:00:00.000Z",
            payload: {
              target_month: "2026-04",
              correction_month: "2026-05",
              reason_code: "late_quality_fix",
              run_type: "adjustment",
              member_adjustments: [
                {
                  member_id: "11111111-1111-4111-8111-111111111111",
                  amount: -8000,
                  explanation: {
                    site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  },
                },
              ],
            },
          },
        ],
        error: null,
      }),
      sites: createChain({
        data: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "渋谷マンション",
          },
        ],
        error: null,
      }),
      policy_bundle_versions: createChain({ data: [], error: null }),
    });
    mockPreviewMonthlyDistribution
      .mockResolvedValueOnce({
        month: "2026-04",
        path_rule_version: "path_v31",
        path_rule_fingerprint: "fp-v31",
        calculation_snapshot: {
          site_closes: [
            {
              site_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              distributable_profit: 120000,
              share_snapshot: [
                {
                  member_id: "11111111-1111-4111-8111-111111111111",
                  result_share: 0.6,
                  credited_units: 12,
                },
                {
                  member_id: "22222222-2222-4222-8222-222222222222",
                  result_share: 0.4,
                  credited_units: 8,
                },
              ],
            },
          ],
        },
        members: [
          {
            member_id: "11111111-1111-4111-8111-111111111111",
            total_pay: 160000,
            floor_pay: 90000,
            result_pay: 70000,
            correction: 0,
            floor_units: 12,
            raw_result_weight: 1.2,
            boosted_result_weight: 1.3,
          },
        ],
      })
      .mockResolvedValueOnce({
        month: "2026-03",
        path_rule_version: "path_v31",
        path_rule_fingerprint: "fp-v31-prev",
        calculation_snapshot: {
          site_closes: [],
        },
        members: [],
      });

    const answer = await service.answerRewardConfirmationQuestion({
      month: "2026-04",
      member_id: "11111111-1111-4111-8111-111111111111",
      question: "補正って何が入ってる？",
      site_id: null,
    });

    expect(answer).toEqual(
      expect.objectContaining({
        conclusion: expect.stringContaining("1 件の補正"),
        reasons: [expect.stringContaining("late_quality_fix")],
        next_action: null,
      }),
    );
    expect(answer.evidence_refs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          anchor: "reward-corrections",
        }),
      ]),
    );
  });
});
