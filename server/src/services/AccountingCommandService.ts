import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveTaxRate } from "./InvoiceEligibilityService";

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
    created_by: string;
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
    invoiceId: string;
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

export async function recordPaymentAllocation(input: RecordPaymentAllocationInput) {
    const { data, error } = await supabaseAdmin.rpc("rpc_record_accounting_payment_allocation", {
        p_org_id: input.orgId,
        p_invoice_id: input.invoiceId,
        p_received_on: input.receivedOn,
        p_amount: input.amount,
        p_payment_method: input.paymentMethod,
        p_payment_account: input.paymentAccount,
        p_external_reference: input.externalReference,
        p_created_by: input.createdBy,
        p_metadata_json: {
            request_source: "accounting.payments.allocate",
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
