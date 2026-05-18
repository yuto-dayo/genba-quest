import { Router, Response } from "express";
import { createHash } from "crypto";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { validateReportingMonth } from "../lib/reportingMonth";
import { analyzeDocument, assessExpenseRisk, OcrResult } from "../services/ocrService";
import { getDriveStorageService } from "../services/DriveStorageService";
import { ensureInvoicePdfStored, INVOICE_PDF_BUCKET } from "../services/InvoicePdfService";
import { buildInvoiceDisplayLineItems } from "../services/InvoiceLineItemsService";
import { assertActiveClientForOrg } from "../services/ClientDirectoryService";
import { memberInvoiceService } from "../services/MemberInvoiceService";
import { invoiceReviewerAssignmentService } from "../services/InvoiceReviewerAssignmentService";
import { invoiceRegistrationService } from "../services/InvoiceRegistrationService";
import { electronicDocumentService } from "../services/ElectronicDocumentService";
import { ProposalService } from "../services/ProposalService";
import type { ActorRef } from "../services/PolicyEngine";
import {
    CASH_RECEIPT_VARIANCE_REASONS,
    assertCashReceiptPayload,
    type CashReceiptAllocationPayload,
    type CashReceiptRecordPayload,
    type CashReceiptVarianceReason,
} from "../services/CashReceiptService";
import { TaxAccountMappingService, type TaxAccountCategory } from "../services/TaxAccountMappingService";
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
import { getPartnersSummary } from "../services/PartnersSummaryService";
import { ConstructionAccountingService } from "../services/ConstructionAccountingService";
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
const PL_COMPLETED_COGS_ACCOUNT_CODES = new Set(["5420"]);
const PL_WORK_IN_PROGRESS_ACCOUNT_CODES = new Set(["1230"]);
const PL_REVENUE_GROSS_COMPAT_ACCOUNT_CODES = new Set([...PL_REVENUE_NET_ACCOUNT_CODES, "2500"]);
const PL_EXPENSE_GROSS_COMPAT_ACCOUNT_CODES = new Set([...PL_EXPENSE_NET_ACCOUNT_CODES, "1500"]);
const PL_NO_REVENUE_POSTING_GROUP_TYPES = new Set(["invoice_transfer", "payment_receipt", "payment_allocation"]);
const REIMBURSEMENT_ACTIVE_TRANSACTION_STATUSES = ["posted", "approved"] as const;

type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];
type ExpenseTaxCategory = typeof EXPENSE_TAX_CATEGORIES[number];
type PlSource = typeof PL_SOURCES[number];
type PlJournalBasis = "net_accounting" | "gross_compat";
type PlSummary = {
    sales: number;
    expenses: number;
    completed_cogs: number;
    overhead: number;
    work_in_progress: number;
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

type ReimbursementTransactionRow = {
    id: string;
    recorded_date: string;
    category: string | null;
    amount_total: number | string;
    claimant_member_id: string | null;
    reimbursement_status: string | null;
    recurring_expense_id?: string | null;
    recurring_expenses?: RecurringExpenseJoin | RecurringExpenseJoin[] | null;
};

type RecurringExpenseJoin = {
    id: string;
    category: string;
    title: string;
    monthly_amount: number | string;
};

type OrgMemberRow = {
    id: string;
    user_id: string;
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

function isUuid(value: unknown): value is string {
    return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    );
}

function buildHumanActor(req: AuthenticatedRequest): ActorRef {
    return {
        type: "human",
        id: req.userId!,
        name: req.userName || "Member",
    };
}

function statusForInvoiceReviewError(message: string): number {
    const normalized = message.includes(":") ? message.split(":")[0] : message;
    const map: Record<string, number> = {
        MEMBER_INVOICE_NOT_FOUND: 404,
        MEMBER_INVOICE_NOT_IN_ISSUED_STATE: 409,
        MEMBER_INVOICE_MARK_PAID_OWNER_CANNOT_SELF_APPROVE: 403,
        MEMBER_INVOICE_MARK_PAID_APPROVER_MUST_BE_HUMAN: 403,
        MEMBER_INVOICE_MARK_PAID_INVOICE_MISSING: 400,
        INVOICE_REVIEW_ASSIGNMENT_NOT_FOUND: 403,
        INVOICE_REVIEW_ASSIGNMENT_EXPIRED: 403,
        INVOICE_REVIEW_ASSIGNMENT_COMPLETED: 403,
    };
    return map[normalized] ?? 500;
}

function sendInvoiceReviewError(res: Response, err: unknown): void {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    const code = message.includes(":") ? message.split(":")[0] : message;
    const status = statusForInvoiceReviewError(message);
    if (status === 500) {
        console.error("[ACCOUNTING_INVOICE_REVIEW] unhandled error:", err);
    }
    res.status(status).json({ error: code });
}

function buildMemberInvoicePaymentSummary(invoice: Awaited<ReturnType<typeof memberInvoiceService.findById>>) {
    if (!invoice) {
        return null;
    }
    return {
        id: invoice.id,
        org_id: invoice.org_id,
        invoice_no: invoice.invoice_no,
        period_month: invoice.period_month,
        amount_total: invoice.amount_total,
        status: invoice.status,
        source: invoice.source,
        issued_at: invoice.issued_at,
        paid_at: invoice.paid_at ?? null,
        paid_proposal_id: invoice.paid_proposal_id ?? null,
        paid_method: invoice.paid_method ?? null,
    };
}

router.use(requireOrgMembership("member"));

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

function normalizeTaxAccountCategory(value: unknown): TaxAccountCategory | null {
    if (
        value === "income" ||
        value === "expense" ||
        value === "asset" ||
        value === "liability" ||
        value === "equity"
    ) {
        return value;
    }
    return null;
}

function normalizeProposalTypes(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const normalized = value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : null;
}

function normalizeCashReceiptVarianceReason(value: unknown): CashReceiptVarianceReason | null {
    const normalized = normalizeText(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }
    return CASH_RECEIPT_VARIANCE_REASONS.includes(normalized as CashReceiptVarianceReason)
        ? normalized as CashReceiptVarianceReason
        : null;
}

function normalizeCashReceiptAllocations(value: unknown): {
    allocations: CashReceiptAllocationPayload[];
    error?: string;
} {
    if (!Array.isArray(value) || value.length === 0) {
        return { allocations: [], error: "allocations must be a non-empty array" };
    }

    const allocations: CashReceiptAllocationPayload[] = [];
    for (const [index, raw] of value.entries()) {
        const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
        const invoiceTransactionId = normalizeText(item.invoice_transaction_id);
        const allocatedAmount = parseNumericInput(item.allocated_amount);
        if (!invoiceTransactionId || !isUuid(invoiceTransactionId)) {
            return { allocations: [], error: `allocations[${index}].invoice_transaction_id must be a uuid` };
        }
        if (allocatedAmount === null || allocatedAmount <= 0) {
            return { allocations: [], error: `allocations[${index}].allocated_amount must be positive` };
        }
        allocations.push({
            invoice_transaction_id: invoiceTransactionId,
            allocated_amount: roundMoney(allocatedAmount),
        });
    }

    return { allocations };
}

function normalizeCashReceiptPayload(body: Record<string, unknown>): {
    payload?: CashReceiptRecordPayload;
    error?: string;
} {
    const clientId = normalizeText(body.client_id);
    const receivedDate = normalizeText(body.received_date);
    const receivedAmount = parseNumericInput(body.received_amount);
    const varianceReason = normalizeCashReceiptVarianceReason(body.variance_reason);
    const { allocations, error: allocationError } = normalizeCashReceiptAllocations(body.allocations);

    if (!clientId || !isUuid(clientId)) {
        return { error: "client_id must be a uuid" };
    }
    if (!receivedDate || !/^\d{4}-\d{2}-\d{2}$/.test(receivedDate)) {
        return { error: "received_date must be YYYY-MM-DD" };
    }
    if (receivedAmount === null || receivedAmount <= 0) {
        return { error: "received_amount must be positive" };
    }
    if (!varianceReason) {
        return { error: "variance_reason is invalid" };
    }
    if (allocationError) {
        return { error: allocationError };
    }

    const payload: CashReceiptRecordPayload = {
        client_id: clientId,
        received_date: receivedDate,
        received_amount: roundMoney(receivedAmount),
        allocations,
        variance_reason: varianceReason,
        bank_txn_ref: normalizeText(body.bank_txn_ref),
        variance_memo: normalizeText(body.variance_memo),
        notes: normalizeText(body.notes),
    };

    try {
        assertCashReceiptPayload(payload);
    } catch (err) {
        return { error: err instanceof Error ? err.message : "cash receipt payload is invalid" };
    }

    return { payload };
}

function parseAsOfDate(value: unknown): Date | null {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

async function registerElectronicDocumentForExpense(input: {
    orgId: string;
    userId: string;
    sourceDocumentId: unknown;
    transactionId: string;
    transactionDate: string;
    vendorName: unknown;
    amountTotal: number;
    expenseScope: string;
    siteId: string | null;
}): Promise<void> {
    if (typeof input.sourceDocumentId !== "string" || !input.sourceDocumentId) {
        return;
    }

    await electronicDocumentService.registerFromStoredDocument({
        orgId: input.orgId,
        sourceDocumentId: input.sourceDocumentId,
        kind: "receipt",
        transactionDate: input.transactionDate,
        counterpartyName: normalizeText(input.vendorName) || "取引先未設定",
        amount: input.amountTotal,
        registeredBy: input.userId,
        sourceTransactionId: input.transactionId,
        metadata: {
            source: "accounting.expenses.create",
            expense_scope: input.expenseScope,
            site_id: input.siteId,
        },
    });
}

function isOrgScopedStoragePath(orgId: string, storagePath: string | null | undefined): storagePath is string {
    return typeof storagePath === "string" && storagePath.startsWith(`${orgId}/`);
}

/**
 * インボイス制度のT番号を正規化する。
 * 形式: T + 13桁 (法人/個人事業主の登録番号)。
 * 半角化・前後空白除去のみ行い、形式不正なら null を返す。
 * 形式チェックを通過した値のみが metadata_json に保存される。
 */
function normalizeInvoiceNumber(value: unknown): string | null {
    const text = normalizeText(value);
    if (!text) {
        return null;
    }

    const halfWidth = text.replace(/[Ｔ]/g, "T").replace(/[０-９]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xFEE0)
    );
    const compact = halfWidth.replace(/[\s-]/g, "").toUpperCase();
    return /^T\d{13}$/.test(compact) ? compact : null;
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

function toWholeYen(value: unknown): number {
    return Math.round(toMoneyNumber(value));
}

function resolveReimbursementStatus(value: unknown): "unsubmitted" | "submitted" | "approved" | "reimbursed" {
    return value === "submitted" || value === "approved" || value === "reimbursed"
        ? value
        : "unsubmitted";
}

function resolveMemberNickname(profile: Record<string, unknown> | undefined, fallback: string): string {
    const raw =
        typeof profile?.nickname === "string" && profile.nickname.trim()
            ? profile.nickname.trim()
            : typeof profile?.username === "string" && profile.username.trim()
                ? profile.username.trim()
                : typeof profile?.full_name === "string" && profile.full_name.trim()
                    ? profile.full_name.trim()
                    : fallback;
    return Array.from(raw).slice(0, 5).join("");
}

function summarizeReimbursementRows(rows: ReimbursementTransactionRow[]) {
    const byStatus = {
        unsubmitted: 0,
        submitted: 0,
        approved: 0,
        reimbursed: 0,
    };
    let totalAdvanced = 0;
    let unsettled = 0;
    let settled = 0;
    let countPending = 0;

    for (const row of rows) {
        const amount = toWholeYen(row.amount_total);
        const status = resolveReimbursementStatus(row.reimbursement_status);
        byStatus[status] += amount;
        totalAdvanced += amount;
        if (status === "reimbursed") {
            settled += amount;
        } else {
            unsettled += amount;
            countPending += 1;
        }
    }

    return {
        total_advanced: totalAdvanced,
        unsettled,
        settled,
        count_pending: countPending,
        by_status: byStatus,
    };
}

function readRecurringExpenseJoin(row: ReimbursementTransactionRow): RecurringExpenseJoin | null {
    const joined = row.recurring_expenses;
    if (Array.isArray(joined)) {
        return joined[0] ?? null;
    }
    return joined ?? null;
}

function summarizeRecurringRows(rows: ReimbursementTransactionRow[]) {
    const recurringById = new Map<string, {
        id: string;
        category: string;
        title: string;
        monthly_amount: number;
    }>();

    for (const row of rows) {
        const recurring = readRecurringExpenseJoin(row);
        const id = row.recurring_expense_id ?? recurring?.id;
        if (!id || !recurring) {
            continue;
        }
        recurringById.set(id, {
            id,
            category: recurring.category,
            title: recurring.title,
            monthly_amount: toWholeYen(recurring.monthly_amount),
        });
    }

    const recurringItems = Array.from(recurringById.values());
    return {
        recurring_total: recurringItems.reduce((sum, item) => sum + item.monthly_amount, 0),
        recurring_items: recurringItems,
    };
}

function resolveReimbursementMemberStatus(summary: ReturnType<typeof summarizeReimbursementRows>): "pending" | "in_review" | "none" | "settled" {
    if (summary.total_advanced <= 0) {
        return "none";
    }
    if (summary.unsettled <= 0) {
        return "settled";
    }
    if (summary.by_status.submitted > 0 || summary.by_status.approved > 0) {
        return "in_review";
    }
    return "pending";
}

async function loadActiveReimbursementMembers(orgId: string): Promise<OrgMemberRow[]> {
    const { data, error } = await supabaseAdmin
        .from("org_memberships")
        .select("id,user_id")
        .eq("org_id", orgId)
        .eq("status", "active")
        .is("suspended_at", null);

    if (error) {
        throw error;
    }

    return ((data ?? []) as Array<Record<string, unknown>>)
        .map((row) => ({
            id: typeof row.id === "string" ? row.id : "",
            user_id: typeof row.user_id === "string" ? row.user_id : "",
        }))
        .filter((row) => row.id && row.user_id);
}

async function loadProfileMap(userIds: string[]): Promise<Map<string, Record<string, unknown>>> {
    if (userIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id,nickname,username,full_name")
        .in("id", Array.from(new Set(userIds)));

    if (error) {
        throw error;
    }

    return new Map(
        ((data ?? []) as Array<Record<string, unknown>>)
            .filter((row) => typeof row.id === "string")
            .map((row) => [String(row.id), row]),
    );
}

function normalizePlSource(value: unknown): PlSource {
    return typeof value === "string" && PL_SOURCES.includes(value as PlSource)
        ? value as PlSource
        : "legacy";
}

function completePlSummary(input: {
    sales: number;
    expenses?: number;
    completedCogs?: number;
    overhead?: number;
    workInProgress?: number;
    transactionCount?: number;
    journalEntryCount?: number;
    journalLineCount?: number;
}): PlSummary {
    const sales = roundMoney(input.sales);
    const completedCogs = roundMoney(input.completedCogs ?? input.expenses ?? 0);
    const overhead = roundMoney(input.overhead ?? 0);
    const workInProgress = roundMoney(input.workInProgress ?? 0);
    const expenses = roundMoney(input.expenses ?? completedCogs + overhead);
    const profit = roundMoney(sales - expenses);
    const distributable = roundMoney(Math.max(profit, 0) * 0.7);

    return {
        sales,
        expenses,
        completed_cogs: completedCogs,
        overhead,
        work_in_progress: workInProgress,
        profit,
        distributable,
        ...(input.transactionCount !== undefined ? { transaction_count: input.transactionCount } : {}),
        ...(input.journalEntryCount !== undefined ? { journal_entry_count: input.journalEntryCount } : {}),
        ...(input.journalLineCount !== undefined ? { journal_line_count: input.journalLineCount } : {}),
    };
}

function summarizeLegacyPlRows(rows: Array<Record<string, unknown>>): PlSummary {
    let sales = 0;
    let completedCogs = 0;
    let workInProgress = 0;
    let overhead = 0;

    for (const tx of rows) {
        const site = firstNestedRecord(tx.site);
        const siteStatus = typeof site?.status === "string" ? site.status : null;
        const isCompletedSite = siteStatus === "completed" || siteStatus === "closed";
        const hasSite = typeof tx.site_id === "string" && tx.site_id.length > 0;

        if ((tx.kind === "sale" || tx.kind === "invoice") && isCompletedSite) {
            sales += toMoneyNumber(tx.amount_total);
        } else if (tx.kind === "expense" && hasSite && isCompletedSite) {
            completedCogs += toMoneyNumber(tx.amount_total);
        } else if (tx.kind === "expense" && hasSite) {
            workInProgress += toMoneyNumber(tx.amount_total);
        } else if (tx.kind === "expense") {
            overhead += toMoneyNumber(tx.amount_total);
        }
    }

    return completePlSummary({
        sales,
        completedCogs,
        overhead,
        workInProgress,
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

    if (typeof costCenterFilter === "string" && costCenterFilter) {
        const transaction = firstNestedRecord(entry.transaction);
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
    let completedCogs = 0;
    let workInProgress = 0;
    let overhead = 0;
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
            } else if (PL_COMPLETED_COGS_ACCOUNT_CODES.has(accountCode)) {
                completedCogs += debit - credit;
                journalLineCount += 1;
                countedEntry = true;
            } else if (PL_WORK_IN_PROGRESS_ACCOUNT_CODES.has(accountCode)) {
                workInProgress += debit - credit;
                journalLineCount += 1;
                countedEntry = true;
            } else if (expenseAccountCodes.has(accountCode)) {
                const amount = debit - credit;
                expenses += amount;
                overhead += amount;
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
        expenses: expenses + completedCogs,
        completedCogs,
        overhead,
        workInProgress,
        journalEntryCount,
        journalLineCount,
    });
}

function buildPlDiff(
    legacy: PlSummary,
    journal: PlSummary
): Pick<PlSummary, "sales" | "expenses" | "completed_cogs" | "overhead" | "work_in_progress" | "profit" | "distributable"> {
    return {
        sales: roundMoney(journal.sales - legacy.sales),
        expenses: roundMoney(journal.expenses - legacy.expenses),
        completed_cogs: roundMoney(journal.completed_cogs - legacy.completed_cogs),
        overhead: roundMoney(journal.overhead - legacy.overhead),
        work_in_progress: roundMoney(journal.work_in_progress - legacy.work_in_progress),
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

/**
 * Append-only log writer for the expense audit trail (S-3).
 * Best-effort: failures are logged but do not abort the parent operation,
 * since the source-of-truth row has already been written. The parent
 * transaction's success matters more than the log entry's perfect arrival.
 *
 * field='registered'      → 起票時の全フィールドを new_value JSON に詰める
 * field='ocr_extracted'   → OCRが抽出したフィールドを new_value JSON に詰める
 * field='<column_name>'   → 個別フィールド編集
 *
 * 詳細: docs/MONEY_EXPENSE_FLOW.md §2.4
 */
type ExpenseLogActor = { type: "human" | "ai" | "system" | "integration"; id: string; name?: string | null };
type ExpenseLogSource = "manual" | "ai_inference" | "system_auto";

async function recordExpenseLogEntry(args: {
    orgId: string;
    expenseId: string;
    field: string;
    oldValue?: unknown;
    newValue?: unknown;
    actor: ExpenseLogActor;
    source: ExpenseLogSource;
    reason?: string | null;
}): Promise<void> {
    try {
        const { error } = await supabaseAdmin
            .from("expense_field_change_log")
            .insert({
                org_id: args.orgId,
                expense_id: args.expenseId,
                field: args.field,
                old_value: args.oldValue === undefined ? null : args.oldValue,
                new_value: args.newValue === undefined ? null : args.newValue,
                changed_by: args.actor,
                source: args.source,
                reason: args.reason ?? null,
            });
        if (error) {
            console.error(
                `expense_field_change_log insert failed (expense=${args.expenseId}, field=${args.field}):`,
                error,
            );
        }
    } catch (err) {
        console.error("expense_field_change_log unexpected error:", err);
    }
}

/** Returns the subset of input_sources whose origin is OCR. */
function ocrSubset(inputSources: unknown): Record<string, true> {
    if (!inputSources || typeof inputSources !== "object") {
        return {};
    }
    return Object.entries(inputSources as Record<string, unknown>).reduce<Record<string, true>>(
        (acc, [field, source]) => {
            if (source === "ocr") {
                acc[field] = true;
            }
            return acc;
        },
        {},
    );
}

/**
 * Emit the audit-log entries for a fresh expense registration. Writes
 *   1. a 'registered' entry with the full payload (always)
 *   2. an 'ocr_extracted' entry listing only the fields whose values
 *      came from OCR (only when at least one such field exists)
 *
 * Both entries share the wall-clock created_at, so the timeline shows
 * "registered" and "ocr_extracted" side-by-side in chronological order.
 */
async function writeExpenseRegistrationLog(args: {
    orgId: string;
    expenseId: string;
    inputSources: unknown;
    actor: ExpenseLogActor;
    payload: Record<string, unknown>;
}): Promise<void> {
    await recordExpenseLogEntry({
        orgId: args.orgId,
        expenseId: args.expenseId,
        field: "registered",
        newValue: args.payload,
        actor: args.actor,
        source: "manual",
    });

    const ocrFields = ocrSubset(args.inputSources);
    const ocrFieldNames = Object.keys(ocrFields);
    if (ocrFieldNames.length > 0) {
        const ocrPayload = ocrFieldNames.reduce<Record<string, unknown>>((acc, field) => {
            if (Object.prototype.hasOwnProperty.call(args.payload, field)) {
                acc[field] = args.payload[field];
            }
            return acc;
        }, {});
        await recordExpenseLogEntry({
            orgId: args.orgId,
            expenseId: args.expenseId,
            field: "ocr_extracted",
            newValue: ocrPayload,
            actor: { type: "system", id: "ocr", name: "レシート読み取り" },
            source: "system_auto",
        });
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

const invoiceBuckets = ["overdue", "this_week", "later", "draft", "all"] as const;
type InvoiceBucket = typeof invoiceBuckets[number];

function normalizeInvoiceBucket(value: unknown): InvoiceBucket | null {
    if (typeof value !== "string" || !value.trim()) {
        return "all";
    }

    const normalized = value.trim();
    return invoiceBuckets.includes(normalized as InvoiceBucket)
        ? normalized as InvoiceBucket
        : null;
}

function getJstDateString(now = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(now);
}

function addDaysToDateString(dateString: string, days: number): string {
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day + days));
    return date.toISOString().slice(0, 10);
}

function daysUntilDue(dueDate: unknown, todayJst = getJstDateString()): number | null {
    if (typeof dueDate !== "string" || dueDate.length < 10) {
        return null;
    }

    const normalizedDueDate = dueDate.slice(0, 10);
    const [dueYear, dueMonth, dueDay] = normalizedDueDate.split("-").map(Number);
    const [todayYear, todayMonth, todayDay] = todayJst.split("-").map(Number);

    if ([dueYear, dueMonth, dueDay, todayYear, todayMonth, todayDay].some((value) => !Number.isFinite(value))) {
        return null;
    }

    const dueTime = Date.UTC(dueYear, dueMonth - 1, dueDay);
    const todayTime = Date.UTC(todayYear, todayMonth - 1, todayDay);
    return Math.round((dueTime - todayTime) / 86_400_000);
}

function isOverdue(dueDate: unknown, todayJst = getJstDateString()): boolean {
    const diff = daysUntilDue(dueDate, todayJst);
    return diff !== null && diff < 0;
}

async function fetchInvoiceListRows(input: {
    orgId: string;
    offset: number;
    limit: number;
    filteredInvoiceIds: string[] | null;
    sourceTransactionIdFilter: string | null;
    bucket: InvoiceBucket;
    todayJst: string;
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

        if (input.bucket === "overdue") {
            query = query.lt("due_date", input.todayJst);
        } else if (input.bucket === "this_week") {
            query = query.gte("due_date", input.todayJst).lte("due_date", addDaysToDateString(input.todayJst, 7));
        } else if (input.bucket === "later") {
            query = query.gt("due_date", addDaysToDateString(input.todayJst, 7));
        } else if (input.bucket === "draft") {
            query = query.eq("pdf_render_status", "pending");
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
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
        const isConfigError = /(api[_\s-]?key|認証情報|credential|is not set|placeholder)/i.test(message);

        if (isConfigError) {
            res.status(503).json({
                error: "OCRサービスが未設定です（管理者に連絡してください）",
            });
            return;
        }

        res.status(500).json({ error: `OCR解析に失敗しました: ${message}` });
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
            invoice_number,
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
        const normalizedInvoiceNumber = normalizeInvoiceNumber(invoice_number);
        const normalizedExpenseScope = normalizeText(expense_scope) || (cost_center === "HQ" ? "overhead" : "job");
        const normalizedPaidBy = normalizeText(paid_by) || "org";
        const normalizedClaimantMemberId = normalizeText(claimant_member_id);
        const normalizedSettlementType = normalizeText(settlement_type) || "paid";
        const normalizedPaymentAccount = normalizeText(payment_account);
        const normalizedReimbursementStatus = normalizeText(reimbursement_status)
            || (normalizedPaidBy === "member" ? "unsubmitted" : null);
        const normalizedRecurringTemplateId = normalizeText(recurring_template_id);

        // Scope 4-value branching (M-1).
        //   job          現場の経費 (site_id 必須, cost_center=SITE)
        //   job_advance  着工前の先行仕入れ (site_id 必須, cost_center=SITE)
        //   stockpile    共通在庫 (site_id 不要, cost_center=HQ)
        //   overhead     本部・会社 (site_id 不要, cost_center=HQ)
        const VALID_EXPENSE_SCOPES = ["job", "job_advance", "stockpile", "overhead"] as const;
        if (!VALID_EXPENSE_SCOPES.includes(normalizedExpenseScope as typeof VALID_EXPENSE_SCOPES[number])) {
            res.status(400).json({ error: "expense_scope must be one of job, job_advance, stockpile, overhead" });
            return;
        }
        const scopeRequiresSite = normalizedExpenseScope === "job" || normalizedExpenseScope === "job_advance";
        const resolvedCostCenter = scopeRequiresSite ? (cost_center || "SITE") : "HQ";
        const resolvedSiteId = scopeRequiresSite ? site_id : null;

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

        const rawInvoiceNumber = normalizeText(invoice_number);
        if (rawInvoiceNumber && !normalizedInvoiceNumber) {
            res.status(400).json({ error: "invoice_number must match the format T followed by 13 digits" });
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

        // S-4 anomaly detection (rule-based, computable at insert time).
        // advance_stale / budget_overrun stay batch-detected; everything
        // resolvable on the insert path lives here.
        // docs/MONEY_EXPENSE_FLOW.md §6.2
        const flagsAtCreate: string[] = [];
        if (!normalizedInvoiceNumber) {
            flagsAtCreate.push("missing_invoice_number");
        }
        if (!source_document_id) {
            flagsAtCreate.push("missing_receipt");
        }
        if (normalizedCategory === "tool" && resolvedTotal >= 100000) {
            flagsAtCreate.push("asset_candidate");
        }

        // duplicate_suspected: same org / vendor / date / amount already
        // exists. Cheap heuristic that catches the most common mistake —
        // re-uploading the same receipt. False positives are fine; the
        // flag is advisory, not blocking.
        const normalizedVendor = normalizeText(vendor_name);
        const dupRecordedDate = recorded_date || new Date().toISOString().split("T")[0];
        if (normalizedVendor) {
            const { data: dupCandidates, error: dupError } = await supabaseAdmin
                .from("accounting_transactions")
                .select("id")
                .eq("org_id", orgId)
                .eq("kind", "expense")
                .eq("vendor_name", normalizedVendor)
                .eq("recorded_date", dupRecordedDate)
                .eq("amount_total", resolvedTotal)
                .limit(1);
            if (dupError) {
                console.error("duplicate_suspected lookup error:", dupError);
            } else if ((dupCandidates ?? []).length > 0) {
                flagsAtCreate.push("duplicate_suspected");
            }
        }

        // The canonical posting RPC currently understands only 'job' and
        // 'overhead' for expense_scope. New scopes (job_advance / stockpile)
        // fall through to the legacy insert path until the RPC is extended.
        const canonicalSupportsScope =
            normalizedExpenseScope === "job" || normalizedExpenseScope === "overhead";

        if (!requiresReview && canonicalSupportsScope) {
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
                expenseScope: normalizedExpenseScope as "job" | "overhead", // canonical RPC currently supports only these two; gate above ensures we only enter this branch with one of them
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
                {
                    const txId = (canonicalData as Record<string, unknown>).id;
                    const patch: Record<string, unknown> = {};
                    if (normalizedInvoiceNumber) {
                        const existingMetadata = (canonicalData as Record<string, unknown>).metadata_json;
                        patch.metadata_json = {
                            ...(existingMetadata && typeof existingMetadata === "object" ? existingMetadata as Record<string, unknown> : {}),
                            invoice_number: normalizedInvoiceNumber,
                        };
                        // T-FIX-1 also wants the typed column populated; M-5 added it.
                        patch.invoice_number = normalizedInvoiceNumber;
                    }
                    if (flagsAtCreate.length > 0) {
                        patch.flags = flagsAtCreate;
                    }
                    if (typeof txId === "string" && Object.keys(patch).length > 0) {
                        const { error: patchError } = await supabaseAdmin
                            .from("accounting_transactions")
                            .update(patch)
                            .eq("id", txId)
                            .eq("org_id", orgId);
                        if (patchError) {
                            console.error("Failed to persist invoice_number/flags on canonical expense:", patchError);
                        } else {
                            Object.assign(canonicalData as Record<string, unknown>, patch);
                        }
                    }
                }

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

                await writeExpenseRegistrationLog({
                    orgId,
                    expenseId: String((canonicalData as Record<string, unknown>).id),
                    inputSources: input_sources,
                    actor: {
                        type: "human",
                        id: req.userId!,
                        name: req.userName || req.userEmail || null,
                    },
                    payload: {
                        amount_total: resolvedTotal,
                        vendor_name: vendor_name ?? null,
                        recorded_date: recorded_date || new Date().toISOString().split("T")[0],
                        expense_scope: normalizedExpenseScope,
                        site_id: resolvedSiteId ?? null,
                        cost_center: resolvedCostCenter,
                        category: normalizedCategory ?? "other",
                        expense_item_code: normalizedExpenseItemCode,
                        invoice_number: normalizedInvoiceNumber,
                        tax_category: normalizedTaxCategory,
                        paid_by: normalizedPaidBy,
                    },
                });

                await registerElectronicDocumentForExpense({
                    orgId,
                    userId: req.userId!,
                    sourceDocumentId: source_document_id,
                    transactionId: String((canonicalData as Record<string, unknown>).id),
                    transactionDate: String((canonicalData as Record<string, unknown>).recorded_date || recorded_date || new Date().toISOString().split("T")[0]),
                    vendorName: vendor_name,
                    amountTotal: resolvedTotal,
                    expenseScope: normalizedExpenseScope,
                    siteId: typeof resolvedSiteId === "string" ? resolvedSiteId : null,
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
                invoice_number: normalizedInvoiceNumber,
            },
            expense_scope: normalizedExpenseScope as "job" | "job_advance" | "stockpile" | "overhead",
            paid_by: normalizedPaidBy as "org" | "member",
            claimant_member_id: normalizedClaimantMemberId,
            settlement_type: normalizedSettlementType as "paid" | "unpaid",
            payment_account: normalizedPaymentAccount as "cash" | "bank" | null,
            reimbursement_status: normalizedReimbursementStatus as "unsubmitted" | "submitted" | "approved" | "reimbursed" | null,
            recurring_template_id: normalizedRecurringTemplateId,
            flags: flagsAtCreate,
            invoice_number: normalizedInvoiceNumber,
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
                    invoice_number: normalizedInvoiceNumber,
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

        await writeExpenseRegistrationLog({
            orgId,
            expenseId: String(data.id),
            inputSources: input_sources,
            actor: {
                type: "human",
                id: req.userId!,
                name: req.userName || req.userEmail || null,
            },
            payload: {
                amount_total: resolvedTotal,
                vendor_name: vendor_name ?? null,
                recorded_date: data.recorded_date,
                expense_scope: normalizedExpenseScope,
                site_id: resolvedSiteId ?? null,
                cost_center: resolvedCostCenter,
                category: normalizedCategory ?? "other",
                expense_item_code: normalizedExpenseItemCode,
                invoice_number: normalizedInvoiceNumber,
                tax_category: normalizedTaxCategory,
                paid_by: normalizedPaidBy,
                requires_review: requiresReview,
            },
        });

        await registerElectronicDocumentForExpense({
            orgId,
            userId: req.userId!,
            sourceDocumentId: source_document_id,
            transactionId: String(data.id),
            transactionDate: String(data.recorded_date),
            vendorName: vendor_name,
            amountTotal: resolvedTotal,
            expenseScope: normalizedExpenseScope,
            siteId: typeof resolvedSiteId === "string" ? resolvedSiteId : null,
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

/**
 * 経費バケット集計 (S-5).
 * Money画面のダッシュボードを駆動する。バケットは独立した「観察ビュー」で、
 * ある経費が複数のバケットに同時にカウントされる場合がある (例: posted な
 * のに asset_candidate でもある工具)。これは仕様 — それぞれが「この観点で
 * 見るとこう」を表す。
 *
 * docs/MONEY_EXPENSE_FLOW.md §5.1, §11.2-11.3
 */
router.get("/expense_buckets", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const monthParam = typeof req.query.month === "string" ? req.query.month : "";

        let startDate: string;
        let endDate: string;
        if (/^\d{4}-\d{2}$/.test(monthParam)) {
            const [yearStr, monthStr] = monthParam.split("-");
            const year = Number(yearStr);
            const month = Number(monthStr);
            const lastDay = new Date(year, month, 0).getDate();
            startDate = `${monthParam}-01`;
            endDate = `${monthParam}-${String(lastDay).padStart(2, "0")}`;
        } else {
            const now = new Date();
            const year = now.getFullYear();
            const month = now.getMonth() + 1;
            const lastDay = new Date(year, month, 0).getDate();
            const monthLabel = `${year}-${String(month).padStart(2, "0")}`;
            startDate = `${monthLabel}-01`;
            endDate = `${monthLabel}-${String(lastDay).padStart(2, "0")}`;
        }

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .select("id, amount_total, expense_scope, expense_lifecycle_state, flags, recorded_date, created_at, status")
            .eq("org_id", orgId)
            .eq("kind", "expense")
            .gte("recorded_date", startDate)
            .lte("recorded_date", endDate);

        if (error) {
            console.error("expense_buckets query error:", error);
            res.status(500).json({ error: "Internal server error" });
            return;
        }

        const REVIEW_FLAGS = new Set([
            "missing_invoice_number",
            "missing_receipt",
            "duplicate_suspected",
            "out_of_pattern",
            "budget_overrun",
        ]);

        type Bucket = { count: number; amount: number };
        const empty = (): Bucket => ({ count: 0, amount: 0 });
        const buckets = {
            unassigned: empty(),
            needs_review: empty(),
            awaiting_verify: empty(),
            posted: empty(),
            asset_candidates: empty(),
            advance_stale: empty(),
        };

        const nowMs = Date.now();
        let oldestUnassignedAgeDays: number | null = null;

        for (const row of data ?? []) {
            const amount = Number(row.amount_total) || 0;
            const flags = Array.isArray(row.flags) ? (row.flags as string[]) : [];
            const lifecycle = typeof row.expense_lifecycle_state === "string"
                ? row.expense_lifecycle_state
                : "captured";
            const scope = typeof row.expense_scope === "string" ? row.expense_scope : null;

            const isUnassigned = !scope || scope === "unassigned" || flags.includes("missing_job");
            if (isUnassigned) {
                buckets.unassigned.count += 1;
                buckets.unassigned.amount += amount;
                if (typeof row.created_at === "string") {
                    const ageDays = Math.floor((nowMs - new Date(row.created_at).getTime()) / 86_400_000);
                    if (oldestUnassignedAgeDays === null || ageDays > oldestUnassignedAgeDays) {
                        oldestUnassignedAgeDays = ageDays;
                    }
                }
            }

            if (flags.some((flag) => REVIEW_FLAGS.has(flag))) {
                buckets.needs_review.count += 1;
                buckets.needs_review.amount += amount;
            }

            if (lifecycle === "classified") {
                buckets.awaiting_verify.count += 1;
                buckets.awaiting_verify.amount += amount;
            }

            if (lifecycle === "posted" || row.status === "posted") {
                buckets.posted.count += 1;
                buckets.posted.amount += amount;
            }

            if (flags.includes("asset_candidate")) {
                buckets.asset_candidates.count += 1;
                buckets.asset_candidates.amount += amount;
            }

            if (flags.includes("advance_stale")) {
                buckets.advance_stale.count += 1;
                buckets.advance_stale.amount += amount;
            }
        }

        res.json({
            month: monthParam || `${startDate.slice(0, 7)}`,
            range: { from: startDate, to: endDate },
            buckets,
            oldest_unassigned_age_days: oldestUnassignedAgeDays,
            total_count: (data ?? []).length,
        });
    } catch (err) {
        console.error("expense_buckets unexpected error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * 経費の編集履歴取得 (F-2 サポート).
 * append-only な expense_field_change_log を時系列で返す。
 * 詳細ビューのタイムライン表示に使う。
 *
 * docs/MONEY_EXPENSE_FLOW.md §5.3, §11.4
 */
router.get("/expenses/:id/history", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const expenseId = req.params.id;
        if (!expenseId) {
            res.status(400).json({ error: "expense id is required" });
            return;
        }

        // 組織境界の確認 — 経費自体が同 org に属すること.
        const { data: expense, error: expenseError } = await supabaseAdmin
            .from("accounting_transactions")
            .select("id")
            .eq("id", expenseId)
            .eq("org_id", orgId)
            .eq("kind", "expense")
            .maybeSingle();

        if (expenseError) {
            console.error("expense lookup error:", expenseError);
            res.status(500).json({ error: "Internal server error" });
            return;
        }
        if (!expense) {
            res.status(404).json({ error: "expense not found" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("expense_field_change_log")
            .select("id, field, old_value, new_value, changed_by, changed_at, source, reason")
            .eq("expense_id", expenseId)
            .eq("org_id", orgId)
            .order("changed_at", { ascending: true });

        if (error) {
            console.error("expense history query error:", error);
            res.status(500).json({ error: "Internal server error" });
            return;
        }

        res.json({ expense_id: expenseId, entries: data ?? [] });
    } catch (err) {
        console.error("expense history unexpected error:", err);
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

function statusForCashReceiptError(message: string): number {
    if (message.includes("duplicate key") || message.includes("uq_cash_receipts_bank_ref")) {
        return 409;
    }
    const code = message.includes(":") ? message.split(":")[0] : message;
    const statusMap: Record<string, number> = {
        CLIENT_NOT_FOUND: 404,
        INVOICE_TRANSACTION_NOT_FOUND: 404,
        CASH_RECEIPT_NOT_FOUND: 404,
        ALLOCATIONS_EXCEED_RECEIVED_AMOUNT: 409,
        CASH_RECEIPT_ALREADY_FULLY_ALLOCATED: 409,
        CASH_RECEIPT_ALLOCATION_DUPLICATE: 409,
        APPROVER_NOT_ALLOWED_BY_POLICY: 403,
        TAX_ACCOUNT_MAPPING_NOT_FOUND: 422,
        TAX_ACCOUNT_MAPPING_NOT_APPLICABLE: 422,
        LEDGER_IMBALANCED: 422,
    };
    return statusMap[code] ?? 500;
}

async function fetchCashReceiptAllocations(receiptIds: string[]) {
    if (receiptIds.length === 0) {
        return new Map<string, unknown[]>();
    }

    const { data, error } = await supabaseAdmin
        .from("cash_receipt_allocations")
        .select("id,receipt_id,invoice_transaction_id,allocated_amount,created_at,invoice:accounting_transactions(id,kind,recorded_date,amount_total,description)")
        .in("receipt_id", receiptIds);

    if (error) {
        throw error;
    }

    const map = new Map<string, unknown[]>();
    for (const row of data || []) {
        const receiptId = String((row as Record<string, unknown>).receipt_id);
        const list = map.get(receiptId) || [];
        list.push(row);
        map.set(receiptId, list);
    }
    return map;
}

router.post("/cash-receipts", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
        const normalized = normalizeCashReceiptPayload(body);
        if (!normalized.payload) {
            res.status(400).json({ error: normalized.error || "cash receipt payload is invalid" });
            return;
        }
        const payload = normalized.payload;

        await assertActiveClientForOrg(payload.client_id, orgId);

        if (payload.bank_txn_ref) {
            const { data: existing, error: existingError } = await supabaseAdmin
                .from("cash_receipts")
                .select("id")
                .eq("org_id", orgId)
                .eq("bank_txn_ref", payload.bank_txn_ref)
                .maybeSingle();
            if (existingError) {
                throw existingError;
            }
            if (existing) {
                res.status(409).json({ error: "CASH_RECEIPT_BANK_TXN_REF_CONFLICT" });
                return;
            }
        }

        const transactionIds = payload.allocations.map((allocation) => allocation.invoice_transaction_id);
        const transactions = await getInvoiceTransactionsByIds(transactionIds, orgId);
        if (transactions.length !== transactionIds.length) {
            res.status(404).json({ error: "INVOICE_TRANSACTION_NOT_FOUND" });
            return;
        }
        if (transactions.some((transaction) => transaction.client_id !== payload.client_id)) {
            res.status(400).json({ error: "INVOICE_TRANSACTION_CLIENT_MISMATCH" });
            return;
        }
        if (transactions.some((transaction) => !["sale", "invoice"].includes(transaction.kind))) {
            res.status(400).json({ error: "Only sale or invoice transactions can be allocated" });
            return;
        }

        const proposalService = new ProposalService(orgId);
        const actor = buildHumanActor(req);
        const description = `入金記録: ${payload.received_date} ¥${payload.received_amount.toLocaleString()}`;
        const result = await proposalService.createAndSubmit({
            type: "cash_receipt.record",
            payload: {
                ...payload,
                description,
            },
            description,
            created_by: actor,
            org_id: orgId,
            idempotency_key: payload.bank_txn_ref || null,
        });

        res.status(201).json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
        const status = statusForCashReceiptError(message);
        if (status === 500) {
            console.error("[accounting] cash receipt create error:", err);
        }
        res.status(status).json({ error: status === 500 ? "Internal server error" : message });
    }
});

router.get("/cash-receipts", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        let query = supabaseAdmin
            .from("cash_receipts")
            .select("*,client:clients(id,name),proposal:proposals(id,status,type,description,created_at,executed_at,result_event_id)")
            .eq("org_id", orgId)
            .order("received_date", { ascending: false })
            .order("created_at", { ascending: false });

        const from = normalizeText(req.query.from);
        const to = normalizeText(req.query.to);
        const clientId = normalizeText(req.query.client_id);
        const status = normalizeText(req.query.status);

        if (from) query = query.gte("received_date", from);
        if (to) query = query.lte("received_date", to);
        if (clientId && isUuid(clientId)) query = query.eq("client_id", clientId);
        if (status) query = query.eq("status", status);

        const { data, error } = await query;
        if (error) {
            throw error;
        }

        const rows = data || [];
        const allocationsByReceipt = await fetchCashReceiptAllocations(rows.map((row: any) => row.id));
        res.json({
            cash_receipts: rows.map((row: any) => ({
                ...row,
                allocations: allocationsByReceipt.get(row.id) || [],
            })),
        });
    } catch (err) {
        console.error("[accounting] cash receipts list error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/cash-receipts/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!isUuid(receiptId)) {
            res.status(404).json({ error: "CASH_RECEIPT_NOT_FOUND" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("cash_receipts")
            .select("*,client:clients(id,name),proposal:proposals(id,status,type,description,created_at,executed_at,result_event_id),ledger_event:ledger_events(id,event_type,created_at)")
            .eq("org_id", orgId)
            .eq("id", receiptId)
            .maybeSingle();

        if (error) {
            throw error;
        }
        if (!data) {
            res.status(404).json({ error: "CASH_RECEIPT_NOT_FOUND" });
            return;
        }

        const allocationsByReceipt = await fetchCashReceiptAllocations([receiptId]);
        res.json({
            cash_receipt: {
                ...data,
                allocations: allocationsByReceipt.get(receiptId) || [],
            },
        });
    } catch (err) {
        console.error("[accounting] cash receipt detail error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/cash-receipts/:id/allocations", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const receiptId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!isUuid(receiptId)) {
            res.status(404).json({ error: "CASH_RECEIPT_NOT_FOUND" });
            return;
        }

        const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
        const invoiceTransactionId = normalizeText(body.invoice_transaction_id);
        const allocatedAmount = parseNumericInput(body.allocated_amount);
        if (!invoiceTransactionId || !isUuid(invoiceTransactionId)) {
            res.status(400).json({ error: "invoice_transaction_id must be a uuid" });
            return;
        }
        if (allocatedAmount === null || allocatedAmount <= 0) {
            res.status(400).json({ error: "allocated_amount must be positive" });
            return;
        }

        const { data: receipt, error: receiptError } = await supabaseAdmin
            .from("cash_receipts")
            .select("*")
            .eq("id", receiptId)
            .eq("org_id", orgId)
            .maybeSingle();
        if (receiptError) {
            throw receiptError;
        }
        if (!receipt) {
            res.status(404).json({ error: "CASH_RECEIPT_NOT_FOUND" });
            return;
        }

        const [transaction] = await getInvoiceTransactionsByIds([invoiceTransactionId], orgId);
        if (!transaction || transaction.client_id !== receipt.client_id) {
            res.status(404).json({ error: "INVOICE_TRANSACTION_NOT_FOUND" });
            return;
        }

        const nextAllocated = roundMoney(Number(receipt.allocated_amount || 0) + allocatedAmount);
        if (nextAllocated > Number(receipt.received_amount)) {
            res.status(409).json({ error: "ALLOCATIONS_EXCEED_RECEIVED_AMOUNT" });
            return;
        }

        const { data: allocation, error: allocationError } = await supabaseAdmin
            .from("cash_receipt_allocations")
            .insert({
                receipt_id: receiptId,
                invoice_transaction_id: invoiceTransactionId,
                allocated_amount: roundMoney(allocatedAmount),
            })
            .select()
            .single();

        if (allocationError) {
            if (allocationError.message.includes("duplicate key")) {
                res.status(409).json({ error: "CASH_RECEIPT_ALLOCATION_DUPLICATE" });
                return;
            }
            throw allocationError;
        }

        const { data: updated, error: updatedError } = await supabaseAdmin
            .from("cash_receipts")
            .select("*")
            .eq("id", receiptId)
            .eq("org_id", orgId)
            .single();
        if (updatedError) {
            throw updatedError;
        }

        res.status(201).json({ allocation, cash_receipt: updated });
    } catch (err) {
        const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
        const status = statusForCashReceiptError(message);
        if (status === 500) {
            console.error("[accounting] cash receipt allocation error:", err);
        }
        res.status(status).json({ error: status === 500 ? "Internal server error" : message });
    }
});

router.get("/tax-account-mappings", async (req: AuthenticatedRequest, res: Response) => {
    try {
        await resolveActiveOrgMembership(req, "admin");
        const orgId = req.orgId!;
        const asOf = parseAsOfDate(req.query.as_of) ?? new Date();
        const service = new TaxAccountMappingService(orgId);
        const [mappings, historyResult, accountsResult] = await Promise.all([
            service.listMappings(asOf),
            service.listHistory(),
            supabaseAdmin
                .from("account_master")
                .select("code,name,category,is_active,display_order")
                .eq("is_active", true)
                .order("display_order", { ascending: true })
                .order("code", { ascending: true }),
        ]);

        if (accountsResult.error) {
            throw accountsResult.error;
        }

        res.json({
            mappings,
            history: historyResult,
            accounts: accountsResult.data ?? [],
        });
    } catch (err: any) {
        const message = err instanceof Error ? err.message : "Internal server error";
        const status = message === "ORG_ROLE_REQUIRED" ? 403 : 500;
        if (status === 500) {
            console.error("[accounting] tax account mappings get error:", err);
        }
        res.status(status).json({ error: message });
    }
});

router.post("/tax-account-mappings/:id/revisions", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "admin");
        const orgId = req.orgId!;
        const mappingId = normalizeText(req.params.id);
        const taxAccountCode = normalizeText(req.body.tax_account_code);
        const taxAccountName = normalizeText(req.body.tax_account_name);
        const category = normalizeTaxAccountCategory(req.body.category);
        const applicableProposalTypes = normalizeProposalTypes(req.body.applicable_proposal_types);
        const effectiveFrom = normalizeText(req.body.effective_from);

        if (!mappingId) {
            res.status(400).json({ error: "mapping id is required" });
            return;
        }
        if (!taxAccountCode) {
            res.status(400).json({ error: "tax_account_code is required" });
            return;
        }
        if (!taxAccountName) {
            res.status(400).json({ error: "tax_account_name is required" });
            return;
        }
        if (!category) {
            res.status(400).json({ error: "category must be one of income, expense, asset, liability, equity" });
            return;
        }
        if (!applicableProposalTypes) {
            res.status(400).json({ error: "applicable_proposal_types must be a non-empty array" });
            return;
        }
        if (!effectiveFrom || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
            res.status(400).json({ error: "effective_from must be YYYY-MM-DD" });
            return;
        }
        if (!membership.id) {
            res.status(403).json({ error: "ORG_MEMBERSHIP_REQUIRED" });
            return;
        }

        const service = new TaxAccountMappingService(orgId);
        const mapping = await service.replaceMapping({
            mappingId,
            taxAccountCode,
            taxAccountName,
            category,
            applicableProposalTypes,
            effectiveFrom,
            actorUserId: req.userId!,
            membershipId: membership.id,
        });

        res.status(201).json({ mapping });
    } catch (err: any) {
        const message = err instanceof Error ? err.message : "Internal server error";
        const status = message === "ORG_ROLE_REQUIRED" ? 403 : 400;
        if (status >= 500) {
            console.error("[accounting] tax account mappings update error:", err);
        }
        res.status(status).json({ error: message });
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
            bucket: requestedBucket,
        } = req.query;
        const bucket = normalizeInvoiceBucket(requestedBucket);

        if (!bucket) {
            res.status(400).json({ error: "bucket must be one of overdue, this_week, later, draft, all" });
            return;
        }

        const todayJst = getJstDateString();

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
            bucket,
            todayJst,
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
            is_overdue: isOverdue(invoice.due_date, todayJst),
            days_until_due: daysUntilDue(invoice.due_date, todayJst),
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

router.get("/invoices/:id/payout-detail", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!isUuid(invoiceId)) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }

        const detail = await invoiceReviewerAssignmentService.getPayoutDetail({
            invoiceId,
            orgId,
            reviewerUserId: req.userId!,
        });

        res.json(detail);
    } catch (err) {
        sendInvoiceReviewError(res, err);
    }
});

router.post("/invoices/:id/mark-paid", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const invoiceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
        if (!isUuid(invoiceId)) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }

        await invoiceReviewerAssignmentService.assertActiveReviewer({
            invoiceId,
            orgId,
            reviewerUserId: req.userId!,
        });

        const invoice = await memberInvoiceService.findById(invoiceId);
        if (!invoice || invoice.org_id !== orgId) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }
        if (invoice.member_id === req.userId) {
            throw new Error("MEMBER_INVOICE_MARK_PAID_OWNER_CANNOT_SELF_APPROVE");
        }
        if (invoice.status !== "issued") {
            throw new Error("MEMBER_INVOICE_NOT_IN_ISSUED_STATE");
        }

        const body = (req.body && typeof req.body === "object" ? req.body : {}) as Record<
            string,
            unknown
        >;
        const paidAt = typeof body.paid_at === "string" ? body.paid_at : new Date().toISOString();
        const memo = typeof body.memo === "string" && body.memo.trim()
            ? body.memo.trim().slice(0, 500)
            : null;

        const proposalService = new ProposalService(orgId);
        const actor = buildHumanActor(req);
        const created = await proposalService.create({
            type: "invoice.member_mark_paid",
            payload: {
                invoice_id: invoice.id,
                invoice_no: invoice.invoice_no,
                paid_at: paidAt,
                paid_method: "bank_transfer",
                memo,
                amount: invoice.amount_total,
                debit_account_code: "2110",
                credit_account_code: "1100",
                description: `${invoice.invoice_no} 支払い`,
            },
            description: `${invoice.invoice_no} を支払い済みに記録 (¥${Number(invoice.amount_total).toLocaleString()})`,
            created_by: actor,
            org_id: orgId,
        });

        await proposalService.submit(created.id, actor);
        const approved = await proposalService.approve(created.id, actor);
        const completedAssignment = await invoiceReviewerAssignmentService.markCompleted({
            invoiceId,
            orgId,
            reviewerUserId: req.userId!,
        });
        const updated = await memberInvoiceService.findById(invoice.id);

        res.status(201).json({
            proposal: approved.proposal,
            invoice: buildMemberInvoicePaymentSummary(updated),
            assignment: completedAssignment,
            self_member_id: req.userId!,
            is_self: invoice.member_id === req.userId,
        });
    } catch (err) {
        sendInvoiceReviewError(res, err);
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

// PL 月次推移 (直近 N ヶ月の sales / expenses / profit, legacy basis, PR #8)
router.get("/pl/trend", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const endParam = typeof req.query.end === "string" ? req.query.end : "";
        const monthsParam = Number(req.query.months);
        const months = Number.isFinite(monthsParam) && monthsParam > 0 && monthsParam <= 24
            ? Math.floor(monthsParam)
            : 6;
        const endMonth = /^\d{4}-\d{2}$/.test(endParam)
            ? endParam
            : new Date().toISOString().slice(0, 7);

        const [endYearStr, endMonStr] = endMonth.split("-");
        const endYear = Number(endYearStr);
        const endMon = Number(endMonStr);

        // 範囲先頭月の 1 日
        const startDate = new Date(endYear, endMon - 1 - (months - 1), 1);
        const startIso = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;
        // 範囲末尾月の末日
        const endDay = new Date(endYear, endMon, 0).getDate();
        const endIso = `${endMonth}-${String(endDay).padStart(2, "0")}`;

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .select("kind, amount_total, recorded_date")
            .eq("org_id", req.orgId!)
            .in("status", [...LEDGER_AGGREGATION_STATUSES])
            .gte("recorded_date", startIso)
            .lte("recorded_date", endIso);

        if (error) throw error;

        // 月別バケット初期化 (古い→新しい順)
        const buckets: Record<string, { sales: number; expenses: number }> = {};
        const monthKeys: string[] = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(endYear, endMon - 1 - (months - 1) + i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            monthKeys.push(key);
            buckets[key] = { sales: 0, expenses: 0 };
        }

        for (const row of (data ?? []) as Array<{ kind: string; amount_total: number | string; recorded_date: string }>) {
            const monthKey = row.recorded_date.slice(0, 7);
            const bucket = buckets[monthKey];
            if (!bucket) continue;
            const amt = Number(row.amount_total) || 0;
            if (row.kind === "sale" || row.kind === "invoice") {
                bucket.sales += amt;
            } else if (row.kind === "expense") {
                bucket.expenses += amt;
            }
        }

        const trend = monthKeys.map((key) => {
            const { sales, expenses } = buckets[key];
            return {
                month: key,
                sales,
                expenses,
                profit: sales - expenses,
            };
        });

        res.json({ months: trend, basis: "legacy" });
    } catch (err: any) {
        console.error("[accounting] pl trend error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/site-cost-transfers/preview", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const monthValidation = validateReportingMonth(req.query.month);
        if (!monthValidation.ok) {
            res.status(monthValidation.status).json({ error: monthValidation.error });
            return;
        }

        const service = new ConstructionAccountingService(req.orgId!);
        const transfers = await service.listMonthlyTransferPreview(monthValidation.month);
        res.json({ month: monthValidation.month, transfers });
    } catch (err: any) {
        const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";
        if (code === "INVALID_MONTH") {
            res.status(400).json({ error: code });
            return;
        }
        console.error("[accounting] site cost transfer preview error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/monthly-deductible", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
        const result = await invoiceRegistrationService.getMonthlyDeductibleAmount({
            orgId: membership.org_id,
            month,
        });

        res.json(result);
    } catch (err: any) {
        if (err instanceof Error && err.message === "INVOICE_DEDUCTIBLE_MONTH_INVALID") {
            res.status(400).json({ error: err.message });
            return;
        }
        if (
            err instanceof Error &&
            (
                err.message === "USER_CONTEXT_REQUIRED" ||
                err.message === "ORG_ONBOARDING_REQUIRED" ||
                err.message === "ORG_MEMBERSHIP_REQUIRED" ||
                err.message === "ORG_ROLE_REQUIRED"
            )
        ) {
            res.status(403).json({ error: err.message });
            return;
        }
        console.error("[accounting] monthly deductible error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

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
                .select("*, site:sites(id, status)")
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
                transaction:accounting_transactions!accounting_journal_entries_org_transaction_fkey(id, kind, cost_center, site_id),
                posting_group:posting_groups!accounting_journal_entries_org_posting_group_fkey(id, group_type),
                lines:accounting_journal_lines!accounting_journal_lines_org_entry_fkey(id, account_code, debit, credit, site_id)
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
// Member reimbursements（立替透明性サマリ）
// ============================================================

router.get("/member-reimbursements-summary", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const monthValidation = validateReportingMonth(req.query.month);
        if (!monthValidation.ok) {
            res.status(monthValidation.status).json({ error: monthValidation.error });
            return;
        }

        const orgId = req.orgId!;
        const selfMemberId = req.orgMembershipId ?? null;
        const members = await loadActiveReimbursementMembers(orgId);
        if (members.length === 0) {
            res.json({ month: monthValidation.month, self_member_id: selfMemberId, members: [] });
            return;
        }

        const membershipIds = members.map((member) => member.id);
        const [profiles, txResult] = await Promise.all([
            loadProfileMap(members.map((member) => member.user_id)),
            supabaseAdmin
                .from("accounting_transactions")
                .select("id,recorded_date,category,amount_total,claimant_member_id,reimbursement_status,recurring_expense_id,recurring_expenses(id,category,title,monthly_amount)")
                .eq("org_id", orgId)
                .eq("kind", "expense")
                .eq("paid_by", "member")
                .eq("settlement_type", "unpaid")
                .in("claimant_member_id", membershipIds)
                .in("status", [...REIMBURSEMENT_ACTIVE_TRANSACTION_STATUSES])
                .gte("recorded_date", monthValidation.startDate)
                .lt("recorded_date", monthValidation.endDateExclusive),
        ]);

        if (txResult.error) {
            throw txResult.error;
        }

        const rowsByMemberId = new Map<string, ReimbursementTransactionRow[]>();
        for (const row of (txResult.data ?? []) as ReimbursementTransactionRow[]) {
            if (!row.claimant_member_id) {
                continue;
            }
            const rows = rowsByMemberId.get(row.claimant_member_id) ?? [];
            rows.push(row);
            rowsByMemberId.set(row.claimant_member_id, rows);
        }

        const responseMembers = members
            .map((member) => {
                const rows = rowsByMemberId.get(member.id) ?? [];
                const summary = summarizeReimbursementRows(rows);
                const recurring = summarizeRecurringRows(rows);
                if (summary.total_advanced <= 0) {
                    return null;
                }
                return {
                    member_id: member.id,
                    nickname: resolveMemberNickname(profiles.get(member.user_id), member.user_id),
                    total_advanced: summary.total_advanced,
                    unsettled: summary.unsettled,
                    settled: summary.settled,
                    count_pending: summary.count_pending,
                    status: resolveReimbursementMemberStatus(summary),
                    recurring_total: recurring.recurring_total,
                    recurring_items: recurring.recurring_items,
                    is_self: member.user_id === req.userId || member.id === req.orgMembershipId,
                };
            })
            .filter((member): member is NonNullable<typeof member> => Boolean(member))
            .sort((left, right) => {
                if (left.is_self !== right.is_self) {
                    return left.is_self ? -1 : 1;
                }
                return right.total_advanced - left.total_advanced;
            })
            .map(({ is_self, ...member }) => member);

        res.json({ month: monthValidation.month, self_member_id: selfMemberId, members: responseMembers });
    } catch (err: any) {
        console.error("[accounting] member reimbursements summary error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/member/:memberId/reimbursement-balance", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const monthValidation = validateReportingMonth(req.query.month);
        if (!monthValidation.ok) {
            res.status(monthValidation.status).json({ error: monthValidation.error });
            return;
        }

        const orgId = req.orgId!;
        const memberId = normalizeText(req.params.memberId);
        if (!memberId) {
            res.status(403).json({ error: "member not in org" });
            return;
        }

        const { data: member, error: memberError } = await supabaseAdmin
            .from("org_memberships")
            .select("id")
            .eq("org_id", orgId)
            .eq("id", memberId)
            .eq("status", "active")
            .is("suspended_at", null)
            .maybeSingle();

        if (memberError) {
            throw memberError;
        }
        if (!member) {
            res.status(403).json({ error: "member not in org" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("accounting_transactions")
            .select("id,recorded_date,category,amount_total,claimant_member_id,reimbursement_status,recurring_expense_id,recurring_expenses(id,category,title,monthly_amount)")
            .eq("org_id", orgId)
            .eq("kind", "expense")
            .eq("paid_by", "member")
            .eq("settlement_type", "unpaid")
            .eq("claimant_member_id", memberId)
            .in("status", [...REIMBURSEMENT_ACTIVE_TRANSACTION_STATUSES])
            .gte("recorded_date", monthValidation.startDate)
            .lt("recorded_date", monthValidation.endDateExclusive)
            .order("recorded_date", { ascending: false })
            .limit(50);

        if (error) {
            throw error;
        }

        const rows = (data ?? []) as ReimbursementTransactionRow[];
        const summary = summarizeReimbursementRows(rows);
        const recurring = summarizeRecurringRows(rows);
        res.json({
            member_id: memberId,
            month: monthValidation.month,
            total_advanced: summary.total_advanced,
            unsettled: summary.unsettled,
            settled: summary.settled,
            by_status: summary.by_status,
            recurring_total: recurring.recurring_total,
            recurring_items: recurring.recurring_items,
            recent_items: rows.slice(0, 5).map((row) => ({
                id: row.id,
                occurred_on: row.recorded_date,
                category: row.category ?? "other",
                amount: toWholeYen(row.amount_total),
                reimbursement_status: resolveReimbursementStatus(row.reimbursement_status),
                recurring_expense: row.recurring_expense_id
                    ? summarizeRecurringRows([row]).recurring_items[0] ?? null
                    : null,
            })),
        });
    } catch (err: any) {
        console.error("[accounting] member reimbursement balance error:", err);
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
                source_document:documents!accounting_transactions_source_document_id_fkey(id, storage_path, drive_file_id, drive_file_url, original_filename, mime_type, ocr_fields),
                items:accounting_transaction_items!accounting_transaction_items_transaction_id_fkey(item_name, quantity, unit_name, unit_price, amount)
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
        source_document:documents!accounting_transactions_source_document_id_fkey(id, storage_path, drive_file_id, drive_file_url, original_filename, mime_type, ocr_fields),
        items:accounting_transaction_items!accounting_transaction_items_transaction_id_fkey(item_name, quantity, unit_name, unit_price, amount)
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

// 取引先 月次サマリ (Money 取引先タブ 3 section, PR #6)
router.get("/partners/summary", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const monthParam = typeof req.query.month === "string" ? req.query.month : "";
        const month = /^\d{4}-\d{2}$/.test(monthParam)
            ? monthParam
            : new Date().toISOString().slice(0, 7);
        const today = new Date().toISOString().slice(0, 10);
        const result = await getPartnersSummary(req.orgId!, month, today);
        res.json(result);
    } catch (err: any) {
        if (err instanceof Error && err.message === "ERR_INVALID_MONTH") {
            res.status(400).json({ error: "month must be YYYY-MM" });
            return;
        }
        console.error("[accounting] partners summary error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// キャッシュフロー 4 バー (v3.3 mock の bucket-strip, PR #10):
//  - unbilled: 当月 sale 取引で invoice 未発行 (請求漏れ candidates)
//  - awaiting_payment: 未完済の invoice 残高 (期間に関わらず累積)
//  - pay_pending: 当月 expense 取引
//  - done: 当月 accounting_payments の合計
router.get("/cashflow-summary", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = req.orgId!;
        const monthParam = typeof req.query.month === "string" ? req.query.month : "";
        const month = /^\d{4}-\d{2}$/.test(monthParam)
            ? monthParam
            : new Date().toISOString().slice(0, 7);
        const [yStr, mStr] = month.split("-");
        const lastDay = new Date(Number(yStr), Number(mStr), 0).getDate();
        const start = `${month}-01`;
        const end = `${month}-${String(lastDay).padStart(2, "0")}`;

        const activeStatuses = ["posted", "approved"] as const;

        // 当月 sale 取引 (id 付きで取り、invoice link 突合に使う)
        const { data: salesRows, error: salesErr } = await supabaseAdmin
            .from("accounting_transactions")
            .select("id, amount_total")
            .eq("org_id", orgId)
            .eq("kind", "sale")
            .in("status", [...activeStatuses])
            .gte("recorded_date", start)
            .lte("recorded_date", end);
        if (salesErr) throw salesErr;
        const monthSaleIds = (salesRows ?? []).map((r) => r.id as string);
        const saleTotalById = new Map<string, number>();
        for (const r of (salesRows ?? []) as Array<{ id: string; amount_total: number | string }>) {
            saleTotalById.set(r.id, Number(r.amount_total) || 0);
        }

        // 当月 sale を source とする invoice を抽出
        let invoicedSaleIds = new Set<string>();
        if (monthSaleIds.length > 0) {
            const { data: invRows, error: invErr } = await supabaseAdmin
                .from("accounting_invoices")
                .select("source_transaction_id")
                .eq("org_id", orgId)
                .in("source_transaction_id", monthSaleIds);
            if (invErr) throw invErr;
            invoicedSaleIds = new Set(
                (invRows ?? [])
                    .map((r) => r.source_transaction_id as string)
                    .filter((id): id is string => !!id),
            );
        }

        const unbilled = monthSaleIds.reduce((sum, id) => {
            return invoicedSaleIds.has(id) ? sum : sum + (saleTotalById.get(id) ?? 0);
        }, 0);

        // 未完済 invoice (期間制限なし)
        const { data: invoiceAllRows, error: invoiceAllErr } = await supabaseAdmin
            .from("accounting_invoices")
            .select(
                `id,
                 source:accounting_transactions!accounting_invoices_source_transaction_id_fkey(amount_total)`,
            )
            .eq("org_id", orgId);
        if (invoiceAllErr) throw invoiceAllErr;
        const invoiceList = (invoiceAllRows ?? []) as Array<{
            id: string;
            source: { amount_total: number | string } | { amount_total: number | string }[] | null;
        }>;
        const invoiceIdList = invoiceList.map((r) => r.id);
        const allocatedByInvoice = new Map<string, number>();
        if (invoiceIdList.length > 0) {
            const { data: allocRows, error: allocErr } = await supabaseAdmin
                .from("payment_allocations")
                .select("invoice_id, allocated_amount")
                .eq("org_id", orgId)
                .in("invoice_id", invoiceIdList);
            if (allocErr) throw allocErr;
            for (const a of (allocRows ?? []) as Array<{ invoice_id: string; allocated_amount: number | string }>) {
                allocatedByInvoice.set(
                    a.invoice_id,
                    (allocatedByInvoice.get(a.invoice_id) ?? 0) + (Number(a.allocated_amount) || 0),
                );
            }
        }
        let awaitingPayment = 0;
        for (const inv of invoiceList) {
            const src = Array.isArray(inv.source) ? inv.source[0] : inv.source;
            const total = Number(src?.amount_total ?? 0);
            const allocated = allocatedByInvoice.get(inv.id) ?? 0;
            const outstanding = total - allocated;
            if (outstanding > 0) awaitingPayment += outstanding;
        }

        // 当月 expense
        const { data: expRows, error: expErr } = await supabaseAdmin
            .from("accounting_transactions")
            .select("amount_total")
            .eq("org_id", orgId)
            .eq("kind", "expense")
            .in("status", [...activeStatuses])
            .gte("recorded_date", start)
            .lte("recorded_date", end);
        if (expErr) throw expErr;
        const payPending = (expRows ?? []).reduce(
            (s, r) => s + (Number((r as { amount_total: number | string }).amount_total) || 0),
            0,
        );

        // 当月 入金
        const { data: payRows, error: payErr } = await supabaseAdmin
            .from("accounting_payments")
            .select("amount")
            .eq("org_id", orgId)
            .gte("received_on", start)
            .lte("received_on", end)
            .neq("status", "voided");
        if (payErr) throw payErr;
        const done = (payRows ?? []).reduce(
            (s, r) => s + (Number((r as { amount: number | string }).amount) || 0),
            0,
        );

        res.json({
            month,
            unbilled,
            awaiting_payment: awaitingPayment,
            pay_pending: payPending,
            done,
        });
    } catch (err: any) {
        console.error("[accounting] cashflow-summary error:", err);
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
        source_document:documents!accounting_transactions_source_document_id_fkey(id, storage_path, drive_file_id, drive_file_url, original_filename, mime_type, ocr_fields)
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
