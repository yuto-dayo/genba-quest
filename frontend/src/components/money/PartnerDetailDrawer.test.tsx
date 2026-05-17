import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AccountingInvoiceListItem } from "../../lib/api";
import { PartnerDetailDrawer } from "./PartnerDetailDrawer";

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"aside">) => <aside {...props}>{children}</aside>,
        },
    ),
    useReducedMotion: () => true,
}));

const invoice = {
    id: "inv-1",
    transaction_id: "tx-1",
    invoice_no: "INV-2026-001",
    document_type: "standard_invoice",
    issue_date: "2026-05-01",
    due_date: "2026-05-10",
    billing_name: "株式会社テスト",
    pdf_render_status: "generated",
    created_by: "user-1",
    created_at: "2026-05-01T00:00:00.000Z",
    source_summary: {
        source_count: 1,
        site_count: 0,
        period_start: "2026-05-01",
        period_end: "2026-05-01",
        site_names: [],
        amount_subtotal: 90000,
        tax_amount: 9000,
        amount_total: 99000,
        currency: "JPY",
    },
    invoice_bucket: "overdue",
    is_overdue: true,
    days_until_due: -7,
} satisfies AccountingInvoiceListItem;

describe("PartnerDetailDrawer", () => {
    it("renders invoice timeline and payment action", () => {
        const onRecordPayment = vi.fn();

        render(
            <PartnerDetailDrawer
                open
                partnerName="株式会社テスト"
                invoices={[invoice]}
                onClose={vi.fn()}
                onRecordPayment={onRecordPayment}
            />,
        );

        expect(screen.getByRole("dialog", { name: "株式会社テスト" })).toBeInTheDocument();
        expect(screen.getByText("INV-2026-001")).toBeInTheDocument();
        expect(screen.getByText("期限超過")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "入金を記録" }));

        expect(onRecordPayment).toHaveBeenCalledWith(invoice);
    });

    it("uses an inline empty state without a create-invoice CTA", () => {
        render(
            <PartnerDetailDrawer
                open
                partnerName="株式会社空"
                invoices={[]}
                onClose={vi.fn()}
            />,
        );

        expect(screen.getByText("該当する請求書はありません")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /新規請求書/ })).not.toBeInTheDocument();
    });
});
