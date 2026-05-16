import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type MemberReimbursementBalance,
    type MemberReimbursementsSummary,
} from "../../lib/api";
import { ExpenseDetailModal } from "./ExpenseDetailModal";
import { TeamExpenseSummaryModal } from "./TeamExpenseSummaryModal";

const fetchMemberReimbursementBalance = vi.fn();
const fetchMemberReimbursementsSummary = vi.fn();

vi.mock("../../lib/api", () => ({
    fetchMemberReimbursementBalance: (...args: unknown[]) => fetchMemberReimbursementBalance(...args),
    fetchMemberReimbursementsSummary: (...args: unknown[]) => fetchMemberReimbursementsSummary(...args),
}));

vi.mock("../ExpenseModal", () => ({
    ExpenseModal: ({
        open,
        onSuccess,
    }: {
        open: boolean;
        onSuccess: () => void;
    }) => open ? (
        <div role="dialog" aria-label="expense modal">
            <button type="button" onClick={onSuccess}>
                経費追加完了
            </button>
        </div>
    ) : null,
}));

const balance: MemberReimbursementBalance = {
    member_id: "member-self",
    month: "2026-05",
    total_advanced: 45200,
    unsettled: 33200,
    settled: 12000,
    by_status: {
        unsubmitted: 12000,
        submitted: 8200,
        approved: 13000,
        reimbursed: 12000,
    },
    recent_items: [
        {
            id: "expense-1",
            occurred_on: "2026-05-12",
            category: "parking",
            amount: 12000,
            reimbursement_status: "unsubmitted",
        },
        {
            id: "expense-2",
            occurred_on: "2026-05-10",
            category: "fuel",
            amount: 8200,
            reimbursement_status: "submitted",
        },
    ],
};

const summary: MemberReimbursementsSummary = {
    month: "2026-05",
    self_member_id: "member-self",
    members: [
        {
            member_id: "member-self",
            nickname: "自分",
            total_advanced: 45200,
            unsettled: 33200,
            settled: 12000,
            count_pending: 3,
            status: "pending",
        },
        {
            member_id: "member-other",
            nickname: "田中",
            total_advanced: 12000,
            unsettled: 12000,
            settled: 0,
            count_pending: 1,
            status: "in_review",
        },
    ],
};

describe("ExpenseDetailModal", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        fetchMemberReimbursementBalance.mockResolvedValue(balance);
        fetchMemberReimbursementsSummary.mockResolvedValue(summary);
    });

    it("shows reimbursement details and opens inline expense modal for self", async () => {
        const onExpenseAdded = vi.fn();

        render(
            <ExpenseDetailModal
                memberId="member-self"
                selfMemberId="member-self"
                month="2026-05"
                onClose={vi.fn()}
                onExpenseAdded={onExpenseAdded}
            />,
        );

        expect(await screen.findByText("合計立替")).toBeInTheDocument();
        expect(screen.getByText("￥45,200")).toBeInTheDocument();
        expect(screen.getByText("未精算")).toBeInTheDocument();
        expect(screen.getByText("精算済")).toBeInTheDocument();
        expect(screen.getAllByText("申請待ち").length).toBeGreaterThan(0);
        expect(screen.getAllByText("申請済").length).toBeGreaterThan(0);
        expect(screen.getByText("駐車")).toBeInTheDocument();
        expect(screen.getByText("ガソリン")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "経費を追加" }));
        fireEvent.click(await screen.findByRole("button", { name: "経費追加完了" }));

        await waitFor(() => expect(fetchMemberReimbursementBalance).toHaveBeenCalledTimes(2));
        expect(onExpenseAdded).toHaveBeenCalledTimes(1);
        expect(await screen.findByText("経費を追加しました")).toBeInTheDocument();
    });

    it("hides the add expense action for other members", async () => {
        render(
            <ExpenseDetailModal
                memberId="member-other"
                selfMemberId="member-self"
                month="2026-05"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("合計立替")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "経費を追加" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "閉じる" }).length).toBeGreaterThan(0);
    });

    it("calls onExpenseClicked from the team expense summary", async () => {
        const onExpenseClicked = vi.fn();

        render(
            <TeamExpenseSummaryModal
                month="2026-05"
                onClose={vi.fn()}
                onExpenseClicked={onExpenseClicked}
            />,
        );

        const otherRow = await screen.findByRole("button", { name: /田中/ });
        fireEvent.click(otherRow);

        expect(onExpenseClicked).toHaveBeenCalledWith("member-other");
    });
});
