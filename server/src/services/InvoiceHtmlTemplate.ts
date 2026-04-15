import {
    type InvoiceSourceSummarySnapshot,
    type InvoiceTaxSummarySnapshot,
} from "./InvoiceEligibilityService";

export interface InvoiceHtmlIssuerSnapshot {
    issuer_name?: string | null;
    issuer_address?: string | null;
    issuer_contact?: string | null;
    bank_account_text?: string | null;
    invoice_notes_default?: string | null;
}

export interface InvoiceHtmlInvoice {
    invoice_no: string;
    document_type: "standard_invoice" | "qualified_invoice" | "invoice_supplement";
    issue_date: string;
    due_date: string | null;
    billing_name: string;
    billing_address: string | null;
    notes: string | null;
    registration_number_snapshot: string | null;
    issuer_snapshot: InvoiceHtmlIssuerSnapshot | null;
    tax_summary_snapshot: InvoiceTaxSummarySnapshot | null;
    source_summary_snapshot?: InvoiceSourceSummarySnapshot | null;
}

export interface InvoiceHtmlTransaction {
    description: string | null;
    amount_subtotal: number | null;
    tax_amount: number | null;
    amount_total: number | null;
    currency: string | null;
    site: { name: string | null } | null;
    client: { name: string | null } | null;
}

export interface InvoiceHtmlItem {
    item_name: string;
    quantity: number | null;
    unit_name: string | null;
    unit_price: number | null;
    amount?: number | null;
}

export interface InvoiceHtmlContext {
    invoice: InvoiceHtmlInvoice;
    transaction: InvoiceHtmlTransaction;
    items: InvoiceHtmlItem[];
    hasExplicitLineItemsOverride?: boolean;
}

const ACCENT = "#5B9BD5";

function escapeHtml(value: string | null | undefined): string {
    if (value === null || value === undefined) {
        return "";
    }
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function nl2br(value: string | null | undefined): string {
    return escapeHtml(value).replace(/\r?\n/g, "<br />");
}

function formatDateJa(date: string | null | undefined): string {
    if (!date) {
        return "";
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
    if (!match) {
        return escapeHtml(date);
    }
    const [, y, m, d] = match;
    return `${y}年${Number(m)}月${Number(d)}日`;
}

function formatCurrency(value: number | null | undefined, currency = "JPY"): string {
    const resolved = Number.isFinite(value) ? Number(value) : 0;
    if (currency !== "JPY") {
        return new Intl.NumberFormat("ja-JP", {
            style: "currency",
            currency,
            maximumFractionDigits: 2,
        }).format(resolved);
    }
    return Math.round(resolved).toLocaleString("ja-JP");
}

function formatQuantity(value: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) {
        return "";
    }
    const rounded = Math.round(value * 100) / 100;
    return rounded.toLocaleString("ja-JP", { maximumFractionDigits: 2 });
}

function resolveItems(context: InvoiceHtmlContext): InvoiceHtmlItem[] {
    if (context.items.length > 0 || context.hasExplicitLineItemsOverride) {
        return context.items;
    }
    const fallbackName = context.transaction.description
        || context.transaction.site?.name
        || "請求項目";
    const amount = context.transaction.amount_subtotal ?? context.transaction.amount_total ?? 0;
    return [{
        item_name: fallbackName,
        quantity: 1,
        unit_name: "式",
        unit_price: amount,
        amount,
    }];
}

function renderItemRows(items: InvoiceHtmlItem[], currency: string): string {
    if (items.length === 0) {
        return `
            <tr>
                <td class="desc" colspan="5">表示明細はありません</td>
            </tr>
        `;
    }

    return items.map((item) => {
        const amount = item.amount !== null && item.amount !== undefined
            ? item.amount
            : item.quantity !== null && item.quantity !== undefined && item.unit_price !== null && item.unit_price !== undefined
                ? item.quantity * item.unit_price
                : null;
        return `
            <tr>
                <td class="desc">${escapeHtml(item.item_name)}</td>
                <td class="num">${formatQuantity(item.quantity)}</td>
                <td class="unit">${escapeHtml(item.unit_name || "")}</td>
                <td class="num">${item.unit_price !== null ? formatCurrency(item.unit_price, currency) : ""}</td>
                <td class="num amount">${amount !== null ? `¥ ${formatCurrency(amount, currency)}` : ""}</td>
            </tr>
        `;
    }).join("");
}

function renderTotalRows(
    subtotal: number,
    taxAmount: number,
    total: number,
    taxSummary: InvoiceTaxSummarySnapshot,
    currency: string,
): string {
    const rows: string[] = [];
    rows.push(`
        <tr>
            <td class="label">小計</td>
            <td class="value">¥ ${formatCurrency(subtotal, currency)}</td>
        </tr>
    `);

    if (taxSummary.by_rate.length > 0) {
        taxSummary.by_rate.forEach((line) => {
            const label = `税額(${Math.round(line.tax_rate * 100)}%)`;
            rows.push(`
                <tr>
                    <td class="label">${escapeHtml(label)}</td>
                    <td class="value">¥ ${formatCurrency(line.tax_amount, currency)}</td>
                </tr>
            `);
        });
    } else if (taxAmount) {
        rows.push(`
            <tr>
                <td class="label">税額</td>
                <td class="value">¥ ${formatCurrency(taxAmount, currency)}</td>
            </tr>
        `);
    }

    rows.push(`
        <tr class="grand">
            <td class="label">合計</td>
            <td class="value">¥ ${formatCurrency(total, currency)}</td>
        </tr>
    `);

    return rows.join("");
}

function renderSourceSummary(invoice: InvoiceHtmlInvoice): string {
    const summary = invoice.source_summary_snapshot;
    if (!summary) {
        return "";
    }

    const fragments: string[] = [];
    if (summary.period_start && summary.period_end) {
        const periodLabel = summary.period_start === summary.period_end
            ? formatDateJa(summary.period_start)
            : `${formatDateJa(summary.period_start)} 〜 ${formatDateJa(summary.period_end)}`;
        fragments.push(`対象期間: ${escapeHtml(periodLabel)}`);
    }

    if (summary.source_count > 1) {
        fragments.push(`対象件数: ${summary.source_count}件`);
    }

    if (summary.site_count > 0) {
        fragments.push(`現場数: ${summary.site_count}件`);
    }

    if (summary.site_names.length > 0) {
        const siteLabel = summary.site_names.length > 3
            ? `${summary.site_names.slice(0, 3).join("、")} ほか`
            : summary.site_names.join("、");
        fragments.push(`対象現場: ${escapeHtml(siteLabel)}`);
    }

    if (fragments.length === 0) {
        return "";
    }

    return `<div class="source-summary">${fragments.join(" / ")}</div>`;
}

export function renderInvoiceHtml(context: InvoiceHtmlContext): string {
    const { invoice, transaction } = context;
    const issuer = invoice.issuer_snapshot || {};
    const taxSummary: InvoiceTaxSummarySnapshot = invoice.tax_summary_snapshot
        && Array.isArray(invoice.tax_summary_snapshot.by_rate)
            ? invoice.tax_summary_snapshot
            : { by_rate: [], currency: "JPY" };
    const currency = transaction.currency || taxSummary.currency || "JPY";
    const subtotal = transaction.amount_subtotal ?? 0;
    const taxAmount = transaction.tax_amount ?? 0;
    const total = transaction.amount_total ?? subtotal + taxAmount;

    const items = resolveItems(context);
    const title = invoice.document_type === "qualified_invoice"
        ? "適格請求書"
        : invoice.document_type === "invoice_supplement"
            ? "登録番号等の追完通知"
            : "請求書";

    const registrationBadge = (invoice.document_type === "qualified_invoice" || invoice.document_type === "invoice_supplement")
        && invoice.registration_number_snapshot
        ? `<div class="registration-number">登録番号: ${escapeHtml(invoice.registration_number_snapshot)}</div>`
        : invoice.document_type === "standard_invoice"
            ? `<div class="registration-warning">※ 適格請求書ではありません</div>`
            : "";
    const billingLead = invoice.document_type === "invoice_supplement"
        ? "下記の通り不足事項を追完いたします。"
        : "下記の通りご請求申し上げます。";

    const notesText = invoice.notes || issuer.invoice_notes_default
        || "この度はお仕事をご依頼いただき、ありがとうございました。\n今後ともよろしくお願いいたします。";

    const bankText = issuer.bank_account_text || "振込先が設定されていません";

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.invoice_no)} ${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    html, body {
        margin: 0; padding: 0;
        font-family: 'Noto Sans JP', 'Hiragino Sans', 'Yu Gothic', sans-serif;
        color: #2b2b2b;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .page { padding: 14mm 14mm; font-size: 10pt; }

    .title {
        text-align: center;
        font-size: 28pt;
        letter-spacing: 0.2em;
        font-weight: 400;
        color: #1b1b1b;
        margin: 0 0 1.5mm;
        padding-left: 0.2em;
    }
    .title-rule { border: 0; border-top: 1pt solid ${ACCENT}; margin: 1.5mm 0 3mm; }

    .top-meta { display: flex; justify-content: flex-end; font-size: 9pt; color: #666; margin-bottom: 4mm; }

    .header { display: flex; justify-content: space-between; gap: 10mm; margin-bottom: 2mm; }
    .header .left { flex: 1; min-width: 0; }
    .header .right { flex: 1; text-align: right; min-width: 0; }

    .billing-address {
        font-size: 10pt;
        color: #333;
        line-height: 1.7;
        white-space: pre-line;
        margin-bottom: 5mm;
    }
    .billing-name {
        font-size: 17pt;
        font-weight: 500;
        letter-spacing: 0.06em;
        margin: 0;
        padding-bottom: 1.5mm;
        border-bottom: 1pt solid ${ACCENT};
    }
    .billing-lead {
        font-size: 9.5pt;
        color: #444;
        margin: 5mm 0 3mm;
    }
    .source-summary {
        font-size: 8.5pt;
        color: #5b5b5b;
        margin: 0 0 4mm;
        line-height: 1.7;
    }

    .amount-block {
        display: flex;
        align-items: baseline;
        gap: 8mm;
        white-space: nowrap;
        margin-bottom: 2mm;
    }
    .amount-label {
        font-size: 13pt;
        color: #333;
        letter-spacing: 0.35em;
    }
    .amount-value {
        font-size: 26pt;
        font-weight: 400;
        color: #1b1b1b;
        letter-spacing: 0.02em;
        font-variant-numeric: tabular-nums;
    }
    .amount-rule { border: 0; border-top: 1.5pt solid ${ACCENT}; width: 75%; margin: 0 0 4mm; }

    .issuer-name {
        font-size: 17pt;
        font-weight: 700;
        letter-spacing: 0.08em;
        margin: 0 0 1.5mm;
        color: #1b1b1b;
    }
    .issuer-person {
        font-size: 12pt;
        font-weight: 400;
        letter-spacing: 0.4em;
        margin: 0 0 4mm;
        color: #1b1b1b;
    }
    .issuer-meta {
        font-size: 9.5pt;
        color: #333;
        line-height: 1.7;
        white-space: pre-line;
    }
    .registration-number {
        font-size: 9pt;
        color: #555;
        margin-top: 2mm;
    }
    .registration-warning {
        font-size: 9pt;
        color: #9A3412;
        margin-top: 2mm;
    }

    table.items {
        width: 100%;
        border-collapse: separate;
        border-spacing: 0;
        font-size: 9.5pt;
        margin-top: 4mm;
    }
    table.items thead th {
        background: ${ACCENT};
        color: #fff;
        font-weight: 500;
        padding: 2.5mm 2mm;
        text-align: center;
        letter-spacing: 0.1em;
        font-size: 9.5pt;
    }
    table.items thead th.desc { text-align: left; padding-left: 4mm; width: 42%; }
    table.items thead th.qty { width: 12%; }
    table.items thead th.unit { width: 10%; }
    table.items thead th.price { width: 16%; }
    table.items thead th.amount { width: 20%; }
    table.items thead th + th { border-left: 0.3pt solid rgba(255, 255, 255, 0.4); }

    table.items tbody td {
        border-bottom: 0.3pt dashed #CFCFCF;
        padding: 2mm 2mm;
        vertical-align: middle;
        font-variant-numeric: tabular-nums;
    }
    table.items tbody td.desc { text-align: left; padding-left: 4mm; }
    table.items tbody td.num { text-align: right; padding-right: 4mm; }
    table.items tbody td.unit { text-align: center; color: #555; }
    table.items tbody td.amount { padding-right: 4mm; }

    .totals-wrap { display: flex; justify-content: flex-end; margin-top: 0; }
    table.totals { border-collapse: separate; border-spacing: 0; width: 48%; font-size: 10pt; }
    table.totals td {
        padding: 2.2mm 3mm;
        border-bottom: 0.3pt dashed #CFCFCF;
        font-variant-numeric: tabular-nums;
    }
    table.totals td.label { text-align: center; color: #555; width: 40%; letter-spacing: 0.15em; }
    table.totals td.value { text-align: right; padding-right: 4mm; }
    table.totals tr.grand td {
        border-top: 0.8pt solid ${ACCENT};
        border-bottom: 0.8pt solid ${ACCENT};
        padding: 2.8mm 3mm;
        font-size: 11pt;
        color: #1b1b1b;
    }
    table.totals tr.grand td.label { letter-spacing: 0.3em; font-weight: 500; }

    .bottom { display: flex; justify-content: space-between; gap: 8mm; margin-top: 6mm; font-size: 9pt; }
    .notes { flex: 1; white-space: pre-line; line-height: 1.7; color: #333; }
    .bank {
        width: 45%;
        border: 0.5pt solid ${ACCENT};
        padding: 3mm 5mm;
        border-radius: 1.5mm;
        background: #F8FBFE;
    }
    .bank-title {
        font-weight: 500;
        margin: 0 0 1.5mm;
        letter-spacing: 0.25em;
        color: #1b1b1b;
    }
    .bank-body { white-space: pre-line; line-height: 1.8; color: #333; }
</style>
</head>
<body>
<div class="page">
    <h1 class="title">${escapeHtml(title)}</h1>
    <hr class="title-rule" />

    <div class="top-meta">${escapeHtml(formatDateJa(invoice.issue_date))}</div>

    <div class="header">
        <div class="left">
            <div class="billing-address">${nl2br(invoice.billing_address || "")}</div>
            <div class="billing-name">${escapeHtml(invoice.billing_name)}　御中</div>
        </div>
        <div class="right">
            <div class="issuer-name">${escapeHtml(issuer.issuer_name || "")}</div>
            <div class="issuer-meta">${nl2br(issuer.issuer_address || "")}</div>
            <div class="issuer-meta">${nl2br(issuer.issuer_contact || "")}</div>
            ${registrationBadge}
        </div>
    </div>

    <div class="billing-lead">${escapeHtml(billingLead)}</div>
    ${renderSourceSummary(invoice)}

    <div class="amount-block">
        <span class="amount-label">ご請求金額</span>
        <span class="amount-value">￥ ${formatCurrency(total, currency)}</span>
    </div>
    <hr class="amount-rule" />

    <table class="items">
        <thead>
            <tr>
                <th class="desc">現場名・摘要</th>
                <th class="qty">数量</th>
                <th class="unit">単位</th>
                <th class="price">単価</th>
                <th class="amount">金額</th>
            </tr>
        </thead>
        <tbody>
            ${renderItemRows(items, currency)}
        </tbody>
    </table>

    <div class="totals-wrap">
        <table class="totals">
            <tbody>
                ${renderTotalRows(subtotal, taxAmount, total, taxSummary, currency)}
            </tbody>
        </table>
    </div>

    <div class="bottom">
        <div class="notes">${nl2br(notesText)}</div>
        <div class="bank">
            <div class="bank-title">振込先</div>
            <div class="bank-body">${nl2br(bankText)}</div>
        </div>
    </div>
</div>
</body>
</html>`;
}
