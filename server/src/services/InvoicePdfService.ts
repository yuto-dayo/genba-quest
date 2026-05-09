import puppeteer, { type Browser, type LaunchOptions } from "puppeteer";
import { supabaseAdmin } from "../lib/supabaseClient";
import {
    buildInvoiceSourceSummarySnapshot,
    type InvoiceSourceSummarySnapshot,
    type InvoiceTaxSummarySnapshot,
} from "./InvoiceEligibilityService";
import { buildInvoiceDisplayLineItems } from "./InvoiceLineItemsService";
import {
    renderInvoiceHtml,
    type InvoiceHtmlContext,
    type InvoiceHtmlIssuerSnapshot,
} from "./InvoiceHtmlTemplate";

export const INVOICE_PDF_BUCKET = "genba-documents";

type InvoicePdfDocumentType = "standard_invoice" | "qualified_invoice" | "invoice_supplement";

interface InvoiceRow {
    id: string;
    org_id: string | null;
    invoice_no: string;
    document_type: InvoicePdfDocumentType;
    issue_date: string;
    due_date: string | null;
    billing_name: string;
    billing_address: string | null;
    notes: string | null;
    source_transaction_id: string;
    source_transaction_date: string;
    registration_number_snapshot: string | null;
    issuer_snapshot: InvoiceHtmlIssuerSnapshot | null;
    tax_summary_snapshot: InvoiceTaxSummarySnapshot | null;
    eligibility_snapshot: Record<string, unknown> | null;
    source_summary_snapshot: InvoiceSourceSummarySnapshot | null;
    pdf_storage_path: string | null;
    pdf_render_status: "pending" | "generated" | "failed" | "locked";
}

interface InvoiceTransactionQueryRow {
    id: string;
    recorded_date: string;
    description: string | null;
    amount_subtotal: number | null;
    tax_amount: number | null;
    amount_total: number | null;
    currency: string | null;
    client_id?: string | null;
    site_id?: string | null;
    site: Array<{ name: string | null }> | { name: string | null } | null;
    client: Array<{ id?: string | null; name: string | null }> | { id?: string | null; name: string | null } | null;
}

interface InvoiceItemRow {
    transaction_id?: string;
    item_name: string;
    quantity: number | null;
    unit_name: string | null;
    unit_price: number | null;
    amount?: number | null;
}

interface InvoicePdfContext extends InvoiceHtmlContext {
    invoice: InvoiceRow;
    hasExplicitLineItemsOverride: boolean;
}

export interface StoredInvoicePdf {
    invoiceId: string;
    invoiceNo: string;
    storagePath: string;
    filename: string;
}

function sanitizePathSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function buildInvoicePdfFilename(invoiceNo: string): string {
    return `${invoiceNo}.pdf`;
}

function buildInvoicePdfStoragePath(invoice: InvoiceRow): string {
    const orgSegment = sanitizePathSegment(invoice.org_id || "legacy");
    const invoiceSegment = sanitizePathSegment(invoice.id);
    const filename = buildInvoicePdfFilename(invoice.invoice_no);
    return `${orgSegment}/generated/invoices/${invoiceSegment}/${filename}`;
}

function pickSingleRelation<T>(value: T[] | T | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] || null;
    }
    return value || null;
}

async function loadInvoicePdfContext(invoiceId: string, orgId: string): Promise<InvoicePdfContext | null> {
    const { data: invoice, error: invoiceError } = await supabaseAdmin
        .from("accounting_invoices")
        .select(`
            id,
            org_id,
            invoice_no,
            document_type,
            issue_date,
            due_date,
            billing_name,
            billing_address,
            notes,
            source_transaction_id,
            source_transaction_date,
            registration_number_snapshot,
            issuer_snapshot,
            tax_summary_snapshot,
            eligibility_snapshot,
            source_summary_snapshot,
            pdf_storage_path,
            pdf_render_status
        `)
        .eq("id", invoiceId)
        .eq("org_id", orgId)
        .maybeSingle();

    if (invoiceError) {
        throw invoiceError;
    }

    if (!invoice) {
        return null;
    }

    const { data: sourceLinks, error: sourceLinksError } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .select("source_transaction_id, sort_order")
        .eq("invoice_id", invoice.id)
        .order("sort_order", { ascending: true });

    if (sourceLinksError) {
        throw sourceLinksError;
    }

    const sourceTransactionIds = Array.isArray(sourceLinks) && sourceLinks.length > 0
        ? sourceLinks.map((link) => link.source_transaction_id)
        : [invoice.source_transaction_id];

    const { data: transactions, error: transactionError } = await supabaseAdmin
        .from("accounting_transactions")
        .select(`
            id,
            recorded_date,
            description,
            amount_subtotal,
            tax_amount,
            amount_total,
            currency,
            client_id,
            site_id,
            site:sites(name),
            client:clients(id, name)
        `)
        .in("id", sourceTransactionIds);

    if (transactionError) {
        throw transactionError;
    }

    if (!Array.isArray(transactions) || transactions.length === 0) {
        throw new Error(`Invoice source transaction not found: ${invoice.source_transaction_id}`);
    }

    const { data: items, error: itemsError } = await supabaseAdmin
        .from("accounting_transaction_items")
        .select("transaction_id, item_name, quantity, unit_name, unit_price, amount")
        .in("transaction_id", sourceTransactionIds);

    if (itemsError) {
        throw itemsError;
    }

    const transactionMap = new Map<string, InvoiceTransactionQueryRow>();
    for (const transaction of transactions as InvoiceTransactionQueryRow[]) {
        transactionMap.set(transaction.id, transaction);
    }

    const orderedTransactions = sourceTransactionIds
        .map((transactionId) => transactionMap.get(transactionId))
        .filter((transaction): transaction is InvoiceTransactionQueryRow => Boolean(transaction));
    const summarySnapshot = invoice.source_summary_snapshot || buildInvoiceSourceSummarySnapshot(
        orderedTransactions.map((transaction) => ({
            id: transaction.id,
            kind: "sale",
            recorded_date: transaction.recorded_date,
            amount_subtotal: transaction.amount_subtotal,
            tax_amount: transaction.tax_amount,
            amount_total: transaction.amount_total,
            currency: transaction.currency,
            client_id: transaction.client_id || null,
            site_id: transaction.site_id || null,
            description: transaction.description,
            site: pickSingleRelation(transaction.site),
            client: pickSingleRelation(transaction.client),
        }))
    );
    const primaryTransaction = orderedTransactions[0];

    const resolvedLineItems = buildInvoiceDisplayLineItems({
        documentType: invoice.document_type,
        eligibilitySnapshot: invoice.eligibility_snapshot,
        sourceTransactions: orderedTransactions.map((transaction) => ({
            id: transaction.id,
            description: transaction.description,
            amount_subtotal: transaction.amount_subtotal,
            amount_total: transaction.amount_total,
            site: pickSingleRelation(transaction.site),
        })),
        itemRows: (items || []) as InvoiceItemRow[],
    });

    return {
        invoice: invoice as InvoiceRow,
        hasExplicitLineItemsOverride: resolvedLineItems.hasExplicitOverride,
        transaction: {
            description: summarySnapshot.source_count > 1
                ? `${summarySnapshot.site_count}現場 / ${summarySnapshot.source_count}件`
                : primaryTransaction?.description || pickSingleRelation(primaryTransaction?.site)?.name || null,
            amount_subtotal: summarySnapshot.amount_subtotal,
            tax_amount: summarySnapshot.tax_amount,
            amount_total: summarySnapshot.amount_total,
            currency: summarySnapshot.currency || primaryTransaction?.currency || "JPY",
            site: summarySnapshot.source_count === 1
                ? pickSingleRelation(primaryTransaction?.site)
                : null,
            client: pickSingleRelation(primaryTransaction?.client),
        },
        items: resolvedLineItems.items,
    };
}

let browserPromise: Promise<Browser> | null = null;

function getPuppeteerLaunchOptions(): LaunchOptions {
    return {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--font-render-hinting=medium",
        ],
    };
}

async function getBrowser(): Promise<Browser> {
    if (!browserPromise) {
        browserPromise = puppeteer.launch(getPuppeteerLaunchOptions()).catch((error) => {
            browserPromise = null;
            throw error;
        });
    }
    const browser = await browserPromise;
    if (!browser.connected) {
        browserPromise = null;
        return getBrowser();
    }
    return browser;
}

export async function closeInvoicePdfBrowser(): Promise<void> {
    if (!browserPromise) {
        return;
    }
    const current = browserPromise;
    browserPromise = null;
    try {
        const browser = await current;
        await browser.close();
    } catch {
        // ignore shutdown errors
    }
}

async function renderPdfFromHtml(html: string): Promise<Buffer> {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
        await page.setContent(html, { waitUntil: "networkidle0" });
        await page.evaluateHandle("document.fonts.ready");
        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "0", right: "0", bottom: "0", left: "0" },
            preferCSSPageSize: true,
        });
        return Buffer.from(pdf);
    } finally {
        await page.close();
    }
}

export async function buildInvoicePdfBuffer(context: InvoiceHtmlContext): Promise<Buffer> {
    const html = renderInvoiceHtml(context);
    return renderPdfFromHtml(html);
}

async function markInvoicePdfFailed(invoiceId: string) {
    await supabaseAdmin
        .from("accounting_invoices")
        .update({
            pdf_render_status: "failed",
        })
        .eq("id", invoiceId);
}

export async function ensureInvoicePdfStored(input: {
    invoiceId: string;
    orgId: string;
}): Promise<StoredInvoicePdf | null> {
    const context = await loadInvoicePdfContext(input.invoiceId, input.orgId);
    if (!context) {
        return null;
    }

    const existingStoragePath = context.invoice.pdf_storage_path;
    const filename = buildInvoicePdfFilename(context.invoice.invoice_no);

    if (existingStoragePath && context.invoice.pdf_render_status === "generated") {
        return {
            invoiceId: context.invoice.id,
            invoiceNo: context.invoice.invoice_no,
            storagePath: existingStoragePath,
            filename,
        };
    }

    try {
        const pdfBuffer = await buildInvoicePdfBuffer(context);
        const storagePath = existingStoragePath || buildInvoicePdfStoragePath(context.invoice);
        const { error: uploadError } = await supabaseAdmin.storage
            .from(INVOICE_PDF_BUCKET)
            .upload(storagePath, pdfBuffer, {
                contentType: "application/pdf",
                upsert: true,
            });

        if (uploadError) {
            throw uploadError;
        }

        const { error: updateError } = await supabaseAdmin
            .from("accounting_invoices")
            .update({
                pdf_storage_path: storagePath,
                pdf_render_status: "generated",
                pdf_generated_at: new Date().toISOString(),
            })
            .eq("id", context.invoice.id);

        if (updateError) {
            throw updateError;
        }

        return {
            invoiceId: context.invoice.id,
            invoiceNo: context.invoice.invoice_no,
            storagePath,
            filename,
        };
    } catch (error) {
        await markInvoicePdfFailed(context.invoice.id);
        throw error;
    }
}
