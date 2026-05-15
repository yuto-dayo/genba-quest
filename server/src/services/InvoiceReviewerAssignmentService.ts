import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";

export interface InvoiceReviewAssignmentRecord {
    id: string;
    invoice_id: string;
    reviewer_user_id: string;
    org_id: string;
    assigned_at: string;
    expires_at: string;
    completed_at: string | null;
    reassigned_from: string | null;
}

export interface InvoicePayoutDetail {
    invoice_id: string;
    invoice_no: string;
    amount: number;
    issued_at: string;
    snapshot: {
        bank_name: string | null;
        branch_name: string | null;
        account_type: string | null;
        account_number: string | null;
        account_holder: string | null;
        real_name: string | null;
        tax_id: string | null;
    };
    body_html: string;
    line_items: unknown[];
    expires_at: string;
    self_member_id: string;
    is_self: boolean;
    is_reviewer: boolean;
}

type InvoiceReviewerAssignmentClient = Pick<SupabaseClient, "from">;

type InvoiceRow = {
    id: string;
    org_id: string;
    member_id: string;
    status: string;
    amount_total: number | string;
    issued_at: string;
    invoice_no?: string | null;
    snapshot_trade_name?: string | null;
    snapshot_invoice_registration_no?: string | null;
    snapshot_bank?: Record<string, unknown> | null;
    line_items?: unknown[] | null;
};

type OrgSettingsRow = {
    finance_review_window_hours?: number | string | null;
    finance_reviewer_pool?: unknown;
};

const DEFAULT_REVIEW_WINDOW_HOURS = 168;

export class InvoiceReviewerAssignmentService {
    constructor(
        private readonly client: InvoiceReviewerAssignmentClient = supabaseAdmin as unknown as InvoiceReviewerAssignmentClient,
        private readonly random: () => number = Math.random,
        private readonly now: () => Date = () => new Date(),
    ) {}

    async assignFinanceReviewer(
        invoiceId: string,
        options: { reassignedFrom?: string | null } = {},
    ): Promise<{
        assignment: InvoiceReviewAssignmentRecord | null;
        candidateCount: number;
    }> {
        const invoice = await this.loadInvoiceForAssignment(invoiceId);

        if (invoice.status !== "issued") {
            return { assignment: null, candidateCount: 0 };
        }

        const existing = await this.loadLatestAssignment(invoice.id);
        if (existing && !options.reassignedFrom) {
            return { assignment: existing, candidateCount: 1 };
        }

        const settings = await this.loadOrgSettings(invoice.org_id);
        const candidates = await this.listCandidates({
            orgId: invoice.org_id,
            issuerUserId: invoice.member_id,
            settings,
        });

        if (candidates.length === 0) {
            await this.notifyAdminsNoCandidate(invoice);
            return { assignment: null, candidateCount: 0 };
        }

        const reviewerUserId = this.pickCandidate(candidates);
        const expiresAt = this.calculateExpiresAt(invoice.issued_at, settings);
        const { data, error } = await this.client
            .from("invoice_review_assignments")
            .insert({
                invoice_id: invoice.id,
                org_id: invoice.org_id,
                reviewer_user_id: reviewerUserId,
                expires_at: expiresAt,
                reassigned_from: options.reassignedFrom ?? null,
            })
            .select("*")
            .single();

        if (error) {
            throw new Error(`INVOICE_REVIEW_ASSIGNMENT_INSERT_FAILED: ${error.message}`);
        }

        const assignment = data as InvoiceReviewAssignmentRecord;
        await this.notifyReviewer(assignment);
        return { assignment, candidateCount: candidates.length };
    }

    async reassign(invoiceId: string): Promise<{
        assignment: InvoiceReviewAssignmentRecord | null;
        candidateCount: number;
    }> {
        const previous = await this.loadLatestAssignment(invoiceId);
        return this.assignFinanceReviewer(invoiceId, {
            reassignedFrom: previous?.id ?? null,
        });
    }

    async getPayoutDetail(input: {
        invoiceId: string;
        orgId: string;
        reviewerUserId: string;
    }): Promise<InvoicePayoutDetail> {
        const assignment = await this.assertActiveAssignment(input);
        const invoice = await this.loadInvoiceForPayout(input.invoiceId, input.orgId);
        const bank = invoice.snapshot_bank ?? {};

        return {
            invoice_id: invoice.id,
            invoice_no: invoice.invoice_no ?? invoice.id,
            amount: Number(invoice.amount_total) || 0,
            issued_at: invoice.issued_at,
            snapshot: {
                bank_name: stringOrNull(bank.bank_name),
                branch_name: stringOrNull(bank.branch_name),
                account_type: stringOrNull(bank.account_type),
                account_number: stringOrNull(bank.account_number),
                account_holder: stringOrNull(bank.account_holder_kana),
                real_name: invoice.snapshot_trade_name ?? null,
                tax_id: invoice.snapshot_invoice_registration_no ?? null,
            },
            body_html: "",
            line_items: Array.isArray(invoice.line_items) ? invoice.line_items : [],
            expires_at: assignment.expires_at,
            self_member_id: input.reviewerUserId,
            is_self: invoice.member_id === input.reviewerUserId,
            is_reviewer: assignment.reviewer_user_id === input.reviewerUserId,
        };
    }

    async assertActiveReviewer(input: {
        invoiceId: string;
        orgId: string;
        reviewerUserId: string;
    }): Promise<InvoiceReviewAssignmentRecord> {
        return this.assertActiveAssignment(input);
    }

    async markCompleted(input: {
        invoiceId: string;
        orgId: string;
        reviewerUserId: string;
    }): Promise<InvoiceReviewAssignmentRecord> {
        const assignment = await this.assertActiveAssignment(input);
        const completedAt = this.now().toISOString();
        const { data, error } = await this.client
            .from("invoice_review_assignments")
            .update({ completed_at: completedAt })
            .eq("id", assignment.id)
            .eq("org_id", input.orgId)
            .is("completed_at", null)
            .gt("expires_at", completedAt)
            .select("*")
            .single();

        if (error) {
            throw new Error(`INVOICE_REVIEW_ASSIGNMENT_COMPLETE_FAILED: ${error.message}`);
        }

        const updated = data as InvoiceReviewAssignmentRecord;
        await this.notifyIssuerPaid(input.invoiceId, input.orgId);
        return updated;
    }

    private async assertActiveAssignment(input: {
        invoiceId: string;
        orgId: string;
        reviewerUserId: string;
    }): Promise<InvoiceReviewAssignmentRecord> {
        const { data, error } = await this.client
            .from("invoice_review_assignments")
            .select("*")
            .eq("invoice_id", input.invoiceId)
            .eq("org_id", input.orgId)
            .eq("reviewer_user_id", input.reviewerUserId)
            .order("assigned_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw new Error(`INVOICE_REVIEW_ASSIGNMENT_LOAD_FAILED: ${error.message}`);
        }
        if (!data) {
            throw new Error("INVOICE_REVIEW_ASSIGNMENT_NOT_FOUND");
        }

        const assignment = data as InvoiceReviewAssignmentRecord;
        if (assignment.completed_at) {
            throw new Error("INVOICE_REVIEW_ASSIGNMENT_COMPLETED");
        }
        if (new Date(assignment.expires_at).getTime() <= this.now().getTime()) {
            throw new Error("INVOICE_REVIEW_ASSIGNMENT_EXPIRED");
        }

        return assignment;
    }

    private async loadInvoiceForAssignment(invoiceId: string): Promise<InvoiceRow> {
        const { data, error } = await this.client
            .from("member_invoices")
            .select("id,org_id,member_id,status,amount_total,issued_at,invoice_no")
            .eq("id", invoiceId)
            .maybeSingle();

        if (error) {
            throw new Error(`MEMBER_INVOICE_LOAD_FAILED: ${error.message}`);
        }
        if (!data) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }
        return data as InvoiceRow;
    }

    private async loadInvoiceForPayout(invoiceId: string, orgId: string): Promise<InvoiceRow> {
        const { data, error } = await this.client
            .from("member_invoices")
            .select("id,org_id,member_id,status,amount_total,issued_at,invoice_no,snapshot_trade_name,snapshot_invoice_registration_no,snapshot_bank,line_items")
            .eq("id", invoiceId)
            .eq("org_id", orgId)
            .maybeSingle();

        if (error) {
            throw new Error(`MEMBER_INVOICE_LOAD_FAILED: ${error.message}`);
        }
        if (!data) {
            throw new Error("MEMBER_INVOICE_NOT_FOUND");
        }
        return data as InvoiceRow;
    }

    private async loadLatestAssignment(invoiceId: string): Promise<InvoiceReviewAssignmentRecord | null> {
        const { data, error } = await this.client
            .from("invoice_review_assignments")
            .select("*")
            .eq("invoice_id", invoiceId)
            .order("assigned_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw new Error(`INVOICE_REVIEW_ASSIGNMENT_LOAD_FAILED: ${error.message}`);
        }
        return (data || null) as InvoiceReviewAssignmentRecord | null;
    }

    private async loadOrgSettings(orgId: string): Promise<OrgSettingsRow> {
        const { data, error } = await this.client
            .from("org_settings")
            .select("finance_review_window_hours, finance_reviewer_pool")
            .eq("org_id", orgId)
            .maybeSingle();

        if (error) {
            throw new Error(`ORG_SETTINGS_LOAD_FAILED: ${error.message}`);
        }
        return (data || {}) as OrgSettingsRow;
    }

    private async listCandidates(input: {
        orgId: string;
        issuerUserId: string;
        settings: OrgSettingsRow;
    }): Promise<string[]> {
        const configuredPool = Array.isArray(input.settings.finance_reviewer_pool)
            ? input.settings.finance_reviewer_pool.filter((id): id is string => typeof id === "string")
            : [];

        let query = this.client
            .from("org_memberships")
            .select("user_id")
            .eq("org_id", input.orgId)
            .eq("status", "active")
            .neq("user_id", input.issuerUserId);

        if (configuredPool.length > 0) {
            query = query.in("user_id", configuredPool);
        }

        const { data, error } = await query;
        if (error) {
            throw new Error(`INVOICE_REVIEW_CANDIDATES_LOAD_FAILED: ${error.message}`);
        }

        return (data || [])
            .map((row) => (row as { user_id?: unknown }).user_id)
            .filter((id): id is string => typeof id === "string");
    }

    private pickCandidate(candidates: string[]): string {
        const index = Math.min(
            candidates.length - 1,
            Math.floor(this.random() * candidates.length),
        );
        return candidates[Math.max(0, index)];
    }

    private calculateExpiresAt(issuedAt: string, settings: OrgSettingsRow): string {
        const configured = Number(settings.finance_review_window_hours);
        const hours = Number.isFinite(configured) && configured > 0
            ? configured
            : DEFAULT_REVIEW_WINDOW_HOURS;
        const base = Number.isFinite(new Date(issuedAt).getTime())
            ? new Date(issuedAt)
            : this.now();
        return new Date(base.getTime() + hours * 60 * 60 * 1000).toISOString();
    }

    private async notifyReviewer(assignment: InvoiceReviewAssignmentRecord): Promise<void> {
        const { error } = await this.client
            .from("notifications")
            .insert({
                user_id: assignment.reviewer_user_id,
                type: "approval_required",
                title: "メンバー請求書の支払い確認",
                message: "支払い内容を確認してください。",
                data: {
                    invoice_id: assignment.invoice_id,
                    kind: "member_invoice_pay",
                },
            });

        if (error) {
            throw new Error(`INVOICE_REVIEW_NOTIFICATION_FAILED: ${error.message}`);
        }
    }

    private async notifyAdminsNoCandidate(invoice: InvoiceRow): Promise<void> {
        const { data, error } = await this.client
            .from("org_memberships")
            .select("user_id")
            .eq("org_id", invoice.org_id)
            .eq("status", "active")
            .eq("role", "admin");

        if (error) {
            throw new Error(`INVOICE_REVIEW_ADMIN_FALLBACK_LOAD_FAILED: ${error.message}`);
        }

        const adminIds = (data || [])
            .map((row) => (row as { user_id?: unknown }).user_id)
            .filter((id): id is string => typeof id === "string");
        if (adminIds.length === 0) {
            return;
        }

        const { error: insertError } = await this.client
            .from("notifications")
            .insert(adminIds.map((userId) => ({
                user_id: userId,
                type: "approval_required",
                title: "経理担当を割り当てできません",
                message: "メンバー請求書の支払い担当候補がいません。",
                data: {
                    invoice_id: invoice.id,
                    kind: "member_invoice_pay",
                    candidate_pool_empty: true,
                },
            })));

        if (insertError) {
            throw new Error(`INVOICE_REVIEW_ADMIN_FALLBACK_NOTIFY_FAILED: ${insertError.message}`);
        }
    }

    private async notifyIssuerPaid(invoiceId: string, orgId: string): Promise<void> {
        const invoice = await this.loadInvoiceForPayout(invoiceId, orgId);
        const { error } = await this.client
            .from("notifications")
            .insert({
                user_id: invoice.member_id,
                type: "approval_result",
                title: "請求書の支払いが完了しました",
                message: "メンバー請求書が支払い済みになりました。",
                data: {
                    invoice_id: invoice.id,
                    kind: "paid",
                },
            });

        if (error) {
            throw new Error(`INVOICE_REVIEW_PAID_NOTIFICATION_FAILED: ${error.message}`);
        }
    }
}

function stringOrNull(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

export const invoiceReviewerAssignmentService = new InvoiceReviewerAssignmentService();
