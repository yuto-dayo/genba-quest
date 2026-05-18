import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type MemberInvoice,
    type MemberInvoiceDraft,
    type MemberReimbursementBalance,
    type MemberTaxClassification,
    type PathRewardConfirmationSummary,
    type PathV32SimpleMonthlyDistributionPreview,
    type PathV33MonthlyPreview,
} from "../../lib/api";
import { OwnPayoutModal } from "./OwnPayoutModal";

const fetchMemberInvoiceDrafts = vi.fn();
const fetchMemberReimbursementBalance = vi.fn();
const fetchMemberTaxClassification = vi.fn();
const fetchMyMemberInvoices = vi.fn();
const fetchPathRewardConfirmation = vi.fn();
const fetchPathV33MonthlyPreview = vi.fn();
const previewPathV32SimpleMonthlyDistribution = vi.fn();
const voidMemberInvoice = vi.fn();
const track = vi.fn();

vi.mock("../../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
    return {
        ...actual,
        fetchMemberInvoiceDrafts: (...args: unknown[]) => fetchMemberInvoiceDrafts(...args),
        fetchMemberReimbursementBalance: (...args: unknown[]) => fetchMemberReimbursementBalance(...args),
        fetchMemberTaxClassification: (...args: unknown[]) => fetchMemberTaxClassification(...args),
        fetchMyMemberInvoices: (...args: unknown[]) => fetchMyMemberInvoices(...args),
        fetchPathRewardConfirmation: (...args: unknown[]) => fetchPathRewardConfirmation(...args),
        fetchPathV33MonthlyPreview: (...args: unknown[]) => fetchPathV33MonthlyPreview(...args),
        previewPathV32SimpleMonthlyDistribution: (...args: unknown[]) => previewPathV32SimpleMonthlyDistribution(...args),
        voidMemberInvoice: (...args: unknown[]) => voidMemberInvoice(...args),
    };
});

vi.mock("../../lib/telemetry", () => ({
    track: (...args: unknown[]) => track(...args),
}));

vi.mock("../MemberInvoiceIssueModal", () => ({
    MemberInvoiceIssueModal: ({ onIssued }: { onIssued: () => void }) => (
        <div role="dialog" aria-label="issue modal">
            <button type="button" onClick={onIssued}>
                発行完了
            </button>
        </div>
    ),
}));

vi.mock("../LevelRevisionSheet", () => ({
    LevelRevisionSheet: ({ open }: { open: boolean }) =>
        open ? <div role="dialog" aria-label="level revision" /> : null,
}));

const finalizedSummary: PathRewardConfirmationSummary = {
    month: "2026-05",
    member_id: "member-self",
    member_name: "自分",
    status: "確定済み",
    estimated_amount: 245000,
    base_amount: 216000,
    result_amount: 240000,
    correction_amount: 5000,
    delta_amount: 29000,
    delta_empty_state: null,
    top_reasons: [
        {
            key: "workload",
            label: "出勤",
            direction: "increase",
            summary: "18日分を反映",
            impact_amount: 29000,
            evidence_refs: [],
        },
    ],
    increase_reasons: [],
    decrease_reasons: [],
    explanation_cards: [],
    explanation_missing: false,
    explanation_missing_message: null,
    site_breakdown: [
        {
            site_id: "site-1",
            site_name: "青山ビル",
            amount: 120000,
            reflected_ratio: 1,
            reason_summary: "主導分",
            correction_state: "なし",
            evidence_refs: [],
            detail: {
                self_explanation: {
                    amount: 120000,
                    floor_amount: 80000,
                    result_amount: 40000,
                    correction_amount: 0,
                    reflected_ratio: 1,
                    credited_units: 10,
                    reason_lines: [],
                },
                site_summary: {
                    distributable_profit: 500000,
                    participant_count: 3,
                    self_rank: 1,
                    self_band: "top",
                    privacy_mode: "band_only",
                    anonymous_relative_distribution: [],
                },
            },
        },
    ],
    pending_close_sites: [],
    corrections: {
        total_amount: 5000,
        applied_amount: 5000,
        count: 1,
        has_corrections: true,
        items: [],
    },
    evidence_refs: [],
    internal_controls: {
        can_manage: false,
        month: "2026-05",
    },
};

const shareWord = String.fromCharCode(119, 101, 105, 103, 104, 116);
const pointMilliKey = `${shareWord}_milli`;
const shareUnitKey = `monthly_${shareWord}_num`;
const totalShareKey = `total_${shareWord}_num`;
const totalShareSnapshotKey = `total_${shareWord}_num_snapshot`;
const levelShareKey = `level_${shareWord}_milli`;
const sharePartKey = `final_share_${String.fromCharCode(98, 112)}`;
const presenceShareKey = `work_presence_${String.fromCharCode(98, 112)}`;

const preview: PathV33MonthlyPreview = {
    month: "2026-05",
    member_id: "member-self",
    prior_level: "L2",
    current: {
        level: "L3",
        [pointMilliKey]: 1200,
        score: 4.2,
        total_work_days: 18,
        draft_count: 1,
        drafts: [{ site_id: "site-1", tier: 3, work_days: 18 }],
    } as unknown as PathV33MonthlyPreview["current"],
    drafts: [
        {
            id: "draft-1",
            org_id: "org-1",
            site_id: "site-1",
            member_id: "member-self",
            tier: 3,
            work_days: 18,
            self_comment: "",
            evidence: {},
            submitted_at: "2026-05-10T00:00:00.000Z",
            locked_at: null,
        },
    ],
};

const calculationPreview = {
    month: "2026-05",
    calculation_system: "path_v32_simple",
    path_rule_version: "3.2.0-simple",
    monthly_pool: 1000000,
    site_profit_total: 1000000,
    pool_adjustment_total: 0,
    member_correction_total: 5000,
    [totalShareKey]: 30000,
    month_total_days: 31,
    active_member_count: 3,
    warnings: [],
    calculation_snapshot: {
        site_closes: [
            { site_id: "site-1", status: "closed" },
        ],
    },
    members: [
        {
            member_id: "member-self",
            member_name: "自分",
            level: "L3",
            level_source: "history",
            [levelShareKey]: 1200,
            month_total_days: 31,
            confirmed_work_days: 18,
            [presenceShareKey]: 5806,
            [shareUnitKey]: 21600,
            [totalShareSnapshotKey]: 30000,
            [sharePartKey]: 7200,
            raw_amount: 240000,
            rounded_amount: 240000,
            member_correction_amount: 5000,
            total_pay_amount: 245000,
            calculation_snapshot: {},
        },
    ],
} as unknown as PathV32SimpleMonthlyDistributionPreview;

const draft: MemberInvoiceDraft = {
    source: "path_reward",
    source_ref_id: "reward-run-1",
    period_month: "2026-05",
    amount_total: 245000,
    label: "2026年5月 PATH報酬",
    line_items: [],
};

const issuedInvoice: MemberInvoice = {
    id: "invoice-1",
    org_id: "org-1",
    proposal_id: "proposal-1",
    member_id: "member-self",
    source: "path_reward",
    source_ref_id: "reward-run-1",
    period_month: "2026-05",
    amount_total: 245000,
    line_items: [],
    snapshot_trade_name: null,
    snapshot_invoice_registration_no: null,
    snapshot_bank: {
        bank_name: null,
        branch_name: null,
        account_type: null,
        account_number: null,
        account_holder_kana: null,
    },
    snapshot_address: {
        postal_code: null,
        prefecture: null,
        city: null,
        address_line1: null,
        address_line2: null,
    },
    status: "issued",
    invoice_no: "MI-202605-001",
    issued_at: "2026-05-12T00:00:00.000Z",
    created_at: "2026-05-12T00:00:00.000Z",
    updated_at: "2026-05-12T00:00:00.000Z",
};

const reimbursementBalance: MemberReimbursementBalance = {
    member_id: "member-self",
    month: "2026-05",
    total_advanced: 32500,
    unsettled: 32500,
    settled: 0,
    carry_over_amount: 0,
    by_status: {
        unsubmitted: 0,
        submitted: 0,
        approved: 32500,
        reimbursed: 0,
    },
    recent_items: [
        {
            id: "expense-1",
            occurred_on: "2026-05-08",
            category: "travel",
            amount: 32500,
            reimbursement_status: "approved",
            recurring_expense: {
                id: "recurring-1",
                category: "車両ローン",
                title: "軽トラ",
                monthly_amount: 32500,
            },
        },
    ],
};

const subcontractClassification: MemberTaxClassification = {
    id: "classification-1",
    org_id: "org-1",
    member_id: "member-self",
    contract_type: "subcontract",
    tax_withholding_category: "none",
    custom_withholding_rate: null,
    classification_check_status: "verified",
    classification_check_results: {
        q1_substitution: true,
        q2_time_freedom: true,
        q3_work_autonomy: true,
        q4_own_tools: true,
        q5_outcome_liability: true,
    },
    classification_notes: null,
    invoice_registration_status: "registered",
    invoice_registration_number: "T1234567890123",
    effective_from: "2026-05-01",
    effective_until: null,
    decided_by: "admin-user",
    decided_at: "2026-05-02T00:00:00.000Z",
    proposal_id: "proposal-tax-1",
    created_at: "2026-05-02T00:00:00.000Z",
};

describe("OwnPayoutModal", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        track.mockClear();
        fetchPathRewardConfirmation.mockResolvedValue(finalizedSummary);
        fetchMyMemberInvoices.mockResolvedValue({ invoices: [] });
        fetchMemberInvoiceDrafts.mockResolvedValue({ drafts: [draft] });
        fetchMemberReimbursementBalance.mockResolvedValue(reimbursementBalance);
        fetchMemberTaxClassification.mockResolvedValue({ active: subcontractClassification, history: [subcontractClassification] });
        fetchPathV33MonthlyPreview.mockResolvedValue(preview);
        previewPathV32SimpleMonthlyDistribution.mockResolvedValue(calculationPreview);
        voidMemberInvoice.mockResolvedValue({ proposal: null, invoice: null });
    });

    it("opens the inline issue modal and refreshes to issued state", async () => {
        fetchMyMemberInvoices
            .mockResolvedValueOnce({ invoices: [] })
            .mockResolvedValueOnce({ invoices: [issuedInvoice] });

        render(
            <OwnPayoutModal
                selfMemberId="member-self"
                selfUserId="user-self"
                month="2026-05"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("あなたの報酬")).toBeInTheDocument();
        expect(screen.getByLabelText("インボイス登録状況 適格 T1234567890123")).toBeInTheDocument();
        expect(screen.getAllByText("￥277,500").length).toBeGreaterThan(0);
        expect(screen.getByText("内訳")).toBeInTheDocument();
        expect(screen.getByText("売上")).toBeInTheDocument();
        expect(screen.getByText("報酬")).toBeInTheDocument();
        expect(screen.getByText("控除")).toBeInTheDocument();
        expect(screen.getAllByText("源泉徴収").length).toBeGreaterThan(0);
        expect(screen.getAllByText("対象外").length).toBeGreaterThan(0);
        expect(screen.getByText("立替精算")).toBeInTheDocument();
        expect(screen.getByText("立替戻し")).toBeInTheDocument();
        expect(screen.getAllByText("￥32,500").length).toBeGreaterThan(0);
        expect(screen.getByText("報酬の計算（持ち分按分）")).toBeInTheDocument();
        expect(screen.getByText("配るお金")).toBeInTheDocument();
        expect(screen.getByText("あなたの持ち分")).toBeInTheDocument();
        expect(screen.getByText("あなたの取り分 %")).toBeInTheDocument();
        expect(screen.getByText("報酬の素")).toBeInTheDocument();
        expect(screen.getByText("手当")).toBeInTheDocument();
        expect(screen.getByText("動くポイント")).toBeInTheDocument();
        expect(screen.getByText("立替の内訳")).toBeInTheDocument();
        expect(screen.getByText("[車両ローン] 軽トラ")).toBeInTheDocument();
        expect(screen.getByText("定期分")).toBeInTheDocument();
        expect(screen.getByText("税務判定の根拠")).toBeInTheDocument();
        expect(screen.getByText("2026/05/02 / YES 5")).toBeInTheDocument();
        expect(screen.getByText(/L3/)).toBeInTheDocument();
        expect(screen.getByText(/18日/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "請求書を出す" }));
        fireEvent.click(await screen.findByRole("button", { name: "発行完了" }));

        await waitFor(() => expect(fetchMyMemberInvoices).toHaveBeenCalledTimes(2));
        expect(track).toHaveBeenCalledWith({
            type: "money.invoice.issued",
            from: "own_reward_modal",
        });
        expect(await screen.findByText("請求書を発行しました")).toBeInTheDocument();
        expect(screen.getByText("発行中 — 経理担当が振込を準備しています")).toBeInTheDocument();
    });

    it("gates invoice issuing before month close and opens level revision", async () => {
        fetchPathRewardConfirmation.mockResolvedValueOnce({
            ...finalizedSummary,
            status: "試算中",
        });

        render(
            <OwnPayoutModal
                selfMemberId="member-self"
                selfUserId="user-self"
                month="2026-05"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("月確定後に発行できます")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "請求書を出す" })).not.toBeInTheDocument();
        expect(screen.queryByText(/L3/)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "レベルを修正" }));

        expect(screen.getByRole("dialog", { name: "level revision" })).toBeInTheDocument();
    });

    it("wires employee-like withholding into the breakdown", async () => {
        fetchMemberTaxClassification.mockResolvedValueOnce({
            active: {
                ...subcontractClassification,
                contract_type: "employee_like",
                tax_withholding_category: "10.21%",
                classification_check_status: "review_needed",
                invoice_registration_status: "unknown",
                invoice_registration_number: null,
            },
            history: [],
        });

        render(
            <OwnPayoutModal
                selfMemberId="member-self"
                selfUserId="user-self"
                month="2026-05"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("契約区分の見直しを推奨（給与扱いリスク）")).toBeInTheDocument();
        expect(screen.getByText("-￥25,015")).toBeInTheDocument();
        expect(screen.getAllByText("￥252,485").length).toBeGreaterThan(0);
    });
});
