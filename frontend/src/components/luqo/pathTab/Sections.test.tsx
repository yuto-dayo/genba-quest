import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ComponentPropsWithoutRef } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PathRewardOperationsSection } from "./PathRewardSections";
import { PathMonthlyFormSection, PathOverviewSection } from "./PathWorkflowSections";

vi.mock("framer-motion", () => ({
    motion: {
        div: ({ children, ...props }: ComponentPropsWithoutRef<"div">) => (
            <div {...props}>{children}</div>
        ),
    },
}));

const styles = new Proxy(
    {},
    {
        get: (_target, key) => String(key),
    },
) as Record<string, string>;

describe("split PATH sections", () => {
    it("renders member summary metrics on the overview card", () => {
        const onOpenMonthlyInput = vi.fn();
        const onOpenRewardSection = vi.fn();

        render(
            <MemoryRouter>
                <PathOverviewSection
                    styles={styles}
                    period="2026-04"
                    bigSkillLabels={{
                        cross_work: "クロス施工力",
                        putty_foundation: "パテ・下地処理力",
                        planning_preparation: "段取り・準備力",
                        quality_stability: "品質安定力",
                        site_trust: "現場信頼形成力",
                        education_support: "教育・支援力",
                    }}
                    bigSkillStateLabels={{
                        unverified: "未確認",
                        assist_required: "補助あり",
                        conditional: "条件付き",
                        near_independent: "ほぼ自走",
                        stable_independent: "安定自走",
                    }}
                    currentLevel="L3"
                    currentReward={128000}
                    rewardDisplayKind="confirmed"
                    currentExpenseAmount={18450}
                    expenseAmountLoading={false}
                    rewardStatusLabel="評価確定済み"
                    rewardStatusNote="2026/4/30 反映"
                    rewardBreakdown={{
                        formula: "¥82,000 + ¥18,000 = ¥100,000",
                        note: "ベース配分と変動配分の合計が今月の支給額です。",
                        inputs: [
                            { label: "Level", value: "L3", helper: "係数 1.15" },
                            { label: "A/R/Q", value: "2 / 1 / 2", helper: "合計 5" },
                            { label: "月係数", value: "1.10", helper: "変動重み 18.00" },
                        ],
                    }}
                    selectedSiteSummary={{
                        siteIds: ["site-001"],
                        labels: ["渋谷マンション"],
                        sourceLabel: "月締めに反映",
                        helper: "1件の現場を今回の対象に使います。",
                    }}
                    workflow={{
                        stage: "needs_reward",
                        label: "評価確定済み",
                        tone: "info",
                        nextAction: "金額を見る",
                        description: "評価は確定済みです。今月の報酬は上のカードで確認できます。",
                    }}
                    form={{
                        id: "form-1",
                        org_id: "org-1",
                        month: "2026-04",
                        member_id: "11111111-1111-4111-8111-111111111111",
                        selected_big_skill_states: {
                            cross_work: "stable_independent",
                        },
                        work_days: 18,
                        A: 2,
                        R: 1,
                        Q: 2,
                        current_level: "L3",
                        selected_roles: ["主担当"],
                        site_ids: ["site-001"],
                        photo_flag: true,
                        rework_flag: "none",
                        comment: "来月は段取りを広げたい",
                        submitted_at: "2026-04-30T09:00:00.000Z",
                        updated_at: "2026-04-30T09:00:00.000Z",
                    }}
                    profile={{
                        id: "profile-1",
                        org_id: "org-1",
                        member_id: "11111111-1111-4111-8111-111111111111",
                        current_level: "L3",
                        current_level_since: "2026-03-31T09:00:00.000Z",
                        cross_work_status: "stable_independent",
                        putty_foundation_status: "near_independent",
                        planning_preparation_status: "conditional",
                        quality_stability_status: "stable_independent",
                        site_trust_status: "near_independent",
                        education_support_status: "assist_required",
                        updated_at: "2026-04-01T00:00:00.000Z",
                    }}
                    onOpenRewardSection={onOpenRewardSection}
                    onOpenMonthlyInput={onOpenMonthlyInput}
                    motionProps={{}}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText("今月の報酬")).toBeInTheDocument();
        expect(screen.getByText("¥128,000")).toBeInTheDocument();
        expect(screen.getByText("確定した支給額です")).toBeInTheDocument();
        expect(screen.getByText("現在 Level")).toBeInTheDocument();
        expect(screen.getAllByText("L3")).not.toHaveLength(0);
        expect(screen.getByText("立替経費")).toBeInTheDocument();
        expect(screen.getByText("¥18,450")).toBeInTheDocument();
        expect(screen.getAllByText("評価確定済み")).not.toHaveLength(0);
        expect(screen.getByText("2026/4/30 反映")).toBeInTheDocument();
        expect(screen.getByText("¥82,000 + ¥18,000 = ¥100,000")).toBeInTheDocument();
        expect(screen.getByText("2 / 1 / 2")).toBeInTheDocument();
        expect(screen.getByText("今回の対象現場")).toBeInTheDocument();
        expect(screen.getByText("渋谷マンション")).toBeInTheDocument();
        expect(screen.getByText("月締めに反映")).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", {
                name: "金額を見る評価は確定済みです。今月の報酬は上のカードで確認できます。",
            }),
        );
        expect(onOpenRewardSection).toHaveBeenCalledTimes(1);

        fireEvent.click(screen.getByRole("button", { name: /現在 Level/i }));

        expect(screen.getByRole("dialog", { name: "L3 の詳細" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "現場入力メモ" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "入力を見直す" }));
        expect(onOpenMonthlyInput).toHaveBeenCalledTimes(1);
    });

    it("shows estimate labeling when the reward is only a preview", () => {
        render(
            <MemoryRouter>
                <PathOverviewSection
                    styles={styles}
                    period="2026-04"
                    bigSkillLabels={{
                        cross_work: "クロス施工力",
                        putty_foundation: "パテ・下地処理力",
                        planning_preparation: "段取り・準備力",
                        quality_stability: "品質安定力",
                        site_trust: "現場信頼形成力",
                        education_support: "教育・支援力",
                    }}
                    bigSkillStateLabels={{
                        unverified: "未確認",
                        assist_required: "補助あり",
                        conditional: "条件付き",
                        near_independent: "ほぼ自走",
                        stable_independent: "安定自走",
                    }}
                    currentLevel="L3"
                    currentReward={98000}
                    rewardDisplayKind="estimate"
                    currentExpenseAmount={0}
                    expenseAmountLoading={false}
                    rewardStatusLabel="評価確定前"
                    workflow={{
                        stage: "needs_finalize",
                        label: "AI下書き済み",
                        tone: "info",
                        nextAction: "評価確定",
                        description: "AIが下書きを整理済みです。内容を見て今月の評価を確定します。",
                    }}
                    motionProps={{}}
                />
            </MemoryRouter>,
        );

        expect(screen.getByText("今月の報酬見込み")).toBeInTheDocument();
        expect(screen.getByText("評価確定前の試算です")).toBeInTheDocument();
        expect(screen.getByText("試算")).toBeInTheDocument();
    });

    it("renders month-close and correction controls for the reward workflow", () => {
        const props: ComponentProps<typeof PathRewardOperationsSection> = {
            styles,
            latestModuleClose: {
                id: "close-1",
                proposal_id: "proposal-close-1",
                member_id: "11111111-1111-4111-8111-111111111111",
                month: "2026-04",
                policy_fingerprint: "fingerprint-12345678",
                input_hash: "hash-1",
            },
            latestModuleCloseSiteSummary: {
                siteIds: ["site-1"],
                labels: ["渋谷マンション"],
                sourceLabel: "close input",
                helper: "対象現場です",
            },
            latestModuleRewardRun: {
                id: "run-1",
                proposal_id: "proposal-run-1",
                month: "2026-04",
                run_type: "monthly",
                status: "executed",
            },
            moduleSummary: {
                month: "2026-04",
                closes: [],
                reward_runs: [
                    {
                        id: "run-1",
                        proposal_id: "proposal-run-1",
                        month: "2026-04",
                        run_type: "monthly",
                        status: "executed",
                    },
                    {
                        id: "run-2",
                        proposal_id: "proposal-run-2",
                        month: "2026-05",
                        run_type: "adjustment",
                        status: "approved",
                    },
                ],
            },
            buildSiteDetailHref: (siteId: string) => `/sites?site=${siteId}`,
            correctionMonth: "2026-05",
            rewardProfitInputs: {
                sales: 1200000,
                outsourcing_cost: 150000,
                materials_cost: 40000,
                parking_cost: 10000,
                transport_cost: 5000,
                other_direct_cost: 3000,
                common_cost: 120000,
                reserve_amount: 80000,
            },
            setRewardProfitInputs: vi.fn(),
            rewardPriorAdjustments: 20000,
            setRewardPriorAdjustments: vi.fn(),
            siteItemProfitCount: 4,
            rewardMembers: [
                {
                    member_id: "11111111-1111-4111-8111-111111111111",
                    name: "山田 太郎",
                    credited_units: 18,
                    role_level: "L3",
                    guaranteed_pay: 0,
                    A: 2,
                    R: 1,
                    Q: 2,
                    package_id: "pkg-1",
                    trade_family: "common_site_operations",
                    std_hours: 40,
                    difficulty_band: "S1",
                    responsibility_share: 1,
                    role_type: "lead",
                    quality_result: "pass",
                    rated_units: 18,
                },
            ],
            memberOptions: [
                {
                    id: "11111111-1111-4111-8111-111111111111",
                    label: "山田 太郎",
                },
            ],
            onSelectRewardMember: vi.fn(),
            onUpdateRewardMember: vi.fn(),
            onRemoveRewardMember: vi.fn(),
            onAddRewardMember: vi.fn(),
            previewingReward: false,
            submittingReward: false,
            onPreviewReward: vi.fn(),
            onSubmitReward: vi.fn(),
            rewardPreview: null,
            motionProps: {},
            tradeFamilyLabels: {
                common_site_operations: "現場共通",
                wall_finish: "壁仕上げ",
                floor_finish: "床仕上げ",
                substrate_preparation: "下地づくり",
                decorative_sheet_or_film: "シート・フィルム",
            },
            roleTypeLabels: {
                lead: "主担当",
                support: "サポート",
                teaching: "育成",
            },
            qualityResultLabels: {
                pass: "問題なし",
                minor_fix: "軽い手直し",
                major_fix: "大きな手直し",
            },
            opportunityStatusLabels: {
                observed: "観測のみ",
                not_observed: "未観測",
                opportunity_not_granted: "機会なし",
                recheck_required: "再確認",
            },
            closeCreditedUnits: 12,
            setCloseCreditedUnits: vi.fn(),
            closeNeutralFlagsInput: "weather",
            setCloseNeutralFlagsInput: vi.fn(),
            closeEvidenceInput: "ev-1",
            setCloseEvidenceInput: vi.fn(),
            selectedModuleEvidenceCount: 3,
            selectedAnnotationCount: 2,
            closeOpportunityTradeFamily: "common_site_operations",
            setCloseOpportunityTradeFamily: vi.fn(),
            closeOpportunityStatus: "observed",
            setCloseOpportunityStatus: vi.fn(),
            closeOpportunityDays: 1,
            setCloseOpportunityDays: vi.fn(),
            closeOpportunityScore: 0.6,
            setCloseOpportunityScore: vi.fn(),
            closeProtectedChallengeCount: 1,
            setCloseProtectedChallengeCount: vi.fn(),
            closePromotionBlocked: false,
            setClosePromotionBlocked: vi.fn(),
            closeReviewerSummary: "現場数が少ないので補足確認あり",
            setCloseReviewerSummary: vi.fn(),
            submittingMonthClose: false,
            onSubmitMonthClose: vi.fn(),
            correctionRewardRunId: "run-1",
            setCorrectionRewardRunId: vi.fn(),
            setCorrectionMonth: vi.fn(),
            correctionMode: "reversal",
            setCorrectionMode: vi.fn(),
            correctionReasonCode: "manual_review",
            setCorrectionReasonCode: vi.fn(),
            correctionAmount: -12000,
            setCorrectionAmount: vi.fn(),
            correctionNote: "翌月に差額を反映",
            setCorrectionNote: vi.fn(),
            explanationMonthLabel: "2026-04",
            explanationRenderedLabel: "04/30 18:00",
            explanationSummary: "Level と package 点数を元に支給額を再計算。",
            explanationReasonCodes: ["level_gap", "package_weight"],
            showExplanation: true,
            submittingCorrection: false,
            onSubmitCorrection: vi.fn(),
            formatCurrency: (value: number) => `¥${value.toLocaleString("ja-JP")}`,
        };

        render(
            <MemoryRouter>
                <PathRewardOperationsSection {...props} />
            </MemoryRouter>,
        );

        expect(screen.getByText("3. 月締めを固める")).toBeInTheDocument();
        expect(screen.getByText("5. 補正を申請")).toBeInTheDocument();
        expect(screen.getByText("説明スナップショット")).toBeInTheDocument();
        expect(screen.getByText("Level と package 点数を元に支給額を再計算。")).toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("付与ユニット"), {
            target: { value: "14" },
        });
        expect(props.setCloseCreditedUnits).toHaveBeenCalledWith(14);

        fireEvent.change(screen.getByLabelText("対象 run"), {
            target: { value: "run-2" },
        });
        expect(props.setCorrectionRewardRunId).toHaveBeenCalledWith("run-2");

        fireEvent.click(
            screen.getByRole("button", { name: "月締め申請を作る" }),
        );
        expect(props.onSubmitMonthClose).toHaveBeenCalledTimes(1);

        fireEvent.click(
            screen.getByRole("button", { name: "補正申請を作る" }),
        );
        expect(props.onSubmitCorrection).toHaveBeenCalledTimes(1);
    });

    it("keeps the monthly form UI hidden until the wizard is opened", () => {
        render(
            <MemoryRouter>
                <PathMonthlyFormSection
                    styles={styles}
                    bigSkillLabels={{
                        cross_work: "クロス施工力",
                        putty_foundation: "パテ・下地処理力",
                        planning_preparation: "段取り・準備力",
                        quality_stability: "品質安定力",
                        site_trust: "現場信頼形成力",
                        education_support: "教育・支援力",
                    }}
                    bigSkillStateLabels={{
                        unverified: "未確認",
                        assist_required: "補助あり",
                        conditional: "条件付き",
                        near_independent: "ほぼ自走",
                        stable_independent: "安定自走",
                    }}
                    reworkFlagLabels={{ none: "なし", minor: "軽微", major: "重大" }}
                    formInput={{
                        month: "2026-04",
                        member_id: "11111111-1111-4111-8111-111111111111",
                        selected_big_skill_states: {
                            cross_work: "unverified",
                            putty_foundation: "unverified",
                            planning_preparation: "unverified",
                            quality_stability: "unverified",
                            site_trust: "unverified",
                            education_support: "unverified",
                        },
                        work_days: 0,
                        A: 2,
                        R: 2,
                        Q: 1,
                        current_level: "L3",
                        selected_roles: [],
                        site_ids: [],
                        photo_flag: false,
                        rework_flag: "none",
                        comment: "",
                    }}
                    setFormInput={vi.fn()}
                    roleInput=""
                    setRoleInput={vi.fn()}
                    siteInput=""
                    setSiteInput={vi.fn()}
                    submittingForm={false}
                    onSubmit={vi.fn()}
                    wizardOpen
                    setWizardOpen={vi.fn()}
                    wizardStepIndex={0}
                    setWizardStepIndex={vi.fn()}
                />
            </MemoryRouter>,
        );

        expect(screen.queryByText("1. 今月の入力")).not.toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "クロス施工力は？" })).toBeInTheDocument();
        expect(screen.getByText("今月いちばん近い状態を選んでください")).toBeInTheDocument();
    });

    it("submits from the last monthly form step after entering a comment", () => {
        const onSubmit = vi.fn();

        render(
            <MemoryRouter>
                <PathMonthlyFormSection
                    styles={styles}
                    bigSkillLabels={{
                        cross_work: "クロス施工力",
                        putty_foundation: "パテ・下地処理力",
                        planning_preparation: "段取り・準備力",
                        quality_stability: "品質安定力",
                        site_trust: "現場信頼形成力",
                        education_support: "教育・支援力",
                    }}
                    bigSkillStateLabels={{
                        unverified: "未確認",
                        assist_required: "補助あり",
                        conditional: "条件付き",
                        near_independent: "ほぼ自走",
                        stable_independent: "安定自走",
                    }}
                    reworkFlagLabels={{ none: "なし", minor: "軽微", major: "重大" }}
                    formInput={{
                        month: "2026-04",
                        member_id: "11111111-1111-4111-8111-111111111111",
                        selected_big_skill_states: {
                            cross_work: "unverified",
                            putty_foundation: "unverified",
                            planning_preparation: "unverified",
                            quality_stability: "unverified",
                            site_trust: "unverified",
                            education_support: "unverified",
                        },
                        work_days: 20,
                        A: 2,
                        R: 2,
                        Q: 1,
                        current_level: "L3",
                        selected_roles: ["主担当"],
                        site_ids: ["site-001"],
                        photo_flag: true,
                        rework_flag: "none",
                        comment: "今月のメモ",
                    }}
                    setFormInput={vi.fn()}
                    roleInput="主担当"
                    setRoleInput={vi.fn()}
                    siteInput="site-001"
                    setSiteInput={vi.fn()}
                    submittingForm={false}
                    onSubmit={onSubmit}
                    wizardOpen
                    setWizardOpen={vi.fn()}
                    wizardStepIndex={14}
                    setWizardStepIndex={vi.fn()}
                />
            </MemoryRouter>,
        );

        fireEvent.change(screen.getByRole("textbox", { name: "月末コメント" }), {
            target: { value: "来月は段取りを強める" },
        });
        fireEvent.click(screen.getByRole("button", { name: "保存する" }));

        expect(onSubmit).toHaveBeenCalledTimes(1);
    });

});
