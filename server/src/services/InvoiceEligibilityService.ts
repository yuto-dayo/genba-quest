export const INVOICE_ISSUER_STATUSES = ["unregistered", "applied", "registered"] as const;
export const INVOICE_DOCUMENT_TYPES = ["standard_invoice", "qualified_invoice", "invoice_supplement"] as const;
export const REQUESTED_INVOICE_DOCUMENT_TYPES = ["auto", "standard_invoice", "qualified_invoice"] as const;

export type InvoiceIssuerStatus = typeof INVOICE_ISSUER_STATUSES[number];
export type InvoiceDocumentType = typeof INVOICE_DOCUMENT_TYPES[number];
export type RequestedInvoiceDocumentType = typeof REQUESTED_INVOICE_DOCUMENT_TYPES[number];

export const INVOICE_REASON_MESSAGES = {
    ISSUER_NOT_REGISTERED: "登録事業者ではないため適格請求書を発行できません",
    REGISTRATION_NUMBER_MISSING: "登録番号が未設定のため適格請求書を発行できません",
    REGISTERED_AT_MISSING: "登録日が未設定のため適格請求書を発行できません",
    TRANSACTION_BEFORE_REGISTRATION_DATE: "取引日が登録日より前のため適格請求書を発行できません",
    TAX_BREAKDOWN_MISSING: "税率別内訳が不足しているため適格請求書を発行できません",
    INVOICE_ALREADY_EXISTS: "対象取引の請求書は既に発行されています",
    QUALIFIED_INVOICE_ALREADY_EXISTS: "対象取引の適格請求書は既に発行されています",
    SUPPLEMENT_ALREADY_EXISTS: "対象取引の追完通知は既に発行されています",
} as const;

export type InvoiceReasonCode = keyof typeof INVOICE_REASON_MESSAGES;

export interface OrgInvoiceSettings {
    org_id: string;
    issuer_name: string;
    issuer_address: string | null;
    issuer_contact: string | null;
    bank_account_text: string | null;
    invoice_issuer_status: InvoiceIssuerStatus;
    qualified_invoice_registration_number: string | null;
    qualified_invoice_registered_at: string | null;
    invoice_notes_default: string | null;
    created_by?: string;
    updated_by?: string;
    created_at?: string;
    updated_at?: string;
}

export interface InvoiceTransaction {
    id: string;
    kind: string;
    recorded_date: string;
    amount_subtotal: number | null;
    tax_amount: number | null;
    amount_total: number | null;
    tax_category?: string | null;
    currency?: string | null;
    client_id?: string | null;
    site_id?: string | null;
    description?: string | null;
    site?: { id?: string | null; name?: string | null } | null;
    client?: { id?: string | null; name?: string | null } | null;
}

export interface InvoiceRecord {
    id: string;
    invoice_no?: string | null;
    document_type?: string | null;
    supplements_invoice_id?: string | null;
}

export interface InvoiceTaxSummaryLine {
    tax_rate: number;
    net_amount: number;
    tax_amount: number;
    gross_amount: number;
}

export interface InvoiceTaxSummarySnapshot {
    by_rate: InvoiceTaxSummaryLine[];
    currency: string;
}

export interface InvoiceSourceSummarySnapshot {
    source_count: number;
    site_count: number;
    client_id: string | null;
    client_name: string | null;
    period_start: string | null;
    period_end: string | null;
    site_names: string[];
    amount_subtotal: number;
    tax_amount: number;
    amount_total: number;
    currency: string;
}

export interface InvoiceEligibility {
    transaction_id: string;
    transaction_ids?: string[];
    source_transaction_date: string;
    source_period_start?: string;
    source_period_end?: string;
    source_count?: number;
    issuer_status: InvoiceIssuerStatus;
    resolved_document_type: Exclude<InvoiceDocumentType, "invoice_supplement">;
    eligible_for_qualified_invoice: boolean;
    reason_codes: InvoiceReasonCode[];
    reason_messages: string[];
}

function toFixedCurrencyAmount(value: number): number {
    return Number(value.toFixed(2));
}

export function isInvoiceIssuerStatus(value: unknown): value is InvoiceIssuerStatus {
    return typeof value === "string" && INVOICE_ISSUER_STATUSES.includes(value as InvoiceIssuerStatus);
}

export function isRequestedInvoiceDocumentType(value: unknown): value is RequestedInvoiceDocumentType {
    return typeof value === "string"
        && REQUESTED_INVOICE_DOCUMENT_TYPES.includes(value as RequestedInvoiceDocumentType);
}

export function isValidQualifiedInvoiceRegistrationNumber(value: string | null | undefined): boolean {
    return typeof value === "string" && /^T\d{13}$/.test(value);
}

export function buildDefaultInvoiceSettings(orgId: string): OrgInvoiceSettings {
    return {
        org_id: orgId,
        issuer_name: "",
        issuer_address: null,
        issuer_contact: null,
        bank_account_text: null,
        invoice_issuer_status: "unregistered",
        qualified_invoice_registration_number: null,
        qualified_invoice_registered_at: null,
        invoice_notes_default: null,
    };
}

export function resolveTaxRate(taxCategory?: string | null): number {
    if (taxCategory === "08_REDUCED") {
        return 0.08;
    }
    if (taxCategory === "00_EXEMPT" || taxCategory === "00_TAXFREE") {
        return 0;
    }
    return 0.1;
}

export function buildTaxSummarySnapshot(transaction: InvoiceTransaction): InvoiceTaxSummarySnapshot {
    return buildTaxSummarySnapshotForTransactions([transaction]);
}

export function buildTaxSummarySnapshotForTransactions(transactions: InvoiceTransaction[]): InvoiceTaxSummarySnapshot {
    const summaryByRate = new Map<number, InvoiceTaxSummaryLine>();
    const currencies = transactions
        .map((transaction) => transaction.currency || "JPY")
        .filter((currency) => typeof currency === "string" && currency.length > 0);
    const currency = currencies[0] || "JPY";

    for (const transaction of transactions) {
        const subtotal = Math.abs(transaction.amount_subtotal || 0);
        const taxAmount = Math.abs(transaction.tax_amount || 0);
        const total = Math.abs(transaction.amount_total || 0);
        const taxRate = resolveTaxRate(transaction.tax_category);

        if (subtotal <= 0 && taxAmount <= 0 && total <= 0) {
            continue;
        }

        const netAmount = subtotal > 0
            ? subtotal
            : (taxAmount > 0 ? total - taxAmount : total);
        const grossAmount = total > 0 ? total : netAmount + taxAmount;
        const existing = summaryByRate.get(taxRate);

        if (existing) {
            existing.net_amount = toFixedCurrencyAmount(existing.net_amount + netAmount);
            existing.tax_amount = toFixedCurrencyAmount(existing.tax_amount + taxAmount);
            existing.gross_amount = toFixedCurrencyAmount(existing.gross_amount + grossAmount);
            continue;
        }

        summaryByRate.set(taxRate, {
            tax_rate: taxRate,
            net_amount: toFixedCurrencyAmount(netAmount),
            tax_amount: toFixedCurrencyAmount(taxAmount),
            gross_amount: toFixedCurrencyAmount(grossAmount),
        });
    }

    return {
        by_rate: Array.from(summaryByRate.values()).sort((a, b) => b.tax_rate - a.tax_rate),
        currency,
    };
}

export function buildInvoiceSourceSummarySnapshot(transactions: InvoiceTransaction[]): InvoiceSourceSummarySnapshot {
    const sortedTransactions = [...transactions].sort((left, right) => {
        if (left.recorded_date !== right.recorded_date) {
            return left.recorded_date.localeCompare(right.recorded_date);
        }
        return left.id.localeCompare(right.id);
    });
    const siteNameSet = new Set<string>();
    const siteIdSet = new Set<string>();
    let amountSubtotal = 0;
    let taxAmount = 0;
    let amountTotal = 0;

    for (const transaction of sortedTransactions) {
        amountSubtotal += Math.abs(transaction.amount_subtotal || 0);
        taxAmount += Math.abs(transaction.tax_amount || 0);
        amountTotal += Math.abs(transaction.amount_total || 0);

        const resolvedSiteName = transaction.site?.name || null;
        if (resolvedSiteName) {
            siteNameSet.add(resolvedSiteName);
        }

        if (transaction.site_id) {
            siteIdSet.add(transaction.site_id);
        }
    }

    const primaryTransaction = sortedTransactions[0] || null;
    const clientName = primaryTransaction?.client?.name || null;
    const clientId = primaryTransaction?.client_id || primaryTransaction?.client?.id || null;

    return {
        source_count: sortedTransactions.length,
        site_count: siteIdSet.size > 0 ? siteIdSet.size : siteNameSet.size,
        client_id: clientId,
        client_name: clientName,
        period_start: sortedTransactions[0]?.recorded_date || null,
        period_end: sortedTransactions[sortedTransactions.length - 1]?.recorded_date || null,
        site_names: Array.from(siteNameSet.values()),
        amount_subtotal: toFixedCurrencyAmount(amountSubtotal),
        tax_amount: toFixedCurrencyAmount(taxAmount),
        amount_total: toFixedCurrencyAmount(amountTotal),
        currency: primaryTransaction?.currency || "JPY",
    };
}

function evaluateInvoiceEligibilityForTransactions(input: {
    settings: OrgInvoiceSettings;
    transactions: InvoiceTransaction[];
    taxSummary: InvoiceTaxSummarySnapshot;
    existingInvoices?: InvoiceRecord[];
}): InvoiceEligibility {
    const { settings, transactions, taxSummary, existingInvoices = [] } = input;
    const uniqueReasonCodes = new Set<InvoiceReasonCode>();
    const sortedTransactions = [...transactions].sort((left, right) => {
        if (left.recorded_date !== right.recorded_date) {
            return left.recorded_date.localeCompare(right.recorded_date);
        }
        return left.id.localeCompare(right.id);
    });
    const primaryTransaction = sortedTransactions[0];

    if (!primaryTransaction) {
        return {
            transaction_id: "",
            transaction_ids: [],
            source_transaction_date: "",
            source_period_start: "",
            source_period_end: "",
            source_count: 0,
            issuer_status: settings.invoice_issuer_status,
            resolved_document_type: "standard_invoice",
            eligible_for_qualified_invoice: false,
            reason_codes: ["TAX_BREAKDOWN_MISSING"],
            reason_messages: [INVOICE_REASON_MESSAGES.TAX_BREAKDOWN_MISSING],
        };
    }

    const primaryInvoice = existingInvoices.find((invoice) => {
        const documentType = invoice.document_type || "standard_invoice";
        return documentType === "standard_invoice" || documentType === "qualified_invoice";
    });
    const qualifiedInvoice = existingInvoices.find((invoice) => invoice.document_type === "qualified_invoice");
    const supplementInvoice = existingInvoices.find((invoice) => invoice.document_type === "invoice_supplement");

    if (settings.invoice_issuer_status !== "registered") {
        uniqueReasonCodes.add("ISSUER_NOT_REGISTERED");
    } else {
        if (!isValidQualifiedInvoiceRegistrationNumber(settings.qualified_invoice_registration_number)) {
            uniqueReasonCodes.add("REGISTRATION_NUMBER_MISSING");
        }

        if (!settings.qualified_invoice_registered_at) {
            uniqueReasonCodes.add("REGISTERED_AT_MISSING");
        } else if (sortedTransactions.some((transaction) => transaction.recorded_date < settings.qualified_invoice_registered_at!)) {
            uniqueReasonCodes.add("TRANSACTION_BEFORE_REGISTRATION_DATE");
        }
    }

    if (taxSummary.by_rate.length === 0) {
        uniqueReasonCodes.add("TAX_BREAKDOWN_MISSING");
    }

    if (primaryInvoice) {
        uniqueReasonCodes.add("INVOICE_ALREADY_EXISTS");
    }

    if (qualifiedInvoice) {
        uniqueReasonCodes.add("QUALIFIED_INVOICE_ALREADY_EXISTS");
    }

    if (supplementInvoice) {
        uniqueReasonCodes.add("SUPPLEMENT_ALREADY_EXISTS");
    }

    const reasonCodes = Array.from(uniqueReasonCodes.values());
    const eligibleForQualifiedInvoice = reasonCodes.length === 0;

    return {
        transaction_id: primaryTransaction.id,
        transaction_ids: sortedTransactions.map((transaction) => transaction.id),
        source_transaction_date: primaryTransaction.recorded_date,
        source_period_start: primaryTransaction.recorded_date,
        source_period_end: sortedTransactions[sortedTransactions.length - 1]?.recorded_date || primaryTransaction.recorded_date,
        source_count: sortedTransactions.length,
        issuer_status: settings.invoice_issuer_status,
        resolved_document_type: eligibleForQualifiedInvoice ? "qualified_invoice" : "standard_invoice",
        eligible_for_qualified_invoice: eligibleForQualifiedInvoice,
        reason_codes: reasonCodes,
        reason_messages: reasonCodes.map((code) => INVOICE_REASON_MESSAGES[code]),
    };
}

export function evaluateInvoiceEligibilityForMany(input: {
    settings: OrgInvoiceSettings;
    transactions: InvoiceTransaction[];
    taxSummary: InvoiceTaxSummarySnapshot;
    existingInvoices?: InvoiceRecord[];
}): InvoiceEligibility {
    return evaluateInvoiceEligibilityForTransactions(input);
}

export function evaluateInvoiceEligibility(input: {
    settings: OrgInvoiceSettings;
    transaction: InvoiceTransaction;
    taxSummary: InvoiceTaxSummarySnapshot;
    existingInvoices?: InvoiceRecord[];
}): InvoiceEligibility {
    return evaluateInvoiceEligibilityForTransactions({
        settings: input.settings,
        transactions: [input.transaction],
        taxSummary: input.taxSummary,
        existingInvoices: input.existingInvoices,
    });
}

export function buildIssuerSnapshot(settings: OrgInvoiceSettings) {
    return {
        issuer_name: settings.issuer_name,
        issuer_address: settings.issuer_address,
        issuer_contact: settings.issuer_contact,
        bank_account_text: settings.bank_account_text,
        invoice_notes_default: settings.invoice_notes_default,
    };
}

export function resolveRequestedDocumentType(
    requestedDocumentType: RequestedInvoiceDocumentType,
    eligibility: InvoiceEligibility
): Exclude<InvoiceDocumentType, "invoice_supplement"> {
    if (requestedDocumentType === "auto") {
        return eligibility.resolved_document_type;
    }

    return requestedDocumentType;
}
