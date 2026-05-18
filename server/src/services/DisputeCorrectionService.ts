import { supabaseAdmin } from "../lib/supabaseAdmin";
import { bookLedgerEntry, type DisplayLabelLedgerEntry } from "../lib/ledger-helpers";
import type { ActorRef, Proposal } from "./PolicyEngine";
import {
    buildWithholdingDecisionSnapshotPayload,
    WithholdingDecisionSnapshotService,
} from "./WithholdingDecisionSnapshotService";

export const DISPUTE_CORRECTION_KINDS = [
    "reward_amount",
    "reimbursement_missing",
    "level_misjudgment",
    "attendance_days",
    "other",
] as const;

export type DisputeCorrectionKind = typeof DISPUTE_CORRECTION_KINDS[number];

export interface CreateDisputeCorrectionInput {
    orgId: string;
    actor: ActorRef;
    targetMemberId: string;
    rewardMemberId?: string | null;
    month: string;
    correctionKind: DisputeCorrectionKind;
    fromAmount: number;
    toAmount: number;
    reason: string;
    details?: Record<string, unknown>;
    sourceDocumentIds?: string[];
}

export interface DisputeCorrectionRow {
    proposal_id: string;
    org_id: string;
    status: string;
    description: string;
    month: string;
    target_member_id: string;
    reward_member_id: string | null;
    correction_kind: DisputeCorrectionKind;
    from_amount: number | null;
    to_amount: number | null;
    delta_amount: number | null;
    reason: string | null;
    evidence_document_ids: unknown;
    assigned_reviewer_id: string | null;
    assigned_at: string | null;
    result_event_id: string | null;
    created_at: string;
    executed_at: string | null;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, code: string): void {
    if (!UUID_PATTERN.test(value)) {
        throw new Error(code);
    }
}

function assertMonth(value: string): void {
    if (!MONTH_PATTERN.test(value)) {
        throw new Error("DISPUTE_CORRECTION_MONTH_INVALID");
    }
}

function normalizeAmount(value: number, code: string): number {
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(code);
    }
    return Number(value.toFixed(2));
}

function assertReason(value: string): string {
    const reason = value.trim();
    if (reason.length < 3) {
        throw new Error("DISPUTE_CORRECTION_REASON_REQUIRED");
    }
    return reason.slice(0, 1000);
}

function labelForKind(kind: DisputeCorrectionKind): string {
    if (kind === "reimbursement_missing") {
        return "立替戻し";
    }
    if (kind === "other") {
        return "手当";
    }
    return "報酬の素";
}

function buildReversalEntries(kind: DisputeCorrectionKind, amount: number): DisplayLabelLedgerEntry[] {
    if (amount <= 0) return [];
    const label = labelForKind(kind);
    return [
        { display_label: "普通預金", debit_amount: amount },
        { display_label: label, credit_amount: amount },
    ];
}

function buildAdjustmentEntries(kind: DisputeCorrectionKind, amount: number): DisplayLabelLedgerEntry[] {
    if (amount <= 0) return [];
    const label = labelForKind(kind);
    return [
        { display_label: label, debit_amount: amount },
        { display_label: "普通預金", credit_amount: amount },
    ];
}

async function findLedgerEventId(proposalId: string, orgId: string, eventType: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
        .from("ledger_events")
        .select("id")
        .eq("proposal_id", proposalId)
        .eq("org_id", orgId)
        .eq("event_type", eventType)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw new Error(`DISPUTE_CORRECTION_LEDGER_LOOKUP_FAILED: ${error.message}`);
    }

    return typeof data?.id === "string" ? data.id : null;
}

async function ensureLedgerEvent(input: {
    proposal: Proposal;
    actor: ActorRef;
    eventType: string;
    entries: DisplayLabelLedgerEntry[];
}): Promise<string | null> {
    if (input.entries.length === 0) {
        return null;
    }

    const existing = await findLedgerEventId(input.proposal.id, input.proposal.org_id, input.eventType);
    if (existing) {
        return existing;
    }

    const result = await bookLedgerEntry(
        input.eventType,
        input.entries,
        {
            org_id: input.proposal.org_id,
            proposal_id: input.proposal.id,
            actor: input.actor,
            payload: input.proposal.payload,
        },
        supabaseAdmin,
    );
    return result.ledger_event_id;
}

export class DisputeCorrectionService {
    async createProposal(input: CreateDisputeCorrectionInput) {
        assertUuid(input.targetMemberId, "DISPUTE_CORRECTION_TARGET_MEMBER_INVALID");
        if (input.rewardMemberId) {
            assertUuid(input.rewardMemberId, "DISPUTE_CORRECTION_REWARD_MEMBER_INVALID");
        }
        assertMonth(input.month);
        if (input.actor.type !== "human") {
            throw new Error("DISPUTE_CORRECTION_CREATOR_MUST_BE_HUMAN");
        }
        if (input.actor.id !== input.targetMemberId) {
            throw new Error("DISPUTE_CORRECTION_CREATOR_MUST_BE_TARGET");
        }

        const fromAmount = normalizeAmount(input.fromAmount, "DISPUTE_CORRECTION_FROM_AMOUNT_INVALID");
        const toAmount = normalizeAmount(input.toAmount, "DISPUTE_CORRECTION_TO_AMOUNT_INVALID");
        const reason = assertReason(input.reason);
        const deltaAmount = Number((toAmount - fromAmount).toFixed(2));
        const snapshotMemberId = input.rewardMemberId ?? input.targetMemberId;
        const memberSnapshots = await new WithholdingDecisionSnapshotService(input.orgId).buildMemberSnapshots(
            [snapshotMemberId],
            input.month,
        );

        const evidenceDocumentIds = await this.registerEvidenceDocuments({
            orgId: input.orgId,
            actorId: input.actor.id,
            sourceDocumentIds: input.sourceDocumentIds ?? [],
            month: input.month,
            amount: Math.max(fromAmount, toAmount),
            kind: input.correctionKind,
        });

        const payload: Record<string, unknown> = {
            target_member_id: input.targetMemberId,
            reward_member_id: input.rewardMemberId ?? input.targetMemberId,
            month: input.month,
            correction_kind: input.correctionKind,
            from_amount: fromAmount,
            to_amount: toAmount,
            delta_amount: deltaAmount,
            reason,
            details: input.details ?? {},
            evidence_document_ids: evidenceDocumentIds,
            source_document_ids: input.sourceDocumentIds ?? [],
            ledger_strategy: "append_reversal_and_adjustment",
            ...buildWithholdingDecisionSnapshotPayload(memberSnapshots),
        };

        const description = `計算修正申立: ${input.month} ${this.labelForDescription(input.correctionKind)} ${deltaAmount >= 0 ? "+" : ""}${deltaAmount.toLocaleString()}円`;
        const { ProposalService } = await import("./ProposalService");
        const proposalService = new ProposalService(input.orgId);
        return proposalService.createAndSubmit({
            type: "reward.dispute_correction",
            payload,
            description,
            created_by: input.actor,
            org_id: input.orgId,
            idempotency_key: `reward:dispute_correction:${input.orgId}:${input.targetMemberId}:${input.month}:${input.correctionKind}:${Date.now()}`,
        });
    }

    async executeApprovedProposal(proposal: Proposal, actor: ActorRef): Promise<Proposal> {
        if (proposal.type !== "reward.dispute_correction") {
            throw new Error("DISPUTE_CORRECTION_PROPOSAL_REQUIRED");
        }
        if (proposal.status === "executed") {
            return proposal;
        }
        if (proposal.status !== "approved") {
            throw new Error("PROPOSAL_NOT_APPROVED");
        }

        const targetMemberId = typeof proposal.payload?.target_member_id === "string"
            ? proposal.payload.target_member_id
            : "";
        if (!targetMemberId || proposal.created_by?.id !== targetMemberId) {
            throw new Error("DISPUTE_CORRECTION_CREATOR_MUST_BE_TARGET");
        }

        const correctionKind = proposal.payload?.correction_kind;
        if (!DISPUTE_CORRECTION_KINDS.includes(correctionKind as DisputeCorrectionKind)) {
            throw new Error("DISPUTE_CORRECTION_KIND_INVALID");
        }

        const fromAmount = normalizeAmount(Number(proposal.payload?.from_amount ?? 0), "DISPUTE_CORRECTION_FROM_AMOUNT_INVALID");
        const toAmount = normalizeAmount(Number(proposal.payload?.to_amount ?? 0), "DISPUTE_CORRECTION_TO_AMOUNT_INVALID");
        const kind = correctionKind as DisputeCorrectionKind;

        const reversalEventId = await ensureLedgerEvent({
            proposal,
            actor,
            eventType: "reward.dispute_correction.reversal",
            entries: buildReversalEntries(kind, fromAmount),
        });
        const adjustmentEventId = await ensureLedgerEvent({
            proposal,
            actor,
            eventType: "reward.dispute_correction.adjustment",
            entries: buildAdjustmentEntries(kind, toAmount),
        });

        const resultEventId = adjustmentEventId ?? reversalEventId;
        const { data, error } = await supabaseAdmin
            .from("proposals")
            .update({
                status: "executed",
                executed_at: new Date().toISOString(),
                executed_by: actor,
                result_event_id: resultEventId,
                updated_at: new Date().toISOString(),
            })
            .eq("id", proposal.id)
            .eq("org_id", proposal.org_id)
            .select()
            .single();

        if (error) {
            throw new Error(`DISPUTE_CORRECTION_PROPOSAL_UPDATE_FAILED: ${error.message}`);
        }

        return data as Proposal;
    }

    async listCorrections(input: {
        orgId: string;
        month?: string | null;
        targetMemberId?: string | null;
        rewardMemberId?: string | null;
        status?: string | null;
        limit?: number;
    }): Promise<DisputeCorrectionRow[]> {
        let query = supabaseAdmin
            .from("v_dispute_corrections")
            .select("*")
            .eq("org_id", input.orgId)
            .order("created_at", { ascending: false })
            .limit(Math.min(Math.max(input.limit ?? 50, 1), 200));

        if (input.month) query = query.eq("month", input.month);
        if (input.status) query = query.eq("status", input.status);
        if (input.targetMemberId) query = query.eq("target_member_id", input.targetMemberId);
        if (input.rewardMemberId) query = query.eq("reward_member_id", input.rewardMemberId);

        const { data, error } = await query;
        if (error) {
            throw new Error(`DISPUTE_CORRECTION_LIST_FAILED: ${error.message}`);
        }
        return (data ?? []) as DisputeCorrectionRow[];
    }

    private async registerEvidenceDocuments(input: {
        orgId: string;
        actorId: string;
        sourceDocumentIds: string[];
        month: string;
        amount: number;
        kind: DisputeCorrectionKind;
    }): Promise<string[]> {
        const uniqueSourceIds = Array.from(new Set(input.sourceDocumentIds.filter((id) => UUID_PATTERN.test(id))));
        const electronicIds: string[] = [];
        for (const sourceDocumentId of uniqueSourceIds) {
            const { electronicDocumentService } = await import("./ElectronicDocumentService");
            const registered = await electronicDocumentService.registerFromStoredDocument({
                orgId: input.orgId,
                sourceDocumentId,
                kind: "other",
                transactionDate: `${input.month}-01`,
                counterpartyName: "報酬異議申立",
                amount: input.amount,
                registeredBy: input.actorId,
                metadata: {
                    source: "reward.dispute_correction",
                    correction_kind: input.kind,
                },
            });
            if (typeof registered === "string") {
                electronicIds.push(registered);
            } else if (registered && typeof registered === "object" && "id" in registered && typeof registered.id === "string") {
                electronicIds.push(registered.id);
            }
        }
        return electronicIds;
    }

    private labelForDescription(kind: DisputeCorrectionKind): string {
        const labels: Record<DisputeCorrectionKind, string> = {
            reward_amount: "報酬額",
            reimbursement_missing: "立替漏れ",
            level_misjudgment: "レベル判定",
            attendance_days: "出勤日数",
            other: "その他",
        };
        return labels[kind];
    }
}

export const disputeCorrectionService = new DisputeCorrectionService();
