/**
 * MemberInvoiceService
 *
 * 本人主導の請求書 (member → org) を扱う。
 *
 * DAO 原則の体現:
 *  - 振込先 / インボイス番号 / 住所 は発行時に本人プロフィールから snapshot 転記する。
 *    その後のプロフィール変更は既存の請求書に影響しない (法的証跡)。
 *  - admin 視点の一覧 API は意図的に作らない。集計のみ。個別の請求書本体は本人だけが読める。
 *  - ドラフトはテーブルに永続化せず Read Model としてオンザフライで計算する
 *    (path_reward_runs / monthly_distribution_lines から、未発行ぶんを差分計算)。
 *    → ドラフトと締めとの同期ずれが原理的に発生しない。
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import type { Proposal } from "./PolicyEngine";

// ============================================================
// Types
// ============================================================

export type MemberInvoiceSource =
    | "path_reward"
    | "monthly_distribution"
    | "manual";

export type MemberInvoiceStatus = "issued" | "paid" | "void";

export interface MemberInvoiceLineItem {
    description: string;
    quantity: number;
    unit_amount: number;
    amount: number;
}

export interface MemberInvoiceBankSnapshot {
    bank_name: string | null;
    branch_name: string | null;
    account_type: string | null;
    account_number: string | null;
    account_holder_kana: string | null;
}

export interface MemberInvoiceAddressSnapshot {
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
}

export interface MemberInvoiceRecord {
    id: string;
    org_id: string;
    proposal_id: string;
    member_id: string;
    source: MemberInvoiceSource;
    source_ref_id: string | null;
    period_month: string;
    amount_total: number;
    line_items: MemberInvoiceLineItem[];
    snapshot_trade_name: string | null;
    snapshot_invoice_registration_no: string | null;
    snapshot_bank: MemberInvoiceBankSnapshot;
    snapshot_address: MemberInvoiceAddressSnapshot;
    status: MemberInvoiceStatus;
    invoice_no: string;
    issued_at: string;
    /** Phase 2-2b: 支払い完了時に Proposal id とタイムスタンプが入る */
    paid_at?: string | null;
    paid_proposal_id?: string | null;
    paid_method?: string | null;
    /** Phase 2-2b: 本人取り消し時に Proposal id と理由が入る */
    void_at?: string | null;
    void_proposal_id?: string | null;
    void_reason?: string | null;
    created_at: string;
    updated_at: string;
}

/**
 * Phase 2-2b: admin が支払い対象を選ぶための最小情報リスト。
 * member_id / snapshot_bank / snapshot_address 等 PII は意図的に含めない。
 */
export interface AdminActionableInvoice {
    invoice_id: string;
    invoice_no: string;
    period_month: string;
    amount_total: number;
    status: MemberInvoiceStatus;
    source: MemberInvoiceSource;
    issued_at: string;
}

export interface DraftCandidate {
    source: MemberInvoiceSource;
    source_ref_id: string;
    period_month: string;
    amount_total: number;
    line_items: MemberInvoiceLineItem[];
    /** 表示用ラベル (e.g. "2026-04 月次分配") */
    label: string;
}

export interface OutstandingSummaryRow {
    status: MemberInvoiceStatus;
    period_month: string;
    invoice_count: number;
    total_amount: number;
}

export type MemberInvoiceClient = Pick<SupabaseClient, "from"> & {
    rpc?: (
        fn: string,
        args?: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

const PROFILE_SNAPSHOT_COLUMNS = [
    "id",
    "trade_name",
    "invoice_registration_number",
    "bank_name",
    "branch_name",
    "account_type",
    "account_number",
    "account_holder_kana",
    "postal_code",
    "prefecture",
    "city",
    "address_line1",
    "address_line2",
].join(",");

// ============================================================
// Service
// ============================================================

export class MemberInvoiceService {
    constructor(
        private readonly client: MemberInvoiceClient = supabaseAdmin as unknown as MemberInvoiceClient,
    ) {}

    /**
     * 本人視点で「まだ請求書を出していない締め」を列挙する。
     * - path_reward_runs (status='approved'|'posted') と monthly_distribution_lines
     *   (close.status='approved'|'executed'|'posted'|'finalized') を横断する
     * - 同じ source × source_ref_id × period_month で既に member_invoices に行があれば除外
     */
    async listDraftCandidatesForMember(input: {
        orgId: string;
        memberId: string;
    }): Promise<DraftCandidate[]> {
        const [pathRewardCandidates, distributionCandidates, issued] =
            await Promise.all([
                this.collectPathRewardCandidates(input),
                this.collectMonthlyDistributionCandidates(input),
                this.listIssuedRefKeysForMember(input),
            ]);

        const candidates = [...pathRewardCandidates, ...distributionCandidates];
        return candidates.filter(
            (candidate) =>
                !issued.has(
                    refKey(
                        candidate.source,
                        candidate.source_ref_id,
                        candidate.period_month,
                    ),
                ),
        );
    }

    /**
     * 自分が発行した請求書の一覧 (新しい順)。
     */
    async listIssuedInvoicesForMember(input: {
        orgId: string;
        memberId: string;
    }): Promise<MemberInvoiceRecord[]> {
        const { data, error } = await this.client
            .from("member_invoices")
            .select("*")
            .eq("org_id", input.orgId)
            .eq("member_id", input.memberId)
            .order("issued_at", { ascending: false });

        if (error) {
            throw new Error(`Failed to list member invoices: ${error.message}`);
        }

        return (data || []) as MemberInvoiceRecord[];
    }

    /**
     * 発行時の本人プロフィール snapshot を作成する。
     * 必須項目欠落時は発行を止める (振込先がないまま請求書だけ出るのを防ぐ)。
     */
    async buildSnapshotForMember(memberId: string): Promise<{
        trade_name: string | null;
        invoice_registration_no: string | null;
        bank: MemberInvoiceBankSnapshot;
        address: MemberInvoiceAddressSnapshot;
    }> {
        const { data, error } = await this.client
            .from("profiles")
            .select(PROFILE_SNAPSHOT_COLUMNS)
            .eq("id", memberId)
            .maybeSingle();

        if (error) {
            throw new Error(
                `Failed to load profile snapshot: ${error.message}`,
            );
        }
        if (!data) {
            throw new Error("MEMBER_PROFILE_NOT_FOUND");
        }

        const row = data as unknown as Record<string, string | null>;
        const bank: MemberInvoiceBankSnapshot = {
            bank_name: row.bank_name,
            branch_name: row.branch_name,
            account_type: row.account_type,
            account_number: row.account_number,
            account_holder_kana: row.account_holder_kana,
        };

        if (
            !bank.bank_name ||
            !bank.branch_name ||
            !bank.account_number ||
            !bank.account_holder_kana
        ) {
            throw new Error("MEMBER_BANK_INFO_INCOMPLETE");
        }

        return {
            trade_name: row.trade_name,
            invoice_registration_no: row.invoice_registration_number,
            bank,
            address: {
                postal_code: row.postal_code,
                prefecture: row.prefecture,
                city: row.city,
                address_line1: row.address_line1,
                address_line2: row.address_line2,
            },
        };
    }

    /**
     * Proposal が executed になった瞬間に呼ばれる。
     * 同一 proposal_id に対しては 1 行のみ作る (冪等)。
     */
    async issueFromExecutedProposal(
        proposal: Proposal,
    ): Promise<{ invoice: MemberInvoiceRecord; alreadyExisted: boolean }> {
        if (proposal.type !== "invoice.member_issue") {
            throw new Error("MEMBER_INVOICE_INVALID_PROPOSAL_TYPE");
        }

        const payload = proposal.payload as Record<string, unknown>;
        const memberId = stringField(payload, "member_id");
        const periodMonth = stringField(payload, "period_month");
        const source = stringField(payload, "source") as MemberInvoiceSource | null;
        const sourceRefId = stringField(payload, "source_ref_id");
        const amountTotal = numericField(payload, "amount_total");
        const lineItemsRaw = payload.line_items;
        const snapshot = payload.snapshot_profile as
            | Record<string, unknown>
            | undefined;

        if (!memberId || !periodMonth || !source || amountTotal === null) {
            throw new Error("MEMBER_INVOICE_INVALID_PAYLOAD");
        }
        if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
            throw new Error("MEMBER_INVOICE_INVALID_PERIOD");
        }
        if (!["path_reward", "monthly_distribution", "manual"].includes(source)) {
            throw new Error("MEMBER_INVOICE_INVALID_SOURCE");
        }
        if (amountTotal <= 0) {
            throw new Error("MEMBER_INVOICE_AMOUNT_INVALID");
        }
        if (proposal.created_by.type !== "human" || proposal.created_by.id !== memberId) {
            throw new Error("MEMBER_INVOICE_CREATOR_MUST_BE_SELF");
        }

        const existing = await this.findByProposalId(proposal.id);
        if (existing) {
            return { invoice: existing, alreadyExisted: true };
        }

        const invoiceNo = this.buildInvoiceNo(memberId, periodMonth, proposal.id);

        const { data, error } = await this.client
            .from("member_invoices")
            .insert({
                org_id: proposal.org_id,
                proposal_id: proposal.id,
                member_id: memberId,
                source,
                source_ref_id: sourceRefId,
                period_month: periodMonth,
                amount_total: amountTotal,
                line_items: normalizeLineItems(lineItemsRaw),
                snapshot_trade_name: stringField(snapshot ?? {}, "trade_name"),
                snapshot_invoice_registration_no: stringField(
                    snapshot ?? {},
                    "invoice_registration_no",
                ),
                snapshot_bank: (snapshot?.bank as Record<string, unknown>) ?? {},
                snapshot_address:
                    (snapshot?.address as Record<string, unknown>) ?? {},
                status: "issued",
                invoice_no: invoiceNo,
            })
            .select("*")
            .single();

        if (error) {
            throw new Error(
                `Failed to insert member invoice: ${error.message}`,
            );
        }

        return { invoice: data as MemberInvoiceRecord, alreadyExisted: false };
    }

    /**
     * admin 用集計。PII を含まない (status / period_month ごとの件数と総額のみ)。
     * security_definer RPC 経由で組織への admin 権限を強制する。
     */
    async getOutstandingSummary(input: {
        orgId: string;
        userId?: string;
    }): Promise<OutstandingSummaryRow[]> {
        if (!this.client.rpc) {
            throw new Error("MEMBER_INVOICE_RPC_NOT_AVAILABLE");
        }
        const { data, error } = await this.client.rpc(
            "rpc_org_invoices_outstanding_summary",
            {
                p_org_id: input.orgId,
                p_user_id: input.userId ?? null,
            },
        );
        if (error) {
            const code = error.message || "MEMBER_INVOICE_SUMMARY_FAILED";
            if (code.includes("ADMIN_ROLE_REQUIRED")) {
                throw new Error("ADMIN_ROLE_REQUIRED");
            }
            if (code.includes("NOT_MEMBER_OF_ORG")) {
                throw new Error("NOT_MEMBER_OF_ORG");
            }
            throw new Error(`Failed to fetch outstanding summary: ${code}`);
        }

        const rows = Array.isArray(data) ? data : [];
        return rows.map((raw) => {
            const row = raw as Record<string, unknown>;
            return {
                status: (row.status as MemberInvoiceStatus) ?? "issued",
                period_month: String(row.period_month ?? ""),
                invoice_count: Number(row.invoice_count ?? 0),
                total_amount: Number(row.total_amount ?? 0),
            };
        });
    }

    // ============================================================
    // Internal helpers
    // ============================================================

    private async collectPathRewardCandidates(input: {
        orgId: string;
        memberId: string;
    }): Promise<DraftCandidate[]> {
        const { data, error } = await this.client
            .from("path_reward_runs")
            .select("id, month, status, reward_payload")
            .eq("org_id", input.orgId)
            .in("status", ["approved", "posted"]);

        if (error) {
            throw new Error(
                `Failed to load path_reward_runs: ${error.message}`,
            );
        }

        const result: DraftCandidate[] = [];
        for (const raw of data || []) {
            const row = raw as {
                id: string;
                month: string;
                reward_payload: unknown;
            };
            const memberAmount = extractMemberRewardAmount(
                row.reward_payload,
                input.memberId,
            );
            if (memberAmount > 0) {
                result.push({
                    source: "path_reward",
                    source_ref_id: row.id,
                    period_month: row.month,
                    amount_total: memberAmount,
                    line_items: [
                        {
                            description: `PATH 報酬 ${row.month}`,
                            quantity: 1,
                            unit_amount: memberAmount,
                            amount: memberAmount,
                        },
                    ],
                    label: `${row.month} PATH 報酬`,
                });
            }
        }
        return result;
    }

    private async collectMonthlyDistributionCandidates(input: {
        orgId: string;
        memberId: string;
    }): Promise<DraftCandidate[]> {
        const { data, error } = await this.client
            .from("monthly_distribution_lines")
            .select(
                "id, member_id, total_pay_amount, total_pay, monthly_distribution_close_id",
            )
            .eq("org_id", input.orgId)
            .eq("member_id", input.memberId);

        if (error) {
            throw new Error(
                `Failed to load monthly_distribution_lines: ${error.message}`,
            );
        }

        const lineRows = (data || []) as Array<{
            id: string;
            member_id: string;
            total_pay_amount: number | string | null;
            total_pay: number | string | null;
            monthly_distribution_close_id: string;
        }>;

        if (lineRows.length === 0) {
            return [];
        }

        const closeIds = Array.from(
            new Set(lineRows.map((line) => line.monthly_distribution_close_id)),
        );

        const { data: closeData, error: closeError } = await this.client
            .from("monthly_distribution_closes")
            .select("id, month, status")
            .eq("org_id", input.orgId)
            .in("id", closeIds);

        if (closeError) {
            throw new Error(
                `Failed to load monthly_distribution_closes: ${closeError.message}`,
            );
        }

        const closeById = new Map<string, { month: string; status: string }>();
        for (const raw of closeData || []) {
            const row = raw as { id: string; month: string; status: string };
            closeById.set(row.id, { month: row.month, status: row.status });
        }

        const finalizedStatuses = new Set([
            "approved",
            "executed",
            "posted",
            "finalized",
        ]);

        const result: DraftCandidate[] = [];
        for (const line of lineRows) {
            const close = closeById.get(line.monthly_distribution_close_id);
            if (!close || !finalizedStatuses.has(close.status)) continue;
            const amount = Number(line.total_pay_amount ?? line.total_pay ?? 0);
            if (amount <= 0) continue;

            result.push({
                source: "monthly_distribution",
                source_ref_id: line.id,
                period_month: close.month,
                amount_total: amount,
                line_items: [
                    {
                        description: `${close.month} 月次分配`,
                        quantity: 1,
                        unit_amount: amount,
                        amount,
                    },
                ],
                label: `${close.month} 月次分配`,
            });
        }
        return result;
    }

    private async listIssuedRefKeysForMember(input: {
        orgId: string;
        memberId: string;
    }): Promise<Set<string>> {
        const { data, error } = await this.client
            .from("member_invoices")
            .select("source, source_ref_id, period_month, status")
            .eq("org_id", input.orgId)
            .eq("member_id", input.memberId);

        if (error) {
            throw new Error(
                `Failed to list issued invoices for dedupe: ${error.message}`,
            );
        }

        const set = new Set<string>();
        for (const raw of data || []) {
            const row = raw as {
                source: string;
                source_ref_id: string | null;
                period_month: string;
                status: string;
            };
            if (row.status === "void") continue;
            if (!row.source_ref_id) continue;
            set.add(refKey(row.source, row.source_ref_id, row.period_month));
        }
        return set;
    }

    async findByProposalId(
        proposalId: string,
    ): Promise<MemberInvoiceRecord | null> {
        const { data, error } = await this.client
            .from("member_invoices")
            .select("*")
            .eq("proposal_id", proposalId)
            .maybeSingle();

        if (error) {
            throw new Error(
                `Failed to load invoice by proposal: ${error.message}`,
            );
        }
        return (data || null) as MemberInvoiceRecord | null;
    }

    private buildInvoiceNo(
        memberId: string,
        periodMonth: string,
        proposalId: string,
    ): string {
        // 「YYYYMM-MMMMM-PPPP」形式。組織内ユニークは proposal_id ベースで担保される。
        const ym = periodMonth.replace("-", "");
        const memberPart = memberId.slice(0, 8);
        const proposalPart = proposalId.slice(0, 8);
        return `MI-${ym}-${memberPart}-${proposalPart}`;
    }

    // ============================================================
    // Phase 2-2b: 取得 (id 経由) / admin 行アクション可能リスト
    // ============================================================

    async findById(invoiceId: string): Promise<MemberInvoiceRecord | null> {
        const { data, error } = await this.client
            .from("member_invoices")
            .select("*")
            .eq("id", invoiceId)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to load member invoice: ${error.message}`);
        }
        return (data || null) as MemberInvoiceRecord | null;
    }

    /**
     * admin が支払い対象を選ぶために最小情報のみ返す。
     * member_id / snapshot 情報は意図的に返さない (PII を覗かれないため)。
     * security_definer RPC 経由で admin 権限を強制する。
     */
    async listAdminActionableInvoices(input: {
        orgId: string;
        status?: MemberInvoiceStatus;
        limit?: number;
        userId?: string;
    }): Promise<AdminActionableInvoice[]> {
        if (!this.client.rpc) {
            throw new Error("MEMBER_INVOICE_RPC_NOT_AVAILABLE");
        }
        const { data, error } = await this.client.rpc(
            "rpc_org_invoices_admin_actionable_list",
            {
                p_org_id: input.orgId,
                p_status: input.status ?? "issued",
                p_limit: input.limit ?? 50,
                p_user_id: input.userId ?? null,
            },
        );
        if (error) {
            const code = error.message || "MEMBER_INVOICE_ACTIONABLE_LIST_FAILED";
            if (code.includes("ADMIN_ROLE_REQUIRED")) {
                throw new Error("ADMIN_ROLE_REQUIRED");
            }
            if (code.includes("NOT_MEMBER_OF_ORG")) {
                throw new Error("NOT_MEMBER_OF_ORG");
            }
            if (code.includes("INVALID_STATUS_FILTER")) {
                throw new Error("INVALID_STATUS_FILTER");
            }
            throw new Error(`Failed to list actionable invoices: ${code}`);
        }
        const rows = Array.isArray(data) ? data : [];
        return rows.map((raw) => {
            const row = raw as Record<string, unknown>;
            return {
                invoice_id: String(row.invoice_id ?? ""),
                invoice_no: String(row.invoice_no ?? ""),
                period_month: String(row.period_month ?? ""),
                amount_total: Number(row.amount_total ?? 0),
                status: (row.status as MemberInvoiceStatus) ?? "issued",
                source: (row.source as MemberInvoiceSource) ?? "manual",
                issued_at: String(row.issued_at ?? ""),
            };
        });
    }

    // ============================================================
    // Phase 2-2b: invoice.member_mark_paid (admin)
    // ============================================================

    /**
     * mark_paid Proposal が executed になった瞬間に呼ばれる。
     * `status='issued'` の行を `paid` に遷移させる。冪等。
     * 同じ proposal を二回処理してもエラーにならない。
     */
    async markPaidFromExecutedProposal(
        proposal: Proposal,
    ): Promise<{ invoice: MemberInvoiceRecord; alreadyApplied: boolean }> {
        if (proposal.type !== "invoice.member_mark_paid") {
            throw new Error("MEMBER_INVOICE_INVALID_PROPOSAL_TYPE");
        }

        const payload = proposal.payload as Record<string, unknown>;
        const invoiceId = stringField(payload, "invoice_id");
        const paidAt = stringField(payload, "paid_at") ?? new Date().toISOString();
        const paidMethod = stringField(payload, "paid_method");

        if (!invoiceId) {
            throw new Error("MEMBER_INVOICE_INVALID_PAYLOAD");
        }

        // 冪等チェック: 同じ proposal が既に paid_proposal_id として記録済みなら何もしない
        const existing = await this.findById(invoiceId);
        if (!existing) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }
        if (existing.paid_proposal_id === proposal.id) {
            return { invoice: existing, alreadyApplied: true };
        }

        // 既に別経路で paid になっている (= ガード違反) のは拒否する
        if (existing.status !== "issued") {
            throw new Error("MEMBER_INVOICE_NOT_IN_ISSUED_STATE");
        }

        const { data, error } = await this.client
            .from("member_invoices")
            .update({
                status: "paid",
                paid_at: paidAt,
                paid_proposal_id: proposal.id,
                paid_method: paidMethod,
            })
            .eq("id", invoiceId)
            .eq("status", "issued")
            .select("*")
            .single();

        if (error) {
            throw new Error(`Failed to mark invoice as paid: ${error.message}`);
        }

        return { invoice: data as MemberInvoiceRecord, alreadyApplied: false };
    }

    // ============================================================
    // Phase 2-2b: invoice.member_void (member self)
    // ============================================================

    async voidFromExecutedProposal(
        proposal: Proposal,
    ): Promise<{ invoice: MemberInvoiceRecord; alreadyApplied: boolean }> {
        if (proposal.type !== "invoice.member_void") {
            throw new Error("MEMBER_INVOICE_INVALID_PROPOSAL_TYPE");
        }

        const payload = proposal.payload as Record<string, unknown>;
        const invoiceId = stringField(payload, "invoice_id");
        const reason = stringField(payload, "reason");
        const voidAt = stringField(payload, "void_at") ?? new Date().toISOString();

        if (!invoiceId || !reason) {
            throw new Error("MEMBER_INVOICE_INVALID_PAYLOAD");
        }

        const existing = await this.findById(invoiceId);
        if (!existing) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }
        // 申請者本人 (member_id) 以外による void は構造的に許さない
        if (proposal.created_by.type !== "human" || proposal.created_by.id !== existing.member_id) {
            throw new Error("MEMBER_INVOICE_VOID_CREATOR_MUST_BE_OWNER");
        }
        if (existing.void_proposal_id === proposal.id) {
            return { invoice: existing, alreadyApplied: true };
        }
        // 既に支払い済み / void 済みは取り消し不可 (Phase 2-2c で再発行は別途検討)
        if (existing.status !== "issued") {
            throw new Error("MEMBER_INVOICE_NOT_IN_ISSUED_STATE");
        }

        const { data, error } = await this.client
            .from("member_invoices")
            .update({
                status: "void",
                void_at: voidAt,
                void_proposal_id: proposal.id,
                void_reason: reason,
            })
            .eq("id", invoiceId)
            .eq("status", "issued")
            .select("*")
            .single();

        if (error) {
            throw new Error(`Failed to void invoice: ${error.message}`);
        }

        return { invoice: data as MemberInvoiceRecord, alreadyApplied: false };
    }
}

// ============================================================
// Helpers
// ============================================================

function refKey(source: string, sourceRefId: string, period: string): string {
    return `${source}:${sourceRefId}:${period}`;
}

function stringField(
    obj: Record<string, unknown>,
    key: string,
): string | null {
    const value = obj?.[key];
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}

function numericField(
    obj: Record<string, unknown>,
    key: string,
): number | null {
    const value = obj?.[key];
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return null;
    return numeric;
}

function normalizeLineItems(raw: unknown): MemberInvoiceLineItem[] {
    if (!Array.isArray(raw)) return [];
    const result: MemberInvoiceLineItem[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        const description = stringField(obj, "description") ?? "";
        const quantity = numericField(obj, "quantity") ?? 1;
        const unitAmount = numericField(obj, "unit_amount") ?? 0;
        const amount = numericField(obj, "amount") ?? quantity * unitAmount;
        result.push({ description, quantity, unit_amount: unitAmount, amount });
    }
    return result;
}

/**
 * path_reward_runs.reward_payload から member_id 該当分の金額を抽出する。
 * 各 service で payload 構造が違うため、ありそうな 3 系統を試す:
 *  - { breakdown: [{ member_id, total_pay_amount|total_pay }] }
 *  - { members: { [member_id]: { total_pay_amount|total_pay } } }
 *  - { lines: [{ member_id, amount }] }
 * いずれも見つからなければ 0 (= ドラフト候補から外す)。
 */
function extractMemberRewardAmount(
    payload: unknown,
    memberId: string,
): number {
    if (!payload || typeof payload !== "object") return 0;
    const root = payload as Record<string, unknown>;

    const breakdown = root.breakdown;
    if (Array.isArray(breakdown)) {
        for (const item of breakdown) {
            if (!item || typeof item !== "object") continue;
            const obj = item as Record<string, unknown>;
            if (obj.member_id === memberId) {
                const amount = Number(
                    obj.total_pay_amount ?? obj.total_pay ?? obj.amount ?? 0,
                );
                if (Number.isFinite(amount) && amount > 0) return amount;
            }
        }
    }

    const members = root.members;
    if (members && typeof members === "object" && !Array.isArray(members)) {
        const entry = (members as Record<string, unknown>)[memberId];
        if (entry && typeof entry === "object") {
            const obj = entry as Record<string, unknown>;
            const amount = Number(
                obj.total_pay_amount ?? obj.total_pay ?? obj.amount ?? 0,
            );
            if (Number.isFinite(amount) && amount > 0) return amount;
        }
    }

    const lines = root.lines;
    if (Array.isArray(lines)) {
        for (const item of lines) {
            if (!item || typeof item !== "object") continue;
            const obj = item as Record<string, unknown>;
            if (obj.member_id === memberId) {
                const amount = Number(obj.amount ?? obj.total_pay ?? 0);
                if (Number.isFinite(amount) && amount > 0) return amount;
            }
        }
    }

    return 0;
}

export const memberInvoiceService = new MemberInvoiceService();
