import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type MemberInvoice,
    type MemberInvoiceDraft,
    type MemberReimbursementBalance,
    type PathRewardConfirmationSummary,
    type PathV33MonthlyPreview,
} from "../../lib/api";
import { OwnPayoutModal } from "./OwnPayoutModal";

const fetchMemberInvoiceDrafts = vi.fn();
const fetchMemberReimbursementBalance = vi.fn();
const fetchMyMemberInvoices = vi.fn();
const fetchPathRewardConfirmation = vi.fn();
const fetchPathV33MonthlyPreview = vi.fn();
const voidMemberInvoice = vi.fn();
const track = vi.fn();

vi.mock("../../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
    return {
        ...actual,
        fetchMemberInvoiceDrafts: (...args: unknown[]) => fetchMemberInvoiceDrafts(...args),
        fetchMemberReimbursementBalance: (...args: unknown[]) => fetchMemberReimbursementBalance(...args),
        fetchMyMemberInvoices: (...args: unknown[]) => fetchMyMemberInvoices(...args),
        fetchPathRewardConfirmation: (...args: unknown[]) => fetchPathRewardConfirmation(...args),
        fetchPathV33MonthlyPreview: (...args: unknown[]) => fetchPathV33MonthlyPreview(...args),
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

const preview: PathV33MonthlyPreview = {
    month: "2026-05",
    member_id: "member-self",
    prior_level: "L2",
    current: {
        level: "L3",
        weight_milli: 1200,
        score: 4.2,
        total_work_days: 18,
        draft_count: 1,
        drafts: [{ site_id: "site-1", tier: 3, work_days: 18 }],
    },
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
    recent_items: [],
};

describe("OwnPayoutModal", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        track.mockClear();
        fetchPathRewardConfirmation.mockResolvedValue(finalizedSummary);
        fetchMyMemberInvoices.mockResolvedValue({ invoices: [] });
        fetchMemberInvoiceDrafts.mockResolvedValue({ drafts: [draft] });
        fetchMemberReimbursementBalance.mockResolvedValue(reimbursementBalance);
        fetchPathV33MonthlyPreview.mockResolvedValue(preview);
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
        expect(screen.getAllByText("￥277,500").length).toBeGreaterThan(0);
        expect(screen.getByText("内訳")).toBeInTheDocument();
        expect(screen.getByText("売上")).toBeInTheDocument();
        expect(screen.getByText("報酬")).toBeInTheDocument();
        expect(screen.getByText("控除")).toBeInTheDocument();
        expect(screen.getByText("源泉徴収")).toBeInTheDocument();
        expect(screen.getByText("対象外")).toBeInTheDocument();
        expect(screen.getByText("立替精算")).toBeInTheDocument();
        expect(screen.getByText("立替戻し")).toBeInTheDocument();
        expect(screen.getByText("￥32,500")).toBeInTheDocument();
        expect(screen.getByText("L3")).toBeInTheDocument();
        expect(screen.getByText("18日")).toBeInTheDocument();

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

        fireEvent.click(screen.getByRole("button", { name: "レベルを修正" }));

        expect(screen.getByRole("dialog", { name: "level revision" })).toBeInTheDocument();
    });
});
