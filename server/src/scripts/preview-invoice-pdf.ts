import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { renderInvoiceHtml, type InvoiceHtmlContext } from "../services/InvoiceHtmlTemplate";

const OUTPUT_DIR = path.resolve(__dirname, "../../../tmp");

const sampleContext: InvoiceHtmlContext = {
    invoice: {
        invoice_no: "INV-2026-03-001",
        document_type: "standard_invoice",
        issue_date: "2026-04-08",
        due_date: "2026-05-31",
        billing_name: "株式会社Grit",
        billing_address: "〒179-0074\n東京都練馬区春日町4-25-23\n03-6770-0613",
        notes: "現在、適格請求書発行事業者の登録申請中です。\n登録番号取得後、適格請求書を再発行いたします。\n今後ともよろしくお願いします。\n\n吉野悠人",
        registration_number_snapshot: null,
        issuer_snapshot: {
            issuer_name: "PATH. インテリア",
            issuer_address: "〒179-0071\n東京都練馬区旭町2-11-4",
            issuer_contact: "070-4398-7578",
            bank_account_text: "楽天銀行 アリア支店\n口座番号: 2017847\n名義: ヨシノ　ユウト",
            invoice_notes_default: null,
        },
        tax_summary_snapshot: {
            by_rate: [{ tax_rate: 0.1, tax_amount: 99036, subtotal: 1019935 } as any],
            currency: "JPY",
        },
    },
    transaction: {
        description: "2026年3月分 作業請求",
        amount_subtotal: 1019935,
        tax_amount: 99036,
        amount_total: 1118971,
        currency: "JPY",
        site: { name: null },
        client: { name: "株式会社Grit" },
    },
    items: [
        { item_name: "南馬込現場　クロス工事", quantity: 662.1, unit_name: "㎡", unit_price: 650 },
        { item_name: "南馬込現場　床工事", quantity: 8, unit_name: "人工", unit_price: 28000 },
        { item_name: "23日(西葛西、高田馬場)現場", quantity: 3, unit_name: "人工", unit_price: 28000 },
        { item_name: "24日　高田馬場現場", quantity: 3, unit_name: "人工", unit_price: 28000 },
        { item_name: "27日　高田馬場現場", quantity: 2, unit_name: "人工", unit_price: 28000 },
        { item_name: "28日　高田馬場現場", quantity: 2, unit_name: "人工", unit_price: 28000 },
        { item_name: "31日　ノーチラス　渋谷現場", quantity: 2, unit_name: "人工", unit_price: 28000 },
        { item_name: "駐車場代", quantity: 1, unit_name: "", unit_price: 29570 },
    ],
};

async function main() {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    const html = renderInvoiceHtml(sampleContext);
    fs.writeFileSync(path.join(OUTPUT_DIR, "invoice-preview.html"), html);

    const browser = await puppeteer.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "networkidle0" });
        await page.evaluateHandle("document.fonts.ready");
        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            preferCSSPageSize: true,
            margin: { top: "0", right: "0", bottom: "0", left: "0" },
        });
        const outPath = path.join(OUTPUT_DIR, "invoice-preview.pdf");
        fs.writeFileSync(outPath, Buffer.from(pdf));
        console.log(`Wrote: ${outPath} (${pdf.length} bytes)`);
        console.log(`HTML:  ${path.join(OUTPUT_DIR, "invoice-preview.html")}`);
    } finally {
        await browser.close();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
