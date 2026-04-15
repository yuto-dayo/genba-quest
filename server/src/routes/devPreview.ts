import { Router, type Request, type Response } from "express";
import { buildInvoicePdfBuffer } from "../services/InvoicePdfService";
import { type InvoiceHtmlContext } from "../services/InvoiceHtmlTemplate";

const router = Router();

function buildSasakiSampleContext(): InvoiceHtmlContext {
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
            billing_name: "佐々木様",
            billing_address: "〒150-0001\n東京都渋谷区神宮前1-2-3\n03-1234-5678",
            notes: "この度はお仕事をご依頼いただき、ありがとうございました。\n今後ともよろしくお願いいたします。\n\n吉野悠人",
            registration_number_snapshot: null,
            issuer_snapshot: {
                issuer_name: "PATH. インテリア",
                issuer_address: "〒179-0071\n東京都練馬区旭町2-11-4",
                issuer_contact: "070-4398-7578",
                bank_account_text: "楽天銀行 アリア支店\n口座番号: 2017847\n名義: ヨシノ　ユウト",
                invoice_notes_default: null,
            },
            tax_summary_snapshot: {
                by_rate: [{ tax_rate: 0.1, tax_amount: 48200 } as any],
                currency: "JPY",
            },
        },
        transaction: {
            description: "佐々木様邸 内装工事",
            amount_subtotal: 482000,
            tax_amount: 48200,
            amount_total: 530200,
            currency: "JPY",
            site: { name: "佐々木様邸" },
            client: { name: "佐々木様" },
        },
        items: [
            { item_name: "佐々木様邸　クロス工事", quantity: 320, unit_name: "㎡", unit_price: 700 },
            { item_name: "佐々木様邸　床工事", quantity: 6, unit_name: "人工", unit_price: 28000 },
            { item_name: "佐々木様邸　建具調整", quantity: 2, unit_name: "人工", unit_price: 28000 },
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
        const context = buildSasakiSampleContext();
        const pdfBuffer = await buildInvoicePdfBuffer(context);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(pdfBuffer.byteLength));
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader(
            "Content-Disposition",
            `inline; filename="sasaki-invoice-preview.pdf"`
        );
        res.send(pdfBuffer);
    } catch (err: any) {
        console.error("Invoice preview error:", err);
        res.status(500).json({ error: "Failed to render invoice preview" });
    }
});

export default router;
