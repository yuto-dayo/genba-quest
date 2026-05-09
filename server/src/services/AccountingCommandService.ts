import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveTaxRate, type InvoiceTransaction } from "./InvoiceEligibilityService";

const EXPENSE_CATEGORIES = ["material", "tool", "travel", "food", "fuel", "utility", "other"] as const;
const VOIDABLE_TRANSACTION_STATUSES = ["posted", "approved"] as const;
const EXPENSE_ACCOUNT_MAP: Record<ExpenseCategory, { code: string; name: string }> = {
    material: { code: "5100", name: "材料費" },
    tool: { code: "5200", name: "工具備品費" },
    travel: { code: "5300", name: "交通費" },
    food: { code: "5400", name: "会議費" },
    fuel: { code: "5900", name: "燃料費" },
    utility: { code: "5900", name: "光熱費" },
    other: { code: "5900", name: "その他経費" },
};

type ExpenseCategory = typeof EXPENSE_CATEGORIES[number];

export class AccountingCommandError extends Error {
    status: number;
    code: string;

    constructor(status: number, code: string) {
        super(code);
        this.status = status;
        this.code = code;
    }
}

export type ExpenseInsertPayload = {
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
    tax_category: string;
    risk_level: "LOW" | "HIGH";
    status?: string;
    review_status?: string;
    source_document_id: unknown;
    input_sources: Record<string, unknown>;
    projection_source?: "legacy_direct_write" | "transition_lineage" | "canonical_posting_projection" | "synthetic_backfill";
    proposal_id?: string | null;
    proposal_execution_id?: string | null;
    posting_group_id?: string | null;
    journal_entry_id?: string | null;
    legacy_source_route?: string | null;
    legacy_source_id?: string | null;
    metadata_json?: Record<string, unknown>;
    expense_scope?: "job" | "overhead";
    paid_by?: "org" | "member";
    claimant_member_id?: string | null;
    settlement_type?: "paid" | "unpaid";
    payment_account?: "cash" | "bank" | null;
    reimbursement_status?: "unsubmitted" | "submitted" | "approved" | "reimbursed" | null;
    recurring_template_id?: string | null;
    created_by: string;
};

export type AccountingCommandActorRef = {
    type: "human" | "ai" | "system" | "integration";
    id: string;
    name?: string | null;
};

export type AccountingCommandProposalLineageInput = {
    orgId: string;
    endpointName: string;
    proposalType:
        | "expense.create"
        | "income.create"
        | "invoice.create"
        | "invoice.mark_paid"
        | "payment.record"
        | "payment.allocate"
        | "expense.void"
        | "income.reverse"
        | "transaction.reverse";
    idempotencyKey: string;
    actor: AccountingCommandActorRef;
    description: string;
    payload: Record<string, unknown>;
    projection: Record<string, unknown>;
    transitionStatus?: "recorded" | "posted_legacy_projection" | "posted_canonical_projection" | "reversed";
    documentId?: string | null;
    siteId?: string | null;
};

export type SaleTransactionInsertPayload = {
    org_id: string;
    kind: "sale";
    cost_center: "SITE";
    site_id: string;
    client_id: unknown;
    description: string;
    recorded_date: string;
    amount_subtotal: number;
    tax_amount: number;
    amount_total: number;
    tax_category: string;
    status: string;
    source_document_id: unknown;
    input_sources: Record<string, unknown>;
    created_by: string;
};

export type SaleItemCommandPayload = {
    item_name: string;
    unit_name: string;
    unit_price: number;
    quantity: number;
};

export type RecordPaymentAllocationInput = {
    orgId: string;
    membershipId?: string | null;
    paymentId: string;
    invoiceId: string;
    allocatedOn: string;
    amount: number;
    createdBy: string;
};

export type RecordPaymentEventInput = {
    orgId: string;
    membershipId?: string | null;
    customerId?: string | null;
    receivedOn: string;
    amount: number;
    paymentMethod: string | null;
    paymentAccount: string | null;
    externalReference: string | null;
    createdBy: string;
};

export type CreateVoidReversalInput = {
    orgId: string;
    transactionId: string;
    reason: string;
    createdBy: string;
};

type InvoiceRevenueBasisAnchor = {
    id: string;
    site_id: string;
    recognition_date?: string | null;
    recognized_on?: string | null;
    amount_ex_tax?: number | null;
    tax_amount?: number | null;
    amount_inc_tax?: number | null;
    receivable_account_type?: string | null;
};

type InvoiceRevenueAllocationInsertRow = {
    org_id: string;
    invoice_id: string;
    invoice_line_key: string;
    revenue_basis_id: string;
    allocation_amount_ex_tax: number;
    tax_amount: number;
    amount_inc_tax: number;
    allocation_kind: "invoice_issue";
    created_by: string;
    metadata_json: Record<string, unknown>;
};

export type CreateAccountingInvoiceInput = {
    orgId: string;
    membershipId?: string | null;
    transactions: InvoiceTransaction[];
    representativeTransaction: InvoiceTransaction;
    sourceTransactionIds: string[];
    documentType: string;
    issueDate: string;
    dueDate: unknown;
    sourceTransactionDate: string;
    billingName: string;
    billingAddress: string | null;
    issuerRegistrationNo: string | null;
    notes: string | null;
    issuerSnapshot: Record<string, unknown>;
    registrationNumberSnapshot: string | null;
    registeredAtSnapshot: string | null;
    taxSummary: Record<string, unknown>;
    sourceSummary: Record<string, unknown>;
    eligibilitySnapshot: Record<string, unknown>;
    createdBy: string;
};

type AccountingTransactionForJournal = {
    id: string;
    kind?: string | null;
    recorded_date?: string | null;
    description?: string | null;
    amount_subtotal?: number | null;
    tax_amount?: number | null;
    amount_total?: number | null;
    tax_category?: string | null;
    category?: unknown;
};

type JournalLineInsert = {
    org_id: string;
    entry_id: string;
    line_no: number;
    account_code: string;
    account_name: string;
    debit: number;
    credit: number;
    tax_rate?: number;
    tax_type?: "taxable" | "exempt" | "taxfree";
};

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

function isVoidableStatus(status: unknown): status is typeof VOIDABLE_TRANSACTION_STATUSES[number] {
    return VOIDABLE_TRANSACTION_STATUSES.includes(status as typeof VOIDABLE_TRANSACTION_STATUSES[number]);
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

function isMissingFunctionError(error: unknown, functionName: string): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    const code = "code" in error && typeof error.code === "string" ? error.code : "";

    return (
        code === "PGRST202"
        || message.includes(`function ${functionName}`)
        || message.includes(`function public.${functionName}`)
        || message.includes("Could not find the function")
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

function isPostgrestNoRowsError(error: unknown): boolean {
    return Boolean(
        error
        && typeof error === "object"
        && "code" in error
        && error.code === "PGRST116"
    );
}

export async function insertExpenseTransaction(payload: ExpenseInsertPayload) {
    let insertPayload: Record<string, unknown> = { ...payload };

    for (let attempt = 0; attempt < 4; attempt += 1) {
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

        const v22CompatColumns = [
            "projection_source",
            "proposal_id",
            "proposal_execution_id",
            "posting_group_id",
            "journal_entry_id",
            "legacy_source_route",
            "legacy_source_id",
            "metadata_json",
            "expense_scope",
            "paid_by",
            "claimant_member_id",
            "settlement_type",
            "payment_account",
            "reimbursement_status",
            "recurring_template_id",
        ];
        const missingV22Column = v22CompatColumns.find((column) => isMissingColumnError(error, column));
        if (missingV22Column) {
            insertPayload = Object.fromEntries(
                Object.entries(insertPayload).filter(([key]) => !v22CompatColumns.includes(key))
            );
            continue;
        }

        throw error;
    }

    throw new Error("Failed to insert expense transaction after schema compatibility retries");
}

export async function createAccountingCommandProposalLineage(
    input: AccountingCommandProposalLineageInput,
) {
    const transitionStatus = input.transitionStatus || "posted_legacy_projection";
    const transitionPayload = {
        ...input.payload,
        lineage_mode: "transition",
        lifecycle_engine: "money_transition",
        full_proposal_lifecycle: false,
        transition_status: transitionStatus,
        source_route: input.endpointName,
        source_idempotency_key: input.idempotencyKey,
        projection: input.projection,
        transition: {
            mode: "legacy_direct_projection",
            endpoint_name: input.endpointName,
            status: transitionStatus,
            full_proposal_lifecycle: false,
        },
    };

    const { data, error } = await supabaseAdmin
        .from("proposals")
        .insert({
            org_id: input.orgId,
            type: input.proposalType,
            status: "executed",
            created_by: input.actor,
            payload: transitionPayload,
            description: input.description,
            policy_ref: "legacy_direct_transition",
            required_approvals: 0,
            approvals: [],
            executed_at: new Date().toISOString(),
            executed_by: input.actor,
            document_id: input.documentId || null,
            site_id: input.siteId || null,
            idempotency_key: `${input.endpointName}:${input.idempotencyKey}`,
        })
        .select()
        .single();

    if (error) {
        throw error;
    }

    return {
        ...(data as Record<string, unknown>),
        db_status: (data as Record<string, unknown>)?.status,
        status: transitionStatus,
        lineage_mode: "transition",
        lifecycle_engine: "money_transition",
        full_proposal_lifecycle: false,
        source_route: input.endpointName,
        source_idempotency_key: input.idempotencyKey,
    };
}

export async function insertSaleTransactionWithItems(
    payload: SaleTransactionInsertPayload,
    items: SaleItemCommandPayload[],
) {
    const { data, error } = await supabaseAdmin
        .from("accounting_transactions")
        .insert(payload)
        .select()
        .single();

    if (error) {
        throw error;
    }

    if (items.length > 0) {
        const { error: itemError } = await supabaseAdmin
            .from("accounting_transaction_items")
            .insert(
                items.map((item) => ({
                    org_id: payload.org_id,
                    transaction_id: data.id,
                    item_name: item.item_name,
                    unit_name: item.unit_name,
                    unit_price: item.unit_price,
                    quantity: item.quantity,
                }))
            );

        if (itemError) {
            throw itemError;
        }
    }

    return data;
}

export async function insertInvoiceSourceLinks(input: {
    orgId: string;
    invoiceId: string;
    transactions: InvoiceTransaction[];
    isPrimaryDocument: boolean;
}) {
    if (input.transactions.length === 0) {
        return;
    }

    const rows = input.transactions.map((transaction, index) => ({
        org_id: input.orgId,
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

async function getInvoiceRevenueBasisBySite(
    transactions: InvoiceTransaction[],
    orgId: string,
): Promise<Map<string, InvoiceRevenueBasisAnchor>> {
    const siteIds = Array.from(new Set(
        transactions
            .map((transaction) => transaction.site_id)
            .filter((value): value is string => typeof value === "string" && value.length > 0)
    ));

    if (siteIds.length === 0) {
        return new Map();
    }

    const fetchRows = async (selectColumns: string) => supabaseAdmin
        .from("revenue_basis")
        .select(selectColumns)
        .eq("org_id", orgId)
        .eq("status", "active")
        .in("site_id", siteIds)
        .order("recognition_date", { ascending: false });

    let result = await fetchRows("id, site_id, recognition_date, recognized_on, amount_ex_tax, tax_amount, amount_inc_tax, receivable_account_type");

    if (result.error && (
        isMissingColumnError(result.error, "recognized_on")
        || isMissingColumnError(result.error, "amount_ex_tax")
        || isMissingColumnError(result.error, "amount_inc_tax")
        || isMissingColumnError(result.error, "receivable_account_type")
    )) {
        result = await fetchRows("id, site_id, recognition_date");
    }

    if (result.error) {
        if (isMissingRelationError(result.error, "revenue_basis")) {
            return new Map();
        }
        throw result.error;
    }

    const bySite = new Map<string, InvoiceRevenueBasisAnchor>();
    const rows = Array.isArray(result.data)
        ? result.data as unknown as InvoiceRevenueBasisAnchor[]
        : [];
    for (const row of rows) {
        if (!bySite.has(row.site_id)) {
            bySite.set(row.site_id, row);
        }
    }

    return bySite;
}

async function getInvoiceAllocationTotalsByRevenueBasis(
    orgId: string,
    revenueBasisIds: string[],
): Promise<Map<string, number> | null> {
    if (revenueBasisIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabaseAdmin
        .from("accounting_invoice_line_revenue_allocations")
        .select("revenue_basis_id, amount_inc_tax")
        .eq("org_id", orgId)
        .in("revenue_basis_id", revenueBasisIds);

    if (error) {
        if (isMissingRelationError(error, "accounting_invoice_line_revenue_allocations")) {
            return null;
        }
        throw error;
    }

    const totals = new Map<string, number>();
    const rows = Array.isArray(data)
        ? data as unknown as Array<{ revenue_basis_id: string; amount_inc_tax: number | string | null }>
        : [];
    for (const row of rows) {
        const amount = Number(row.amount_inc_tax || 0);
        if (!Number.isFinite(amount)) {
            continue;
        }
        totals.set(row.revenue_basis_id, roundMoney((totals.get(row.revenue_basis_id) || 0) + amount));
    }

    return totals;
}

async function assertInvoiceRevenueAllocationCapacity(input: {
    orgId: string;
    revenueBasisById: Map<string, InvoiceRevenueBasisAnchor>;
    allocations: Array<{ revenue_basis_id: string; amount_inc_tax: number }>;
}) {
    const existingTotals = await getInvoiceAllocationTotalsByRevenueBasis(
        input.orgId,
        Array.from(input.revenueBasisById.keys())
    );

    if (!existingTotals) {
        return;
    }

    const requestedTotals = new Map<string, number>();
    for (const row of input.allocations) {
        requestedTotals.set(
            row.revenue_basis_id,
            roundMoney((requestedTotals.get(row.revenue_basis_id) || 0) + row.amount_inc_tax)
        );
    }

    const tolerance = 1;
    for (const [revenueBasisId, requestedAmount] of requestedTotals.entries()) {
        const revenueBasis = input.revenueBasisById.get(revenueBasisId);
        const cap = Number(revenueBasis?.amount_inc_tax);
        if (!Number.isFinite(cap) || cap <= 0) {
            continue;
        }

        const alreadyAllocated = existingTotals.get(revenueBasisId) || 0;
        if (roundMoney(alreadyAllocated + requestedAmount) > cap + tolerance) {
            throw new AccountingCommandError(409, "INVOICE_ALLOCATION_EXCEEDS_UNINVOICED_BALANCE");
        }
    }
}

async function assertInvoiceRevenueAllocationCapacityForTransactions(input: {
    orgId: string;
    transactions: InvoiceTransaction[];
}) {
    const revenueBasisBySite = await getInvoiceRevenueBasisBySite(input.transactions, input.orgId);
    if (revenueBasisBySite.size === 0) {
        return;
    }

    const allocations = input.transactions.flatMap((transaction) => {
        const siteId = typeof transaction.site_id === "string" ? transaction.site_id : null;
        const revenueBasis = siteId ? revenueBasisBySite.get(siteId) : null;
        if (!siteId || !revenueBasis) {
            return [];
        }

        return [{
            revenue_basis_id: revenueBasis.id,
            amount_inc_tax: Math.abs(Number(transaction.amount_total || 0)),
        }];
    });

    if (allocations.length === 0) {
        return;
    }

    const revenueBasisById = new Map(
        Array.from(revenueBasisBySite.values()).map((revenueBasis) => [revenueBasis.id, revenueBasis])
    );
    await assertInvoiceRevenueAllocationCapacity({
        orgId: input.orgId,
        revenueBasisById,
        allocations,
    });
}

async function insertInvoiceRevenueAllocations(input: {
    orgId: string;
    invoiceId: string;
    transactions: InvoiceTransaction[];
    createdBy: string;
}) {
    const revenueBasisBySite = await getInvoiceRevenueBasisBySite(input.transactions, input.orgId);
    if (revenueBasisBySite.size === 0) {
        return;
    }

    const rows: InvoiceRevenueAllocationInsertRow[] = input.transactions.flatMap((transaction) => {
        const siteId = typeof transaction.site_id === "string" ? transaction.site_id : null;
        const revenueBasis = siteId ? revenueBasisBySite.get(siteId) : null;
        if (!siteId || !revenueBasis) {
            return [];
        }

        const total = Math.abs(Number(transaction.amount_total || 0));
        const taxAmount = Math.abs(Number(transaction.tax_amount || 0));
        const rawSubtotal = Math.abs(Number(transaction.amount_subtotal || 0));
        const subtotal = normalizeNetSubtotal(rawSubtotal, taxAmount, total);

        return [{
            org_id: input.orgId,
            invoice_id: input.invoiceId,
            invoice_line_key: `source_transaction:${transaction.id}`,
            revenue_basis_id: revenueBasis.id,
            allocation_amount_ex_tax: subtotal,
            tax_amount: taxAmount,
            amount_inc_tax: total,
            allocation_kind: "invoice_issue",
            created_by: input.createdBy,
            metadata_json: {
                source_transaction_id: transaction.id,
                source_transaction_kind: transaction.kind,
                source_site_id: siteId,
                recognition_date: revenueBasis.recognized_on || revenueBasis.recognition_date || null,
                receivable_account_type: revenueBasis.receivable_account_type || "accounts_receivable",
                posting_mode: "no_pl_journal",
            },
        }];
    });

    if (rows.length === 0) {
        return;
    }

    const { error } = await supabaseAdmin
        .from("accounting_invoice_line_revenue_allocations")
        .insert(rows);

    if (error) {
        if (isMissingRelationError(error, "accounting_invoice_line_revenue_allocations")) {
            return;
        }
        throw error;
    }
}

export async function insertInvoiceRecord(row: Record<string, unknown>) {
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

async function createInvoiceRecordAtomically(input: {
    orgId: string;
    membershipId?: string | null;
    sourceTransactionIds: string[];
    representativeTransactionId: string;
    documentType: string;
    issueDate: string;
    dueDate: unknown;
    sourceTransactionDate: string;
    billingName: string;
    billingAddress: string | null;
    issuerRegistrationNo: string | null;
    notes: string | null;
    issuerSnapshot: Record<string, unknown>;
    registrationNumberSnapshot: string | null;
    registeredAtSnapshot: string | null;
    taxSummary: Record<string, unknown>;
    sourceSummary: Record<string, unknown>;
    eligibilitySnapshot: Record<string, unknown>;
    createdBy: string;
}): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabaseAdmin.rpc("rpc_create_accounting_invoice", {
        p_org_id: input.orgId,
        p_source_transaction_ids: input.sourceTransactionIds,
        p_representative_transaction_id: input.representativeTransactionId,
        p_document_type: input.documentType,
        p_issue_date: input.issueDate,
        p_due_date: input.dueDate || null,
        p_source_transaction_date: input.sourceTransactionDate,
        p_billing_name: input.billingName,
        p_billing_address: input.billingAddress,
        p_issuer_registration_no: input.issuerRegistrationNo,
        p_notes: input.notes,
        p_issuer_snapshot: input.issuerSnapshot,
        p_registration_number_snapshot: input.registrationNumberSnapshot,
        p_registered_at_snapshot: input.registeredAtSnapshot,
        p_tax_summary_snapshot: input.taxSummary,
        p_source_summary_snapshot: input.sourceSummary,
        p_eligibility_snapshot: input.eligibilitySnapshot,
        p_created_by: input.createdBy,
        p_membership_id: input.membershipId || null,
    });

    if (error) {
        if (isMissingFunctionError(error, "rpc_create_accounting_invoice")) {
            return null;
        }
        throw error;
    }

    const invoice = data && typeof data === "object" && "invoice" in data
        ? (data as { invoice?: unknown }).invoice
        : null;

    return invoice && typeof invoice === "object"
        ? invoice as Record<string, unknown>
        : null;
}

export async function createAccountingInvoice(input: CreateAccountingInvoiceInput): Promise<Record<string, unknown>> {
    await assertInvoiceRevenueAllocationCapacityForTransactions({
        orgId: input.orgId,
        transactions: input.transactions,
    });

    let data = await createInvoiceRecordAtomically({
        orgId: input.orgId,
        membershipId: input.membershipId,
        sourceTransactionIds: input.sourceTransactionIds,
        representativeTransactionId: input.representativeTransaction.id,
        documentType: input.documentType,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        sourceTransactionDate: input.sourceTransactionDate,
        billingName: input.billingName,
        billingAddress: input.billingAddress,
        issuerRegistrationNo: input.issuerRegistrationNo,
        notes: input.notes,
        issuerSnapshot: input.issuerSnapshot,
        registrationNumberSnapshot: input.registrationNumberSnapshot,
        registeredAtSnapshot: input.registeredAtSnapshot,
        taxSummary: input.taxSummary,
        sourceSummary: input.sourceSummary,
        eligibilitySnapshot: input.eligibilitySnapshot,
        createdBy: input.createdBy,
    });

    if (data) {
        return data;
    }

    const { data: invoiceNo, error: seqError } = await supabaseAdmin.rpc("rpc_next_invoice_no", {
        p_issue_date: input.issueDate,
    });

    if (seqError) throw seqError;

    const result = await insertInvoiceRecord({
        org_id: input.orgId,
        transaction_id: input.representativeTransaction.id,
        source_transaction_id: input.representativeTransaction.id,
        invoice_no: invoiceNo,
        document_type: input.documentType,
        issue_date: input.issueDate,
        due_date: input.dueDate,
        source_transaction_date: input.sourceTransactionDate,
        billing_name: input.billingName,
        billing_address: input.billingAddress,
        issuer_registration_no: input.issuerRegistrationNo,
        notes: input.notes,
        issuer_snapshot: input.issuerSnapshot,
        registration_number_snapshot: input.registrationNumberSnapshot,
        registered_at_snapshot: input.registeredAtSnapshot,
        tax_summary_snapshot: input.taxSummary,
        source_summary_snapshot: input.sourceSummary,
        eligibility_snapshot: input.eligibilitySnapshot,
        pdf_render_status: "pending",
        created_by: input.createdBy,
    });

    if (result.error) throw result.error;
    data = result.data as Record<string, unknown>;

    await insertInvoiceSourceLinks({
        orgId: input.orgId,
        invoiceId: String(data.id),
        transactions: input.transactions,
        isPrimaryDocument: true,
    });

    await insertInvoiceRevenueAllocations({
        orgId: input.orgId,
        invoiceId: String(data.id),
        transactions: input.transactions,
        createdBy: input.createdBy,
    });

    const { error: txUpdateError } = await supabaseAdmin
        .from("accounting_transactions")
        .update({ kind: "invoice" })
        .eq("org_id", input.orgId)
        .in("id", input.sourceTransactionIds);

    if (txUpdateError) {
        throw txUpdateError;
    }

    return data;
}

export async function recordPaymentAllocation(input: RecordPaymentAllocationInput) {
    const { data, error } = await supabaseAdmin.rpc("rpc_allocate_accounting_payment", {
        p_org_id: input.orgId,
        p_actor_user_id: input.createdBy,
        p_membership_id: input.membershipId || null,
        p_payment_id: input.paymentId,
        p_invoice_id: input.invoiceId,
        p_allocated_on: input.allocatedOn,
        p_amount: input.amount,
        p_metadata_json: {
            request_source: "accounting.payments.allocate",
        },
    });

    if (error) {
        throw error;
    }

    return data || {};
}

export async function recordPaymentEvent(input: RecordPaymentEventInput) {
    const { data, error } = await supabaseAdmin.rpc("rpc_record_accounting_payment_event", {
        p_org_id: input.orgId,
        p_actor_user_id: input.createdBy,
        p_membership_id: input.membershipId || null,
        p_received_on: input.receivedOn,
        p_amount: input.amount,
        p_customer_id: input.customerId || null,
        p_payment_method: input.paymentMethod,
        p_payment_account: input.paymentAccount,
        p_external_reference: input.externalReference,
        p_metadata_json: {
            request_source: "accounting.payments.create",
        },
    });

    if (error) {
        throw error;
    }

    return data || {};
}

async function hasInvoiceLinkForTransaction(transactionId: string, orgId: string): Promise<boolean> {
    const { data: sourceLinks, error: sourceLinksError } = await supabaseAdmin
        .from("accounting_invoice_sources")
        .select("invoice_id, source_transaction_id, source_transaction_date, sort_order, is_primary_document")
        .eq("source_transaction_id", transactionId)
        .eq("org_id", orgId)
        .order("sort_order", { ascending: true });

    if (sourceLinksError && !isMissingRelationError(sourceLinksError, "accounting_invoice_sources")) {
        throw sourceLinksError;
    }

    const invoiceIds = Array.from(new Set(
        Array.isArray(sourceLinks) ? sourceLinks.map((link) => link.invoice_id) : []
    ));

    const query = invoiceIds.length > 0
        ? supabaseAdmin
            .from("accounting_invoices")
            .select("id, invoice_no, document_type, supplements_invoice_id")
            .eq("org_id", orgId)
            .in("id", invoiceIds)
        : supabaseAdmin
            .from("accounting_invoices")
            .select("id, invoice_no, document_type, supplements_invoice_id")
            .eq("org_id", orgId)
            .in("source_transaction_id", [transactionId]);

    const { data: invoices, error: invoicesError } = await query;

    if (invoicesError) {
        throw invoicesError;
    }

    return Boolean(invoices && invoices.length > 0);
}

export async function createVoidReversal(input: CreateVoidReversalInput) {
    const { data: original, error: fetchError } = await supabaseAdmin
        .from("accounting_transactions")
        .select("*")
        .eq("id", input.transactionId)
        .eq("org_id", input.orgId)
        .maybeSingle();

    if (fetchError) {
        throw fetchError;
    }

    if (!original) {
        throw new AccountingCommandError(404, "Transaction not found");
    }

    if (original.voids_transaction_id) {
        throw new AccountingCommandError(409, "取消で作成された逆仕訳は再度取消できません");
    }

    if (original.status === "voided") {
        throw new AccountingCommandError(409, "この取引はすでに取消済みです");
    }

    if (!isVoidableStatus(original.status)) {
        throw new AccountingCommandError(409, "記帳済みまたは承認済みの取引のみ取消できます");
    }

    if (original.kind === "invoice") {
        throw new AccountingCommandError(409, "請求済み売上はこの画面から取消できません");
    }

    if (await hasInvoiceLinkForTransaction(input.transactionId, input.orgId)) {
        throw new AccountingCommandError(409, "請求書に紐づく取引は取消できません");
    }

    const { data: existingReversal, error: existingReversalError } = await supabaseAdmin
        .from("accounting_transactions")
        .select("id")
        .eq("voids_transaction_id", input.transactionId)
        .eq("org_id", input.orgId)
        .maybeSingle();

    if (existingReversalError && !isPostgrestNoRowsError(existingReversalError)) {
        throw existingReversalError;
    }

    if (existingReversal) {
        throw new AccountingCommandError(409, "この取引はすでに取消済みです");
    }

    const { data: reversal, error: reversalError } = await supabaseAdmin
        .from("accounting_transactions")
        .insert({
            org_id: original.org_id || input.orgId,
            kind: original.kind,
            cost_center: original.cost_center,
            site_id: original.site_id,
            client_id: original.client_id,
            vendor_name: original.vendor_name,
            description: `【取消】${original.description || ""} - ${input.reason}`,
            recorded_date: new Date().toISOString().split("T")[0],
            amount_subtotal: -original.amount_subtotal,
            tax_amount: -original.tax_amount,
            amount_total: -original.amount_total,
            category: original.category,
            status: original.status,
            voids_transaction_id: input.transactionId,
            tax_category: original.tax_category,
            voided_by: input.createdBy,
            voided_at: new Date().toISOString(),
            void_reason: input.reason,
            created_by: input.createdBy,
        })
        .select()
        .single();

    if (reversalError) {
        if (isDuplicateKeyError(reversalError)) {
            throw new AccountingCommandError(409, "この取引はすでに取消済みです");
        }
        throw reversalError;
    }

    await createJournalEntry(reversal, input.createdBy, input.orgId);

    return {
        original_voided: input.transactionId,
        original_reversed: input.transactionId,
        reversal_created: reversal.id,
    };
}

export async function createJournalEntry(
    transaction: AccountingTransactionForJournal,
    userId: string,
    orgId: string,
) {
    const { data: existingEntry, error: existingEntryError } = await supabaseAdmin
        .from("accounting_journal_entries")
        .select("id")
        .eq("transaction_id", transaction.id)
        .eq("org_id", orgId)
        .maybeSingle();

    if (existingEntryError) throw existingEntryError;
    if (existingEntry) {
        return existingEntry;
    }

    const { data: entry, error: entryError } = await supabaseAdmin
        .from("accounting_journal_entries")
        .insert({
            org_id: orgId,
            transaction_id: transaction.id,
            entry_date: transaction.recorded_date,
            memo: transaction.description,
            posted_at: new Date().toISOString(),
            created_by: userId,
        })
        .select()
        .single();

    if (entryError) throw entryError;

    const lines: JournalLineInsert[] = [];
    let lineNo = 1;

    const subtotal = Math.abs(transaction.amount_subtotal || 0);
    const taxAmount = Math.abs(transaction.tax_amount || 0);
    const total = Math.abs(transaction.amount_total || 0);
    const isReversalAmount = Number(transaction.amount_total || 0) < 0;

    const taxRate = resolveTaxRate(transaction.tax_category);
    const taxType = resolveExpenseTaxType(transaction.tax_category);

    if (transaction.kind === "sale" || transaction.kind === "invoice") {
        const salesAmount = normalizeNetSubtotal(subtotal, taxAmount, total);

        if (isReversalAmount) {
            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "4100",
                account_name: "売上高",
                debit: salesAmount,
                credit: 0,
                tax_rate: taxRate,
                tax_type: taxType,
            });

            if (taxAmount > 0) {
                lines.push({
                    org_id: orgId,
                    entry_id: entry.id,
                    line_no: lineNo++,
                    account_code: "2500",
                    account_name: "仮受消費税",
                    debit: taxAmount,
                    credit: 0,
                });
            }

            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "1200",
                account_name: "売掛金",
                debit: 0,
                credit: total,
            });
        } else {
            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "1200",
                account_name: "売掛金",
                debit: total,
                credit: 0,
            });

            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "4100",
                account_name: "売上高",
                debit: 0,
                credit: salesAmount,
                tax_rate: taxRate,
                tax_type: taxType,
            });

            if (taxAmount > 0) {
                lines.push({
                    org_id: orgId,
                    entry_id: entry.id,
                    line_no: lineNo++,
                    account_code: "2500",
                    account_name: "仮受消費税",
                    debit: 0,
                    credit: taxAmount,
                });
            }
        }
    } else if (transaction.kind === "expense") {
        const expenseAccount = resolveExpenseAccount(transaction.category);
        const expenseAmount = normalizeNetSubtotal(subtotal, taxAmount, total);

        if (isReversalAmount) {
            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "1100",
                account_name: "現金",
                debit: total,
                credit: 0,
            });

            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: expenseAccount.code,
                account_name: expenseAccount.name,
                debit: 0,
                credit: expenseAmount,
                tax_rate: taxRate,
                tax_type: taxType,
            });

            if (taxAmount > 0) {
                lines.push({
                    org_id: orgId,
                    entry_id: entry.id,
                    line_no: lineNo++,
                    account_code: "1500",
                    account_name: "仮払消費税",
                    debit: 0,
                    credit: taxAmount,
                });
            }
        } else {
            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: expenseAccount.code,
                account_name: expenseAccount.name,
                debit: expenseAmount,
                credit: 0,
                tax_rate: taxRate,
                tax_type: taxType,
            });

            if (taxAmount > 0) {
                lines.push({
                    org_id: orgId,
                    entry_id: entry.id,
                    line_no: lineNo++,
                    account_code: "1500",
                    account_name: "仮払消費税",
                    debit: taxAmount,
                    credit: 0,
                });
            }

            lines.push({
                org_id: orgId,
                entry_id: entry.id,
                line_no: lineNo++,
                account_code: "1100",
                account_name: "現金",
                debit: 0,
                credit: total,
            });
        }
    }

    if (lines.length > 0) {
        const { error: linesError } = await supabaseAdmin
            .from("accounting_journal_lines")
            .insert(lines);

        if (linesError) throw linesError;
    }

    return entry;
}
