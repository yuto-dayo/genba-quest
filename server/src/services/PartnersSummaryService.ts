/**
 * Money 取引先タブ用の月次サマリを集計する (PR #6).
 *
 * 3 section:
 *  - receive (もらう): 当月 sale 系取引 + 未入金 invoice を client_id GROUP BY
 *  - pay     (払う):  当月 expense 取引を vendor_name GROUP BY
 *  - done    (完了):  当月 入金 (accounting_payments.received_on) を customer_id GROUP BY
 *
 * 鉄則:
 *  - 過去の billing_period は不変
 *  - DB I/O は本ファイルに閉じる (route 側はパラメータ整形のみ)
 */

import { supabaseAdmin } from "../lib/supabaseClient";
import {
    getActiveBillingRuleWithPreview,
    type ActiveRulePreview,
} from "./BillingRulesService";

// ============================================================
// Types
// ============================================================

export type ReceiveStatus = "unbilled" | "billed" | "awaiting_payment";

export interface ReceivePartnerSummary {
    client_id: string;
    client_name: string;
    amount: number;
    rule: ActiveRulePreview["rule"];
    next_period: ActiveRulePreview["next_period"];
    status: ReceiveStatus;
    /** unbilled: 直近の締め日 (period_end). billed/awaiting_payment: 入金予定日. */
    target_date: string | null;
    /** awaiting_payment のみ: 入金予定日からの経過日数 (>= 1). */
    days_overdue: number | null;
    /** billed/awaiting_payment のみ: 該当 invoice の発行日. */
    billed_at: string | null;
}

export interface PayPartnerSummary {
    vendor_name: string;
    amount: number;
    transaction_count: number;
    /** MIN(due_date) があれば優先, 無ければ MIN(recorded_date). */
    due_date: string | null;
}

export interface DonePartnerSummary {
    client_id: string | null;
    client_name: string;
    amount: number;
    paid_at: string;
}

export interface PartnersSummaryResult {
    month: string;
    receive: { total: number; partners: ReceivePartnerSummary[] };
    pay: { total: number; partners: PayPartnerSummary[] };
    done: { total: number; partners: DonePartnerSummary[] };
}

// ============================================================
// Utility
// ============================================================

const ACTIVE_TX_STATUSES = ["posted", "approved"] as const;

function monthRange(month: string): { start: string; end: string } {
    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) {
        throw new Error("ERR_INVALID_MONTH");
    }
    const year = Number(m[1]);
    const mon = Number(m[2]);
    const last = new Date(year, mon, 0).getDate();
    return {
        start: `${m[1]}-${m[2]}-01`,
        end: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}`,
    };
}

function diffDays(fromIso: string, toIso: string): number {
    const a = new Date(fromIso).getTime();
    const b = new Date(toIso).getTime();
    return Math.floor((b - a) / (1000 * 60 * 60 * 24));
}

// ============================================================
// メイン
// ============================================================

export async function getPartnersSummary(
    orgId: string,
    month: string,
    today: string,
): Promise<PartnersSummaryResult> {
    const { start, end } = monthRange(month);

    const [receive, pay, done] = await Promise.all([
        buildReceiveSection(orgId, start, end, today),
        buildPaySection(orgId, start, end),
        buildDoneSection(orgId, start, end),
    ]);

    return {
        month,
        receive,
        pay,
        done,
    };
}

// ============================================================
// もらう (receive)
// ============================================================

async function buildReceiveSection(
    orgId: string,
    start: string,
    end: string,
    today: string,
): Promise<PartnersSummaryResult["receive"]> {
    // 当月の sale 取引 (client_id ありのみ)
    const { data: salesRows, error: salesErr } = await supabaseAdmin
        .from("accounting_transactions")
        .select("client_id, amount_total, recorded_date, client:clients(id, name)")
        .eq("org_id", orgId)
        .eq("kind", "sale")
        .in("status", [...ACTIVE_TX_STATUSES])
        .gte("recorded_date", start)
        .lte("recorded_date", end)
        .not("client_id", "is", null);

    if (salesErr) {
        throw new Error(`Failed to load sales: ${salesErr.message}`);
    }

    type Bucket = { clientId: string; clientName: string; amount: number };
    const buckets = new Map<string, Bucket>();
    for (const row of (salesRows ?? []) as Array<{
        client_id: string;
        amount_total: number | string;
        client: { id: string; name: string } | { id: string; name: string }[] | null;
    }>) {
        const clientId = row.client_id;
        if (!clientId) continue;
        const clientRel = Array.isArray(row.client) ? row.client[0] : row.client;
        const name = clientRel?.name ?? "(不明な取引先)";
        const amt = Number(row.amount_total) || 0;
        const existing = buckets.get(clientId);
        if (existing) {
            existing.amount += amt;
        } else {
            buckets.set(clientId, { clientId, clientName: name, amount: amt });
        }
    }

    if (buckets.size === 0) {
        return { total: 0, partners: [] };
    }

    const clientIds = Array.from(buckets.keys());

    // 各 client の直近未入金 invoice を一括取得 (status 未確定なので payment_allocations と突合)
    const { data: invoiceRows, error: invErr } = await supabaseAdmin
        .from("accounting_invoices")
        .select(
            `id, issue_date, due_date, source_transaction_id,
             source:accounting_transactions!accounting_invoices_source_transaction_id_fkey(id, client_id, amount_total)`,
        )
        .eq("org_id", orgId);

    if (invErr) {
        throw new Error(`Failed to load invoices: ${invErr.message}`);
    }

    const invoicesByClient = new Map<string, Array<{
        id: string;
        issue_date: string;
        due_date: string | null;
        amount: number;
    }>>();
    for (const inv of (invoiceRows ?? []) as Array<{
        id: string;
        issue_date: string;
        due_date: string | null;
        source: { client_id: string | null; amount_total: number | string } | { client_id: string | null; amount_total: number | string }[] | null;
    }>) {
        const src = Array.isArray(inv.source) ? inv.source[0] : inv.source;
        const cid = src?.client_id ?? null;
        if (!cid || !clientIds.includes(cid)) continue;
        const list = invoicesByClient.get(cid) ?? [];
        list.push({
            id: inv.id,
            issue_date: inv.issue_date,
            due_date: inv.due_date,
            amount: Number(src?.amount_total ?? 0),
        });
        invoicesByClient.set(cid, list);
    }

    const allInvoiceIds = Array.from(invoicesByClient.values()).flat().map((i) => i.id);
    const allocatedByInvoice = new Map<string, number>();
    if (allInvoiceIds.length > 0) {
        const { data: allocRows, error: allocErr } = await supabaseAdmin
            .from("payment_allocations")
            .select("invoice_id, allocated_amount")
            .eq("org_id", orgId)
            .in("invoice_id", allInvoiceIds);
        if (allocErr) {
            throw new Error(`Failed to load allocations: ${allocErr.message}`);
        }
        for (const a of (allocRows ?? []) as Array<{ invoice_id: string; allocated_amount: number | string }>) {
            allocatedByInvoice.set(
                a.invoice_id,
                (allocatedByInvoice.get(a.invoice_id) ?? 0) + (Number(a.allocated_amount) || 0),
            );
        }
    }

    // billing rule preview を並列取得
    const previews = await Promise.all(
        clientIds.map(async (cid) => {
            try {
                const preview = await getActiveBillingRuleWithPreview(orgId, cid, today);
                return [cid, preview] as const;
            } catch {
                return [cid, { rule: null, next_period: null } as ActiveRulePreview] as const;
            }
        }),
    );
    const previewByClient = new Map(previews);

    const partners: ReceivePartnerSummary[] = [];
    for (const bucket of buckets.values()) {
        const invs = invoicesByClient.get(bucket.clientId) ?? [];
        // 未完済 invoice = 配賦合計 < 元金額
        const outstanding = invs
            .filter((inv) => (allocatedByInvoice.get(inv.id) ?? 0) < inv.amount)
            .sort((a, b) => a.issue_date.localeCompare(b.issue_date));
        const latestUnpaid = outstanding[outstanding.length - 1] ?? null;
        const preview = previewByClient.get(bucket.clientId) ?? { rule: null, next_period: null };

        let status: ReceiveStatus;
        let targetDate: string | null = null;
        let daysOverdue: number | null = null;
        let billedAt: string | null = null;

        if (latestUnpaid) {
            billedAt = latestUnpaid.issue_date;
            const due = latestUnpaid.due_date ?? preview.next_period?.payment_due_date ?? null;
            targetDate = due;
            if (due && diffDays(due, today) > 0) {
                status = "awaiting_payment";
                daysOverdue = diffDays(due, today);
            } else {
                status = "billed";
            }
        } else {
            status = "unbilled";
            targetDate = preview.next_period?.period_end ?? null;
        }

        partners.push({
            client_id: bucket.clientId,
            client_name: bucket.clientName,
            amount: bucket.amount,
            rule: preview.rule,
            next_period: preview.next_period,
            status,
            target_date: targetDate,
            days_overdue: daysOverdue,
            billed_at: billedAt,
        });
    }

    // ソート: 緊急度 (overdue 日数 DESC) → 金額 DESC
    partners.sort((a, b) => {
        const aOver = a.days_overdue ?? -1;
        const bOver = b.days_overdue ?? -1;
        if (aOver !== bOver) return bOver - aOver;
        return b.amount - a.amount;
    });

    const total = partners.reduce((sum, p) => sum + p.amount, 0);
    return { total, partners };
}

// ============================================================
// 払う (pay)
// ============================================================

async function buildPaySection(
    orgId: string,
    start: string,
    end: string,
): Promise<PartnersSummaryResult["pay"]> {
    const { data, error } = await supabaseAdmin
        .from("accounting_transactions")
        .select("vendor_name, amount_total, recorded_date")
        .eq("org_id", orgId)
        .eq("kind", "expense")
        .in("status", [...ACTIVE_TX_STATUSES])
        .gte("recorded_date", start)
        .lte("recorded_date", end)
        .not("vendor_name", "is", null);

    if (error) {
        throw new Error(`Failed to load expenses: ${error.message}`);
    }

    type Bucket = {
        vendor_name: string;
        amount: number;
        transaction_count: number;
        earliest_recorded: string;
    };
    const buckets = new Map<string, Bucket>();
    for (const row of (data ?? []) as Array<{
        vendor_name: string | null;
        amount_total: number | string;
        recorded_date: string;
    }>) {
        const name = (row.vendor_name ?? "").trim();
        if (!name) continue;
        const amt = Number(row.amount_total) || 0;
        const existing = buckets.get(name);
        if (existing) {
            existing.amount += amt;
            existing.transaction_count += 1;
            if (row.recorded_date < existing.earliest_recorded) {
                existing.earliest_recorded = row.recorded_date;
            }
        } else {
            buckets.set(name, {
                vendor_name: name,
                amount: amt,
                transaction_count: 1,
                earliest_recorded: row.recorded_date,
            });
        }
    }

    const partners: PayPartnerSummary[] = Array.from(buckets.values())
        .map((b) => ({
            vendor_name: b.vendor_name,
            amount: b.amount,
            transaction_count: b.transaction_count,
            due_date: b.earliest_recorded, // vendor billing rule 整備までは仕入記録日を支払予定の代理値
        }))
        // 支払予定日 ASC (近い順)
        .sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""));

    const total = partners.reduce((sum, p) => sum + p.amount, 0);
    return { total, partners };
}

// ============================================================
// 完了 (done)
// ============================================================

async function buildDoneSection(
    orgId: string,
    start: string,
    end: string,
): Promise<PartnersSummaryResult["done"]> {
    // accounting_payments.customer_id には FK が無いので join できない。
    // 2 段階で取得 → clients テーブルから名前を後付けで埋める。
    const { data, error } = await supabaseAdmin
        .from("accounting_payments")
        .select("customer_id, amount, received_on")
        .eq("org_id", orgId)
        .gte("received_on", start)
        .lte("received_on", end)
        .neq("status", "voided");

    if (error) {
        throw new Error(`Failed to load payments: ${error.message}`);
    }

    const rows = (data ?? []) as Array<{
        customer_id: string | null;
        amount: number | string;
        received_on: string;
    }>;

    const customerIds = Array.from(
        new Set(rows.map((r) => r.customer_id).filter((id): id is string => !!id)),
    );

    const nameByCustomer = new Map<string, string>();
    if (customerIds.length > 0) {
        const { data: clientRows, error: clientErr } = await supabaseAdmin
            .from("clients")
            .select("id, name")
            .eq("org_id", orgId)
            .in("id", customerIds);
        if (clientErr) {
            throw new Error(`Failed to load payment customers: ${clientErr.message}`);
        }
        for (const c of (clientRows ?? []) as Array<{ id: string; name: string }>) {
            nameByCustomer.set(c.id, c.name);
        }
    }

    const partners: DonePartnerSummary[] = rows.map((row) => ({
        client_id: row.customer_id,
        client_name: (row.customer_id && nameByCustomer.get(row.customer_id)) || "(不明な取引先)",
        amount: Number(row.amount) || 0,
        paid_at: row.received_on,
    }));

    // paid_at DESC
    partners.sort((a, b) => b.paid_at.localeCompare(a.paid_at));
    const total = partners.reduce((sum, p) => sum + p.amount, 0);
    return { total, partners };
}
