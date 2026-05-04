import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { analyzeDocument, assessExpenseRisk, OcrResult } from "../services/ocrService";
import { getDriveStorageService } from "../services/DriveStorageService";
import { ensureInvoicePdfStored, INVOICE_PDF_BUCKET } from "../services/InvoicePdfService";
import { buildInvoiceDisplayLineItems } from "../services/InvoiceLineItemsService";
import { assertActiveClientForOrg } from "../services/ClientDirectoryService";
import {
    buildDefaultInvoiceSettings,
    buildInvoiceSourceSummarySnapshot,
    buildIssuerSnapshot,
    buildTaxSummarySnapshot,
    buildTaxSummarySnapshotForTransactions,
    evaluateInvoiceEligibility,
    evaluateInvoiceEligibilityForMany,
    isInvoiceIssuerStatus,
    isRequestedInvoiceDocumentType,
    isValidQualifiedInvoiceRegistrationNumber,
    type InvoiceTransaction,
    resolveTaxRate,
    resolveRequestedDocumentType,
} from "../services/InvoiceEligibilityService";

const router = Router();
const EXPENSE_REVIEW_PENDING_STATUS = "pending_review";
const EXPENSE_REVIEW_PENDING = "pending";
const EXPENSE_REVIEW_NOT_REQUIRED = "not_required";
const POSTED_STATUS = "posted";
const EXPENSE_CATEGORIES = ["material", "tool", "travel", "food", "fuel", "utility", "other"] as const;
const EXPENSE_TAX_CATEGORIES = ["10_STANDARD", "08_REDUCED", "00_EXEMPT", "00_TAXFREE"] as const;
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";
const INVOICE_SETTINGS_MANAGER_ROLES = new Set(["admin", "manager"]);
const DEFAULT_SALE_TAX_CATEGORY = "10_STANDARD";
const DEFAULT_SALE_TAX_RATE = 0.1;
const DEFAULT_SALE_UNIT_NAME = "式";
const VOIDABLE_TRANSACTION_STATUSES = ["posted", "approved"] as const;

type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
type ExpenseTaxCategory = typeof EXPENSE_TAX_CATEGORIES[number];
type SaleItemPayload = {
    item_name: string;
    quantity: number;
    unit_name: string;
    unit_price: number;
    amount: number;
};

type SupplementLineItemPayload = {
    item_name: string;
    quantity: number | null;
    unit_name: string | null;
    unit_price: number | null;
    amount: number | null;
};

const EXPENSE_ACCOUNT_MAP: Record<ExpenseCategory, { code: string; name: string }> = {
    material: { code: "5100", name: "材料費" },
    tool: { code: "5200", name: "工具備品費" },
    travel: { code: "5300", name: "交通費" },
    food: { code: "5400", name: "会議費" },
    fuel: { code: "5900", name: "燃料費" },
    utility: { code: "5900", name: "光熱費" },
    other: { code: "5900", name: "その他経費" },
};

function isDevAuthBypassEnabled(): boolean {
    return process.env.NODE_ENV === "development" && process.env.DEV_SKIP_AUTH === "true";
}

function hasAdminOrManagerRole(role: string | null | undefined): boolean {
    return isDevAuthBypassEnabled() || INVOICE_SETTINGS_MANAGER_ROLES.has(role || "");
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeExpenseCategory(value: unknown): ExpenseCategory | null {
    const normalized = normalizeText(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }

    return EXPENSE_CATEGORIES.includes(normalized as ExpenseCategory)
        ? normalized as ExpenseCategory
        : null;
}

function normalizeExpenseTaxCategory(value: unknown): ExpenseTaxCategory | null {
    const normalized = normalizeText(value)?.toUpperCase();
    if (!normalized) {
        return null;
    }

    return EXPENSE_TAX_CATEGORIES.includes(normalized as ExpenseTaxCategory)
        ? normalized as ExpenseTaxCategory
        : null;
}

function resolveExpenseTaxType(taxCategory: string | null | undefined): "taxable" | "exempt" | "taxfree" {
    if (taxCategory === "00_EXEMPT") {
        return "exempt";
    }
    if (taxCategory === "00_TAXFREE") {
        return "taxfree";
    }
    return "taxable";
}

function resolveExpenseAccount(category: unknown): { code: string; name: string } {
    const normalizedCategory = normalizeExpenseCategory(category) || "other";
    return EXPENSE_ACCOUNT_MAP[normalizedCategory];
}

function parseNumericInput(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function normalizeNetSubtotal(subtotal: number | null, taxAmount: number, total: number): number {
    const tolerance = 1;
    const safeSubtotal = subtotal ?? 0;
    const safeTaxAmount = Number.isFinite(taxAmount) ? taxAmount : 0;
    const safeTotal = Number.isFinite(total) ? total : 0;

    if (safeTotal <= 0) {
        return Math.max(safeSubtotal, 0);
    }

    if (safeTaxAmount <= 0) {
        if (safeSubtotal > 0 && safeSubtotal <= safeTotal + tolerance) {
            return safeSubtotal;
        }
        return safeTotal;
    }

    const derivedNet = Math.max(safeTotal - safeTaxAmount, 0);

    if (safeSubtotal <= 0) {
        return derivedNet;
    }

    const subtotalLooksLikeTotal = Math.abs(safeSubtotal - safeTotal) <= tolerance;
    const subtotalPlusTaxExceedsTotal = safeSubtotal + safeTaxAmount > safeTotal + tolerance;
    const subtotalExceedsTotal = safeSubtotal > safeTotal + tolerance;

    if (subtotalLooksLikeTotal || subtotalPlusTaxExceedsTotal || subtotalExceedsTotal) {
        return derivedNet;
    }

    return safeSubtotal;
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

type ExpenseInsertPayload = {
    org_id: string;
    kind: "expense";
    cost_center: string;
    site_id: string | null;
    vendor_name: unknown;
    description: unknown;
    recorded_date: string;
    amount_subtotal: number;
    tax_amount: number;
    amount_total: number;
    category: ExpenseCategory;
    expense_item_code: string | null;
    expense_item_other: string | null;
    tax_category: ExpenseTaxCategory;
    risk_level: "LOW" | "HIGH";
    status?: string;
    review_status?: string;
    source_document_id: unknown;
    input_sources: Record<string, unknown>;
    created_by: string;
};

function isMissingColumnError(error: unknown, columnName: string): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return (
        message.includes(`Could not find the '${columnName}' column`) ||
        message.includes(`column "${columnName}"`) ||
        message.includes(`'${columnName}' column`)
    );
}

function isMissingRelationError(error: unknown, relationName: string): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return (
        message.includes(`relation "${relationName}" does not exist`)
        || message.includes(`Could not find the table '${relationName}'`)
        || message.includes(`Could not find a relationship between`)
    );
}

function isPostgrestNoRowsError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && error.code === "PGRST116"
    );
}

function isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const code = "code" in error ? error.code : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return code === "23505" || message.includes("duplicate key value") || message.includes("23505");
}

async function assertSiteSalesMutable(siteId: string, orgId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
        .from("sites")
        .select("id, status")
        .eq("org_id", orgId)
        .eq("id", siteId)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        throw new Error("SITE_NOT_FOUND");
    }

    if (String(data.status ?? "") === "completed") {
        throw new Error("SITE_COMPLETED_SALES_IMMUTABLE");
    }
}

async function insertExpenseTransaction(payload: ExpenseInsertPayload) {
    let insertPayload: Record<string, unknown> = { ...payload };

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .insert(insertPayload)
            .select()
            .single();

        if (!error) {
            return data;
        }

        if ("category" in insertPayload && isMissingColumnError(error, "category")) {
            const { category: _category, ...rest } = insertPayload;
            insertPayload = rest;
            continue;
        }

        if ("expense_item_code" in insertPayload && isMissingColumnError(error, "expense_item_code")) {
            const { expense_item_code: _expenseItemCode, expense_item_other: _expenseItemOther, ...rest } = insertPayload;
            insertPayload = rest;
            continue;
        }

        if ("expense_item_other" in insertPayload && isMissingColumnError(error, "expense_item_other")) {
            const { expense_item_other: _expenseItemOther, ...rest } = insertPayload;
            insertPayload = rest;
            continue;
        }

        throw error;
    }

    throw new Error("Failed to insert expense transaction after schema compatibility retries");
}

function buildSaleDescription(description: string | null, items: SaleItemPayload[]): string {
    if (description) {
        return description;
    }

    const names = items.map((item) => item.item_name).filter(Boolean);
    if (names.length === 0) {
        return "売上";
    }

    if (names.length === 1) {
        return names[0];
    }

    if (names.length === 2) {
        return `${names[0]}、${names[1]}`;
    }

    return `${names[0]}、${names[1]} ほか${names.length - 2}件`;
}

function normalizeSaleItems(rawItems: unknown): { items: SaleItemPayload[]; error?: string } {
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
        return { items: [] };
    }

    const items: SaleItemPayload[] = [];

    for (const [index, rawItem] of rawItems.entries()) {
        const candidate = rawItem as Record<string, unknown>;
        const itemName = normalizeText(candidate?.item_name);
        const unitName = normalizeText(candidate?.unit_name);
        const quantity = parseNumericInput(candidate?.quantity);
        const unitPrice = parseNumericInput(candidate?.unit_price);

        if (!itemName) {
            return { items: [], error: `items[${index}].item_name is required` };
        }

        if (!unitName) {
            return { items: [], error: `items[${index}].unit_name is required` };
        }

        if (quantity === null || quantity <= 0) {
            return { items: [], error: `items[${index}].quantity must be a positive number` };
        }

        if (unitPrice === null || unitPrice < 0) {
            return { items: [], error: `items[${index}].unit_price must be a non-negative number` };
        }

        items.push({
            item_name: itemName,
            unit_name: unitName,
            quantity,
            unit_price: unitPrice,
            amount: roundMoney(quantity * unitPrice),
        });
    }

    return { items };
}

function normalizeSupplementLineItems(rawItems: unknown): { items: SupplementLineItemPayload[]; error?: string } {
    if (rawItems === undefined || rawItems === null) {
        return { items: [] };
    }

    if (!Array.isArray(rawItems)) {
        return { items: [], error: "supplement_line_items must be an array" };
    }

    const items: SupplementLineItemPayload[] = [];

    for (const [index, rawItem] of rawItems.entries()) {
        const candidate = rawItem as Record<string, unknown>;
        const itemName = normalizeText(candidate?.item_name);
        const unitName = normalizeText(candidate?.unit_name);
        const quantity = parseNumericInput(candidate?.quantity);
        const unitPrice = parseNumericInput(candidate?.unit_price);
        const hasAnyValue = Boolean(itemName || unitName || quantity !== null || unitPrice !== null);

        if (!hasAnyValue) {
            continue;
        }

        if (!itemName) {
            return { items: [], error: `supplement_line_items[${index}].item_name is required` };
        }

        if (quantity !== null && quantity <= 0) {
            return { items: [], error: `supplement_line_items[${index}].quantity must be a positive number` };
        }

        if (unitPrice !== null && unitPrice < 0) {
            return { items: [], error: `supplement_line_items[${index}].unit_price must be a non-negative number` };
        }

        items.push({
            item_name: itemName,
            quantity,
            unit_name: unitName,
            unit_price: unitPrice,
            amount: quantity !== null && unitPrice !== null
                ? roundMoney(quantity * unitPrice)
                : null,
        });
    }

    return { items };
}

async function getOrgInvoiceSettings(orgId: string) {
    const { data, error } = await supabaseAdmin
        .from("org_invoice_settings")
        .select("*")
        .eq("org_id", orgId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data || buildDefaultInvoiceSettings(orgId);
}

async function ensureInvoiceSettingsManager(userId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return hasAdminOrManagerRole(data?.role);
}

function pickSingleRelation<T>(value: T[] | T | null | undefined): T | null {
    if (Array.isArray(value)) {
        return value[0] || null;
    }

    return value || null;
}

type InvoiceSourceLinkRecord = {
    invoice_id: string;
    source_transaction_id: string;
    source_transaction_date: string;
    sort_order: number;
    is_primary_document: boolean;
};

async function getInvoiceTransactionsByIds(transactionIds: string[]): Promise<InvoiceTransaction[]> {
    if (transactionIds.length === 0) {
        return [];
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_transactions")
        .select(`
            id,
            kind,
            recorded_date,
            amount_subtotal,
            tax_amount,
            amount_total,
            tax_category,
            currency,
            client_id,
            site_id,
            description,
            site:sites(id, name),
            client:clients(id, name)
        `)
        .in("id", transactionIds);

    if (error) {
        throw error;
    }

    const rows = Array.isArray(data)
        ? data
        : (data ? [data] : []);
    const transactionMap = new Map<string, InvoiceTransaction>();
    for (const row of rows) {
        transactionMap.set(row.id, {
            ...row,
            site: pickSingleRelation(row.site),
            client: pickSingleRelation(row.client),
        } as InvoiceTransaction);
    }

    return transactionIds
        .map((transactionId) => transactionMap.get(transactionId))
        .filter((transaction): transaction is InvoiceTransaction => Boolean(transaction));
}

async function getInvoiceTransaction(transactionId: string) {
    const [transaction] = await getInvoiceTransactionsByIds([transactionId]);
    return transaction || null;
}

async function getInvoiceSourceLinksByTransactionIds(
    transactionIds: string[],
    options?: { primaryOnly?: boolean }
): Promise<InvoiceSourceLinkRecord[]> {
    if (transactionIds.length === 0) {
        return [];
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .select("invoice_id, source_transaction_id, source_transaction_date, sort_order, is_primary_document")
        .in("source_transaction_id", transactionIds);

    if (error) {
        if (isMissingRelationError(error, "accounting_invoice_sources")) {
            return [];
        }
        throw error;
    }

    const sourceLinks = Array.isArray(data)
        ? data as InvoiceSourceLinkRecord[]
        : [];

    return options?.primaryOnly
        ? sourceLinks.filter((link) => link.is_primary_document)
        : sourceLinks;
}

async function getInvoiceSourceLinksByInvoiceIds(invoiceIds: string[]): Promise<InvoiceSourceLinkRecord[]> {
    if (invoiceIds.length === 0) {
        return [];
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .select("invoice_id, source_transaction_id, source_transaction_date, sort_order, is_primary_document")
        .in("invoice_id", invoiceIds)
        .order("sort_order", { ascending: true });

    if (error) {
        if (isMissingRelationError(error, "accounting_invoice_sources")) {
            return [];
        }
        throw error;
    }

    return Array.isArray(data)
        ? data as InvoiceSourceLinkRecord[]
        : [];
}

async function getExistingInvoicesForSourceTransactions(
    transactionIds: string[],
    orgId: string,
    options?: { primaryOnly?: boolean }
) {
    const sourceLinks = await getInvoiceSourceLinksByTransactionIds(transactionIds, options);
    const invoiceIds = Array.from(new Set(sourceLinks.map((link) => link.invoice_id)));

    if (invoiceIds.length === 0) {
        const fallbackQuery = supabaseAdmin
            .from("accounting_invoices")
            .select("id, invoice_no, document_type, supplements_invoice_id")
            .eq("org_id", orgId)
            .in("source_transaction_id", transactionIds);

        const { data, error } = options?.primaryOnly
            ? await fallbackQuery.in("document_type", ["standard_invoice", "qualified_invoice"])
            : await fallbackQuery;

        if (error) {
            throw error;
        }

        return Array.isArray(data) ? data : [];
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_invoices")
        .select("id, invoice_no, document_type, supplements_invoice_id")
        .eq("org_id", orgId)
        .in("id", invoiceIds);

    if (error) {
        throw error;
    }

    return Array.isArray(data) ? data : [];
}

async function getExistingInvoicesForTransaction(transactionId: string, orgId = DEFAULT_ORG_ID) {
    return getExistingInvoicesForSourceTransactions([transactionId], orgId);
}

async function insertInvoiceSourceLinks(input: {
    invoiceId: string;
    transactions: InvoiceTransaction[];
    isPrimaryDocument: boolean;
}) {
    if (input.transactions.length === 0) {
        return;
    }

    const rows = input.transactions.map((transaction, index) => ({
        invoice_id: input.invoiceId,
        source_transaction_id: transaction.id,
        source_transaction_date: transaction.recorded_date,
        sort_order: index,
        is_primary_document: input.isPrimaryDocument,
    }));

    const { error } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .insert(rows);

    if (error) {
        if (isMissingRelationError(error, "accounting_invoice_sources")) {
            return;
        }
        throw error;
    }
}

function buildInvoiceListSelect(includeSourceSummarySnapshot: boolean): string {
    return `
        id,
        transaction_id,
        invoice_no,
        document_type,
        issue_date,
        due_date,
        billing_name,
        billing_address,
        notes,
        pdf_render_status,
        created_at,
        source_transaction_id,
        source_transaction_date,
        eligibility_snapshot
        ${includeSourceSummarySnapshot ? ",source_summary_snapshot" : ""}
    `;
}

async function fetchInvoiceListRows(input: {
    orgId: string;
    offset: number;
    limit: number;
    filteredInvoiceIds: string[] | null;
    sourceTransactionIdFilter: string | null;
}) {
    const runQuery = async (includeSourceSummarySnapshot: boolean) => {
        let query = supabaseAdmin
            .from("accounting_invoices")
            .select(buildInvoiceListSelect(includeSourceSummarySnapshot))
            .eq("org_id", input.orgId)
            .order("issue_date", { ascending: false })
            .order("created_at", { ascending: false })
            .range(input.offset, input.offset + input.limit - 1);

        if (input.filteredInvoiceIds && input.filteredInvoiceIds.length > 0) {
            query = query.in("id", input.filteredInvoiceIds);
        } else if (input.sourceTransactionIdFilter) {
            query = query.eq("source_transaction_id", input.sourceTransactionIdFilter);
        }

        return query;
    };

    const primary = await runQuery(true);
    if (!primary.error) {
        return primary;
    }

    if (!isMissingColumnError(primary.error, "source_summary_snapshot")) {
        return primary;
    }

    return runQuery(false);
}

async function insertInvoiceRecord(row: Record<string, unknown>) {
    let insertPayload = { ...row };

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await supabaseAdmin
            .from("accounting_invoices")
            .insert(insertPayload)
            .select()
            .single();

        if (!result.error) {
            return result;
        }

        if ("source_summary_snapshot" in insertPayload && isMissingColumnError(result.error, "source_summary_snapshot")) {
            const { source_summary_snapshot: _sourceSummarySnapshot, ...rest } = insertPayload;
            insertPayload = rest;
            continue;
        }

        return result;
    }

    return { data: null, error: new Error("Failed to insert invoice after compatibility retries") };
}

async function getInvoiceById(invoiceId: string, orgId: string) {
    const { data, error } = await supabaseAdmin
        .from("accounting_invoices")
        .select("*")
        .eq("id", invoiceId)
        .eq("org_id", orgId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data;
}

function buildInvoiceCorrectionSnapshot(existingSnapshot: any, correction: Record<string, unknown>) {
    const history = Array.isArray(existingSnapshot?.correction_history)
        ? existingSnapshot.correction_history
        : [];

    return {
        ...(existingSnapshot || {}),
        last_correction: correction,
        correction_history: [...history, correction].slice(-10),
    };
}

// ============================================================
// Documents（証憑アップロード・OCR）
// ============================================================

// 画像アップロード → documents レコード作成
router.post("/documents", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { file_base64, mime_type, original_filename, doc_type, site_id, client_id } = req.body;
        const orgId = req.orgId || DEFAULT_ORG_ID;

        if (!file_base64 || !mime_type || !doc_type) {
            res.status(400).json({ error: "file_base64, mime_type, doc_type are required" });
            return;
        }

        if (client_id) {
            try {
                await assertActiveClientForOrg(client_id, orgId);
            } catch {
                res.status(400).json({ error: "client_id is invalid or unavailable" });
                return;
            }
        }

        // Base64 → Buffer
        const fileBuffer = Buffer.from(file_base64, "base64");
        const fileSize = fileBuffer.length;

        // SHA256 ハッシュ
        const crypto = await import("crypto");
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        // Storage にアップロード
        const timestamp = Date.now();
        const ext = original_filename?.split(".").pop() || "jpg";
        const storagePath = `${req.userId!}/${timestamp}.${ext}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from("genba-documents")
            .upload(storagePath, fileBuffer, {
                contentType: mime_type,
                upsert: false,
            });

        if (uploadError) throw uploadError;

        // documents レコード作成
        const { data, error } = await supabaseAdmin
            .from("documents")
            .insert({
                org_id: orgId,
                doc_type,
                storage_path: storagePath,
                original_filename,
                mime_type,
                file_size: fileSize,
                sha256,
                uploaded_by: req.userId!,
                site_id: site_id || null,
                client_id: client_id || null,
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        console.error("Document upload error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// OCR解析
router.post("/ocr/analyze", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { document_id } = req.body;

        if (!document_id) {
            res.status(400).json({ error: "document_id is required" });
            return;
        }

        // ドキュメント取得
        const { data: doc, error: docError } = await supabaseAdmin
            .from("documents")
            .select("*")
            .eq("id", document_id)
            .single();

        if (docError || !doc) {
            res.status(404).json({ error: "Document not found" });
            return;
        }

        let fileBuffer: Buffer;
        let mimeType = doc.mime_type || "application/octet-stream";

        if (doc.drive_file_id) {
            const driveFile = await getDriveStorageService().downloadAttachmentFromDrive(doc.drive_file_id);
            fileBuffer = driveFile.buffer;
            mimeType = driveFile.mimeType || mimeType;
        } else if (doc.storage_path) {
            const { data: fileData, error: downloadError } = await supabaseAdmin.storage
                .from("genba-documents")
                .download(doc.storage_path);

            if (downloadError || !fileData) {
                res.status(500).json({ error: "Failed to download file" });
                return;
            }

            const arrayBuffer = await fileData.arrayBuffer();
            fileBuffer = Buffer.from(arrayBuffer);
        } else {
            res.status(400).json({ error: "Document has no downloadable source" });
            return;
        }

        const base64 = fileBuffer.toString("base64");

        // OCR 実行（デフォルトプロバイダーを使用）
        const ocrResult: OcrResult = await analyzeDocument(base64, mimeType);

        // documents 更新
        const { data: updated, error: updateError } = await supabaseAdmin
            .from("documents")
            .update({
                ocr_provider: ocrResult.provider,
                ocr_blocks: ocrResult.ocr_blocks,
                ocr_fields: ocrResult.ocr_fields,
                field_provenance: Object.keys(ocrResult.ocr_fields).reduce((acc, key) => {
                    acc[key] = { source: "ocr", at: new Date().toISOString() };
                    return acc;
                }, {} as Record<string, any>),
            })
            .eq("id", document_id)
            .select()
            .single();

        if (updateError) throw updateError;
        res.json(updated);
    } catch (err: any) {
        console.error("OCR analyze error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Expenses（経費）
// ============================================================

router.post("/expenses", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            cost_center,
            site_id,
            vendor_name,
            description,
            recorded_date,
            amount_subtotal,
            tax_amount,
            amount_total,
            category,
            tax_category,
            expense_item_code,
            expense_item_other,
            source_document_id,
            input_sources,
        } = req.body;
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const normalizedCategory = normalizeExpenseCategory(category);
        const normalizedTaxCategory = normalizeExpenseTaxCategory(tax_category) || "10_STANDARD";
        const normalizedExpenseItemCode = normalizeText(expense_item_code);
        const normalizedExpenseItemOther = normalizeText(expense_item_other);

        if (cost_center !== "HQ" && !site_id) {
            res.status(400).json({ error: "site_id is required when cost_center is SITE" });
            return;
        }

        if (typeof amount_total !== "number" || Number.isNaN(amount_total) || amount_total <= 0) {
            res.status(400).json({ error: "amount_total must be a positive number" });
            return;
        }

        if (category !== undefined && category !== null && !normalizedCategory) {
            res.status(400).json({ error: "category must be one of material, tool, travel, food, fuel, utility, other" });
            return;
        }

        if (tax_category !== undefined && tax_category !== null && !normalizeExpenseTaxCategory(tax_category)) {
            res.status(400).json({ error: "tax_category must be one of 10_STANDARD, 08_REDUCED, 00_EXEMPT, 00_TAXFREE" });
            return;
        }

        if (normalizedCategory === "other" && normalizedExpenseItemCode === "other" && !normalizedExpenseItemOther) {
            res.status(400).json({ error: "expense_item_other is required when expense_item_code is other" });
            return;
        }

        const resolvedTotal = parseNumericInput(amount_total) || 0;
        let resolvedTaxAmount = parseNumericInput(tax_amount) || 0;
        let resolvedSubtotal = parseNumericInput(amount_subtotal);

        if (normalizedTaxCategory === "00_EXEMPT" || normalizedTaxCategory === "00_TAXFREE") {
            resolvedTaxAmount = 0;
        }

        resolvedSubtotal = normalizeNetSubtotal(resolvedSubtotal, resolvedTaxAmount, resolvedTotal);

        // リスク判定
        let risk_level: "LOW" | "HIGH" = "LOW";
        if (source_document_id) {
            const { data: doc } = await supabaseAdmin
                .from("documents")
                .select("ocr_fields")
                .eq("id", source_document_id)
                .single();

            if (doc?.ocr_fields) {
                const assessment = assessExpenseRisk(doc.ocr_fields, normalizedCategory || "other");
                risk_level = assessment.level;
            }
        }

        // 金額ベースのリスク判定（OCRがなくても）
        const total = resolvedTotal;
        if (
            (normalizedCategory === "material" || normalizedCategory === "tool") && total > 30000 ||
            (normalizedCategory === "food" || normalizedCategory === "travel") && total > 5000
        ) {
            risk_level = "HIGH";
        }

        const requiresReview = risk_level === "HIGH";

        const data = await insertExpenseTransaction({
            org_id: orgId,
            kind: "expense",
            cost_center: cost_center || "SITE",
            site_id: cost_center === "HQ" ? null : site_id,
            vendor_name,
            description,
            recorded_date: recorded_date || new Date().toISOString().split("T")[0],
            amount_subtotal: resolvedSubtotal,
            tax_amount: resolvedTaxAmount,
            amount_total: resolvedTotal,
            category: normalizedCategory || "other",
            expense_item_code: normalizedExpenseItemCode,
            expense_item_other: normalizedExpenseItemOther,
            tax_category: normalizedTaxCategory,
            risk_level,
            status: requiresReview ? undefined : POSTED_STATUS,
            review_status: requiresReview ? undefined : EXPENSE_REVIEW_NOT_REQUIRED,
            source_document_id,
            input_sources: input_sources || {},
            created_by: req.userId!,
        });

        if (!requiresReview) {
            await createJournalEntry(data, req.userId!);
        }

        res.status(201).json(data);
    } catch (err: any) {
        console.error("Expense create error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 経費承認/否認
router.post("/expenses/:id/review", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { action, comment } = req.body; // action: 'approve' | 'reject'

        if (!["approve", "reject"].includes(action)) {
            res.status(400).json({ error: "action must be 'approve' or 'reject'" });
            return;
        }

        // 取引情報を取得して自己承認チェック
        const { data: tx, error: txError } = await supabaseAdmin
            .from("accounting_transactions")
            .select("created_by, amount_total, reviewer_id, status, review_status")
            .eq("id", id)
            .single();

        if (txError || !tx) {
            res.status(404).json({ error: "Transaction not found" });
            return;
        }

        // 自己承認防止チェック
        if (tx.created_by === req.userId) {
            res.status(403).json({ error: "自己承認は禁止されています" });
            return;
        }

        if (tx.reviewer_id !== req.userId) {
            res.status(403).json({ error: "承認者として割り当てられていません" });
            return;
        }

        if (tx.status !== EXPENSE_REVIEW_PENDING_STATUS || tx.review_status !== EXPENSE_REVIEW_PENDING) {
            res.status(409).json({ error: "この経費は承認待ちではありません" });
            return;
        }

        // 承認権限チェック
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("approval_limit, role")
            .eq("id", req.userId!)
            .single();

        const approvalLimit = profile?.approval_limit ?? 50000;
        const txAmount = tx.amount_total ?? 0;

        if (approvalLimit < txAmount && !hasAdminOrManagerRole(profile?.role)) {
            res.status(403).json({
                error: `承認権限が不足しています（上限: ¥${approvalLimit.toLocaleString()}、申請額: ¥${txAmount.toLocaleString()}）`,
            });
            return;
        }

        const newStatus = action === "approve" ? "approved" : "rejected";
        const txStatus = action === "approve" ? "posted" : "draft";

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .update({
                review_status: newStatus,
                review_comment: comment,
                reviewed_at: new Date().toISOString(),
                status: txStatus,
            })
            .eq("id", id)
            .select()
            .single();

        if (error) throw error;

        // 承認の場合は仕訳を作成
        if (action === "approve" && data) {
            await createJournalEntry(data, req.userId!);
        }

        res.json(data);
    } catch (err: any) {
        console.error("Expense review error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 複数経費の一括承認
router.post("/expenses/batch-review", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { ids, action, comment } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            res.status(400).json({ error: "ids array is required" });
            return;
        }

        if (ids.length > 50) {
            res.status(400).json({ error: "Maximum 50 items per batch" });
            return;
        }

        if (!["approve", "reject"].includes(action)) {
            res.status(400).json({ error: "action must be 'approve' or 'reject'" });
            return;
        }

        // 承認者のプロファイル取得
        const { data: profile } = await supabaseAdmin
            .from("profiles")
            .select("approval_limit, role")
            .eq("id", req.userId!)
            .single();

        const approvalLimit = profile?.approval_limit ?? 50000;
        const isAdminOrManager = hasAdminOrManagerRole(profile?.role);

        const results: { success: string[]; failed: { id: string; error: string }[] } = {
            success: [],
            failed: [],
        };

        for (const id of ids) {
            try {
                // 取引情報を取得
                const { data: tx, error: txError } = await supabaseAdmin
                    .from("accounting_transactions")
                    .select("created_by, amount_total, reviewer_id, status, review_status")
                    .eq("id", id)
                    .single();

                if (txError || !tx) {
                    results.failed.push({ id, error: "取引が見つかりません" });
                    continue;
                }

                // 自己承認チェック
                if (tx.created_by === req.userId) {
                    results.failed.push({ id, error: "自己承認不可" });
                    continue;
                }

                // 承認者として割り当てられているかチェック
                if (tx.reviewer_id !== req.userId) {
                    results.failed.push({ id, error: "承認者として割り当てられていません" });
                    continue;
                }

                if (tx.status !== EXPENSE_REVIEW_PENDING_STATUS || tx.review_status !== EXPENSE_REVIEW_PENDING) {
                    results.failed.push({ id, error: "承認待ちではありません" });
                    continue;
                }

                // 承認権限チェック
                const txAmount = tx.amount_total ?? 0;
                if (approvalLimit < txAmount && !isAdminOrManager) {
                    results.failed.push({ id, error: "承認権限不足" });
                    continue;
                }

                // 承認/否認実行
                const newStatus = action === "approve" ? "approved" : "rejected";
                const txStatus = action === "approve" ? "posted" : "draft";

                const { data: updated, error: updateError } = await supabaseAdmin
                    .from("accounting_transactions")
                    .update({
                        review_status: newStatus,
                        review_comment: comment,
                        reviewed_at: new Date().toISOString(),
                        status: txStatus,
                    })
                    .eq("id", id)
                    .select()
                    .single();

                if (updateError) {
                    results.failed.push({ id, error: updateError.message });
                    continue;
                }

                // 承認の場合は仕訳を作成
                if (action === "approve" && updated) {
                    await createJournalEntry(updated, req.userId!);
                }

                results.success.push(id);
            } catch (err: any) {
                results.failed.push({ id, error: err.message });
            }
        }

        res.json(results);
    } catch (err: any) {
        console.error("Batch review error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Sales（売上）
// ============================================================

router.post("/sales", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            site_id,
            client_id,
            description,
            recorded_date,
            unit_name,
            unit_price,
            quantity,
            items,
            amount_subtotal,
            tax_amount,
            amount_total,
            source_document_id,
            input_sources,
        } = req.body;
        const orgId = req.orgId || DEFAULT_ORG_ID;

        if (!site_id) {
            res.status(400).json({ error: "site_id is required" });
            return;
        }

        await assertSiteSalesMutable(site_id, orgId);

        if (client_id) {
            try {
                await assertActiveClientForOrg(client_id, orgId);
            } catch {
                res.status(400).json({ error: "client_id is invalid or unavailable" });
                return;
            }
        }

        const hasUnitPrice = unit_price !== undefined && unit_price !== null;
        const hasQuantity = quantity !== undefined && quantity !== null;
        const normalizedDescription = normalizeText(description);
        const normalizedStructuredItems = normalizeSaleItems(items);

        if (normalizedStructuredItems.error) {
            res.status(400).json({ error: normalizedStructuredItems.error });
            return;
        }

        if (normalizedStructuredItems.items.length === 0 && hasUnitPrice !== hasQuantity) {
            res.status(400).json({ error: "unit_price and quantity must be provided together" });
            return;
        }

        let saleItems = normalizedStructuredItems.items;

        if (saleItems.length === 0 && hasUnitPrice) {
            if (typeof unit_price !== "number" || Number.isNaN(unit_price) || unit_price < 0) {
                res.status(400).json({ error: "unit_price must be a non-negative number" });
                return;
            }

            if (typeof quantity !== "number" || Number.isNaN(quantity) || quantity <= 0) {
                res.status(400).json({ error: "quantity must be a positive number" });
                return;
            }

            saleItems = [
                {
                    item_name: normalizedDescription || "売上",
                    unit_name: normalizeText(unit_name) || DEFAULT_SALE_UNIT_NAME,
                    quantity,
                    unit_price,
                    amount: roundMoney(quantity * unit_price),
                },
            ];
        }

        let resolvedSubtotal = parseNumericInput(amount_subtotal) || 0;
        let resolvedTaxAmount = parseNumericInput(tax_amount) || 0;
        let resolvedTotal = parseNumericInput(amount_total) || 0;

        if (saleItems.length > 0) {
            resolvedSubtotal = roundMoney(
                saleItems.reduce((sum, item) => sum + item.amount, 0)
            );
            resolvedTaxAmount = roundMoney(resolvedSubtotal * DEFAULT_SALE_TAX_RATE);
            resolvedTotal = roundMoney(resolvedSubtotal + resolvedTaxAmount);
        }

        if (!Number.isFinite(resolvedTotal) || resolvedTotal <= 0) {
            res.status(400).json({ error: "amount_total must be a positive number" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .insert({
                org_id: orgId,
                kind: "sale",
                cost_center: "SITE",
                site_id,
                client_id,
                description: buildSaleDescription(normalizedDescription, saleItems),
                recorded_date: recorded_date || new Date().toISOString().split("T")[0],
                amount_subtotal: resolvedSubtotal,
                tax_amount: resolvedTaxAmount,
                amount_total: resolvedTotal,
                tax_category: DEFAULT_SALE_TAX_CATEGORY,
                status: "posted",
                source_document_id,
                input_sources: input_sources || {},
                created_by: req.userId!,
            })
            .select()
            .single();

        if (error) throw error;

        if (saleItems.length > 0) {
            const { error: itemError } = await supabaseAdmin
                .from("accounting_transaction_items")
                .insert(
                    saleItems.map((item) => ({
                        transaction_id: data.id,
                        item_name: item.item_name,
                        unit_name: item.unit_name,
                        unit_price: item.unit_price,
                        quantity: item.quantity,
                    }))
                );

            if (itemError) throw itemError;
        }

        // 仕訳作成
        await createJournalEntry(data, req.userId!);

        res.status(201).json(data);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_COMPLETED_SALES_IMMUTABLE") {
            res.status(409).json({ error: "SITE_COMPLETED_SALES_IMMUTABLE" });
            return;
        }
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "SITE_NOT_FOUND" });
            return;
        }
        console.error("Sale create error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Invoices（請求書）
// ============================================================

router.get("/invoice-settings", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const settings = await getOrgInvoiceSettings(orgId);
        res.json(settings);
    } catch (err: any) {
        console.error("Invoice settings get error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.put("/invoice-settings", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const normalizedIssuerName = normalizeText(req.body.issuer_name);
        const normalizedIssuerAddress = normalizeText(req.body.issuer_address);
        const normalizedIssuerContact = normalizeText(req.body.issuer_contact);
        const normalizedBankAccountText = normalizeText(req.body.bank_account_text);
        const normalizedInvoiceNotesDefault = normalizeText(req.body.invoice_notes_default);
        const invoiceIssuerStatus = req.body.invoice_issuer_status;
        const normalizedRegistrationNumber = normalizeText(req.body.qualified_invoice_registration_number)?.toUpperCase() || null;
        const registeredAt = normalizeText(req.body.qualified_invoice_registered_at);

        if (!normalizedIssuerName) {
            res.status(400).json({ error: "issuer_name is required" });
            return;
        }

        if (!isInvoiceIssuerStatus(invoiceIssuerStatus)) {
            res.status(400).json({ error: "invoice_issuer_status must be one of unregistered, applied, registered" });
            return;
        }

        const canManage = await ensureInvoiceSettingsManager(req.userId!);
        if (!canManage) {
            res.status(403).json({ error: "Invoice settings can only be updated by admin or manager" });
            return;
        }

        if (invoiceIssuerStatus === "registered") {
            if (!normalizedRegistrationNumber) {
                res.status(400).json({ error: "qualified_invoice_registration_number is required when registered" });
                return;
            }

            if (!isValidQualifiedInvoiceRegistrationNumber(normalizedRegistrationNumber)) {
                res.status(400).json({ error: "qualified_invoice_registration_number must match T + 13 digits" });
                return;
            }

            if (!registeredAt) {
                res.status(400).json({ error: "qualified_invoice_registered_at is required when registered" });
                return;
            }
        }

        const existingSettings = await getOrgInvoiceSettings(orgId);
        const payload = {
            issuer_name: normalizedIssuerName,
            issuer_address: normalizedIssuerAddress,
            issuer_contact: normalizedIssuerContact,
            bank_account_text: normalizedBankAccountText,
            invoice_issuer_status: invoiceIssuerStatus,
            qualified_invoice_registration_number: invoiceIssuerStatus === "registered" ? normalizedRegistrationNumber : null,
            qualified_invoice_registered_at: invoiceIssuerStatus === "registered" ? registeredAt : null,
            invoice_notes_default: normalizedInvoiceNotesDefault,
            updated_by: req.userId!,
            updated_at: new Date().toISOString(),
        };

        let result;
        if (existingSettings.created_at) {
            const { data, error } = await supabaseAdmin
                .from("org_invoice_settings")
                .update(payload)
                .eq("org_id", orgId)
                .select("*")
                .single();

            if (error) {
                throw error;
            }

            result = data;
        } else {
            const { data, error } = await supabaseAdmin
                .from("org_invoice_settings")
                .insert({
                    org_id: orgId,
                    ...payload,
                    created_by: req.userId!,
                })
                .select("*")
                .single();

            if (error) {
                throw error;
            }

            result = data;
        }

        res.json(result);
    } catch (err: any) {
        console.error("Invoice settings update error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/invoice-candidates", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const clientId = normalizeText(req.query.client_id);
        const dateFrom = normalizeText(req.query.date_from);
        const dateTo = normalizeText(req.query.date_to);

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select(`
                *,
                site:sites(id, name),
                client:clients(id, name)
            `)
            .eq("kind", "sale")
            .neq("status", "voided")
            .order("recorded_date", { ascending: true })
            .order("created_at", { ascending: true });

        if (clientId) {
            query = query.eq("client_id", clientId);
        }

        if (dateFrom) {
            query = query.gte("recorded_date", dateFrom);
        }

        if (dateTo) {
            query = query.lte("recorded_date", dateTo);
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        const transactions = Array.isArray(data) ? data : [];
        if (transactions.length === 0) {
            res.json([]);
            return;
        }

        const linkedInvoices = await getExistingInvoicesForSourceTransactions(
            transactions.map((transaction) => transaction.id),
            orgId,
            { primaryOnly: true }
        );
        const linkedInvoiceIds = new Set(linkedInvoices.map((invoice) => invoice.id));
        const sourceLinks = await getInvoiceSourceLinksByTransactionIds(
            transactions.map((transaction) => transaction.id),
            { primaryOnly: true }
        );
        const linkedSourceIds = new Set(
            sourceLinks
                .filter((link) => linkedInvoiceIds.has(link.invoice_id))
                .map((link) => link.source_transaction_id)
        );

        res.json(transactions.filter((transaction) => !linkedSourceIds.has(transaction.id)));
    } catch (err: any) {
        console.error("Invoice candidates error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/invoice-eligibility", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const transactionIds: string[] = Array.isArray(req.body.transaction_ids)
            ? req.body.transaction_ids
                .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
                .map((value: string) => value.trim())
            : [];

        if (transactionIds.length === 0) {
            res.status(400).json({ error: "transaction_ids is required" });
            return;
        }

        const uniqueTransactionIds: string[] = Array.from(new Set(transactionIds));
        const transactions = await getInvoiceTransactionsByIds(uniqueTransactionIds);

        if (transactions.length !== uniqueTransactionIds.length) {
            res.status(404).json({ error: "One or more transactions were not found" });
            return;
        }

        if (transactions.some((transaction) => !["sale", "invoice"].includes(transaction.kind))) {
            res.status(400).json({ error: "Only sale transactions can be invoiced" });
            return;
        }

        const [settings, existingInvoices] = await Promise.all([
            getOrgInvoiceSettings(orgId),
            getExistingInvoicesForSourceTransactions(uniqueTransactionIds, orgId),
        ]);
        const taxSummary = buildTaxSummarySnapshotForTransactions(transactions);
        const eligibility = evaluateInvoiceEligibilityForMany({
            settings,
            transactions,
            taxSummary,
            existingInvoices,
        });

        res.json(eligibility);
    } catch (err: any) {
        console.error("Invoice eligibility batch error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/invoice-eligibility/:transactionId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const transactionId = Array.isArray(req.params.transactionId)
            ? req.params.transactionId[0]
            : req.params.transactionId;
        const transaction = await getInvoiceTransaction(transactionId);

        if (!transaction) {
            res.status(404).json({ error: "Transaction not found" });
            return;
        }

        if (!["sale", "invoice"].includes(transaction.kind)) {
            res.status(400).json({ error: "Only sale transactions can be invoiced" });
            return;
        }

        const [settings, existingInvoices] = await Promise.all([
            getOrgInvoiceSettings(orgId),
            getExistingInvoicesForTransaction(transactionId, orgId),
        ]);
        const taxSummary = buildTaxSummarySnapshot(transaction);
        const eligibility = evaluateInvoiceEligibility({
            settings,
            transaction,
            taxSummary,
            existingInvoices,
        });

        res.json(eligibility);
    } catch (err: any) {
        console.error("Invoice eligibility error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/invoices", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const {
            limit = 50,
            offset = 0,
            source_transaction_id: sourceTransactionId,
        } = req.query;

        let filteredInvoiceIds: string[] | null = null;
        let directSourceTransactionFilter: string | null = null;
        if (typeof sourceTransactionId === "string" && sourceTransactionId.trim()) {
            const normalizedSourceTransactionId = sourceTransactionId.trim();
            const sourceLinks = await getInvoiceSourceLinksByTransactionIds([normalizedSourceTransactionId]);
            filteredInvoiceIds = Array.from(new Set(sourceLinks.map((link) => link.invoice_id)));

            if (filteredInvoiceIds.length === 0) {
                directSourceTransactionFilter = normalizedSourceTransactionId;
            }
        }

        const { data: invoices, error: invoicesError } = await fetchInvoiceListRows({
            orgId,
            offset: Number(offset),
            limit: Number(limit),
            filteredInvoiceIds,
            sourceTransactionIdFilter: directSourceTransactionFilter,
        });

        if (invoicesError) {
            throw invoicesError;
        }

        if (!Array.isArray(invoices) || invoices.length === 0) {
            res.json([]);
            return;
        }

        const invoiceRows = invoices as Array<Record<string, any>>;
        const invoiceIds = invoiceRows.map((invoice) => invoice.id);
        const sourceLinks = await getInvoiceSourceLinksByInvoiceIds(invoiceIds);
        const sourceLinksByInvoiceId = sourceLinks.reduce<Map<string, InvoiceSourceLinkRecord[]>>((map, link) => {
            const existing = map.get(link.invoice_id) || [];
            existing.push(link);
            map.set(link.invoice_id, existing);
            return map;
        }, new Map());
        const sourceTransactionIds = Array.from(new Set([
            ...sourceLinks.map((link) => link.source_transaction_id),
            ...invoiceRows
                .map((invoice) => invoice.source_transaction_id)
                .filter((value): value is string => typeof value === "string" && value.length > 0),
        ]));

        const transactionMap = new Map<string, any>();

        if (sourceTransactionIds.length > 0) {
            const { data: transactions, error: transactionsError } = await supabaseAdmin
                .from("accounting_transactions")
                .select(`
                    id,
                    description,
                    amount_subtotal,
                    amount_total,
                    status,
                    recorded_date,
                    site:sites(id, name),
                    client:clients(id, name)
                `)
                .in("id", sourceTransactionIds);

            if (transactionsError) {
                throw transactionsError;
            }

            if (Array.isArray(transactions)) {
                for (const transaction of transactions) {
                    transactionMap.set(transaction.id, {
                        ...transaction,
                        site: pickSingleRelation(transaction.site),
                        client: pickSingleRelation(transaction.client),
                    });
                }
            }
        }

        const transactionItemRowsByTransactionId = new Map<string, Array<Record<string, unknown>>>();
        if (sourceTransactionIds.length > 0) {
            const { data: transactionItems, error: transactionItemsError } = await supabaseAdmin
                .from("accounting_transaction_items")
                .select("transaction_id, item_name, quantity, unit_name, unit_price, amount")
                .in("transaction_id", sourceTransactionIds);

            if (transactionItemsError) {
                throw transactionItemsError;
            }

            if (Array.isArray(transactionItems)) {
                for (const item of transactionItems as Array<Record<string, unknown>>) {
                    const transactionId = typeof item.transaction_id === "string" ? item.transaction_id : "";
                    if (!transactionId) {
                        continue;
                    }

                    const existing = transactionItemRowsByTransactionId.get(transactionId) || [];
                    existing.push(item);
                    transactionItemRowsByTransactionId.set(transactionId, existing);
                }
            }
        }

        res.json(invoiceRows.map((invoice) => ({
            ...invoice,
            source_transaction: (() => {
                const invoiceSourceLinks = sourceLinksByInvoiceId.get(invoice.id) || [];
                const primaryLink = invoiceSourceLinks.find((link) => link.is_primary_document) || invoiceSourceLinks[0];
                if (primaryLink) {
                    return transactionMap.get(primaryLink.source_transaction_id) || null;
                }

                return invoice.source_transaction_id
                    ? transactionMap.get(invoice.source_transaction_id) || null
                    : null;
            })(),
            source_summary: invoice.source_summary_snapshot || (() => {
                const invoiceSourceLinks = sourceLinksByInvoiceId.get(invoice.id) || [];
                const sourceTransactions = invoiceSourceLinks
                    .map((link) => transactionMap.get(link.source_transaction_id))
                    .filter(Boolean);

                if (sourceTransactions.length === 0 && invoice.source_transaction_id) {
                    const fallbackTransaction = transactionMap.get(invoice.source_transaction_id);
                    if (fallbackTransaction) {
                        return buildInvoiceSourceSummarySnapshot([fallbackTransaction]);
                    }
                }

                return sourceTransactions.length > 0
                    ? buildInvoiceSourceSummarySnapshot(sourceTransactions)
                    : null;
            })(),
            display_line_items: (() => {
                const invoiceSourceLinks = sourceLinksByInvoiceId.get(invoice.id) || [];
                const sourceTransactions = invoiceSourceLinks
                    .map((link) => transactionMap.get(link.source_transaction_id))
                    .filter(Boolean);

                if (sourceTransactions.length === 0 && invoice.source_transaction_id) {
                    const fallbackTransaction = transactionMap.get(invoice.source_transaction_id);
                    if (fallbackTransaction) {
                        sourceTransactions.push(fallbackTransaction);
                    }
                }

                const itemRows = sourceTransactions.flatMap((transaction) =>
                    transactionItemRowsByTransactionId.get(transaction.id) || []
                );

                return buildInvoiceDisplayLineItems({
                    documentType: invoice.document_type,
                    eligibilitySnapshot: invoice.eligibility_snapshot,
                    sourceTransactions,
                    itemRows,
                }).items;
            })(),
        })));
    } catch (err: any) {
        console.error("Invoices list error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/invoices", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            transaction_id,
            source_transaction_ids,
            issue_date,
            due_date,
            billing_name,
            billing_address,
            notes,
            requested_document_type,
        } = req.body;
        const orgId = req.orgId || DEFAULT_ORG_ID;

        const requestedTransactionIds: string[] = Array.isArray(source_transaction_ids)
            ? source_transaction_ids
                .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
                .map((value: string) => value.trim())
            : (typeof transaction_id === "string" && transaction_id.trim() ? [transaction_id.trim()] : []);

        if (requestedTransactionIds.length === 0) {
            res.status(400).json({ error: "transaction_id or source_transaction_ids is required" });
            return;
        }
        const uniqueTransactionIds: string[] = Array.from(new Set(requestedTransactionIds));

        const normalizedBillingName = normalizeText(billing_name);
        if (!normalizedBillingName) {
            res.status(400).json({ error: "billing_name is required" });
            return;
        }

        if (requested_document_type !== undefined && !isRequestedInvoiceDocumentType(requested_document_type)) {
            res.status(400).json({ error: "requested_document_type must be one of auto, standard_invoice, qualified_invoice" });
            return;
        }

        const transactions = await getInvoiceTransactionsByIds(uniqueTransactionIds);
        if (transactions.length !== uniqueTransactionIds.length) {
            res.status(404).json({ error: "One or more transactions were not found" });
            return;
        }

        if (transactions.some((transaction) => !["sale", "invoice"].includes(transaction.kind))) {
            res.status(400).json({ error: "Only sale transactions can be invoiced" });
            return;
        }

        const uniqueClientIds = Array.from(new Set(
            transactions
                .map((transaction) => transaction.client_id)
                .filter((value): value is string => typeof value === "string" && value.length > 0)
        ));
        if (transactions.length > 1 && (uniqueClientIds.length > 1 || transactions.some((transaction) => !transaction.client_id))) {
            res.status(400).json({ error: "Multiple source transactions must belong to the same client" });
            return;
        }

        const sortedTransactions = [...transactions].sort((left, right) => {
            if (left.recorded_date !== right.recorded_date) {
                return left.recorded_date.localeCompare(right.recorded_date);
            }
            return left.id.localeCompare(right.id);
        });
        const representativeTransaction = sortedTransactions[0];

        const [settings, existingInvoices] = await Promise.all([
            getOrgInvoiceSettings(orgId),
            getExistingInvoicesForSourceTransactions(uniqueTransactionIds, orgId, { primaryOnly: true }),
        ]);
        const taxSummary = buildTaxSummarySnapshotForTransactions(sortedTransactions);
        const eligibility = evaluateInvoiceEligibilityForMany({
            settings,
            transactions: sortedTransactions,
            taxSummary,
            existingInvoices,
        });
        const existingInvoice = existingInvoices.find((invoice) => {
            const documentType = invoice.document_type || "standard_invoice";
            return documentType === "standard_invoice" || documentType === "qualified_invoice";
        });

        if (existingInvoice) {
            res.status(409).json({ error: `Invoice already exists: ${existingInvoice.invoice_no}` });
            return;
        }

        const requestedDocumentType = requested_document_type || "auto";
        if (requestedDocumentType === "qualified_invoice" && !eligibility.eligible_for_qualified_invoice) {
            res.status(422).json({
                error: "Requested qualified invoice is not allowed",
                reason_codes: eligibility.reason_codes,
                reason_messages: eligibility.reason_messages,
            });
            return;
        }

        const resolvedDocumentType = resolveRequestedDocumentType(requestedDocumentType, eligibility);
        const issueDate = issue_date || new Date().toISOString().split("T")[0];
        const notesValue = normalizeText(notes) || settings.invoice_notes_default || null;
        const sourceSummary = buildInvoiceSourceSummarySnapshot(sortedTransactions);

        // 請求書番号を採番
        const { data: invoiceNo, error: seqError } = await supabaseAdmin.rpc("rpc_next_invoice_no", {
            p_issue_date: issueDate,
        });

        if (seqError) throw seqError;

        const { data, error } = await insertInvoiceRecord({
            org_id: orgId,
            transaction_id: representativeTransaction.id,
            source_transaction_id: representativeTransaction.id,
            invoice_no: invoiceNo,
            document_type: resolvedDocumentType,
            issue_date: issueDate,
            due_date,
            source_transaction_date: sourceSummary.period_start || representativeTransaction.recorded_date,
            billing_name: normalizedBillingName,
            billing_address: normalizeText(billing_address),
            issuer_registration_no: resolvedDocumentType === "qualified_invoice"
                ? settings.qualified_invoice_registration_number
                : null,
            notes: notesValue,
            issuer_snapshot: buildIssuerSnapshot(settings),
            registration_number_snapshot: resolvedDocumentType === "qualified_invoice"
                ? settings.qualified_invoice_registration_number
                : null,
            registered_at_snapshot: resolvedDocumentType === "qualified_invoice"
                ? settings.qualified_invoice_registered_at
                : null,
            tax_summary_snapshot: taxSummary,
            source_summary_snapshot: sourceSummary,
            eligibility_snapshot: {
                ...eligibility,
                resolved_document_type: resolvedDocumentType,
                evaluated_at: new Date().toISOString(),
            },
            pdf_render_status: "pending",
            created_by: req.userId!,
        });

        if (error) throw error;

        await insertInvoiceSourceLinks({
            invoiceId: data.id,
            transactions: sortedTransactions,
            isPrimaryDocument: true,
        });

        // Transaction の種別更新
        const { error: txUpdateError } = await supabaseAdmin
            .from("accounting_transactions")
            .update({ kind: "invoice" })
            .in("id", uniqueTransactionIds);

        if (txUpdateError) {
            throw txUpdateError;
        }

        res.status(201).json({
            ...data,
            source_summary: sourceSummary,
            eligibility: {
                eligible_for_qualified_invoice: eligibility.eligible_for_qualified_invoice,
                reason_codes: eligibility.reason_codes,
                reason_messages: eligibility.reason_messages,
                resolved_document_type: resolvedDocumentType,
            },
        });
    } catch (err: any) {
        console.error("Invoice create error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/invoices/:id/correct", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const hasCorrectedLineItemsInput = Object.prototype.hasOwnProperty.call(req.body || {}, "corrected_line_items");
        const correctedBillingName = normalizeText(req.body.billing_name);
        const correctedBillingAddress = normalizeText(req.body.billing_address);
        const correctedNotes = normalizeText(req.body.notes);
        const correctionReasonType = normalizeText(req.body.correction_reason_type);
        const correctionNote = normalizeText(req.body.correction_note);
        const {
            items: correctedLineItems,
            error: correctedLineItemsError,
        } = normalizeSupplementLineItems(req.body.corrected_line_items);

        if (!correctedBillingName) {
            res.status(400).json({ error: "billing_name is required" });
            return;
        }

        if (!correctionReasonType) {
            res.status(400).json({ error: "correction_reason_type is required" });
            return;
        }

        if (!correctionNote) {
            res.status(400).json({ error: "correction_note is required" });
            return;
        }

        if (correctedLineItemsError) {
            res.status(400).json({ error: correctedLineItemsError.replace(/supplement_line_items/g, "corrected_line_items") });
            return;
        }

        const existingInvoice = await getInvoiceById(invoiceId, orgId);
        if (!existingInvoice) {
            res.status(404).json({ error: "Invoice not found" });
            return;
        }

        if (existingInvoice.document_type === "invoice_supplement") {
            res.status(400).json({ error: "Supplements must be handled from the original invoice" });
            return;
        }

        const correctionRecord = {
            mode: "document_only",
            reason_type: correctionReasonType,
            note: correctionNote,
            corrected_at: new Date().toISOString(),
            corrected_by: req.userId!,
            ...(hasCorrectedLineItemsInput ? { corrected_line_items: correctedLineItems } : {}),
        };
        const nextEligibilitySnapshot = {
            ...buildInvoiceCorrectionSnapshot(
                existingInvoice.eligibility_snapshot,
                correctionRecord
            ),
            ...(hasCorrectedLineItemsInput ? { corrected_line_items: correctedLineItems } : {}),
        };

        const { data, error } = await supabaseAdmin
            .from("accounting_invoices")
            .update({
                billing_name: correctedBillingName,
                billing_address: correctedBillingAddress,
                notes: correctedNotes,
                eligibility_snapshot: nextEligibilitySnapshot,
                pdf_render_status: "pending",
            })
            .eq("id", invoiceId)
            .eq("org_id", orgId)
            .select()
            .single();

        if (error) {
            throw error;
        }

        res.json(data);
    } catch (err: any) {
        console.error("Invoice correction error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/invoices/:id/supplement", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const issueDate = normalizeText(req.body.issue_date) || new Date().toISOString().split("T")[0];
        const supplementNote = normalizeText(req.body.correction_note);
        const correctionReasonType = normalizeText(req.body.correction_reason_type);
        const {
            items: supplementLineItems,
            error: supplementLineItemsError,
        } = normalizeSupplementLineItems(req.body.supplement_line_items);

        if (!correctionReasonType) {
            res.status(400).json({ error: "correction_reason_type is required" });
            return;
        }

        if (!supplementNote) {
            res.status(400).json({ error: "correction_note is required" });
            return;
        }

        if (supplementLineItemsError) {
            res.status(400).json({ error: supplementLineItemsError });
            return;
        }

        const baseInvoice = await getInvoiceById(invoiceId, orgId);
        if (!baseInvoice) {
            res.status(404).json({ error: "Invoice not found" });
            return;
        }

        if (baseInvoice.document_type !== "standard_invoice") {
            res.status(400).json({ error: "Only standard invoices can be supplemented" });
            return;
        }

        const settings = await getOrgInvoiceSettings(orgId);
        if (settings.invoice_issuer_status !== "registered") {
            res.status(422).json({ error: "Supplement requires a registered invoice issuer" });
            return;
        }

        if (!isValidQualifiedInvoiceRegistrationNumber(settings.qualified_invoice_registration_number)) {
            res.status(422).json({ error: "Qualified invoice registration number is not configured" });
            return;
        }

        if (!settings.qualified_invoice_registered_at) {
            res.status(422).json({ error: "Qualified invoice registration date is not configured" });
            return;
        }

        if (baseInvoice.source_transaction_date < settings.qualified_invoice_registered_at) {
            res.status(422).json({ error: "The source transaction predates the registration date" });
            return;
        }

        const { data: existingSupplement, error: existingSupplementError } = await supabaseAdmin
            .from("accounting_invoices")
            .select("id, invoice_no")
            .eq("org_id", orgId)
            .eq("supplements_invoice_id", invoiceId)
            .maybeSingle();

        if (existingSupplementError) {
            throw existingSupplementError;
        }

        if (existingSupplement) {
            res.status(409).json({ error: `Supplement already exists: ${existingSupplement.invoice_no}` });
            return;
        }

        const baseSourceLinks = await getInvoiceSourceLinksByInvoiceIds([invoiceId]);
        const baseSourceTransactions = baseSourceLinks.length > 0
            ? await getInvoiceTransactionsByIds(baseSourceLinks.map((link) => link.source_transaction_id))
            : [await getInvoiceTransaction(baseInvoice.source_transaction_id)].filter(Boolean) as InvoiceTransaction[];
        const sourceSummary = baseInvoice.source_summary_snapshot
            || buildInvoiceSourceSummarySnapshot(baseSourceTransactions);

        const { data: invoiceNo, error: seqError } = await supabaseAdmin.rpc("rpc_next_invoice_no", {
            p_issue_date: issueDate,
        });

        if (seqError) {
            throw seqError;
        }

        const correctionRecord = {
            mode: "supplement",
            reason_type: correctionReasonType,
            note: supplementNote,
            corrected_at: new Date().toISOString(),
            corrected_by: req.userId!,
            supplements_invoice_id: invoiceId,
            ...(supplementLineItems.length > 0 ? { supplement_line_items: supplementLineItems } : {}),
        };
        const nextEligibilitySnapshot = {
            ...buildInvoiceCorrectionSnapshot(baseInvoice.eligibility_snapshot, correctionRecord),
            ...(supplementLineItems.length > 0 ? { supplement_line_items: supplementLineItems } : {}),
        };

        const { data, error } = await insertInvoiceRecord({
            org_id: orgId,
            transaction_id: baseInvoice.transaction_id,
            source_transaction_id: baseInvoice.source_transaction_id,
            invoice_no: invoiceNo,
            document_type: "invoice_supplement",
            issue_date: issueDate,
            due_date: baseInvoice.due_date,
            source_transaction_date: baseInvoice.source_transaction_date,
            billing_name: baseInvoice.billing_name,
            billing_address: baseInvoice.billing_address,
            issuer_registration_no: settings.qualified_invoice_registration_number,
            notes: supplementNote,
            issuer_snapshot: buildIssuerSnapshot(settings),
            registration_number_snapshot: settings.qualified_invoice_registration_number,
            registered_at_snapshot: settings.qualified_invoice_registered_at,
            tax_summary_snapshot: baseInvoice.tax_summary_snapshot,
            source_summary_snapshot: sourceSummary,
            eligibility_snapshot: nextEligibilitySnapshot,
            supplements_invoice_id: invoiceId,
            supplemented_at: new Date().toISOString(),
            pdf_render_status: "pending",
            created_by: req.userId!,
        });

        if (error) {
            throw error;
        }

        await insertInvoiceSourceLinks({
            invoiceId: data.id,
            transactions: baseSourceTransactions,
            isPrimaryDocument: false,
        });

        res.status(201).json(data);
    } catch (err: any) {
        console.error("Invoice supplement error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/invoices/:id/download", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const storedPdf = await ensureInvoicePdfStored({
            invoiceId,
            orgId,
        });

        if (!storedPdf) {
            res.status(404).json({ error: "Invoice not found" });
            return;
        }

        const { data: fileData, error: downloadError } = await supabaseAdmin.storage
            .from(INVOICE_PDF_BUCKET)
            .download(storedPdf.storagePath);

        if (downloadError || !fileData) {
            res.status(500).json({ error: "Failed to download invoice PDF" });
            return;
        }

        const arrayBuffer = await fileData.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const encodedFilename = encodeURIComponent(storedPdf.filename);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(buffer.byteLength));
        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${storedPdf.filename}"; filename*=UTF-8''${encodedFilename}`
        );
        res.send(buffer);
    } catch (err: any) {
        console.error("Invoice download error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Void（取消 / 逆仕訳）
// ============================================================

router.post("/void/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const orgId = req.orgId || DEFAULT_ORG_ID;
        const reason = normalizeText(req.body?.reason);

        if (!reason) {
            res.status(400).json({ error: "reason is required" });
            return;
        }

        // 元の取引を取得
        const { data: original, error: fetchError } = await supabaseAdmin
            .from("accounting_transactions")
            .select("*")
            .eq("id", id)
            .maybeSingle();

        if (fetchError) {
            throw fetchError;
        }

        if (!original) {
            res.status(404).json({ error: "Transaction not found" });
            return;
        }

        if (original.voids_transaction_id) {
            res.status(409).json({ error: "取消で作成された逆仕訳は再度取消できません" });
            return;
        }

        if (original.status === "voided") {
            res.status(409).json({ error: "この取引はすでに取消済みです" });
            return;
        }

        if (!VOIDABLE_TRANSACTION_STATUSES.includes(original.status)) {
            res.status(409).json({ error: "記帳済みまたは承認済みの取引のみ取消できます" });
            return;
        }

        if (original.kind === "invoice") {
            res.status(409).json({ error: "請求済み売上はこの画面から取消できません" });
            return;
        }

        const linkedInvoices = await getExistingInvoicesForTransaction(id, orgId);
        if (linkedInvoices.length > 0) {
            res.status(409).json({ error: "請求書に紐づく取引は取消できません" });
            return;
        }

        const { data: existingReversal, error: existingReversalError } = await supabaseAdmin
            .from("accounting_transactions")
            .select("id")
            .eq("voids_transaction_id", id)
            .maybeSingle();

        if (existingReversalError && !isPostgrestNoRowsError(existingReversalError)) {
            throw existingReversalError;
        }

        if (existingReversal) {
            res.status(409).json({ error: "この取引はすでに取消済みです" });
            return;
        }

        // 元の取引を voided に更新。status 条件を付けて多重実行を防ぐ。
        const { data: voidedOriginal, error: updateError } = await supabaseAdmin
            .from("accounting_transactions")
            .update({
                status: "voided",
                voided_by: req.userId!,
                voided_at: new Date().toISOString(),
                void_reason: reason,
            })
            .eq("id", id)
            .in("status", [...VOIDABLE_TRANSACTION_STATUSES])
            .select("*")
            .maybeSingle();

        if (updateError && !isPostgrestNoRowsError(updateError)) {
            throw updateError;
        }

        if (!voidedOriginal) {
            res.status(409).json({ error: "この取引はすでに取消済みです" });
            return;
        }

        // 逆仕訳（マイナス金額）を作成
        const { data: reversal, error: reversalError } = await supabaseAdmin
            .from("accounting_transactions")
            .insert({
                org_id: voidedOriginal.org_id || orgId,
                kind: voidedOriginal.kind,
                cost_center: voidedOriginal.cost_center,
                site_id: voidedOriginal.site_id,
                client_id: voidedOriginal.client_id,
                vendor_name: voidedOriginal.vendor_name,
                description: `【取消】${voidedOriginal.description || ""} - ${reason}`,
                recorded_date: new Date().toISOString().split("T")[0],
                amount_subtotal: -voidedOriginal.amount_subtotal,
                tax_amount: -voidedOriginal.tax_amount,
                amount_total: -voidedOriginal.amount_total,
                category: voidedOriginal.category,
                status: "posted",
                voids_transaction_id: id,
                tax_category: voidedOriginal.tax_category,
                created_by: req.userId!,
            })
            .select()
            .single();

        if (reversalError) {
            if (isDuplicateKeyError(reversalError)) {
                res.status(409).json({ error: "この取引はすでに取消済みです" });
                return;
            }
            throw reversalError;
        }

        // 逆仕訳の仕訳エントリ作成
        await createJournalEntry(reversal, req.userId!);

        res.json({ original_voided: id, reversal_created: reversal.id });
    } catch (err: any) {
        console.error("Void error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// PL（月次損益）
// ============================================================

router.get("/pl", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { month, site_id, cost_center } = req.query;

        // デフォルトは今月
        const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);
        const startDate = `${targetMonth}-01`;
        // 月末日を正しく計算
        const [year, mon] = targetMonth.split("-").map(Number);
        const lastDay = new Date(year, mon, 0).getDate();
        const endDate = `${targetMonth}-${String(lastDay).padStart(2, "0")}`;

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select("*")
            .in("status", ["posted", "approved"])
            .gte("recorded_date", startDate)
            .lte("recorded_date", endDate);

        if (site_id) {
            query = query.eq("site_id", site_id);
        }
        if (cost_center) {
            query = query.eq("cost_center", cost_center);
        }

        const { data, error } = await query;

        if (error) throw error;

        // 集計
        let sales = 0;
        let expenses = 0;

        for (const tx of data || []) {
            if (tx.kind === "sale" || tx.kind === "invoice") {
                sales += tx.amount_total || 0;
            } else if (tx.kind === "expense") {
                expenses += tx.amount_total || 0;
            }
        }

        const profit = sales - expenses;
        const distributable = profit * 0.7; // 会社留保30%

        res.json({
            month: targetMonth,
            sales,
            expenses,
            profit,
            distributable,
            transaction_count: data?.length || 0,
        });
    } catch (err: any) {
        console.error("PL error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Transactions（取引一覧）
// ============================================================

// 取引検索
router.get("/transactions/search", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const {
            q,
            kind,
            date_from,
            date_to,
            limit = 50,
            offset = 0,
        } = req.query;

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select(`
                *,
                site:sites(id, name),
                client:clients(id, name),
                source_document:documents(id, storage_path, drive_file_id, drive_file_url, original_filename, mime_type, ocr_fields),
                items:accounting_transaction_items(item_name, quantity, unit_name, unit_price, amount)
            `)
            .order("recorded_date", { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        // 種別フィルター
        if (kind && ["expense", "sale", "invoice"].includes(kind as string)) {
            query = query.eq("kind", kind);
        }

        // 日付範囲フィルター
        if (date_from) {
            query = query.gte("recorded_date", date_from as string);
        }
        if (date_to) {
            query = query.lte("recorded_date", date_to as string);
        }

        const { data, error } = await query;

        if (error) throw error;

        // テキスト検索（q）はDB側でILIKEを使うか、メモリでフィルタリング
        // Supabaseのor+ilikeは複雑なので、シンプルにメモリフィルタリングを採用
        let results = data || [];

        if (q && typeof q === "string" && q.trim()) {
            const searchTerm = q.toLowerCase().trim();
            results = results.filter((tx) => {
                const vendorMatch = tx.vendor_name?.toLowerCase().includes(searchTerm);
                const descMatch = tx.description?.toLowerCase().includes(searchTerm);
                const siteMatch = tx.site?.name?.toLowerCase().includes(searchTerm);
                const clientMatch = tx.client?.name?.toLowerCase().includes(searchTerm);
                return vendorMatch || descMatch || siteMatch || clientMatch;
            });
        }

        res.json(results);
    } catch (err: any) {
        console.error("Transaction search error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/transactions", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { kind, status, created_by, date_from, date_to, limit = 50, offset = 0 } = req.query;

        let query = supabaseAdmin
            .from("accounting_transactions")
            .select(`
        *,
        site:sites(id, name),
        client:clients(id, name),
        source_document:documents(id, storage_path, drive_file_id, drive_file_url, original_filename, mime_type, ocr_fields),
        items:accounting_transaction_items(item_name, quantity, unit_name, unit_price, amount)
      `)
            .order("recorded_date", { ascending: false })
            .range(Number(offset), Number(offset) + Number(limit) - 1);

        if (kind) {
            query = query.eq("kind", kind);
        }
        if (status) {
            query = query.eq("status", status);
        }
        if (typeof created_by === "string" && created_by.trim()) {
            query = query.eq("created_by", created_by.trim());
        }
        if (typeof date_from === "string" && date_from.trim()) {
            query = query.gte("recorded_date", date_from.trim());
        }
        if (typeof date_to === "string" && date_to.trim()) {
            query = query.lte("recorded_date", date_to.trim());
        }

        const { data, error } = await query;

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        console.error("Transactions error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 未承認取引一覧
router.get("/pending-approvals", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .select(`
        *,
        site:sites(id, name),
        source_document:documents(id, storage_path, drive_file_id, drive_file_url, original_filename, mime_type, ocr_fields)
      `)
            .eq("status", "pending_review")
            .eq("reviewer_id", req.userId!)
            .order("created_at", { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        console.error("Pending approvals error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// Helper: 仕訳エントリ作成
// ============================================================

async function createJournalEntry(transaction: any, userId: string) {
    const { data: existingEntry, error: existingEntryError } = await supabaseAdmin
        .from("accounting_journal_entries")
        .select("id")
        .eq("transaction_id", transaction.id)
        .maybeSingle();

    if (existingEntryError) throw existingEntryError;
    if (existingEntry) {
        return existingEntry;
    }

    const { data: entry, error: entryError } = await supabaseAdmin
        .from("accounting_journal_entries")
        .insert({
            transaction_id: transaction.id,
            entry_date: transaction.recorded_date,
            memo: transaction.description,
            posted_at: new Date().toISOString(),
            created_by: userId,
        })
        .select()
        .single();

    if (entryError) throw entryError;

    // 仕訳明細（消費税分離対応）
    const lines: any[] = [];
    let lineNo = 1;

    const subtotal = Math.abs(transaction.amount_subtotal || 0);
    const taxAmount = Math.abs(transaction.tax_amount || 0);
    const total = Math.abs(transaction.amount_total || 0);

    const taxRate = resolveTaxRate(transaction.tax_category);
    const taxType = resolveExpenseTaxType(transaction.tax_category);

    if (transaction.kind === "sale" || transaction.kind === "invoice") {
        // 売上: 借方=売掛金、貸方=売上高+仮受消費税
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "1200",
            account_name: "売掛金",
            debit: total,
            credit: 0,
        });

        // 売上高（税抜）
        const salesAmount = normalizeNetSubtotal(subtotal, taxAmount, total);
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "4100",
            account_name: "売上高",
            debit: 0,
            credit: salesAmount,
            tax_rate: taxRate,
            tax_type: taxType,
        });

        // 仮受消費税（税額がある場合）
        if (taxAmount > 0) {
            lines.push({
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "2500",
                account_name: "仮受消費税",
                debit: 0,
                credit: taxAmount,
            });
        }
    } else if (transaction.kind === "expense") {
        // 経費: 借方=経費+仮払消費税、貸方=現金
        const expenseAccount = resolveExpenseAccount(transaction.category);

        // 経費（税抜）
        const expenseAmount = normalizeNetSubtotal(subtotal, taxAmount, total);
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: expenseAccount.code,
            account_name: expenseAccount.name,
            debit: expenseAmount,
            credit: 0,
            tax_rate: taxRate,
            tax_type: taxType,
        });

        // 仮払消費税（税額がある場合）
        if (taxAmount > 0) {
            lines.push({
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "1500",
                account_name: "仮払消費税",
                debit: taxAmount,
                credit: 0,
            });
        }

        // 現金（税込総額）
        lines.push({
            entry_id: entry.id,
            line_no: lineNo++,
            account_code: "1100",
            account_name: "現金",
            debit: 0,
            credit: total,
        });
    }

    if (lines.length > 0) {
        const { error: linesError } = await supabaseAdmin
            .from("accounting_journal_lines")
            .insert(lines);

        if (linesError) throw linesError;
    }

    return entry;
}

export default router;
