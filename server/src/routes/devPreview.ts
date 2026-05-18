import { Router, type Request, type Response } from "express";
import { buildInvoicePdfBuffer } from "../services/InvoicePdfService";
import { type InvoiceHtmlContext } from "../services/InvoiceHtmlTemplate";

const router = Router();

function buildSampleInvoiceContext(): InvoiceHtmlContext {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");

    return {
        invoice: {
            invoice_no: `PREVIEW-${yyyy}${mm}${dd}`,
            document_type: "standard_invoice",
            issue_date: `${yyyy}-${mm}-${dd}`,
            due_date: null,
            billing_name: "サンプル様",
            billing_address: "〒000-0000\nサンプル県サンプル市1-2-3\n00-0000-0000",
            notes: "この度はお仕事をご依頼いただき、ありがとうございました。\n今後ともよろしくお願いいたします。\n\nサンプル",
            registration_number_snapshot: null,
            issuer_snapshot: {
                issuer_name: "GENBA QUEST デモ",
                issuer_address: "〒000-0000\nサンプル県サンプル市1-2-3",
                issuer_contact: "000-0000-0000",
                bank_account_text: "サンプル銀行 サンプル支店\n口座番号: 0000000\n名義: サンプル",
                invoice_notes_default: null,
            },
            tax_summary_snapshot: {
                by_rate: [{ tax_rate: 0.1, tax_amount: 48200 } as any],
                currency: "JPY",
            },
        },
        transaction: {
            description: "サンプル現場 内装工事",
            amount_subtotal: 482000,
            tax_amount: 48200,
            amount_total: 530200,
            currency: "JPY",
            site: { name: "サンプル現場" },
            client: { name: "サンプル様" },
        },
        items: [
            { item_name: "サンプル現場　クロス工事", quantity: 320, unit_name: "㎡", unit_price: 700 },
            { item_name: "サンプル現場　床工事", quantity: 6, unit_name: "人工", unit_price: 28000 },
            { item_name: "サンプル現場　建具調整", quantity: 2, unit_name: "人工", unit_price: 28000 },
            { item_name: "資材運搬費", quantity: 1, unit_name: "式", unit_price: 18000 },
            { item_name: "駐車場代", quantity: 1, unit_name: "", unit_price: 6000 },
        ],
    };
}

router.get("/invoice-preview.pdf", async (_req: Request, res: Response) => {
    if (process.env.NODE_ENV === "production") {
        res.status(404).json({ error: "Not found" });
        return;
    }

    try {
        const context = buildSampleInvoiceContext();
        const pdfBuffer = await buildInvoicePdfBuffer(context);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(pdfBuffer.byteLength));
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader(
            "Content-Disposition",
            `inline; filename="sample-invoice-preview.pdf"`
        );
        res.send(pdfBuffer);
    } catch (err: any) {
        console.error("Invoice preview error:", err);
        res.status(500).json({ error: "Failed to render invoice preview" });
    }
});

export default router;
