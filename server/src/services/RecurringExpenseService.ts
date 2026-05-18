import { supabaseAdmin } from "../lib/supabaseClient";
import { Proposal, ActorRef } from "./PolicyEngine";

export const RECURRING_EXPENSE_CATEGORIES = [
    "車両ローン",
    "携帯代",
    "月極駐車",
    "工具リース",
    "事務所家賃",
    "保険",
    "その他",
] as const;

export type RecurringExpenseCategory = typeof RECURRING_EXPENSE_CATEGORIES[number];
export type RecurringExpenseScope = "overhead" | "stockpile";
export type RecurringExpenseStatus = "active" | "paused" | "ended";
export type RecurringExpenseProposalType =
    | "recurring_expense.create"
    | "recurring_expense.update"
    | "recurring_expense.end";

export interface RecurringExpenseRecord {
    id: string;
    org_id: string;
    member_id: string;
    category: RecurringExpenseCategory;
    title: string;
    monthly_amount: number | string;
    effective_from: string;
    effective_until: string | null;
    cycle: "monthly" | "quarterly";
    status: RecurringExpenseStatus;
    expense_scope: RecurringExpenseScope;
    proposal_id: string | null;
    created_at: string;
    created_by: string;
}

export interface RecurringExpenseDraft {
    member_user_id: string;
    category: RecurringExpenseCategory;
    title: string;
    monthly_amount: number;
    effective_from: string;
    effective_until?: string | null;
    expense_scope?: RecurringExpenseScope;
}

export interface RecurringExpenseUpdateDraft extends RecurringExpenseDraft {
    recurring_expense_id: string;
}

export interface RecurringExpenseEndDraft {
    recurring_expense_id: string;
    effective_until: string;
}

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const CATEGORY_SET = new Set<string>(RECURRING_EXPENSE_CATEGORIES);

function normalizeString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeAmount(value: unknown): number {
    const amount = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error("RECURRING_EXPENSE_AMOUNT_INVALID");
    }
    return Math.round(amount);
}

function assertMonth(value: string, code: string): void {
    if (!MONTH_PATTERN.test(value)) {
        throw new Error(code);
    }
}

function previousMonth(month: string): string {
    const [yearPart, monthPart] = month.split("-");
    const date = new Date(Number(yearPart), Number(monthPart) - 2, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function currentJstMonth(): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
    }).format(new Date());
}

function normalizeCategory(value: unknown): RecurringExpenseCategory {
    const category = normalizeString(value);
    if (!category || !CATEGORY_SET.has(category)) {
        throw new Error("RECURRING_EXPENSE_CATEGORY_INVALID");
    }
    return category as RecurringExpenseCategory;
}

function normalizeScope(value: unknown): RecurringExpenseScope {
    return value === "stockpile" ? "stockpile" : "overhead";
}

function parseDraft(payload: Record<string, unknown>): RecurringExpenseDraft {
    const memberUserId = normalizeString(payload.member_user_id ?? payload.member_id);
    const title = normalizeString(payload.title);
    const effectiveFrom = normalizeString(payload.effective_from);
    const effectiveUntil = normalizeString(payload.effective_until);

    if (!memberUserId) throw new Error("RECURRING_EXPENSE_MEMBER_REQUIRED");
    if (!title) throw new Error("RECURRING_EXPENSE_TITLE_REQUIRED");
    if (!effectiveFrom) throw new Error("RECURRING_EXPENSE_EFFECTIVE_FROM_REQUIRED");

    assertMonth(effectiveFrom, "RECURRING_EXPENSE_EFFECTIVE_FROM_INVALID");
    if (effectiveUntil) {
        assertMonth(effectiveUntil, "RECURRING_EXPENSE_EFFECTIVE_UNTIL_INVALID");
        if (effectiveUntil <= effectiveFrom) {
            throw new Error("RECURRING_EXPENSE_EFFECTIVE_RANGE_INVALID");
        }
    }

    return {
        member_user_id: memberUserId,
        category: normalizeCategory(payload.category),
        title,
        monthly_amount: normalizeAmount(payload.monthly_amount),
        effective_from: effectiveFrom,
        effective_until: effectiveUntil,
        expense_scope: normalizeScope(payload.expense_scope),
    };
}

function parseUpdateDraft(payload: Record<string, unknown>): RecurringExpenseUpdateDraft {
    const recurringExpenseId = normalizeString(payload.recurring_expense_id);
    if (!recurringExpenseId) throw new Error("RECURRING_EXPENSE_ID_REQUIRED");
    return {
        recurring_expense_id: recurringExpenseId,
        ...parseDraft(payload),
    };
}

function parseEndDraft(payload: Record<string, unknown>): RecurringExpenseEndDraft {
    const recurringExpenseId = normalizeString(payload.recurring_expense_id);
    const effectiveUntil = normalizeString(payload.effective_until) ?? currentJstMonth();
    if (!recurringExpenseId) throw new Error("RECURRING_EXPENSE_ID_REQUIRED");
    assertMonth(effectiveUntil, "RECURRING_EXPENSE_EFFECTIVE_UNTIL_INVALID");
    return {
        recurring_expense_id: recurringExpenseId,
        effective_until: effectiveUntil,
    };
}

export function normalizeRecurringExpenseProposalPayload(
    type: RecurringExpenseProposalType,
    payload: Record<string, unknown>,
): RecurringExpenseDraft | RecurringExpenseUpdateDraft | RecurringExpenseEndDraft {
    if (type === "recurring_expense.create") return parseDraft(payload);
    if (type === "recurring_expense.update") return parseUpdateDraft(payload);
    return parseEndDraft(payload);
}

export class RecurringExpenseService {
    constructor(private orgId: string) {}

    async list(options: { memberUserId?: string | null; includeEnded?: boolean } = {}): Promise<RecurringExpenseRecord[]> {
        let query = supabaseAdmin
            .from("recurring_expenses")
            .select("*")
            .eq("org_id", this.orgId)
            .order("effective_from", { ascending: false })
            .order("created_at", { ascending: false });

        if (options.memberUserId) {
            query = query.eq("member_id", options.memberUserId);
        }
        if (!options.includeEnded) {
            query = query.neq("status", "ended");
        }

        const { data, error } = await query;
        if (error) {
            throw new Error(`Failed to list recurring expenses: ${error.message}`);
        }
        return (data ?? []) as RecurringExpenseRecord[];
    }

    async applyFromExecutedProposal(proposal: Proposal, actor: ActorRef): Promise<void> {
        if (
            proposal.type !== "recurring_expense.create" &&
            proposal.type !== "recurring_expense.update" &&
            proposal.type !== "recurring_expense.end"
        ) {
            return;
        }

        if (proposal.type === "recurring_expense.create") {
            await this.createFromProposal(proposal, actor);
            return;
        }
        if (proposal.type === "recurring_expense.update") {
            await this.updateFromProposal(proposal, actor);
            return;
        }
        await this.endFromProposal(proposal, actor);
    }

    private async createFromProposal(proposal: Proposal, actor: ActorRef): Promise<void> {
        const draft = parseDraft(proposal.payload);
        const existing = await this.findByProposal(proposal.id);
        if (existing) return;

        const { error } = await supabaseAdmin
            .from("recurring_expenses")
            .insert({
                org_id: this.orgId,
                member_id: draft.member_user_id,
                category: draft.category,
                title: draft.title,
                monthly_amount: draft.monthly_amount,
                effective_from: draft.effective_from,
                effective_until: draft.effective_until ?? null,
                expense_scope: draft.expense_scope ?? "overhead",
                proposal_id: proposal.id,
                created_by: actor.type === "human" ? actor.id : proposal.created_by.id,
            });

        if (error) {
            throw new Error(`Failed to create recurring expense: ${error.message}`);
        }
    }

    private async updateFromProposal(proposal: Proposal, actor: ActorRef): Promise<void> {
        const draft = parseUpdateDraft(proposal.payload);
        const current = await this.getActiveForUpdate(draft.recurring_expense_id);
        if (!current) {
            throw new Error("RECURRING_EXPENSE_NOT_FOUND");
        }

        const newFrom = draft.effective_from;
        if (newFrom <= current.effective_from) {
            const { error } = await supabaseAdmin
                .from("recurring_expenses")
                .update({
                    category: draft.category,
                    title: draft.title,
                    monthly_amount: draft.monthly_amount,
                    effective_from: draft.effective_from,
                    effective_until: draft.effective_until ?? null,
                    expense_scope: draft.expense_scope ?? current.expense_scope,
                    proposal_id: proposal.id,
                })
                .eq("id", current.id)
                .eq("org_id", this.orgId);
            if (error) {
                throw new Error(`Failed to update recurring expense: ${error.message}`);
            }
            return;
        }

        const oldEffectiveUntil = previousMonth(newFrom);
        const closePatch = oldEffectiveUntil > current.effective_from
            ? { effective_until: oldEffectiveUntil, status: "ended" }
            : { status: "ended" };

        const { error: closeError } = await supabaseAdmin
            .from("recurring_expenses")
            .update(closePatch)
            .eq("id", current.id)
            .eq("org_id", this.orgId);
        if (closeError) {
            throw new Error(`Failed to close recurring expense history: ${closeError.message}`);
        }

        const { error: insertError } = await supabaseAdmin
            .from("recurring_expenses")
            .insert({
                org_id: this.orgId,
                member_id: draft.member_user_id,
                category: draft.category,
                title: draft.title,
                monthly_amount: draft.monthly_amount,
                effective_from: draft.effective_from,
                effective_until: draft.effective_until ?? null,
                expense_scope: draft.expense_scope ?? current.expense_scope,
                proposal_id: proposal.id,
                created_by: actor.type === "human" ? actor.id : proposal.created_by.id,
            });
        if (insertError) {
            throw new Error(`Failed to insert recurring expense history: ${insertError.message}`);
        }
    }

    private async endFromProposal(proposal: Proposal, _actor: ActorRef): Promise<void> {
        const draft = parseEndDraft(proposal.payload);
        const current = await this.getActiveForUpdate(draft.recurring_expense_id);
        if (!current) {
            throw new Error("RECURRING_EXPENSE_NOT_FOUND");
        }

        const patch = draft.effective_until > current.effective_from
            ? { effective_until: draft.effective_until, status: "ended", proposal_id: proposal.id }
            : { status: "ended", proposal_id: proposal.id };

        const { error } = await supabaseAdmin
            .from("recurring_expenses")
            .update(patch)
            .eq("id", current.id)
            .eq("org_id", this.orgId);
        if (error) {
            throw new Error(`Failed to end recurring expense: ${error.message}`);
        }
    }

    private async findByProposal(proposalId: string): Promise<RecurringExpenseRecord | null> {
        const { data, error } = await supabaseAdmin
            .from("recurring_expenses")
            .select("*")
            .eq("org_id", this.orgId)
            .eq("proposal_id", proposalId)
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to find recurring expense proposal result: ${error.message}`);
        }
        return (data ?? null) as RecurringExpenseRecord | null;
    }

    private async getActiveForUpdate(id: string): Promise<RecurringExpenseRecord | null> {
        const { data, error } = await supabaseAdmin
            .from("recurring_expenses")
            .select("*")
            .eq("id", id)
            .eq("org_id", this.orgId)
            .eq("status", "active")
            .maybeSingle();
        if (error) {
            throw new Error(`Failed to fetch recurring expense: ${error.message}`);
        }
        return (data ?? null) as RecurringExpenseRecord | null;
    }
}
