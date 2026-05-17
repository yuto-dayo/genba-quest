import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseModal } from "./ExpenseModal";

const createExpense = vi.fn();
const fetchMembers = vi.fn();
const fetchSites = vi.fn();
const fetchTransactions = vi.fn();

vi.mock("../lib/api", () => ({
    uploadDocument: vi.fn(),
    analyzeDocumentOcr: vi.fn(),
    createExpense: (...args: unknown[]) => createExpense(...args),
    fetchMembers: (...args: unknown[]) => fetchMembers(...args),
    fetchSites: (...args: unknown[]) => fetchSites(...args),
    fetchTransactions: (...args: unknown[]) => fetchTransactions(...args),
}));

vi.mock("./BottomSheet", () => ({
    BottomSheet: ({
        open,
        ariaLabel,
        children,
    }: {
        open: boolean;
        ariaLabel: string;
        children: ReactNode;
    }) => open ? (
        <div role="dialog" aria-label={ariaLabel}>
            {children}
        </div>
    ) : null,
}));

vi.mock("./JournalPreview", () => ({
    JournalPreview: () => <div data-testid="journal-preview" />,
}));

vi.mock("./OcrHighlight", () => ({
    OcrHighlight: () => <div data-testid="ocr-highlight" />,
}));

describe("ExpenseModal paid_by", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createExpense.mockResolvedValue({ id: "expense-1" });
        fetchTransactions.mockResolvedValue([]);
        fetchSites.mockResolvedValue([]);
        fetchMembers.mockResolvedValue([
            {
                id: "member-self",
                user_id: "user-self",
                status: "active",
                display_name: "自分",
                full_name: "現場 太郎",
                username: "taro",
                avatar_url: null,
            },
        ]);
    });

    it("submits member-paid reimbursement fields without losing existing form input", async () => {
        const onSuccess = vi.fn();
        render(
            <ExpenseModal
                open
                onClose={vi.fn()}
                onSuccess={onSuccess}
                initialCostCenter="HQ"
                initialAmountTotal="1200"
                defaultClaimantMemberId="member-self"
            />,
        );

        fireEvent.change(screen.getByPlaceholderText("店舗名・会社名"), {
            target: { value: "工具店" },
        });
        fireEvent.click(screen.getByRole("button", { name: "立替" }));
        await screen.findByDisplayValue("自分");
        fireEvent.change(screen.getByDisplayValue("未指定"), {
            target: { value: "bank" },
        });
        fireEvent.click(screen.getByRole("button", { name: "登録" }));

        await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
        expect(createExpense).toHaveBeenCalledWith(
            expect.objectContaining({
                vendor_name: "工具店",
                paid_by: "member",
                claimant_member_id: "member-self",
                settlement_type: "unpaid",
                payment_account: "bank",
                reimbursement_status: "unsubmitted",
            }),
        );
        expect(onSuccess).toHaveBeenCalledTimes(1);
    });

    it("disables submit when member-paid has no active claimant", async () => {
        fetchMembers.mockResolvedValueOnce([]);

        render(
            <ExpenseModal
                open
                onClose={vi.fn()}
                onSuccess={vi.fn()}
                initialCostCenter="HQ"
                initialAmountTotal="1200"
            />,
        );

        fireEvent.click(screen.getByRole("button", { name: "立替" }));

        expect(screen.getByRole("button", { name: "登録" })).toBeDisabled();
    });
});
