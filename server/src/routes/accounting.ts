import { Router, Response } from "express";
import { createHash } from "crypto";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { analyzeDocument, assessExpenseRisk, OcrResult } from "../services/ocrService";
import { getDriveStorageService } from "../services/DriveStorageService";
import { ensureInvoicePdfStored, INVOICE_PDF_BUCKET } from "../services/InvoicePdfService";
import { buildInvoiceDisplayLineItems } from "../services/InvoiceLineItemsService";
import { assertActiveClientForOrg } from "../services/ClientDirectoryService";
import {
    AccountingCommandError,
    createAccountingCommandProposalLineage,
    createAccountingInvoice,
    createJournalEntry,
    createVoidReversal,
    insertExpenseTransaction,
    insertInvoiceRecord,
    insertInvoiceSourceLinks,
    insertSaleTransactionWithItems,
    postCanonicalExpense,
    postCanonicalSale,
    recordPaymentEvent,
    recordPaymentAllocation,
    reverseCanonicalSale,
} from "../services/AccountingCommandService";
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
    resolveRequestedDocumentType,
} from "../services/InvoiceEligibilityService";

const router = Router();
const EXPENSE_REVIEW_PENDING_STATUS = "pending_review";
const EXPENSE_REVIEW_PENDING = "pending";
const EXPENSE_REVIEW_NOT_REQUIRED = "not_required";
const POSTED_STATUS = "posted";
const EXPENSE_CATEGORIES = ["material", "tool", "travel", "food", "fuel", "utility", "other"] as const;
const EXPENSE_TAX_CATEGORIES = ["10_STANDARD", "08_REDUCED", "00_EXEMPT", "00_TAXFREE"] as const;
const INVOICE_SETTINGS_MANAGER_ROLES = new Set(["admin", "manager"]);
const DEFAULT_SALE_TAX_CATEGORY = "10_STANDARD";
const DEFAULT_SALE_TAX_RATE = 0.1;
const DEFAULT_SALE_UNIT_NAME = "式";
const LEDGER_AGGREGATION_STATUSES = ["posted", "approved", "voided"] as const;
const PL_SOURCES = ["legacy", "journal", "compare"] as const;
const PL_REVENUE_NET_ACCOUNT_CODES = new Set(["4100"]);
const PL_EXPENSE_NET_ACCOUNT_CODES = new Set(["5100", "5110", "5120", "5130", "5140", "5200", "5300", "5400", "5900"]);
const PL_REVENUE_GROSS_COMPAT_ACCOUNT_CODES = new Set([...PL_REVENUE_NET_ACCOUNT_CODES, "2500"]);
const PL_EXPENSE_GROSS_COMPAT_ACCOUNT_CODES = new Set([...PL_EXPENSE_NET_ACCOUNT_CODES, "1500"]);
const PL_NO_REVENUE_POSTING_GROUP_TYPES = new Set(["invoice_transfer", "payment_receipt", "payment_allocation"]);

type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
type ExpenseTaxCategory = typeof EXPENSE_TAX_CATEGORIES[number];
type PlSource = typeof PL_SOURCES[number];
type PlJournalBasis = "net_accounting" | "gross_compat";
type PlSummary = {
    sales: number;
    expenses: number;
    profit: number;
    distributable: number;
    transaction_count?: number;
    journal_entry_count?: number;
    journal_line_count?: number;
};
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

type AccountingWriteEndpoint =
    | "accounting.expenses.create"
    | "accounting.sales.adjust"
    | "accounting.invoices.create"
    | "accounting.payments.create"
    | "accounting.payments.allocate"
    | "accounting.void.create";

type AccountingIdempotencyStart =
    | {
        mode: "created";
        id: string;
        endpointName: AccountingWriteEndpoint;
        idempotencyKey: string;
        requestHash: string;
    }
    | {
        mode: "replay";
        responseStatus: number;
        responseJson: unknown;
    };

class AccountingRouteError extends Error {
    status: number;

    constructor(status: number, message: string) {
        super(message);
        this.status = status;
    }
}

router.use(async (req: AuthenticatedRequest, res, next) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        req.orgId = membership.org_id;
        req.orgMembershipId = membership.id ?? null;
        next();
    } catch (err) {
        const message = err instanceof Error ? err.message : "ORG_ACCESS_ERROR";
        const status = message === "INVALID_ORG_ID" ? 400 : 403;
        res.status(status).json({ error: message });
    }
});

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

function isOrgScopedStoragePath(orgId: string, storagePath: string | null | undefined): storagePath is string {
    return typeof storagePath === "string" && storagePath.startsWith(`${orgId}/`);
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

function toMoneyNumber(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value;
    }

    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    return 0;
}

function normalizePlSource(value: unknown): PlSource {
    return typeof value === "string" && PL_SOURCES.includes(value as PlSource)
        ? value as PlSource
        : "legacy";
}

function completePlSummary(input: {
    sales: number;
    expenses: number;
    transactionCount?: number;
    journalEntryCount?: number;
    journalLineCount?: number;
}): PlSummary {
    const sales = roundMoney(input.sales);
    const expenses = roundMoney(input.expenses);
    const profit = roundMoney(sales - expenses);
    const distributable = roundMoney(Math.max(profit, 0) * 0.7);

    return {
        sales,
        expenses,
        profit,
        distributable,
        ...(input.transactionCount !== undefined ? { transaction_count: input.transactionCount } : {}),
        ...(input.journalEntryCount !== undefined ? { journal_entry_count: input.journalEntryCount } : {}),
        ...(input.journalLineCount !== undefined ? { journal_line_count: input.journalLineCount } : {}),
    };
}

function summarizeLegacyPlRows(rows: Array<Record<string, unknown>>): PlSummary {
    let sales = 0;
    let expenses = 0;

    for (const tx of rows) {
        if (tx.kind === "sale" || tx.kind === "invoice") {
            sales += toMoneyNumber(tx.amount_total);
        } else if (tx.kind === "expense") {
            expenses += toMoneyNumber(tx.amount_total);
        }
    }

    return completePlSummary({
        sales,
        expenses,
        transactionCount: rows.length,
    });
}

function firstNestedRecord(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) {
        const first = value[0];
        return first && typeof first === "object" ? first as Record<string, unknown> : null;
    }

    return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function shouldSkipJournalEntryForPl(
    entry: Record<string, unknown>,
    costCenterFilter: unknown,
): boolean {
    if (!entry.posted_at) {
        return true;
    }

    const postingGroup = firstNestedRecord(entry.posting_group);
    const groupType = postingGroup?.group_type;
    if (typeof groupType === "string" && PL_NO_REVENUE_POSTING_GROUP_TYPES.has(groupType)) {
        return true;
    }

    const transaction = firstNestedRecord(entry.transaction);
    if (transaction?.kind === "invoice") {
        return true;
    }

    if (typeof costCenterFilter === "string" && costCenterFilter) {
        return transaction?.cost_center !== costCenterFilter;
    }

    return false;
}

function summarizeJournalPlRows(
    entries: Array<Record<string, unknown>>,
    filters: { siteId?: unknown; costCenter?: unknown },
    basis: PlJournalBasis = "net_accounting",
): PlSummary {
    let sales = 0;
    let expenses = 0;
    let journalEntryCount = 0;
    let journalLineCount = 0;
    const revenueAccountCodes = basis === "gross_compat"
        ? PL_REVENUE_GROSS_COMPAT_ACCOUNT_CODES
        : PL_REVENUE_NET_ACCOUNT_CODES;
    const expenseAccountCodes = basis === "gross_compat"
        ? PL_EXPENSE_GROSS_COMPAT_ACCOUNT_CODES
        : PL_EXPENSE_NET_ACCOUNT_CODES;

    for (const entry of entries) {
        if (shouldSkipJournalEntryForPl(entry, filters.costCenter)) {
            continue;
        }

        const transaction = firstNestedRecord(entry.transaction);
        const linesValue = entry.lines ?? entry.accounting_journal_lines;
        const lines = Array.isArray(linesValue) ? linesValue : [];
        let countedEntry = false;

        for (const rawLine of lines) {
            if (!rawLine || typeof rawLine !== "object") {
                continue;
            }

            const line = rawLine as Record<string, unknown>;
            const lineSiteId = line.site_id ?? transaction?.site_id;
            if (typeof filters.siteId === "string" && filters.siteId && lineSiteId !== filters.siteId) {
                continue;
            }

            const accountCode = typeof line.account_code === "string" ? line.account_code : "";
            const debit = toMoneyNumber(line.debit);
            const credit = toMoneyNumber(line.credit);

            if (revenueAccountCodes.has(accountCode)) {
                sales += credit - debit;
                journalLineCount += 1;
                countedEntry = true;
            } else if (expenseAccountCodes.has(accountCode)) {
                expenses += debit - credit;
                journalLineCount += 1;
                countedEntry = true;
            }
        }

        if (countedEntry) {
            journalEntryCount += 1;
        }
    }

    return completePlSummary({
        sales,
        expenses,
        journalEntryCount,
        journalLineCount,
    });
}

function buildPlDiff(legacy: PlSummary, journal: PlSummary): Pick<PlSummary, "sales" | "expenses" | "profit" | "distributable"> {
    return {
        sales: roundMoney(journal.sales - legacy.sales),
        expenses: roundMoney(journal.expenses - legacy.expenses),
        profit: roundMoney(journal.profit - legacy.profit),
        distributable: roundMoney(journal.distributable - legacy.distributable),
    };
}

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

function isDuplicateKeyError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const code = "code" in error ? error.code : "";
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return code === "23505" || message.includes("duplicate key value") || message.includes("23505");
}

function canonicalizeForHash(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(canonicalizeForHash);
    }

    if (value && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>)
            .sort()
            .reduce<Record<string, unknown>>((acc, key) => {
                if (key !== "idempotency_key") {
                    acc[key] = canonicalizeForHash((value as Record<string, unknown>)[key]);
                }
                return acc;
            }, {});
    }

    return value;
}

function buildRequestHash(body: unknown): string {
    return createHash("sha256")
        .update(JSON.stringify(canonicalizeForHash(body)))
        .digest("hex");
}

function withAccountingCommandEnvelope<T extends Record<string, unknown>>(
    legacyPayload: T,
    input: {
        endpointName: AccountingWriteEndpoint;
        projection: Record<string, unknown>;
        proposal?: Record<string, unknown> | null;
        approvalStatus?: string;
        execution?: Record<string, unknown> | null;
        postingStatus?: string;
        mode?: string;
        postingMetadata?: Record<string, unknown>;
    },
): T & {
    proposal: Record<string, unknown> | null;
    approval: Record<string, unknown>;
    execution: Record<string, unknown>;
    posting: Record<string, unknown>;
    projection: Record<string, unknown>;
} {
    return {
        ...legacyPayload,
        proposal: input.proposal ?? null,
        approval: {
            status: input.approvalStatus || "legacy_direct",
            mode: input.mode || "legacy_direct",
        },
        execution: input.execution
            ? {
                ...input.execution,
                status: input.execution.status || "succeeded",
                mode: input.mode || input.execution.mode || "legacy_direct",
                endpoint_name: input.endpointName,
                proposal_id: input.execution.proposal_id ?? input.proposal?.id ?? null,
            }
            : {
                status: "succeeded",
                mode: input.mode || "legacy_direct",
                endpoint_name: input.endpointName,
                proposal_id: input.proposal?.id ?? null,
            },
        posting: {
            status: input.postingStatus || "legacy_projection",
            mode: input.mode || "legacy_projection",
            ...(input.postingMetadata || {}),
        },
        projection: input.projection,
    };
}

function readIdempotencyKey(body: unknown): string {
    const value = body && typeof body === "object"
        ? (body as Record<string, unknown>).idempotency_key
        : null;

    if (typeof value !== "string" || !value.trim()) {
        throw new AccountingRouteError(400, "idempotency_key is required");
    }

    return value.trim();
}

async function beginAccountingWriteIdempotency(input: {
    orgId: string;
    endpointName: AccountingWriteEndpoint;
    idempotencyKey: string;
    requestBody: unknown;
}): Promise<AccountingIdempotencyStart> {
    const requestHash = buildRequestHash(input.requestBody);
    const insertResult = await supabaseAdmin
        .from("accounting_write_idempotency_keys")
        .insert({
            org_id: input.orgId,
            endpoint_name: input.endpointName,
            idempotency_key: input.idempotencyKey,
            request_hash: requestHash,
            status: "in_progress",
            locked_at: new Date().toISOString(),
        })
        .select("id,request_hash,status,response_status,response_json")
        .single();

    if (!insertResult.error && insertResult.data) {
        return {
            mode: "created",
            id: insertResult.data.id,
            endpointName: input.endpointName,
            idempotencyKey: input.idempotencyKey,
            requestHash,
        };
    }

    if (!isDuplicateKeyError(insertResult.error)) {
        throw insertResult.error;
    }

    const { data: existing, error: existingError } = await supabaseAdmin
        .from("accounting_write_idempotency_keys")
        .select("id,request_hash,status,response_status,response_json")
        .eq("org_id", input.orgId)
        .eq("endpoint_name", input.endpointName)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();

    if (existingError) {
        throw existingError;
    }

    if (!existing) {
        throw new AccountingRouteError(409, "IDEMPOTENCY_STATE_CONFLICT");
    }

    if (existing.request_hash && existing.request_hash !== requestHash) {
        throw new AccountingRouteError(409, "IDEMPOTENCY_CONFLICT");
    }

    if (existing.status === "succeeded") {
        return {
            mode: "replay",
            responseStatus: typeof existing.response_status === "number" ? existing.response_status : 200,
            responseJson: existing.response_json || {},
        };
    }

    throw new AccountingRouteError(409, `IDEMPOTENCY_${String(existing.status || "in_progress").toUpperCase()}`);
}

async function completeAccountingWriteIdempotency(
    idempotency: AccountingIdempotencyStart | null,
    responseStatus: number,
    responseJson: unknown,
): Promise<void> {
    if (!idempotency || idempotency.mode !== "created") {
        return;
    }

    const { error } = await supabaseAdmin
        .from("accounting_write_idempotency_keys")
        .update({
            status: "succeeded",
            response_status: responseStatus,
            response_json: responseJson || {},
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
        })
        .eq("id", idempotency.id);

    if (error) {
        throw error;
    }
}

async function failAccountingWriteIdempotency(
    idempotency: AccountingIdempotencyStart | null,
    errorCode: string,
): Promise<void> {
    if (!idempotency || idempotency.mode !== "created") {
        return;
    }

    await supabaseAdmin
        .from("accounting_write_idempotency_keys")
        .update({
            status: "failed",
            response_json: { error: errorCode },
            updated_at: new Date().toISOString(),
        })
        .eq("id", idempotency.id);
}

async function assertSiteBelongsToOrg(siteId: string, orgId: string) {
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

    return data;
}

async function assertSiteSalesMutable(siteId: string, orgId: string): Promise<void> {
    const data = await assertSiteBelongsToOrg(siteId, orgId);

    if (String(data.status ?? "") === "completed") {
        throw new Error("SITE_COMPLETED_SALES_IMMUTABLE");
    }
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

async function getInvoiceTransactionsByIds(transactionIds: string[], orgId: string): Promise<InvoiceTransaction[]> {
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
        .eq("org_id", orgId)
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

async function getInvoiceTransaction(transactionId: string, orgId: string) {
    const [transaction] = await getInvoiceTransactionsByIds([transactionId], orgId);
    return transaction || null;
}

async function getInvoiceSourceLinksByTransactionIds(
    transactionIds: string[],
    orgId: string,
    options?: { primaryOnly?: boolean }
): Promise<InvoiceSourceLinkRecord[]> {
    if (transactionIds.length === 0) {
        return [];
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .select("invoice_id, source_transaction_id, source_transaction_date, sort_order, is_primary_document")
        .eq("org_id", orgId)
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

async function getInvoiceSourceLinksByInvoiceIds(invoiceIds: string[], orgId: string): Promise<InvoiceSourceLinkRecord[]> {
    if (invoiceIds.length === 0) {
        return [];
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .select("invoice_id, source_transaction_id, source_transaction_date, sort_order, is_primary_document")
        .eq("org_id", orgId)
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
    const sourceLinks = await getInvoiceSourceLinksByTransactionIds(transactionIds, orgId, options);
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

async function getExistingInvoicesForTransaction(transactionId: string, orgId: string) {
    return getExistingInvoicesForSourceTransactions([transactionId], orgId);
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
        const orgId = req.orgId!;

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

        if (site_id) {
            try {
                await assertSiteBelongsToOrg(site_id, orgId);
            } catch {
                res.status(400).json({ error: "site_id is invalid or unavailable" });
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
        const storagePath = `${orgId}/${req.userId!}/${timestamp}.${ext}`;

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
            .eq("org_id", req.orgId!)
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
            if (!isOrgScopedStoragePath(req.orgId!, doc.storage_path)) {
                res.status(403).json({ error: "Document storage path is outside active org" });
                return;
            }

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
            .eq("org_id", req.orgId!)
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
    let idempotency: AccountingIdempotencyStart | null = null;
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
            expense_scope,
            paid_by,
            claimant_member_id,
            settlement_type,
            payment_account,
            reimbursement_status,
            recurring_template_id,
        } = req.body;
        const orgId = req.orgId!;
        const normalizedCategory = normalizeExpenseCategory(category);
        const normalizedTaxCategory = normalizeExpenseTaxCategory(tax_category) || "10_STANDARD";
        const normalizedExpenseItemCode = normalizeText(expense_item_code);
        const normalizedExpenseItemOther = normalizeText(expense_item_other);
        const normalizedExpenseScope = normalizeText(expense_scope) || (cost_center === "HQ" ? "overhead" : "job");
        const normalizedPaidBy = normalizeText(paid_by) || "org";
        const normalizedClaimantMemberId = normalizeText(claimant_member_id);
        const normalizedSettlementType = normalizeText(settlement_type) || "paid";
        const normalizedPaymentAccount = normalizeText(payment_account);
        const normalizedReimbursementStatus = normalizeText(reimbursement_status)
            || (normalizedPaidBy === "member" ? "unsubmitted" : null);
        const normalizedRecurringTemplateId = normalizeText(recurring_template_id);
        const resolvedCostCenter = normalizedExpenseScope === "overhead" ? "HQ" : (cost_center || "SITE");
        const resolvedSiteId = normalizedExpenseScope === "overhead" ? null : site_id;

        if (normalizedExpenseScope !== "job" && normalizedExpenseScope !== "overhead") {
            res.status(400).json({ error: "expense_scope must be one of job, overhead" });
            return;
        }

        if (normalizedPaidBy !== "org" && normalizedPaidBy !== "member") {
            res.status(400).json({ error: "paid_by must be one of org, member" });
            return;
        }

        if (normalizedPaidBy === "member" && !normalizedClaimantMemberId) {
            res.status(400).json({ error: "claimant_member_id is required when paid_by is member" });
            return;
        }

        if (normalizedSettlementType !== "paid" && normalizedSettlementType !== "unpaid") {
            res.status(400).json({ error: "settlement_type must be one of paid, unpaid" });
            return;
        }

        if (normalizedPaymentAccount && normalizedPaymentAccount !== "cash" && normalizedPaymentAccount !== "bank") {
            res.status(400).json({ error: "payment_account must be one of cash, bank" });
            return;
        }

        if (
            normalizedReimbursementStatus
            && !["unsubmitted", "submitted", "approved", "reimbursed"].includes(normalizedReimbursementStatus)
        ) {
            res.status(400).json({ error: "reimbursement_status must be one of unsubmitted, submitted, approved, reimbursed" });
            return;
        }

        if (resolvedCostCenter !== "HQ" && !resolvedSiteId) {
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

        if (resolvedSiteId) {
            try {
                await assertSiteBelongsToOrg(resolvedSiteId, orgId);
            } catch {
                res.status(400).json({ error: "site_id is invalid or unavailable" });
                return;
            }
        }

        idempotency = await beginAccountingWriteIdempotency({
            orgId,
            endpointName: "accounting.expenses.create",
            idempotencyKey: readIdempotencyKey(req.body),
            requestBody: req.body,
        });

        if (idempotency.mode === "replay") {
            res.status(idempotency.responseStatus).json(idempotency.responseJson);
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
                .eq("org_id", orgId)
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

        if (!requiresReview) {
            const canonicalResult = await postCanonicalExpense({
                orgId,
                membershipId: req.orgMembershipId || null,
                idempotencyKey: idempotency.idempotencyKey,
                costCenter: resolvedCostCenter,
                siteId: typeof resolvedSiteId === "string" ? resolvedSiteId : null,
                vendorName: vendor_name,
                description,
                recordedDate: recorded_date || new Date().toISOString().split("T")[0],
                amountSubtotal: resolvedSubtotal,
                taxAmount: resolvedTaxAmount,
                amountTotal: resolvedTotal,
                category: normalizedCategory || "other",
                expenseItemCode: normalizedExpenseItemCode,
                expenseItemOther: normalizedExpenseItemOther,
                taxCategory: normalizedTaxCategory,
                riskLevel: risk_level,
                sourceDocumentId: source_document_id,
                inputSources: input_sources || {},
                expenseScope: normalizedExpenseScope as "job" | "overhead",
                paidBy: normalizedPaidBy as "org" | "member",
                claimantMemberId: normalizedClaimantMemberId,
                settlementType: normalizedSettlementType as "paid" | "unpaid",
                paymentAccount: normalizedPaymentAccount as "cash" | "bank" | null,
                reimbursementStatus: normalizedReimbursementStatus as "unsubmitted" | "submitted" | "approved" | "reimbursed" | null,
                recurringTemplateId: normalizedRecurringTemplateId,
                createdBy: req.userId!,
                actorName: req.userName || req.userEmail || null,
            });

            const canonicalData = canonicalResult?.transaction;

            if (canonicalData && typeof canonicalData === "object" && "id" in canonicalData) {
                const canonicalProposal = canonicalResult.proposal && typeof canonicalResult.proposal === "object"
                    ? canonicalResult.proposal as Record<string, unknown>
                    : null;
                const canonicalProjection = canonicalResult.projection && typeof canonicalResult.projection === "object"
                    ? canonicalResult.projection as Record<string, unknown>
                    : {
                        legacy_transaction_id: (canonicalData as Record<string, unknown>).id,
                        legacy_transaction_kind: (canonicalData as Record<string, unknown>).kind || "expense",
                        projection_source: "canonical_posting_projection",
                    };
                const canonicalPosting = canonicalResult.posting && typeof canonicalResult.posting === "object"
                    ? canonicalResult.posting as Record<string, unknown>
                    : {
                        affects_pl: true,
                        affects_revenue: false,
                        affects_ar: false,
                        mode: "canonical_expense_posting",
                    };

                const responseBody = withAccountingCommandEnvelope(canonicalData as Record<string, unknown>, {
                    endpointName: "accounting.expenses.create",
                    proposal: canonicalProposal,
                    approvalStatus: "not_required",
                    postingStatus: "posted",
                    mode: "canonical_expense_posting",
                    projection: canonicalProjection,
                    postingMetadata: canonicalPosting,
                });

                await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
                res.status(201).json(responseBody);
                return;
            }
        }

        const data = await insertExpenseTransaction({
            org_id: orgId,
            kind: "expense",
            cost_center: resolvedCostCenter,
            site_id: resolvedSiteId,
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
            projection_source: "transition_lineage",
            legacy_source_route: "accounting.expenses.create",
            legacy_source_id: idempotency.idempotencyKey,
            metadata_json: {
                expense_scope: normalizedExpenseScope,
                paid_by: normalizedPaidBy,
                settlement_type: normalizedSettlementType,
                payment_account: normalizedPaymentAccount,
                reimbursement_status: normalizedReimbursementStatus,
                recurring_template_id: normalizedRecurringTemplateId,
            },
            expense_scope: normalizedExpenseScope as "job" | "overhead",
            paid_by: normalizedPaidBy as "org" | "member",
            claimant_member_id: normalizedClaimantMemberId,
            settlement_type: normalizedSettlementType as "paid" | "unpaid",
            payment_account: normalizedPaymentAccount as "cash" | "bank" | null,
            reimbursement_status: normalizedReimbursementStatus as "unsubmitted" | "submitted" | "approved" | "reimbursed" | null,
            recurring_template_id: normalizedRecurringTemplateId,
            created_by: req.userId!,
        });

        if (!requiresReview) {
            await createJournalEntry(data, req.userId!, orgId);
        }

        let proposalLineage: Record<string, unknown> | null = null;
        const legacyProjection = {
            projection_source: "transition_lineage",
            legacy_transaction_id: data.id,
            legacy_transaction_kind: data.kind || "expense",
        };

        try {
            proposalLineage = await createAccountingCommandProposalLineage({
                orgId,
                endpointName: "accounting.expenses.create",
                proposalType: "expense.create",
                idempotencyKey: idempotency.idempotencyKey,
                transitionStatus: "posted_legacy_projection",
                actor: {
                    type: "human",
                    id: req.userId!,
                    name: req.userName || req.userEmail || null,
                },
                description: `経費登録: ${normalizeText(description) || normalizeText(vendor_name) || data.id}`,
                payload: {
                    cost_center: resolvedCostCenter,
                    site_id: resolvedSiteId,
                    vendor_name,
                    description,
                    recorded_date: data.recorded_date,
                    amount_subtotal: resolvedSubtotal,
                    tax_amount: resolvedTaxAmount,
                    amount_total: resolvedTotal,
                    category: normalizedCategory || "other",
                    expense_item_code: normalizedExpenseItemCode,
                    expense_item_other: normalizedExpenseItemOther,
                    tax_category: normalizedTaxCategory,
                    risk_level,
                    review_required: requiresReview,
                    source_document_id,
                    input_sources: input_sources || {},
                    expense_scope: normalizedExpenseScope,
                    paid_by: normalizedPaidBy,
                    claimant_member_id: normalizedClaimantMemberId,
                    settlement_type: normalizedSettlementType,
                    payment_account: normalizedPaymentAccount,
                    reimbursement_status: normalizedReimbursementStatus,
                    recurring_template_id: normalizedRecurringTemplateId,
                },
                projection: legacyProjection,
                documentId: typeof source_document_id === "string" ? source_document_id : null,
                siteId: typeof resolvedSiteId === "string" ? resolvedSiteId : null,
            });
        } catch (proposalError) {
            console.error("Expense proposal lineage error:", proposalError);
        }

        const responseBody = withAccountingCommandEnvelope(data, {
            endpointName: "accounting.expenses.create",
            proposal: proposalLineage,
            approvalStatus: requiresReview ? "pending_review" : "not_required",
            postingStatus: requiresReview ? "pending_review" : "posted",
            mode: "legacy_direct_projection",
            projection: proposalLineage
                ? { ...legacyProjection, proposal_id: proposalLineage.id }
                : legacyProjection,
        });

        await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
        res.status(201).json(responseBody);
    } catch (err: any) {
        await failAccountingWriteIdempotency(idempotency, err instanceof Error ? err.message : "UNKNOWN_ERROR");
        if (err instanceof AccountingRouteError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
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
            .eq("org_id", req.orgId!)
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
            .eq("org_id", req.orgId!)
            .select()
            .single();

        if (error) throw error;

        // 承認の場合は仕訳を作成
        if (action === "approve" && data) {
            await createJournalEntry(data, req.userId!, req.orgId!);
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
                    .eq("org_id", req.orgId!)
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
                    .eq("org_id", req.orgId!)
                    .select()
                    .single();

                if (updateError) {
                    results.failed.push({ id, error: updateError.message });
                    continue;
                }

                // 承認の場合は仕訳を作成
                if (action === "approve" && updated) {
                    await createJournalEntry(updated, req.userId!, req.orgId!);
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
    let idempotency: AccountingIdempotencyStart | null = null;
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
        const orgId = req.orgId!;

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

        idempotency = await beginAccountingWriteIdempotency({
            orgId,
            endpointName: "accounting.sales.adjust",
            idempotencyKey: readIdempotencyKey(req.body),
            requestBody: req.body,
        });

        if (idempotency.mode === "replay") {
            res.status(idempotency.responseStatus).json(idempotency.responseJson);
            return;
        }

        const saleDescription = buildSaleDescription(normalizedDescription, saleItems);
        const canonicalResult = await postCanonicalSale({
            orgId,
            membershipId: req.orgMembershipId || null,
            idempotencyKey: idempotency.idempotencyKey,
            siteId: site_id,
            clientId: client_id,
            description: saleDescription,
            recordedDate: recorded_date || new Date().toISOString().split("T")[0],
            amountSubtotal: resolvedSubtotal,
            taxAmount: resolvedTaxAmount,
            amountTotal: resolvedTotal,
            taxCategory: DEFAULT_SALE_TAX_CATEGORY,
            sourceDocumentId: source_document_id,
            inputSources: input_sources || {},
            items: saleItems,
            createdBy: req.userId!,
            actorName: req.userName || req.userEmail || null,
        });

        const canonicalData = canonicalResult?.transaction;

        if (canonicalData && typeof canonicalData === "object" && "id" in canonicalData) {
            const canonicalProposal = canonicalResult.proposal && typeof canonicalResult.proposal === "object"
                ? canonicalResult.proposal as Record<string, unknown>
                : null;
            const canonicalProjection = canonicalResult.projection && typeof canonicalResult.projection === "object"
                ? canonicalResult.projection as Record<string, unknown>
                : {
                    legacy_transaction_id: (canonicalData as Record<string, unknown>).id,
                    legacy_transaction_kind: (canonicalData as Record<string, unknown>).kind || "sale",
                    projection_source: "canonical_posting_projection",
                };
            const canonicalPosting = canonicalResult.posting && typeof canonicalResult.posting === "object"
                ? canonicalResult.posting as Record<string, unknown>
                : {
                    affects_pl: true,
                    affects_revenue: true,
                    affects_ar: true,
                    mode: "canonical_sales_posting",
                };

            const responseBody = withAccountingCommandEnvelope(canonicalData as Record<string, unknown>, {
                endpointName: "accounting.sales.adjust",
                proposal: canonicalProposal,
                approvalStatus: "not_required",
                postingStatus: "posted",
                mode: "canonical_sales_posting",
                projection: canonicalProjection,
                postingMetadata: canonicalPosting,
            });

            await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
            res.status(201).json(responseBody);
            return;
        }

        const data = await insertSaleTransactionWithItems(
            {
                org_id: orgId,
                kind: "sale",
                cost_center: "SITE",
                site_id,
                client_id,
                description: saleDescription,
                recorded_date: recorded_date || new Date().toISOString().split("T")[0],
                amount_subtotal: resolvedSubtotal,
                tax_amount: resolvedTaxAmount,
                amount_total: resolvedTotal,
                tax_category: DEFAULT_SALE_TAX_CATEGORY,
                status: "posted",
                source_document_id,
                input_sources: input_sources || {},
                created_by: req.userId!,
            },
            saleItems
        );

        // 仕訳作成
        await createJournalEntry(data, req.userId!, orgId);

        let proposalLineage: Record<string, unknown> | null = null;
        const legacyProjection = {
            legacy_transaction_id: data.id,
            legacy_transaction_kind: data.kind || "sale",
        };

        try {
            proposalLineage = await createAccountingCommandProposalLineage({
                orgId,
                endpointName: "accounting.sales.adjust",
                proposalType: "income.create",
                idempotencyKey: idempotency.idempotencyKey,
                transitionStatus: "posted_legacy_projection",
                actor: {
                    type: "human",
                    id: req.userId!,
                    name: req.userName || req.userEmail || null,
                },
                description: `売上登録: ${saleDescription}`,
                payload: {
                    site_id,
                    client_id,
                    description: saleDescription,
                    recorded_date: data.recorded_date,
                    amount_subtotal: resolvedSubtotal,
                    tax_amount: resolvedTaxAmount,
                    amount_total: resolvedTotal,
                    tax_category: DEFAULT_SALE_TAX_CATEGORY,
                    source_document_id,
                    input_sources: input_sources || {},
                    items: saleItems,
                },
                projection: legacyProjection,
                documentId: typeof source_document_id === "string" ? source_document_id : null,
                siteId: typeof site_id === "string" ? site_id : null,
            });
        } catch (proposalError) {
            console.error("Sale proposal lineage error:", proposalError);
        }

        const responseBody = withAccountingCommandEnvelope(data, {
            endpointName: "accounting.sales.adjust",
            proposal: proposalLineage,
            approvalStatus: "not_required",
            postingStatus: "posted",
            mode: "legacy_direct_projection",
            projection: proposalLineage
                ? { ...legacyProjection, proposal_id: proposalLineage.id }
                : legacyProjection,
        });

        await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
        res.status(201).json(responseBody);
    } catch (err: any) {
        await failAccountingWriteIdempotency(idempotency, err instanceof Error ? err.message : "UNKNOWN_ERROR");
        if (err instanceof AccountingRouteError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
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
        const orgId = req.orgId!;
        const settings = await getOrgInvoiceSettings(orgId);
        res.json(settings);
    } catch (err: any) {
        console.error("Invoice settings get error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.put("/invoice-settings", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
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
        const orgId = req.orgId!;
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
            .eq("org_id", orgId)
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
            orgId,
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
        const orgId = req.orgId!;
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
        const transactions = await getInvoiceTransactionsByIds(uniqueTransactionIds, orgId);

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
        const orgId = req.orgId!;
        const transactionId = Array.isArray(req.params.transactionId)
            ? req.params.transactionId[0]
            : req.params.transactionId;
        const transaction = await getInvoiceTransaction(transactionId, orgId);

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
        const orgId = req.orgId!;
        const {
            limit = 50,
            offset = 0,
            source_transaction_id: sourceTransactionId,
        } = req.query;

        let filteredInvoiceIds: string[] | null = null;
        let directSourceTransactionFilter: string | null = null;
        if (typeof sourceTransactionId === "string" && sourceTransactionId.trim()) {
            const normalizedSourceTransactionId = sourceTransactionId.trim();
            const sourceLinks = await getInvoiceSourceLinksByTransactionIds([normalizedSourceTransactionId], orgId);
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
        const sourceLinks = await getInvoiceSourceLinksByInvoiceIds(invoiceIds, orgId);
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
                .eq("org_id", orgId)
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
    let idempotency: AccountingIdempotencyStart | null = null;
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
        const orgId = req.orgId!;

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

        const transactions = await getInvoiceTransactionsByIds(uniqueTransactionIds, orgId);
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

        idempotency = await beginAccountingWriteIdempotency({
            orgId,
            endpointName: "accounting.invoices.create",
            idempotencyKey: readIdempotencyKey(req.body),
            requestBody: req.body,
        });

        if (idempotency.mode === "replay") {
            res.status(idempotency.responseStatus).json(idempotency.responseJson);
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
        const eligibilitySnapshot = {
            ...eligibility,
            resolved_document_type: resolvedDocumentType,
            evaluated_at: new Date().toISOString(),
        };

        const data = await createAccountingInvoice({
            orgId,
            membershipId: req.orgMembershipId || null,
            idempotencyKey: idempotency.idempotencyKey,
            transactions: sortedTransactions,
            representativeTransaction,
            sourceTransactionIds: uniqueTransactionIds,
            documentType: resolvedDocumentType,
            issueDate,
            dueDate: due_date,
            sourceTransactionDate: sourceSummary.period_start || representativeTransaction.recorded_date,
            billingName: normalizedBillingName,
            billingAddress: normalizeText(billing_address),
            issuerRegistrationNo: resolvedDocumentType === "qualified_invoice"
                ? settings.qualified_invoice_registration_number
                : null,
            notes: notesValue,
            issuerSnapshot: buildIssuerSnapshot(settings),
            registrationNumberSnapshot: resolvedDocumentType === "qualified_invoice"
                ? settings.qualified_invoice_registration_number
                : null,
            registeredAtSnapshot: resolvedDocumentType === "qualified_invoice"
                ? settings.qualified_invoice_registered_at
                : null,
            taxSummary: taxSummary as unknown as Record<string, unknown>,
            sourceSummary: sourceSummary as unknown as Record<string, unknown>,
            eligibilitySnapshot,
            createdBy: req.userId!,
            actorName: req.userName || req.userEmail || null,
        });

        const {
            proposal: invoiceProposalEnvelope,
            execution: invoiceExecutionEnvelope,
            posting: invoicePostingEnvelope,
            projection: invoiceProjectionEnvelope,
            rpc_membership_verified: _rpcMembershipVerified,
            source_summary: _canonicalSourceSummary,
            ...invoiceData
        } = data;
        let proposalLineage: Record<string, unknown> | null =
            invoiceProposalEnvelope && typeof invoiceProposalEnvelope === "object"
                ? invoiceProposalEnvelope as Record<string, unknown>
                : null;
        const canonicalExecution = invoiceExecutionEnvelope && typeof invoiceExecutionEnvelope === "object"
            ? invoiceExecutionEnvelope as Record<string, unknown>
            : null;
        const canonicalPosting = invoicePostingEnvelope && typeof invoicePostingEnvelope === "object"
            ? invoicePostingEnvelope as Record<string, unknown>
            : null;
        const canonicalProjection = invoiceProjectionEnvelope && typeof invoiceProjectionEnvelope === "object"
            ? invoiceProjectionEnvelope as Record<string, unknown>
            : null;
        let projection = canonicalProjection || {
            projection_source: "transition_lineage",
            legacy_invoice_id: invoiceData.id,
            legacy_transaction_id: representativeTransaction.id,
            source_transaction_ids: sortedTransactions.map((transaction) => transaction.id),
        };

        if (!proposalLineage) {
            try {
                proposalLineage = await createAccountingCommandProposalLineage({
                    orgId,
                    endpointName: "accounting.invoices.create",
                    proposalType: "invoice.create",
                    idempotencyKey: idempotency.idempotencyKey,
                    transitionStatus: "posted_legacy_projection",
                    actor: {
                        type: "human",
                        id: req.userId!,
                        name: req.userName || req.userEmail || null,
                    },
                    description: `請求書発行: ${normalizedBillingName}`,
                    payload: {
                        invoice_id: invoiceData.id,
                        invoice_no: invoiceData.invoice_no,
                        customer_name: normalizedBillingName,
                        document_type: resolvedDocumentType,
                        issue_date: issueDate,
                        due_date,
                        source_transaction_ids: uniqueTransactionIds,
                        source_summary: sourceSummary,
                        eligibility: eligibilitySnapshot,
                        posting_mode: "invoice_issue_no_pl_revenue",
                    },
                    projection,
                });
                projection = {
                    ...projection,
                    proposal_id: proposalLineage.id,
                };
            } catch (proposalError) {
                console.error("Invoice proposal lineage error:", proposalError);
            }
        }

        const postingMode = typeof canonicalPosting?.mode === "string"
            ? canonicalPosting.mode
            : "invoice_issue_no_pl_revenue";
        const postingStatus = typeof canonicalPosting?.status === "string"
            ? canonicalPosting.status
            : "posted";

        const responseBody = withAccountingCommandEnvelope({
            ...invoiceData,
            source_summary: sourceSummary,
            eligibility: {
                eligible_for_qualified_invoice: eligibility.eligible_for_qualified_invoice,
                reason_codes: eligibility.reason_codes,
                reason_messages: eligibility.reason_messages,
                resolved_document_type: resolvedDocumentType,
            },
        }, {
            endpointName: "accounting.invoices.create",
            proposal: proposalLineage,
            approvalStatus: "not_required",
            execution: canonicalExecution,
            postingStatus,
            mode: postingMode,
            postingMetadata: canonicalPosting || {
                affects_pl: false,
                affects_revenue: false,
                affects_ar: true,
            },
            projection,
        });

        await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
        res.status(201).json(responseBody);
    } catch (err: any) {
        await failAccountingWriteIdempotency(idempotency, err instanceof Error ? err.message : "UNKNOWN_ERROR");
        if (err instanceof AccountingCommandError) {
            res.status(err.status).json({ error: err.code });
            return;
        }
        if (err instanceof AccountingRouteError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        const message = err instanceof Error ? err.message : String(err?.message || err || "UNKNOWN_ERROR");
        if (message.includes("INVOICE_ALREADY_EXISTS") || message.includes("INVOICE_ALLOCATION_EXCEEDS_UNINVOICED_BALANCE")) {
            res.status(409).json({ error: message.includes("INVOICE_ALREADY_EXISTS") ? "Invoice already exists" : "INVOICE_ALLOCATION_EXCEEDS_UNINVOICED_BALANCE" });
            return;
        }
        if (message.includes("SOURCE_TRANSACTION_NOT_FOUND")) {
            res.status(404).json({ error: "One or more transactions were not found" });
            return;
        }
        if (message.includes("RPC_MEMBERSHIP_REQUIRED")) {
            res.status(403).json({ error: "RPC_MEMBERSHIP_REQUIRED" });
            return;
        }
        if (message.includes("SOURCE_TRANSACTION_IDS_REQUIRED") || message.includes("BILLING_NAME_REQUIRED")) {
            res.status(400).json({ error: message });
            return;
        }
        console.error("Invoice create error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/invoices/:id/correct", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
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
        const orgId = req.orgId!;
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

        const baseSourceLinks = await getInvoiceSourceLinksByInvoiceIds([invoiceId], orgId);
        const baseSourceTransactions = baseSourceLinks.length > 0
            ? await getInvoiceTransactionsByIds(baseSourceLinks.map((link) => link.source_transaction_id), orgId)
            : [await getInvoiceTransaction(baseInvoice.source_transaction_id, orgId)].filter(Boolean) as InvoiceTransaction[];
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
            orgId,
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

// ============================================================
// Payments（入金イベント / 消込）
// ============================================================

router.post("/payments", async (req: AuthenticatedRequest, res: Response) => {
    let idempotency: AccountingIdempotencyStart | null = null;
    try {
        const orgId = req.orgId!;
        const customerId = normalizeText(req.body.customer_id);
        const amount = parseNumericInput(req.body.amount);
        const receivedOn = normalizeText(req.body.received_on) || new Date().toISOString().split("T")[0];
        const paymentMethod = normalizeText(req.body.payment_method);
        const paymentAccount = normalizeText(req.body.payment_account);
        const externalReference = normalizeText(req.body.external_reference);

        if (!amount || amount <= 0) {
            res.status(400).json({ error: "amount must be a positive number" });
            return;
        }

        if (paymentAccount && paymentAccount !== "cash" && paymentAccount !== "bank") {
            res.status(400).json({ error: "payment_account must be one of cash, bank" });
            return;
        }

        if (customerId) {
            try {
                await assertActiveClientForOrg(customerId, orgId);
            } catch {
                res.status(404).json({ error: "customer_id is invalid or unavailable" });
                return;
            }
        }

        idempotency = await beginAccountingWriteIdempotency({
            orgId,
            endpointName: "accounting.payments.create",
            idempotencyKey: readIdempotencyKey(req.body),
            requestBody: req.body,
        });

        if (idempotency.mode === "replay") {
            res.status(idempotency.responseStatus).json(idempotency.responseJson);
            return;
        }

        const paymentResult = await recordPaymentEvent({
            orgId,
            membershipId: req.orgMembershipId || null,
            idempotencyKey: idempotency.idempotencyKey,
            customerId,
            receivedOn,
            amount,
            paymentMethod,
            paymentAccount,
            externalReference,
            createdBy: req.userId!,
            actorName: req.userName || req.userEmail || null,
        });
        const paymentId = paymentResult && typeof paymentResult === "object" && "payment" in paymentResult
            ? (paymentResult as { payment?: { id?: unknown } }).payment?.id
            : null;
        const rpcProjection = paymentResult
            && typeof paymentResult === "object"
            && "projection" in paymentResult
            && paymentResult.projection
            && typeof paymentResult.projection === "object"
            ? paymentResult.projection as Record<string, unknown>
            : null;
        const legacyProjection = {
            projection_source: "transition_lineage",
            legacy_payment_id: paymentId ?? null,
        };

        let proposalLineage: Record<string, unknown> | null = paymentResult
            && typeof paymentResult === "object"
            && "proposal" in paymentResult
            && paymentResult.proposal
            && typeof paymentResult.proposal === "object"
            ? paymentResult.proposal as Record<string, unknown>
            : null;
        if (!proposalLineage) {
            try {
                proposalLineage = await createAccountingCommandProposalLineage({
                    orgId,
                    endpointName: "accounting.payments.create",
                    proposalType: "payment.record",
                    idempotencyKey: idempotency.idempotencyKey,
                    transitionStatus: "posted_legacy_projection",
                    actor: {
                        type: "human",
                        id: req.userId!,
                        name: req.userName || req.userEmail || null,
                    },
                    description: `入金記録: ${receivedOn}`,
                    payload: {
                        customer_id: customerId,
                        received_on: receivedOn,
                        amount,
                        payment_method: paymentMethod,
                        payment_account: paymentAccount,
                        external_reference: externalReference,
                        posting_mode: "payment_received_no_pl_revenue",
                        unapplied_account_type: "unapplied_cash",
                    },
                    projection: legacyProjection,
                });
            } catch (proposalError) {
                console.error("Payment event proposal lineage error:", proposalError);
            }
        }

        const rpcPosting = paymentResult
            && typeof paymentResult === "object"
            && "posting" in paymentResult
            && paymentResult.posting
            && typeof paymentResult.posting === "object"
            ? paymentResult.posting as Record<string, unknown>
            : null;

        const responseBody = withAccountingCommandEnvelope(
            paymentResult && typeof paymentResult === "object"
                ? paymentResult as Record<string, unknown>
                : { result: paymentResult as unknown },
            {
                endpointName: "accounting.payments.create",
                proposal: proposalLineage,
                approvalStatus: "not_required",
                postingStatus: "posted",
                mode: "payment_received_no_pl_revenue",
                postingMetadata: rpcPosting || {
                    affects_pl: false,
                    affects_revenue: false,
                    affects_ar: true,
                },
                projection: rpcProjection || (proposalLineage
                    ? { ...legacyProjection, proposal_id: proposalLineage.id }
                    : legacyProjection),
            },
        );

        await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
        res.status(201).json(responseBody);
    } catch (err: any) {
        await failAccountingWriteIdempotency(idempotency, err instanceof Error ? err.message : "UNKNOWN_ERROR");
        const message = err instanceof Error ? err.message : String(err?.message || err || "UNKNOWN_ERROR");

        if (
            message.includes("PAYMENT_AMOUNT_MUST_BE_POSITIVE")
            || message.includes("PAYMENT_RECEIVED_ON_REQUIRED")
            || message.includes("PAYMENT_ACCOUNT_INVALID")
        ) {
            res.status(400).json({ error: message });
            return;
        }

        if (message.includes("RPC_MEMBERSHIP_REQUIRED")) {
            res.status(403).json({ error: "RPC_MEMBERSHIP_REQUIRED" });
            return;
        }

        if (message.includes("rpc_record_accounting_payment_event")) {
            res.status(503).json({ error: "PAYMENT_EVENT_SCHEMA_UNAVAILABLE" });
            return;
        }

        if (err instanceof AccountingRouteError) {
            res.status(err.status).json({ error: err.message });
            return;
        }

        console.error("Payment event error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/payments/allocations", async (req: AuthenticatedRequest, res: Response) => {
    let idempotency: AccountingIdempotencyStart | null = null;
    try {
        const orgId = req.orgId!;
        const paymentId = normalizeText(req.body.payment_id);
        const invoiceId = normalizeText(req.body.invoice_id);
        const amount = parseNumericInput(req.body.amount);
        const allocatedOn = normalizeText(req.body.allocated_on) || normalizeText(req.body.received_on) || new Date().toISOString().split("T")[0];

        if (!paymentId) {
            res.status(400).json({ error: "payment_id is required" });
            return;
        }

        if (!invoiceId) {
            res.status(400).json({ error: "invoice_id is required" });
            return;
        }

        if (!amount || amount <= 0) {
            res.status(400).json({ error: "amount must be a positive number" });
            return;
        }

        idempotency = await beginAccountingWriteIdempotency({
            orgId,
            endpointName: "accounting.payments.allocate",
            idempotencyKey: readIdempotencyKey(req.body),
            requestBody: req.body,
        });

        if (idempotency.mode === "replay") {
            res.status(idempotency.responseStatus).json(idempotency.responseJson);
            return;
        }

        const allocationResult = await recordPaymentAllocation({
            orgId,
            membershipId: req.orgMembershipId || null,
            idempotencyKey: idempotency.idempotencyKey,
            paymentId,
            invoiceId,
            allocatedOn,
            amount,
            createdBy: req.userId!,
            actorName: req.userName || req.userEmail || null,
        });

        const allocatedPaymentId = allocationResult && typeof allocationResult === "object" && "payment" in allocationResult
            ? (allocationResult as { payment?: { id?: unknown } }).payment?.id
            : null;
        const allocationId = allocationResult && typeof allocationResult === "object" && "allocation" in allocationResult
            ? (allocationResult as { allocation?: { id?: unknown } }).allocation?.id
            : null;
        const rpcProjection = allocationResult
            && typeof allocationResult === "object"
            && "projection" in allocationResult
            && allocationResult.projection
            && typeof allocationResult.projection === "object"
            ? allocationResult.projection as Record<string, unknown>
            : null;
        const legacyProjection = {
            projection_source: "transition_lineage",
            legacy_payment_id: allocatedPaymentId ?? null,
            legacy_payment_allocation_id: allocationId ?? null,
            legacy_invoice_id: invoiceId,
        };

        let proposalLineage: Record<string, unknown> | null = allocationResult
            && typeof allocationResult === "object"
            && "proposal" in allocationResult
            && allocationResult.proposal
            && typeof allocationResult.proposal === "object"
            ? allocationResult.proposal as Record<string, unknown>
            : null;
        if (!proposalLineage) {
            try {
                proposalLineage = await createAccountingCommandProposalLineage({
                    orgId,
                    endpointName: "accounting.payments.allocate",
                    proposalType: "payment.allocate",
                    idempotencyKey: idempotency.idempotencyKey,
                    transitionStatus: "posted_legacy_projection",
                    actor: {
                        type: "human",
                        id: req.userId!,
                        name: req.userName || req.userEmail || null,
                    },
                    description: `入金消込: ${invoiceId}`,
                    payload: {
                        invoice_id: invoiceId,
                        payment_id: paymentId,
                        allocated_on: allocatedOn,
                        amount,
                        posting_mode: "payment_allocation_no_pl_revenue",
                    },
                    projection: legacyProjection,
                });
            } catch (proposalError) {
                console.error("Payment allocation proposal lineage error:", proposalError);
            }
        }

        const rpcPosting = allocationResult
            && typeof allocationResult === "object"
            && "posting" in allocationResult
            && allocationResult.posting
            && typeof allocationResult.posting === "object"
            ? allocationResult.posting as Record<string, unknown>
            : null;

        const responseBody = withAccountingCommandEnvelope(
            allocationResult && typeof allocationResult === "object"
                ? allocationResult as Record<string, unknown>
                : { result: allocationResult as unknown },
            {
                endpointName: "accounting.payments.allocate",
                proposal: proposalLineage,
                approvalStatus: "not_required",
                postingStatus: "posted",
                mode: "payment_allocation_no_pl_revenue",
                postingMetadata: rpcPosting || {
                    affects_pl: false,
                    affects_revenue: false,
                    affects_ar: true,
                },
                projection: rpcProjection || (proposalLineage
                    ? { ...legacyProjection, proposal_id: proposalLineage.id }
                    : legacyProjection),
            },
        );
        await completeAccountingWriteIdempotency(idempotency, 201, responseBody);
        res.status(201).json(responseBody);
    } catch (err: any) {
        await failAccountingWriteIdempotency(idempotency, err instanceof Error ? err.message : "UNKNOWN_ERROR");
        const message = err instanceof Error ? err.message : String(err?.message || err || "UNKNOWN_ERROR");

        if (message.includes("INVOICE_NOT_FOUND")) {
            res.status(404).json({ error: "INVOICE_NOT_FOUND" });
            return;
        }

        if (
            message.includes("PAYMENT_AMOUNT_MUST_BE_POSITIVE")
            || message.includes("PAYMENT_ALLOCATION_AMOUNT_MUST_BE_POSITIVE")
            || message.includes("INVOICE_AMOUNT_UNAVAILABLE")
        ) {
            res.status(400).json({ error: message });
            return;
        }

        if (message.includes("PAYMENT_ALLOCATION_EXCEEDS_UNCOLLECTED_BALANCE")) {
            res.status(409).json({ error: "PAYMENT_ALLOCATION_EXCEEDS_UNCOLLECTED_BALANCE" });
            return;
        }

        if (message.includes("PAYMENT_NOT_FOUND")) {
            res.status(404).json({ error: "PAYMENT_NOT_FOUND" });
            return;
        }

        if (message.includes("PAYMENT_ALLOCATION_EXCEEDS_UNAPPLIED_BALANCE")) {
            res.status(409).json({ error: "PAYMENT_ALLOCATION_EXCEEDS_UNAPPLIED_BALANCE" });
            return;
        }

        if (message.includes("RPC_MEMBERSHIP_REQUIRED")) {
            res.status(403).json({ error: "RPC_MEMBERSHIP_REQUIRED" });
            return;
        }

        if (message.includes("rpc_allocate_accounting_payment")) {
            res.status(503).json({ error: "PAYMENT_ALLOCATION_SCHEMA_UNAVAILABLE" });
            return;
        }

        console.error("Payment allocation error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/invoices/:id/download", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
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
    let idempotency: AccountingIdempotencyStart | null = null;
    try {
        const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        const orgId = req.orgId!;
        const reason = normalizeText(req.body?.reason);

        if (!reason) {
            res.status(400).json({ error: "reason is required" });
            return;
        }

        idempotency = await beginAccountingWriteIdempotency({
            orgId,
            endpointName: "accounting.void.create",
            idempotencyKey: readIdempotencyKey(req.body),
            requestBody: {
                transaction_id: id,
                ...req.body,
            },
        });

        if (idempotency.mode === "replay") {
            res.status(idempotency.responseStatus).json(idempotency.responseJson);
            return;
        }

        const canonicalReversal = await reverseCanonicalSale({
            orgId,
            membershipId: req.orgMembershipId || null,
            transactionId: id,
            reason,
            idempotencyKey: idempotency.idempotencyKey,
            createdBy: req.userId!,
            actorName: req.userName || req.userEmail || null,
        });

        if (canonicalReversal && "reversal_created" in canonicalReversal) {
            const proposal = canonicalReversal.proposal && typeof canonicalReversal.proposal === "object"
                ? canonicalReversal.proposal as Record<string, unknown>
                : null;
            const projection = canonicalReversal.projection && typeof canonicalReversal.projection === "object"
                ? canonicalReversal.projection as Record<string, unknown>
                : {
                    projection_source: "canonical_posting_projection",
                    legacy_transaction_id: canonicalReversal.reversal_created,
                    reverses_transaction_id: id,
                };
            const posting = canonicalReversal.posting && typeof canonicalReversal.posting === "object"
                ? canonicalReversal.posting as Record<string, unknown>
                : {
                    affects_pl: true,
                    affects_revenue: true,
                    affects_ar: true,
                    mode: "canonical_sales_reversal",
                };
            const responseBody = withAccountingCommandEnvelope(
                {
                    original_voided: canonicalReversal.original_voided,
                    original_reversed: canonicalReversal.original_reversed,
                    reversal_created: canonicalReversal.reversal_created,
                },
                {
                    endpointName: "accounting.void.create",
                    proposal,
                    approvalStatus: "not_required",
                    postingStatus: "posted",
                    mode: "canonical_sales_reversal",
                    postingMetadata: posting,
                    projection,
                },
            );

            await completeAccountingWriteIdempotency(idempotency, 200, responseBody);
            res.json(responseBody);
            return;
        }

        const reversalResult = await createVoidReversal({
            orgId,
            transactionId: id,
            reason,
            createdBy: req.userId!,
        });
        const legacyProjection = {
            projection_source: "transition_lineage",
            legacy_transaction_id: reversalResult.reversal_created,
            reverses_transaction_id: reversalResult.original_reversed,
        };

        let proposalLineage: Record<string, unknown> | null = null;
        try {
            proposalLineage = await createAccountingCommandProposalLineage({
                orgId,
                endpointName: "accounting.void.create",
                proposalType: "transaction.reverse",
                idempotencyKey: idempotency.idempotencyKey,
                transitionStatus: "reversed",
                actor: {
                    type: "human",
                    id: req.userId!,
                    name: req.userName || req.userEmail || null,
                },
                description: `取引取消: ${id}`,
                payload: {
                    action: "reverse_posted",
                    transaction_id: id,
                    reason,
                    reversal_transaction_id: reversalResult.reversal_created,
                },
                projection: legacyProjection,
            });
        } catch (proposalError) {
            console.error("Void proposal lineage error:", proposalError);
        }

        const responseBody = withAccountingCommandEnvelope(reversalResult, {
            endpointName: "accounting.void.create",
            proposal: proposalLineage,
            approvalStatus: "not_required",
            postingStatus: "posted",
            mode: "legacy_reversal_projection",
            postingMetadata: {
                affects_pl: true,
                affects_revenue: true,
                affects_ar: false,
            },
            projection: proposalLineage
                ? { ...legacyProjection, proposal_id: proposalLineage.id }
                : legacyProjection,
        });
        await completeAccountingWriteIdempotency(idempotency, 200, responseBody);
        res.json(responseBody);
    } catch (err: any) {
        await failAccountingWriteIdempotency(idempotency, err instanceof Error ? err.message : "UNKNOWN_ERROR");
        if (err instanceof AccountingCommandError) {
            res.status(err.status).json({ error: err.code });
            return;
        }
        if (err instanceof AccountingRouteError) {
            res.status(err.status).json({ error: err.message });
            return;
        }
        console.error("Void error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// ============================================================
// PL（月次損益）
// ============================================================

router.get("/pl", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const { month, site_id, cost_center, source } = req.query;
        const plSource = normalizePlSource(source);

        // デフォルトは今月
        const targetMonth = (month as string) || new Date().toISOString().slice(0, 7);
        const startDate = `${targetMonth}-01`;
        // 月末日を正しく計算
        const [year, mon] = targetMonth.split("-").map(Number);
        const lastDay = new Date(year, mon, 0).getDate();
        const endDate = `${targetMonth}-${String(lastDay).padStart(2, "0")}`;

        let legacySummary: PlSummary | null = null;

        if (plSource !== "journal") {
            let query = supabaseAdmin
                .from("accounting_transactions")
                .select("*")
                .eq("org_id", req.orgId!)
                .in("status", [...LEDGER_AGGREGATION_STATUSES])
                .gte("recorded_date", startDate)
                .lte("recorded_date", endDate);

            if (site_id) {
                query = query.eq("site_id", site_id);
            }
            if (cost_center) {
                query = query.eq("cost_center", cost_center);
            }

            const { data: legacyRows, error } = await query;

            if (error) throw error;

            legacySummary = summarizeLegacyPlRows((legacyRows || []) as Array<Record<string, unknown>>);
        }

        if (plSource === "legacy") {
            res.json({
                month: targetMonth,
                source: "legacy",
                ...legacySummary!,
            });
            return;
        }

        let journalQuery = supabaseAdmin
            .from("accounting_journal_entries")
            .select(`
                id,
                entry_date,
                posted_at,
                posting_group_id,
                transaction:accounting_transactions(id, kind, cost_center, site_id),
                posting_group:posting_groups(id, group_type),
                lines:accounting_journal_lines(id, account_code, debit, credit, site_id)
            `)
            .eq("org_id", req.orgId!)
            .gte("entry_date", startDate)
            .lte("entry_date", endDate);

        const { data: journalRows, error: journalError } = await journalQuery;

        if (journalError) throw journalError;

        const journalSummary = summarizeJournalPlRows(
            (journalRows || []) as Array<Record<string, unknown>>,
            {
                siteId: site_id,
                costCenter: cost_center,
            },
            "net_accounting"
        );

        if (plSource === "journal") {
            res.json({
                month: targetMonth,
                source: "journal",
                basis: "net_accounting",
                ...journalSummary,
            });
            return;
        }

        const journalGrossCompatSummary = summarizeJournalPlRows(
            (journalRows || []) as Array<Record<string, unknown>>,
            {
                siteId: site_id,
                costCenter: cost_center,
            },
            "gross_compat"
        );
        const diff = buildPlDiff(legacySummary!, journalGrossCompatSummary);
        const mismatches = Object.entries(diff)
            .filter(([, amount]) => amount !== 0)
            .map(([field, amount]) => ({
                field,
                amount,
                basis: "gross_compat",
            }));

        res.json({
            month: targetMonth,
            source: "compare",
            basis: {
                legacy: "gross",
                journal: "net_accounting",
                diff: "gross_compat",
            },
            tax_basis_warning: true,
            legacy: legacySummary!,
            journal: journalSummary,
            journal_gross_compat: journalGrossCompatSummary,
            diff,
            mismatches,
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
            .eq("org_id", req.orgId!)
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
            .eq("org_id", req.orgId!)
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
            .eq("org_id", req.orgId!)
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

export default router;
