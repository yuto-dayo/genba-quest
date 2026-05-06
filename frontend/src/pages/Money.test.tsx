import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PLReport, ProposalRecord } from "../lib/api";
import { Money } from "./Money";

const approveProposal = vi.fn();
const batchReviewExpenses = vi.fn();
const executeProposal = vi.fn();
const fetchPendingApprovals = vi.fn();
const fetchPendingProposals = vi.fn();
const fetchPL = vi.fn();
const fetchTransactions = vi.fn();
const instructProposal = vi.fn();
const rejectProposal = vi.fn();
const searchTransactions = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({
    approveProposal: (...args: unknown[]) => approveProposal(...args),
    batchReviewExpenses: (...args: unknown[]) => batchReviewExpenses(...args),
    executeProposal: (...args: unknown[]) => executeProposal(...args),
    fetchPendingApprovals: (...args: unknown[]) => fetchPendingApprovals(...args),
    fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
    fetchPL: (...args: unknown[]) => fetchPL(...args),
    fetchTransactions: (...args: unknown[]) => fetchTransactions(...args),
    instructProposal: (...args: unknown[]) => instructProposal(...args),
    rejectProposal: (...args: unknown[]) => rejectProposal(...args),
    searchTransactions: (...args: unknown[]) => searchTransactions(...args),
}));

vi.mock("../lib/pathProposal", () => ({
    getPathProposalContext: () => ({ month: "2026-05", memberId: "member-1" }),
    isPathModuleProposal: () => true,
}));

vi.mock("../components/ExpenseModal", () => ({
    ExpenseModal: () => null,
}));

vi.mock("../components/SalesModal", () => ({
    SalesModal: () => null,
}));

vi.mock("../components/InvoiceModal", () => ({
    InvoiceModal: () => null,
}));

vi.mock("../components/InvoiceListPanel", () => ({
    InvoiceListPanel: () => <div data-testid="invoice-list-panel" />,
}));

vi.mock("../components/TransactionDetailModal", () => ({
    TransactionDetailModal: () => null,
}));

vi.mock("../components/ApprovalCard", () => ({
    ApprovalCard: () => null,
}));

vi.mock("../components/FloatingActionButton", () => ({
    FloatingActionButton: () => null,
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

function renderMoney() {
    return render(
        <MemoryRouter initialEntries={["/money"]}>
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
        fetchPendingApprovals.mockResolvedValue([]);
        fetchPendingProposals.mockResolvedValue([]);
        fetchPL.mockResolvedValue(plReport);
        fetchTransactions.mockResolvedValue([]);
        instructProposal.mockResolvedValue({ proposal: pathProposal });
        rejectProposal.mockResolvedValue({ proposal: { ...pathProposal, status: "rejected" } });
        searchTransactions.mockResolvedValue([]);
    });

    it("keeps the Money page visible when the post-approval background refresh fails", async () => {
        fetchPendingProposals
            .mockResolvedValueOnce([pathProposal])
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([]);
        fetchPL.mockResolvedValueOnce(plReport).mockRejectedValueOnce(new Error("background refresh failed"));

        renderMoney();

        await screen.findByText("承認待ち Proposal");
        fireEvent.click(screen.getByRole("button", { name: /PATH報酬を確定する/ }));
        fireEvent.click(screen.getByRole("button", { name: "承認する" }));

        await waitFor(() => expect(approveProposal).toHaveBeenCalledWith("proposal-path-1", "確認しました"));
        await waitFor(() => expect(fetchPL).toHaveBeenCalledTimes(2));

        expect(screen.queryByText("読み込みに失敗しました")).not.toBeInTheDocument();
        expect(screen.getByText("お金の流れ")).toBeInTheDocument();
    });

    it("shows PATH action failures in the modal without replacing the Money page", async () => {
        fetchPendingProposals.mockResolvedValueOnce([pathProposal]).mockResolvedValueOnce([]);
        approveProposal.mockRejectedValueOnce(new Error("承認結果の同期に失敗しました"));

        renderMoney();

        await screen.findByText("承認待ち Proposal");
        fireEvent.click(screen.getByRole("button", { name: /PATH報酬を確定する/ }));
        fireEvent.click(screen.getByRole("button", { name: "承認する" }));

        await screen.findByRole("alert");

        expect(screen.getByText("承認結果の同期に失敗しました")).toBeInTheDocument();
        expect(screen.queryByText("読み込みに失敗しました")).not.toBeInTheDocument();
        expect(screen.getByText("お金の流れ")).toBeInTheDocument();
    });

    it("surfaces Sherpa and integration proposals in the Money approval queue", async () => {
        fetchPendingProposals.mockResolvedValueOnce([sherpaProposal]);

        renderMoney();

        await screen.findByText("承認待ち Proposal");

        expect(screen.getByText("追加見積の返答を準備する")).toBeInTheDocument();
        expect(screen.getByText(/AI Sherpa/)).toBeInTheDocument();
        expect(screen.getByText("メール対応タスク")).toBeInTheDocument();
    });

    it("keeps an approved proposal open so execution can happen from the same detail", async () => {
        fetchPendingProposals.mockResolvedValueOnce([pathProposal]).mockResolvedValueOnce([]);
        approveProposal.mockResolvedValueOnce({
            proposal: { ...pathProposal, status: "approved", approvals: [{ actor: pathProposal.created_by, decision: "approve", at: "2026-05-05T00:00:00.000Z" }] },
            is_fully_approved: true,
            auto_executed: false,
        });

        renderMoney();

        await screen.findByText("承認待ち Proposal");
        fireEvent.click(screen.getByRole("button", { name: /PATH報酬を確定する/ }));
        fireEvent.click(screen.getByRole("button", { name: "承認する" }));

        expect(await screen.findByRole("button", { name: "実行する" })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "実行する" }));

        await waitFor(() => expect(executeProposal).toHaveBeenCalledWith("proposal-path-1"));
    });
});
