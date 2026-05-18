import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PLReport, ProposalRecord } from "../lib/api";
import { Money } from "./Money";

const approveProposal = vi.fn();
const batchReviewExpenses = vi.fn();
const executeProposal = vi.fn();
const fetchClients = vi.fn();
const fetchExpenseBuckets = vi.fn();
const fetchCashflowSummary = vi.fn();
const fetchMonthlyDeductible = vi.fn();
const fetchPartnersSummary = vi.fn();
const fetchClientCreditSummaries = vi.fn();
const fetchClientCreditMetrics = vi.fn();
const fetchPLTrend = vi.fn();
const fetchPendingApprovals = vi.fn();
const fetchPendingProposals = vi.fn();
const fetchPL = vi.fn();
const fetchTeamRewardSummary = vi.fn();
const fetchMemberReimbursementsSummary = vi.fn();
const fetchDisputeCorrections = vi.fn();
const fetchTransactions = vi.fn();
const fetchPathModuleMonthCloseSummary = vi.fn();
const fetchPathV33OpenObjections = vi.fn();
const expirePathV33MonthObjections = vi.fn();
const finalizePathV33Month = vi.fn();
const lockPathV33MonthDrafts = vi.fn();
const fetchNotifications = vi.fn();
const markNotificationRead = vi.fn();
const instructProposal = vi.fn();
const rejectProposal = vi.fn();
const reviewExpense = vi.fn();
const searchTransactions = vi.fn();
const expenseModal = vi.fn();
const floatingActionButton = vi.fn();
const track = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    useReducedMotion: () => false,
    useMotionValue: (initial: number) => {
        let current = initial;
        return {
            get: () => current,
            set: (v: number) => { current = v; },
            on: () => () => {},
        };
    },
    useTransform: <T,>(_mv: unknown, transformer: (v: number) => T) => transformer(0) as unknown,
    animate: () => ({ stop: () => {} }),
}));

vi.mock("../lib/api", () => ({
    approveProposal: (...args: unknown[]) => approveProposal(...args),
    batchReviewExpenses: (...args: unknown[]) => batchReviewExpenses(...args),
    executeProposal: (...args: unknown[]) => executeProposal(...args),
    fetchClients: (...args: unknown[]) => fetchClients(...args),
    fetchExpenseBuckets: (...args: unknown[]) => fetchExpenseBuckets(...args),
    fetchCashflowSummary: (...args: unknown[]) => fetchCashflowSummary(...args),
    fetchMonthlyDeductible: (...args: unknown[]) => fetchMonthlyDeductible(...args),
    fetchPartnersSummary: (...args: unknown[]) => fetchPartnersSummary(...args),
    fetchClientCreditSummaries: (...args: unknown[]) => fetchClientCreditSummaries(...args),
    fetchClientCreditMetrics: (...args: unknown[]) => fetchClientCreditMetrics(...args),
    fetchPLTrend: (...args: unknown[]) => fetchPLTrend(...args),
    fetchPendingApprovals: (...args: unknown[]) => fetchPendingApprovals(...args),
    fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
    fetchPL: (...args: unknown[]) => fetchPL(...args),
    fetchTeamRewardSummary: (...args: unknown[]) => fetchTeamRewardSummary(...args),
    fetchMemberReimbursementsSummary: (...args: unknown[]) => fetchMemberReimbursementsSummary(...args),
    fetchDisputeCorrections: (...args: unknown[]) => fetchDisputeCorrections(...args),
    fetchTransactions: (...args: unknown[]) => fetchTransactions(...args),
    fetchPathModuleMonthCloseSummary: (...args: unknown[]) => fetchPathModuleMonthCloseSummary(...args),
    fetchPathV33OpenObjections: (...args: unknown[]) => fetchPathV33OpenObjections(...args),
    expirePathV33MonthObjections: (...args: unknown[]) => expirePathV33MonthObjections(...args),
    finalizePathV33Month: (...args: unknown[]) => finalizePathV33Month(...args),
    lockPathV33MonthDrafts: (...args: unknown[]) => lockPathV33MonthDrafts(...args),
    fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
    markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
    instructProposal: (...args: unknown[]) => instructProposal(...args),
    rejectProposal: (...args: unknown[]) => rejectProposal(...args),
    reviewExpense: (...args: unknown[]) => reviewExpense(...args),
    searchTransactions: (...args: unknown[]) => searchTransactions(...args),
    fetchMonthCloseStatus: vi.fn().mockResolvedValue({ month: "2026-05", status: "open" }),
}));

vi.mock("../lib/pathProposal", () => ({
    getPathProposalContext: () => ({ month: "2026-05", memberId: "member-1" }),
    isPathModuleProposal: () => true,
}));

vi.mock("../lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "user-1" } } } }),
        },
    },
}));

vi.mock("../lib/telemetry", () => ({
    track: (...args: unknown[]) => track(...args),
}));

vi.mock("../components/ExpenseModal", () => ({
    ExpenseModal: (props: Record<string, unknown>) => {
        expenseModal(props);
        return null;
    },
}));

vi.mock("../components/MemberInvoiceDraftBanner", () => ({
    MemberInvoiceDraftBanner: () => null,
}));

vi.mock("../components/MyMemberInvoicesList", () => ({
    MyMemberInvoicesList: () => null,
}));

vi.mock("../components/money/ClientCreditStatusSection", () => ({
    ClientCreditStatusSection: () => null,
}));

vi.mock("../components/money/ClientCreditDetailModal", () => ({
    ClientCreditDetailModal: () => null,
}));

vi.mock("../components/OutstandingInvoicesCard", () => ({
    OutstandingInvoicesCard: () => null,
}));

vi.mock("../components/AdminInvoiceActionableList", () => ({
    AdminInvoiceActionableList: () => null,
}));

vi.mock("../components/SalesModal", () => ({
    SalesModal: () => null,
}));

vi.mock("../components/InvoiceModal", () => ({
    InvoiceModal: () => null,
}));

vi.mock("../components/TransactionDetailModal", () => ({
    TransactionDetailModal: () => null,
}));

vi.mock("../components/ApprovalCard", () => ({
    ApprovalCard: () => null,
}));

vi.mock("../components/FloatingActionButton", () => ({
    FloatingActionButton: (props: {
        behavior?: string;
        hideOnDesktop?: boolean;
        buttonLabel?: string;
        onOpen?: () => void;
        items: Array<{ id: string; label: string; onClick: () => void }>;
    }) => {
        floatingActionButton(props);
        return (
            <div data-testid="money-fab">
                {props.items.map((item) => (
                    <button key={item.id} type="button" onClick={item.onClick}>
                        {item.label}
                    </button>
                ))}
            </div>
        );
    },
}));

vi.mock("../components/CashflowBucketStrip", () => ({
    CashflowBucketStrip: () => null,
}));

vi.mock("../components/MonthlyTrendChart", () => ({
    MonthlyTrendChart: () => null,
}));

vi.mock("../components/MoneyTabs", () => ({
    MoneyTabs: () => null,
}));

vi.mock("../components/MoneyFilterSheet", () => ({
    MoneyFilterSheet: () => null,
}));

vi.mock("../components/PartnerSection", () => ({
    PartnerSection: () => null,
}));

vi.mock("../components/PartnerCard", () => ({
    ReceivePartnerCard: () => null,
    PayPartnerCard: () => null,
    DonePartnerCard: () => null,
}));

vi.mock("../components/money/OwnPayoutModal", () => ({
    OwnPayoutModal: ({
        selfMemberId,
        month,
        onClose,
    }: {
        selfMemberId: string;
        month: string;
        onClose: () => void;
    }) => (
        <div role="dialog" aria-label="own reward modal">
            <span>own reward:{selfMemberId}:{month}</span>
            <button type="button" onClick={onClose}>
                close own reward
            </button>
        </div>
    ),
}));

vi.mock("../components/money/OtherPayoutModal", () => ({
    OtherPayoutModal: ({
        memberId,
        month,
        onClose,
    }: {
        memberId: string;
        month: string;
        onClose: () => void;
    }) => (
        <div role="dialog" aria-label="other reward modal">
            <span>other reward:{memberId}:{month}</span>
            <button type="button" onClick={onClose}>
                close other reward
            </button>
        </div>
    ),
}));

vi.mock("../components/ProposalDetailModal", () => ({
    ProposalDetailModal: ({
        proposal,
        onApprove,
        onExecute,
        actionError,
    }: {
        proposal: ProposalRecord;
        onApprove: (proposalId: string, reason?: string) => void;
        onExecute: (proposalId: string) => void;
        actionError?: string | null;
    }) => (
        <div role="dialog" aria-label="proposal detail">
            {proposal.status === "approved" ? (
                <button type="button" onClick={() => onExecute(proposal.id)}>
                    実行する
                </button>
            ) : (
                <button type="button" onClick={() => onApprove(proposal.id, "確認しました")}>
                    承認する
                </button>
            )}
            {actionError && <div role="alert">{actionError}</div>}
        </div>
    ),
}));

const plReport: PLReport = {
    month: "2026-05",
    sales: 1000000,
    expenses: 400000,
    completed_cogs: 300000,
    overhead: 100000,
    work_in_progress: 250000,
    profit: 600000,
    distributable: 420000,
    transaction_count: 0,
};

const pathProposal: ProposalRecord = {
    id: "proposal-path-1",
    org_id: "org-1",
    type: "reward.calculate",
    status: "pending",
    created_by: { type: "human", id: "user-1", name: "ユウト" },
    payload: { path: { month: "2026-05", member_id: "member-1" } },
    description: "PATH報酬を確定する",
    approvals: [],
    required_approvals: 1,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
};

const sherpaProposal: ProposalRecord = {
    ...pathProposal,
    id: "proposal-sherpa-1",
    type: "communication.task",
    created_by: { type: "ai", id: "sherpa", name: "Sherpa" },
    payload: {
        source_message_subject: "追加見積の確認",
        source_message_from: "client@example.com",
    },
    description: "追加見積の返答を準備する",
};

function renderMoney(initialPath = "/money") {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/money" element={<Money />} />
            </Routes>
        </MemoryRouter>,
    );
}

describe("Money PATH proposal queue", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        approveProposal.mockResolvedValue({ proposal: { ...pathProposal, status: "executed" } });
        batchReviewExpenses.mockResolvedValue({ success: [], failed: [] });
        executeProposal.mockResolvedValue({ proposal: { ...pathProposal, status: "executed" } });
        fetchClients.mockResolvedValue([]);
        fetchExpenseBuckets.mockResolvedValue([]);
        fetchCashflowSummary.mockResolvedValue({
            month: "2026-05", unbilled: 0, awaiting_payment: 0, pay_pending: 0, done: 0,
        });
        fetchMonthlyDeductible.mockResolvedValue({
            month: "2026-05",
            gross_subject_amount: 0,
            deductible_amount: 0,
            effective_deduction_rate: 1,
            transitional_phase: "pre-introduction",
            transitional_rate: 1,
            member_count: 0,
        });
        fetchPartnersSummary.mockResolvedValue({ month: "2026-05", receive: [], pay: [], done: [] });
        fetchClientCreditSummaries.mockResolvedValue({ clients: [] });
        fetchClientCreditMetrics.mockResolvedValue(null);
        fetchPLTrend.mockResolvedValue({ months: [], basis: "legacy" });
        fetchPendingApprovals.mockResolvedValue([]);
        fetchPendingProposals.mockResolvedValue([]);
        fetchPL.mockResolvedValue(plReport);
        fetchTeamRewardSummary.mockResolvedValue({
            month: "2026-05",
            self_member_id: "member-1",
            is_finalized: true,
            members: [],
        });
        fetchMemberReimbursementsSummary.mockResolvedValue({
            month: "2026-05",
            self_member_id: "member-1",
            members: [],
        });
        fetchDisputeCorrections.mockResolvedValue([]);
        fetchTransactions.mockResolvedValue([]);
        fetchPathModuleMonthCloseSummary.mockResolvedValue({
            month: "2026-05",
            closes: [],
            reward_runs: [],
            eligible_closes: [],
        });
        fetchPathV33OpenObjections.mockResolvedValue([]);
        expirePathV33MonthObjections.mockResolvedValue({ month: "2026-05", expired_objection_count: 0 });
        finalizePathV33Month.mockResolvedValue({ month: "2026-05", members: [] });
        lockPathV33MonthDrafts.mockResolvedValue({ month: "2026-05", locked_draft_count: 0, recounted_drafts: 0 });
        fetchNotifications.mockResolvedValue([]);
        markNotificationRead.mockResolvedValue(null);
        instructProposal.mockResolvedValue({ proposal: pathProposal });
        rejectProposal.mockResolvedValue({ proposal: { ...pathProposal, status: "rejected" } });
        reviewExpense.mockResolvedValue({ transaction: null });
        searchTransactions.mockResolvedValue([]);
        expenseModal.mockClear();
        floatingActionButton.mockClear();
        track.mockClear();
    });

    it("keeps the Money page visible when the post-approval background refresh fails", async () => {
        fetchPendingProposals
            .mockResolvedValueOnce([pathProposal])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        fetchPL.mockResolvedValueOnce(plReport).mockRejectedValueOnce(new Error("background refresh failed"));

        renderMoney(`/money?proposal=${pathProposal.id}`);

        await screen.findByRole("dialog", { name: "proposal detail" });
        fireEvent.click(screen.getByRole("button", { name: "承認する" }));

        await waitFor(() => expect(approveProposal).toHaveBeenCalledWith("proposal-path-1", "確認しました"));
        await waitFor(() => expect(fetchPL.mock.calls.length).toBeGreaterThanOrEqual(2));

        expect(screen.queryByText("読み込みに失敗しました")).not.toBeInTheDocument();
        expect(screen.getByLabelText("会社の月次サマリー")).toBeInTheDocument();
    });

    it("shows PATH action failures in the modal without replacing the Money page", async () => {
        fetchPendingProposals.mockResolvedValueOnce([pathProposal]).mockResolvedValueOnce([]);
        approveProposal.mockRejectedValueOnce(new Error("承認結果の同期に失敗しました"));

        renderMoney(`/money?proposal=${pathProposal.id}`);

        await screen.findByRole("dialog", { name: "proposal detail" });
        fireEvent.click(screen.getByRole("button", { name: "承認する" }));

        await screen.findByRole("alert");

        expect(screen.getByText("承認結果の同期に失敗しました")).toBeInTheDocument();
        expect(screen.queryByText("読み込みに失敗しました")).not.toBeInTheDocument();
        expect(screen.getByLabelText("会社の月次サマリー")).toBeInTheDocument();
    });

    it("opens AI/integration proposals via the deep link entry point", async () => {
        fetchPendingProposals.mockResolvedValueOnce([sherpaProposal]);

        renderMoney(`/money?proposal=${sherpaProposal.id}`);

        await screen.findByRole("dialog", { name: "proposal detail" });
        // Modal received the Sherpa proposal — approve button rendered means the proposal payload reached the detail handler.
        expect(screen.getByRole("button", { name: "承認する" })).toBeInTheDocument();
    });

    it("opens the own reward modal from modal=reward when member is self", async () => {
        renderMoney("/money?modal=reward&member=member-1&period=2026-04&site=site-1");

        expect(await screen.findByRole("dialog", { name: "own reward modal" })).toBeInTheDocument();
        expect(screen.getByText("own reward:member-1:2026-04")).toBeInTheDocument();
    });

    it("opens the other reward modal from modal=reward when member is not self", async () => {
        renderMoney("/money?modal=reward&member=member-2&period=2026-04&site=site-1");

        expect(await screen.findByRole("dialog", { name: "other reward modal" })).toBeInTheDocument();
        expect(screen.getByText("other reward:member-2:2026-04")).toBeInTheDocument();
    });

    it("falls back to the own reward modal for reward links without member", async () => {
        renderMoney("/money?modal=reward&period=2026-04&site=site-1");

        expect(await screen.findByRole("dialog", { name: "own reward modal" })).toBeInTheDocument();
        expect(screen.getByText("own reward:member-1:2026-04")).toBeInTheDocument();
    });

    it("uses the shared FAB as the only Money creation entry", async () => {
        renderMoney();

        await screen.findByTestId("money-fab");

        expect(screen.queryByText("請求書を作る")).not.toBeInTheDocument();
        expect(floatingActionButton).toHaveBeenCalled();
        const props = floatingActionButton.mock.calls.at(-1)?.[0];
        expect(props).toMatchObject({
            behavior: "draggable",
            buttonLabel: "追加",
        });
        expect(props?.hideOnDesktop).toBeUndefined();
        expect(props?.items.map((item: { label: string }) => item.label)).toEqual([
            "経費・立替を記録",
            "売上を記録",
            "請求書を発行",
        ]);

        props?.onOpen?.();
        expect(track).toHaveBeenCalledWith({
            type: "money.fab.clicked",
            from_tab: "transactions",
        });

        fireEvent.click(screen.getByRole("button", { name: "請求書を発行" }));
        expect(track).toHaveBeenCalledWith({
            type: "money.fab.option_clicked",
            option: "invoice",
        });
    });

    it("passes the self reimbursement member id into ExpenseModal", async () => {
        renderMoney();

        await waitFor(() => {
            expect(expenseModal).toHaveBeenLastCalledWith(
                expect.objectContaining({ defaultClaimantMemberId: "member-1" }),
            );
        });
    });

    it("keeps an approved proposal open so execution can happen from the same detail", async () => {
        fetchPendingProposals.mockResolvedValueOnce([pathProposal]).mockResolvedValueOnce([]);
        approveProposal.mockResolvedValueOnce({
            proposal: { ...pathProposal, status: "approved", approvals: [{ actor: pathProposal.created_by, decision: "approve", at: "2026-05-05T00:00:00.000Z" }] },
            is_fully_approved: true,
            auto_executed: false,
        });

        renderMoney(`/money?proposal=${pathProposal.id}`);

        await screen.findByRole("dialog", { name: "proposal detail" });
        fireEvent.click(screen.getByRole("button", { name: "承認する" }));

        expect(await screen.findByRole("button", { name: "実行する" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "実行する" }));

        await waitFor(() => expect(executeProposal).toHaveBeenCalledWith("proposal-path-1"));
    });
});
