import { supabaseAdmin } from "../lib/supabaseClient";

export type CreditTier = "healthy" | "caution" | "warning" | "blocked";

export interface ClientCreditSummary {
    org_id: string;
    client_id: string;
    client_name: string;
    as_of_date: string;
    accounts_receivable_balance: number;
    overdue_count: number;
    sales_90_days: number;
    dso_days: number | null;
    credit_tier: CreditTier;
    credit_tier_sort?: number;
}

export interface CreditMonthlyTrendPoint {
    month: string;
    dso_days: number | null;
    accounts_receivable_balance: number;
}

export interface CreditOverdueInvoice {
    invoice_id: string;
    invoice_no: string;
    issue_date: string;
    due_date: string | null;
    amount: number;
    outstanding_amount: number;
    overdue_days: number;
}

export interface CreditRecentInvoice {
    invoice_id: string;
    invoice_no: string;
    issue_date: string;
    due_date: string | null;
    amount: number;
    outstanding_amount: number;
}

export interface CreditRecentCashReceipt {
    receipt_id: string;
    received_date: string;
    received_amount: number;
    allocated_amount: number;
    status: string;
    bank_txn_ref: string | null;
}

export interface ClientCreditMetrics extends ClientCreditSummary {
    monthly_trends: CreditMonthlyTrendPoint[];
    overdue_history: CreditOverdueInvoice[];
    recent_invoices: CreditRecentInvoice[];
    recent_cash_receipts: CreditRecentCashReceipt[];
}

interface SupabaseLike {
    from(table: string): any;
}

interface ClientRow {
    id: string;
    org_id: string;
    name: string;
}

interface SaleRow {
    id: string;
    recorded_date: string;
    amount_total: number | string;
}

interface InvoiceRow {
    id: string;
    invoice_no: string;
    issue_date: string;
    due_date: string | null;
    transaction_id: string;
    source_transaction_id: string;
    billing_name?: string | null;
    created_at: string;
    source_transaction?: {
        id: string;
        client_id: string | null;
        amount_total: number | string;
        description?: string | null;
        recorded_date: string;
    } | null | Array<{
        id: string;
        client_id: string | null;
        amount_total: number | string;
        description?: string | null;
        recorded_date: string;
    }>;
}

interface InvoiceSourceRow {
    id: string;
    client_id: string | null;
    amount_total: number | string;
    description?: string | null;
    recorded_date: string;
}

interface CashReceiptRow {
    id: string;
    received_date: string;
    received_amount: number | string;
    allocated_amount: number | string;
    status: string;
    bank_txn_ref: string | null;
}

interface AllocationRow {
    invoice_transaction_id: string;
    allocated_amount: number | string;
    receipt_id: string;
}

const ACTIVE_SALE_STATUSES = ["posted", "approved"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;

function todayIso(): string {
    return new Date().toISOString().slice(0, 10);
}

function isIsoDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(iso: string, days: number): string {
    const date = new Date(`${iso}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

function monthEnd(isoMonth: string): string {
    const [year, month] = isoMonth.split("-").map(Number);
    const date = new Date(Date.UTC(year, month, 0));
    return date.toISOString().slice(0, 10);
}

function recentMonths(asOf: string, count: number): string[] {
    const [year, month] = asOf.slice(0, 7).split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, 1));
    return Array.from({ length: count }, (_, index) => {
        const dt = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - (count - 1 - index), 1));
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
    });
}

function diffDays(fromIso: string, toIso: string): number {
    const from = new Date(`${fromIso}T00:00:00.000Z`).getTime();
    const to = new Date(`${toIso}T00:00:00.000Z`).getTime();
    return Math.floor((to - from) / DAY_MS);
}

function asNumber(value: number | string | null | undefined): number {
    return Number(value ?? 0) || 0;
}

function normalizeSource(invoice: InvoiceRow): InvoiceSourceRow | null {
    const source = invoice.source_transaction;
    return ((Array.isArray(source) ? source[0] : source) as InvoiceSourceRow | null) ?? null;
}

function invoiceTransactionIds(invoice: InvoiceRow): string[] {
    return Array.from(new Set([invoice.source_transaction_id, invoice.transaction_id].filter(Boolean)));
}

function creditTier(dsoDays: number | null, balance: number): CreditTier {
    const dso = dsoDays ?? 0;
    if (dso > 90 || balance > 5_000_000) return "blocked";
    if (dso > 60 || balance >= 3_000_000) return "warning";
    if (dso >= 45 || balance >= 1_000_000) return "caution";
    return "healthy";
}

function creditTierSort(tier: CreditTier): number {
    return ({ blocked: 0, warning: 1, caution: 2, healthy: 3 })[tier];
}

function calculateDso(balance: number, sales90Days: number): number | null {
    if (sales90Days <= 0) return null;
    return Math.round((balance / sales90Days) * 90 * 10) / 10;
}

export class ClientCreditMonitoringService {
    constructor(private readonly client: SupabaseLike = supabaseAdmin as unknown as SupabaseLike) {}

    async listAllClientsCreditSummary(orgId: string): Promise<ClientCreditSummary[]> {
        const { data, error } = await this.client
            .from("v_client_credit_summary")
            .select("*")
            .eq("org_id", orgId)
            .order("credit_tier_sort", { ascending: true })
            .order("accounts_receivable_balance", { ascending: false });

        if (error) {
            throw new Error(`Failed to load client credit summary: ${error.message}`);
        }

        return ((data ?? []) as any[]).map(mapSummaryRow);
    }

    async getClientCreditMetrics(orgId: string, clientId: string, asOf = todayIso()): Promise<ClientCreditMetrics> {
        if (!isIsoDate(asOf)) {
            throw new Error("ERR_INVALID_AS_OF");
        }

        const [client, salesRows, invoiceRows, receiptRows] = await Promise.all([
            this.loadClient(orgId, clientId),
            this.loadSales(orgId, clientId, addDays(asOf, -270), asOf),
            this.loadInvoices(orgId, clientId, asOf),
            this.loadCashReceipts(orgId, clientId, asOf),
        ]);

        if (!client) {
            throw new Error("ERR_CLIENT_NOT_FOUND");
        }

        const transactionIds = Array.from(new Set(invoiceRows.flatMap(invoiceTransactionIds)));
        const allocations = transactionIds.length > 0 && receiptRows.length > 0
            ? await this.loadAllocations(transactionIds, receiptRows.map((row) => row.id))
            : [];

        const summary = buildSummaryFromRows({
            orgId,
            clientId,
            clientName: client.name,
            asOf,
            salesRows,
            invoiceRows,
            receiptRows,
            allocationRows: allocations,
        });

        const invoiceSummaries = invoiceRows
            .map((invoice) => toInvoiceSummary(invoice, allocations, receiptRows, asOf))
            .filter((invoice): invoice is CreditRecentInvoice & { overdue_days: number } => invoice !== null)
            .sort((a, b) => (b.issue_date || "").localeCompare(a.issue_date || ""));

        const overdueHistory = invoiceSummaries
            .filter((invoice) => invoice.outstanding_amount > 0 && invoice.due_date && invoice.due_date < asOf)
            .map((invoice) => ({
                invoice_id: invoice.invoice_id,
                invoice_no: invoice.invoice_no,
                issue_date: invoice.issue_date,
                due_date: invoice.due_date,
                amount: invoice.amount,
                outstanding_amount: invoice.outstanding_amount,
                overdue_days: invoice.overdue_days,
            }))
            .sort((a, b) => b.overdue_days - a.overdue_days);

        return {
            ...summary,
            monthly_trends: recentMonths(asOf, 6).map((month) => {
                const pointAsOf = monthEnd(month);
                const point = buildSummaryFromRows({
                    orgId,
                    clientId,
                    clientName: client.name,
                    asOf: pointAsOf > asOf ? asOf : pointAsOf,
                    salesRows,
                    invoiceRows,
                    receiptRows,
                    allocationRows: allocations,
                });
                return {
                    month,
                    dso_days: point.dso_days,
                    accounts_receivable_balance: point.accounts_receivable_balance,
                };
            }),
            overdue_history: overdueHistory,
            recent_invoices: invoiceSummaries.slice(0, 8).map(({ overdue_days: _overdueDays, ...invoice }) => invoice),
            recent_cash_receipts: receiptRows.slice(0, 8).map((receipt) => ({
                receipt_id: receipt.id,
                received_date: receipt.received_date,
                received_amount: asNumber(receipt.received_amount),
                allocated_amount: asNumber(receipt.allocated_amount),
                status: receipt.status,
                bank_txn_ref: receipt.bank_txn_ref,
            })),
        };
    }

    private async loadClient(orgId: string, clientId: string): Promise<ClientRow | null> {
        const { data, error } = await this.client
            .from("clients")
            .select("id, org_id, name")
            .eq("org_id", orgId)
            .eq("id", clientId)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to load client: ${error.message}`);
        }
        return (data ?? null) as ClientRow | null;
    }

    private async loadSales(orgId: string, clientId: string, from: string, to: string): Promise<SaleRow[]> {
        const { data, error } = await this.client
            .from("accounting_transactions")
            .select("id, recorded_date, amount_total")
            .eq("org_id", orgId)
            .eq("client_id", clientId)
            .eq("kind", "sale")
            .in("status", [...ACTIVE_SALE_STATUSES])
            .gte("recorded_date", from)
            .lte("recorded_date", to);

        if (error) {
            throw new Error(`Failed to load client sales: ${error.message}`);
        }
        return (data ?? []) as SaleRow[];
    }

    private async loadInvoices(orgId: string, clientId: string, asOf: string): Promise<InvoiceRow[]> {
        const { data, error } = await this.client
            .from("accounting_invoices")
            .select(`
                id,
                invoice_no,
                issue_date,
                due_date,
                transaction_id,
                source_transaction_id,
                billing_name,
                created_at,
                source_transaction:accounting_transactions!accounting_invoices_source_transaction_id_fkey(
                    id,
                    client_id,
                    amount_total,
                    description,
                    recorded_date
                )
            `)
            .eq("org_id", orgId)
            .lte("issue_date", asOf)
            .order("issue_date", { ascending: false });

        if (error) {
            throw new Error(`Failed to load client invoices: ${error.message}`);
        }

        return ((data ?? []) as InvoiceRow[]).filter((invoice) => normalizeSource(invoice)?.client_id === clientId);
    }

    private async loadCashReceipts(orgId: string, clientId: string, asOf: string): Promise<CashReceiptRow[]> {
        const { data, error } = await this.client
            .from("cash_receipts")
            .select("id, received_date, received_amount, allocated_amount, status, bank_txn_ref")
            .eq("org_id", orgId)
            .eq("client_id", clientId)
            .lte("received_date", asOf)
            .order("received_date", { ascending: false });

        if (error) {
            throw new Error(`Failed to load cash receipts: ${error.message}`);
        }
        return (data ?? []) as CashReceiptRow[];
    }

    private async loadAllocations(transactionIds: string[], receiptIds: string[]): Promise<AllocationRow[]> {
        const { data, error } = await this.client
            .from("cash_receipt_allocations")
            .select("invoice_transaction_id, allocated_amount, receipt_id")
            .in("invoice_transaction_id", transactionIds)
            .in("receipt_id", receiptIds);

        if (error) {
            throw new Error(`Failed to load cash receipt allocations: ${error.message}`);
        }
        return (data ?? []) as AllocationRow[];
    }
}

function mapSummaryRow(row: any): ClientCreditSummary {
    const tier = row.credit_tier as CreditTier;
    return {
        org_id: row.org_id,
        client_id: row.client_id,
        client_name: row.client_name,
        as_of_date: row.as_of_date,
        accounts_receivable_balance: asNumber(row.accounts_receivable_balance),
        overdue_count: Number(row.overdue_count ?? 0),
        sales_90_days: asNumber(row.sales_90_days),
        dso_days: row.dso_days === null || row.dso_days === undefined ? null : Number(row.dso_days),
        credit_tier: tier,
        credit_tier_sort: Number(row.credit_tier_sort ?? creditTierSort(tier)),
    };
}

function buildSummaryFromRows(input: {
    orgId: string;
    clientId: string;
    clientName: string;
    asOf: string;
    salesRows: SaleRow[];
    invoiceRows: InvoiceRow[];
    receiptRows: CashReceiptRow[];
    allocationRows: AllocationRow[];
}): ClientCreditSummary {
    const salesStart = addDays(input.asOf, -90);
    const sales90Days = input.salesRows
        .filter((row) => row.recorded_date > salesStart && row.recorded_date <= input.asOf)
        .reduce((sum, row) => sum + asNumber(row.amount_total), 0);

    let balance = 0;
    let overdueCount = 0;

    for (const invoice of input.invoiceRows) {
        if (invoice.issue_date > input.asOf) continue;
        const invoiceSummary = toInvoiceSummary(invoice, input.allocationRows, input.receiptRows, input.asOf);
        if (!invoiceSummary) continue;
        balance += invoiceSummary.outstanding_amount;
        if (
            invoiceSummary.outstanding_amount > 0
            && invoiceSummary.due_date
            && invoiceSummary.due_date < input.asOf
        ) {
            overdueCount += 1;
        }
    }

    const roundedBalance = Math.round(balance);
    const dsoDays = calculateDso(roundedBalance, sales90Days);
    const tier = creditTier(dsoDays, roundedBalance);

    return {
        org_id: input.orgId,
        client_id: input.clientId,
        client_name: input.clientName,
        as_of_date: input.asOf,
        accounts_receivable_balance: roundedBalance,
        overdue_count: overdueCount,
        sales_90_days: Math.round(sales90Days),
        dso_days: dsoDays,
        credit_tier: tier,
        credit_tier_sort: creditTierSort(tier),
    };
}

function allocatedForInvoice(
    invoice: InvoiceRow,
    allocations: AllocationRow[],
    receiptRows: CashReceiptRow[],
    asOf: string,
): number {
    const ids = new Set(invoiceTransactionIds(invoice));
    const receiptDateById = new Map(receiptRows.map((receipt) => [receipt.id, receipt.received_date]));
    return allocations
        .filter((allocation) => {
            const receiptDate = receiptDateById.get(allocation.receipt_id);
            return ids.has(allocation.invoice_transaction_id) && Boolean(receiptDate && receiptDate <= asOf);
        })
        .reduce((sum, allocation) => sum + asNumber(allocation.allocated_amount), 0);
}

function toInvoiceSummary(
    invoice: InvoiceRow,
    allocations: AllocationRow[],
    receiptRows: CashReceiptRow[],
    asOf: string,
): (CreditRecentInvoice & { overdue_days: number }) | null {
    const source = normalizeSource(invoice);
    if (!source) return null;
    const amount = asNumber(source.amount_total);
    const outstanding = Math.max(amount - allocatedForInvoice(invoice, allocations, receiptRows, asOf), 0);
    return {
        invoice_id: invoice.id,
        invoice_no: invoice.invoice_no,
        issue_date: invoice.issue_date,
        due_date: invoice.due_date,
        amount,
        outstanding_amount: Math.round(outstanding),
        overdue_days: invoice.due_date ? Math.max(diffDays(invoice.due_date, asOf), 0) : 0,
    };
}

export const clientCreditMonitoringService = new ClientCreditMonitoringService();
