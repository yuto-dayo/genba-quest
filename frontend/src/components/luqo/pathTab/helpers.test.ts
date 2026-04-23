import { describe, expect, it } from "vitest";
import type {
  PathModuleMonthlyCloseInput,
  PathModuleSiteItemProfitSnapshot,
  PathMonthlyEvaluationFinalization,
  PathMonthlyEvaluationForm,
} from "../../../lib/api";
import {
  buildRewardSourceLineageCards,
  buildSelectedSiteSummary,
  buildEmptyRewardMember,
  buildInitialFormInput,
  buildPathRewardRunMembers,
  getAutoRewardCandidateIds,
  getSuggestedSiteIdsFromSiteItems,
} from "./helpers";

function buildSiteItem(
  overrides: Partial<PathModuleSiteItemProfitSnapshot>,
): PathModuleSiteItemProfitSnapshot {
  return {
    id: overrides.id ?? "site-item-1",
    org_id: overrides.org_id ?? "org-1",
    month: overrides.month ?? "2026-04",
    site_id: overrides.site_id ?? "site-1",
    item_key: overrides.item_key ?? "canonical-revenue:site-1",
    item_name: overrides.item_name ?? "現場A",
    trade_family: overrides.trade_family ?? "common_site_operations",
    revenue: overrides.revenue ?? 0,
    material_cost: overrides.material_cost ?? 0,
    subcontract_cost: overrides.subcontract_cost ?? 0,
    direct_cost: overrides.direct_cost ?? 0,
    gross_profit: overrides.gross_profit ?? 0,
    estimated_std_hours: overrides.estimated_std_hours ?? 0,
    difficulty_band: overrides.difficulty_band ?? "S1",
    metadata: overrides.metadata ?? {},
    created_at: overrides.created_at ?? "2026-04-18T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-04-18T00:00:00.000Z",
  };
}

describe("pathTab helpers", () => {
  describe("getAutoRewardCandidateIds", () => {
    it("returns only finalized members with positive work days", () => {
      const finalizations = [
        {
          member_id: "11111111-1111-4111-8111-111111111111",
          work_days: 12,
        },
        {
          member_id: "22222222-2222-4222-8222-222222222222",
          work_days: 0,
        },
        {
          member_id: "11111111-1111-4111-8111-111111111111",
          work_days: 8,
        },
      ] as PathMonthlyEvaluationFinalization[];

      expect(getAutoRewardCandidateIds(finalizations)).toEqual([
        "11111111-1111-4111-8111-111111111111",
      ]);
    });
  });

  describe("buildPathRewardRunMembers", () => {
    it("rejects members with zero credited units before calling the API", () => {
      const member = {
        ...buildEmptyRewardMember(),
        member_id: "11111111-1111-4111-8111-111111111111",
        name: "田中",
        role_level: "L2",
        std_hours: 8,
      } satisfies ReturnType<typeof buildEmptyRewardMember>;

      expect(() => buildPathRewardRunMembers([member], "2026-04")).toThrow(
        "メンバー1の付与ユニットを1以上で入力してください",
      );
    });

    it("builds a valid reward-run payload member when finalized data exists", () => {
      const member = {
        ...buildEmptyRewardMember(),
        member_id: "11111111-1111-4111-8111-111111111111",
        name: "田中",
        role_level: "L2",
        credited_units: 12,
        A: 2,
        R: 1,
        Q: 2,
        std_hours: 8,
      } satisfies ReturnType<typeof buildEmptyRewardMember>;

      expect(buildPathRewardRunMembers([member], "2026-04")).toEqual([
        expect.objectContaining({
          member_id: "11111111-1111-4111-8111-111111111111",
          credited_units: 12,
          role_level: "L2",
          name: "田中",
        }),
      ]);
    });
  });

  describe("getSuggestedSiteIdsFromSiteItems", () => {
    it("returns unique site ids only from canonical revenue rows", () => {
      const siteItems = [
        {
          id: "item-1",
          org_id: "org-1",
          month: "2026-04",
          site_id: "site-1",
          item_key: "canonical-revenue:site-1",
          item_name: "現場A",
          trade_family: "common_site_operations",
          revenue: 280000,
          material_cost: 0,
          subcontract_cost: 0,
          direct_cost: 0,
          gross_profit: 280000,
          estimated_std_hours: 0,
          difficulty_band: "S1",
          metadata: { source_kind: "revenue_basis_income_create" },
          created_at: "2026-04-18T00:00:00.000Z",
          updated_at: "2026-04-18T00:00:00.000Z",
        },
        {
          id: "item-2",
          org_id: "org-1",
          month: "2026-04",
          site_id: "site-1",
          item_key: "canonical-revenue:site-1:duplicate",
          item_name: "現場A",
          trade_family: "common_site_operations",
          revenue: 20000,
          material_cost: 0,
          subcontract_cost: 0,
          direct_cost: 0,
          gross_profit: 20000,
          estimated_std_hours: 0,
          difficulty_band: "S1",
          metadata: { source_kind: "revenue_basis_income_create" },
          created_at: "2026-04-18T00:00:00.000Z",
          updated_at: "2026-04-18T00:00:00.000Z",
        },
        {
          id: "item-3",
          org_id: "org-1",
          month: "2026-04",
          site_id: "site-costs",
          item_key: "auto-rollup:all",
          item_name: "会計コスト自動集計",
          trade_family: "common_site_operations",
          revenue: 0,
          material_cost: 50000,
          subcontract_cost: 0,
          direct_cost: 0,
          gross_profit: -50000,
          estimated_std_hours: 0,
          difficulty_band: "S1",
          metadata: { source_kind: "accounting_cost_rollup" },
          created_at: "2026-04-18T00:00:00.000Z",
          updated_at: "2026-04-18T00:00:00.000Z",
        },
      ] as PathModuleSiteItemProfitSnapshot[];

      expect(getSuggestedSiteIdsFromSiteItems(siteItems)).toEqual(["site-1"]);
    });
  });

  describe("buildInitialFormInput", () => {
    it("prefers saved form site ids over close input and canonical suggestions", () => {
      const form = {
        site_ids: ["site-form"],
      } as PathMonthlyEvaluationForm;
      const closeInput = {
        selected_site_ids: ["site-close"],
      } as PathModuleMonthlyCloseInput;
      const siteItems = [
        buildSiteItem({
          site_id: "site-canonical",
          item_key: "canonical-revenue:site-canonical",
          revenue: 280000,
          metadata: { source_kind: "revenue_basis_income_create" },
          gross_profit: 280000,
        }),
      ];

      expect(
        buildInitialFormInput("2026-04", "member-1", form, closeInput, siteItems)
          .site_ids,
      ).toEqual(["site-form"]);
    });

    it("uses close input site ids when form is empty", () => {
      const closeInput = {
        selected_site_ids: ["site-close"],
      } as PathModuleMonthlyCloseInput;

      expect(
        buildInitialFormInput("2026-04", "member-1", undefined, closeInput).site_ids,
      ).toEqual(["site-close"]);
    });

    it("falls back to canonical completion site ids when no saved inputs exist", () => {
      const siteItems = [
        buildSiteItem({
          site_id: "site-canonical",
          item_key: "canonical-revenue:site-canonical",
          revenue: 280000,
          metadata: { source_kind: "revenue_basis_income_create" },
          gross_profit: 280000,
        }),
      ];

      expect(
        buildInitialFormInput("2026-04", "member-1", undefined, null, siteItems)
          .site_ids,
      ).toEqual(["site-canonical"]);
    });
  });

  describe("buildSelectedSiteSummary", () => {
    it("prefers month-close selected sites and resolves canonical labels", () => {
      const summary = buildSelectedSiteSummary({
        form: {
          site_ids: ["site-form"],
        } as PathMonthlyEvaluationForm,
        monthlyCloseInput: {
          selected_site_ids: ["site-close"],
        } as PathModuleMonthlyCloseInput,
        siteItems: [
          buildSiteItem({
            site_id: "site-close",
            item_key: "canonical-revenue:site-close",
            item_name: "渋谷マンション",
            revenue: 280000,
            metadata: { source_kind: "revenue_basis_income_create" },
            gross_profit: 280000,
          }),
        ],
      });

      expect(summary).toEqual({
        siteIds: ["site-close"],
        labels: ["渋谷マンション"],
        sourceLabel: "月締めに反映",
        helper: "1件の現場を今回の対象に使います。",
      });
    });

    it("uses explicit selected site ids for reward explanation summaries", () => {
      const summary = buildSelectedSiteSummary({
        selectedSiteIds: ["site-explanation"],
        siteItems: [
          buildSiteItem({
            site_id: "site-explanation",
            item_key: "canonical-revenue:site-explanation",
            item_name: "代々木ビル",
            revenue: 180000,
            metadata: { source_kind: "revenue_basis_income_create" },
            gross_profit: 180000,
          }),
        ],
      });

      expect(summary).toEqual({
        siteIds: ["site-explanation"],
        labels: ["代々木ビル"],
        sourceLabel: "報酬詳細",
        helper: "1件の現場を今回の対象に使います。",
      });
    });
  });

  describe("buildRewardSourceLineageCards", () => {
    it("builds canonical revenue and accounting cost cards with selection state", () => {
      const cards = buildRewardSourceLineageCards(
        [
          {
            id: "site-1-card",
            org_id: "org-1",
            month: "2026-04",
            site_id: "site-1",
            item_key: "canonical-revenue:site-1",
            item_name: "渋谷マンション",
            trade_family: "common_site_operations",
            revenue: 280000,
            material_cost: 0,
            subcontract_cost: 0,
            direct_cost: 0,
            gross_profit: 280000,
            estimated_std_hours: 0,
            difficulty_band: "S1",
            metadata: { source_kind: "revenue_basis_income_create" },
            created_at: "2026-04-18T00:00:00.000Z",
            updated_at: "2026-04-18T00:00:00.000Z",
          },
          {
            id: "cost-card",
            org_id: "org-1",
            month: "2026-04",
            site_id: "org-1",
            item_key: "auto-rollup:all",
            item_name: "会計コスト自動集計",
            trade_family: "common_site_operations",
            revenue: 0,
            material_cost: 50000,
            subcontract_cost: 20000,
            direct_cost: 12000,
            gross_profit: -82000,
            estimated_std_hours: 0,
            difficulty_band: "S1",
            metadata: { source_kind: "accounting_cost_rollup" },
            created_at: "2026-04-18T00:00:00.000Z",
            updated_at: "2026-04-18T00:00:00.000Z",
          },
        ] as PathModuleSiteItemProfitSnapshot[],
        ["site-1"],
      );

      expect(cards).toEqual([
        {
          id: "site-1-card",
          siteId: "site-1",
          title: "渋谷マンション",
          badge: "完了現場売上",
          highlightLabel: "今見ていた現場",
          value: "¥280,000",
          helper: "site-1 / 今回の対象現場",
          selected: true,
        },
        {
          id: "cost-card",
          siteId: null,
          title: "会計コスト自動集計",
          badge: "会計コスト",
          highlightLabel: null,
          value: "¥82,000",
          helper: "材料 ¥50,000 / 外注 ¥20,000 / 直接 ¥12,000",
          selected: false,
        },
      ]);
    });
  });
});
