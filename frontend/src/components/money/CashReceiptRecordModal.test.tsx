import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CashReceiptRecordModal } from "./CashReceiptRecordModal";
import { submitCashReceiptProposal, type ClientInvoiceWithReceipts } from "../../lib/api";

vi.mock("../../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
    return {
        ...actual,
        submitCashReceiptProposal: vi.fn(),
    };
});

const invoice: ClientInvoiceWithReceipts = {
    id: "invoice-1",
    transaction_id: "tx-1",
    source_transaction_id: "tx-1",
    invoice_no: "INV-001",
    status: "issued",
    invoice_bucket: "this_week",
    is_overdue: false,
    days_until_due: 2,
    issue_date: "2026-05-10",
    due_date: "2026-05-20",
    created_by: "user-1",
    created_at: "2026-05-10T00:00:00.000Z",
    source_summary: {
        source_count: 1,
        site_count: 1,
        client_id: "11111111-1111-4111-8111-111111111111",
        client_name: "A社",
        site_names: ["A邸"],
        amount_subtotal: 90909,
        tax_amount: 9091,
        amount_total: 100000,
        currency: "JPY",
    },
    source_transaction: {
        id: "22222222-2222-4222-8222-222222222222",
        amount_total: 100000,
        status: "posted",
        recorded_date: "2026-05-10",
        client: { id: "11111111-1111-4111-8111-111111111111", name: "A社" },
        site: { id: "site-1", name: "A邸" },
    },
    cash_receipts: [],
};

describe("CashReceiptRecordModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(submitCashReceiptProposal).mockResolvedValue({ proposal: {} as never });
    });

    it("calculates variance from the received amount and submits a cash receipt proposal", async () => {
        const onClose = vi.fn();
        const onSubmitted = vi.fn();

        render(
            <CashReceiptRecordModal
                invoice={invoice}
                candidateInvoices={[invoice]}
                onClose={onClose}
                onSubmitted={onSubmitted}
            />,
        );

        fireEvent.change(screen.getByLabelText("実際の振込額"), {
            target: { value: "99,560" },
        });

        expect(screen.getByText("¥440")).toBeInTheDocument();
        expect(screen.getByRole("radio", { name: "振込手数料" })).toBeChecked();

        fireEvent.click(screen.getByRole("button", { name: "確認" }));

        await waitFor(() => {
            expect(submitCashReceiptProposal).toHaveBeenCalledWith(expect.objectContaining({
                client_id: "11111111-1111-4111-8111-111111111111",
                received_amount: 99560,
                variance_reason: "fee_deduction",
                allocations: [{
                    invoice_transaction_id: "22222222-2222-4222-8222-222222222222",
                    allocated_amount: 99560,
                }],
            }));
        });
        expect(onSubmitted).toHaveBeenCalled();
        expect(onClose).toHaveBeenCalled();
    });

    it("blocks confirmation when allocations exceed the received amount", () => {
        render(
            <CashReceiptRecordModal
                invoice={invoice}
                candidateInvoices={[invoice]}
                onClose={vi.fn()}
            />,
        );

        fireEvent.change(screen.getByLabelText("実際の振込額"), {
            target: { value: "99,560" },
        });
        fireEvent.change(screen.getByLabelText("配賦額"), {
            target: { value: "100,001" },
        });

        expect(screen.getByText("配賦合計は実入金額以下にしてください")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "確認" })).toBeDisabled();
    });
});
