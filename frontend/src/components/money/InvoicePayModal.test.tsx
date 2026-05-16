import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InvoicePayModal } from "./InvoicePayModal";
import {
    fetchInvoicePayoutDetail,
    markInvoicePaid,
    markNotificationRead,
} from "../../lib/api";

vi.mock("../../lib/api", () => ({
    fetchInvoicePayoutDetail: vi.fn(),
    markInvoicePaid: vi.fn(),
    markNotificationRead: vi.fn(),
}));

const detail = {
    invoice_id: "invoice-1",
    invoice_no: "MI-2026-001",
    amount: 120000,
    issued_at: "2026-05-10T00:00:00.000Z",
    snapshot: {
        bank_name: "現場銀行",
        branch_name: "本店",
        account_type: "ordinary",
        account_number: "1234567",
        account_holder: "ゲンバ タロウ",
        real_name: "現場 太郎",
        tax_id: "T1234567890123",
    },
    body_html: "",
    line_items: [],
    expires_at: "2099-05-20T00:00:00.000Z",
    self_member_id: "reviewer-1",
    is_self: false,
    is_reviewer: true,
};

describe("InvoicePayModal", () => {
    beforeEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
        vi.mocked(fetchInvoicePayoutDetail).mockResolvedValue(detail);
        vi.mocked(markInvoicePaid).mockResolvedValue({
            proposal: {} as never,
            invoice: null,
            assignment: {} as never,
            self_member_id: "reviewer-1",
            is_self: false,
        });
        vi.mocked(markNotificationRead).mockResolvedValue({} as never);
    });

    it("shows payout details and marks the invoice paid after confirmation", async () => {
        const onClose = vi.fn();
        const onCompleted = vi.fn();

        render(
            <InvoicePayModal
                invoiceId="invoice-1"
                notificationId="notification-1"
                onClose={onClose}
                onCompleted={onCompleted}
            />,
        );

        expect(await screen.findByText("請求書の支払い")).toBeInTheDocument();
        expect(screen.getAllByText("現場 太郎").length).toBeGreaterThan(0);
        expect(screen.getByText("¥120,000")).toBeInTheDocument();
        expect(screen.getByText("T1234567890123")).toBeInTheDocument();
        expect(screen.getByText("1234567")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "支払い済みにする" }));
        expect(screen.getByText("銀行への振込は完了しましたか？")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "はい、支払い済みにする" }));

        await waitFor(() => {
            expect(markInvoicePaid).toHaveBeenCalledWith(
                "invoice-1",
                expect.objectContaining({ paid_at: expect.any(String) }),
            );
        });
        expect(markNotificationRead).toHaveBeenCalledWith("notification-1");
        expect(onCompleted).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it("shows the expired message for a 403 expired assignment", async () => {
        vi.mocked(fetchInvoicePayoutDetail).mockRejectedValue(
            new Error("INVOICE_REVIEW_ASSIGNMENT_EXPIRED"),
        );

        render(<InvoicePayModal invoiceId="invoice-1" onClose={vi.fn()} />);

        expect(await screen.findByText("閲覧期間が終了しました")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "支払い済みにする" })).toBeDisabled();
    });

    it("schedules payout detail refetch every five minutes", async () => {
        const intervalSpy = vi.spyOn(window, "setInterval");

        render(<InvoicePayModal invoiceId="invoice-1" onClose={vi.fn()} />);

        expect((await screen.findAllByText("現場 太郎")).length).toBeGreaterThan(0);
        expect(fetchInvoicePayoutDetail).toHaveBeenCalledTimes(1);
        expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1000);
    });
});
