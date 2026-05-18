import { Router, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { disputeCorrectionService, DISPUTE_CORRECTION_KINDS, type DisputeCorrectionKind } from "../services/DisputeCorrectionService";
import type { ActorRef } from "../services/PolicyEngine";

const router = Router();

router.use(requireOrgMembership("member"));

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((item): item is string => typeof item === "string" && UUID_PATTERN.test(item))
        .slice(0, 5);
}

function buildHumanActor(req: AuthenticatedRequest): ActorRef {
    return {
        type: "human",
        id: req.userId!,
        name: req.userName || "Member",
    };
}

function sendDisputeError(res: Response, err: unknown): void {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    const code = message.includes(":") ? message.split(":")[0] : message;
    const statusMap: Record<string, number> = {
        DISPUTE_CORRECTION_TARGET_MEMBER_INVALID: 400,
        DISPUTE_CORRECTION_REWARD_MEMBER_INVALID: 400,
        DISPUTE_CORRECTION_MONTH_INVALID: 400,
        DISPUTE_CORRECTION_KIND_INVALID: 400,
        DISPUTE_CORRECTION_FROM_AMOUNT_INVALID: 400,
        DISPUTE_CORRECTION_TO_AMOUNT_INVALID: 400,
        DISPUTE_CORRECTION_REASON_REQUIRED: 400,
        DISPUTE_CORRECTION_CREATOR_MUST_BE_HUMAN: 403,
        DISPUTE_CORRECTION_CREATOR_MUST_BE_TARGET: 403,
        DISPUTE_CORRECTION_APPROVER_MUST_BE_ASSIGNED_REVIEWER: 403,
        TAX_ACCOUNT_MAPPING_NOT_FOUND: 422,
        TAX_ACCOUNT_MAPPING_NOT_APPLICABLE: 422,
        LEDGER_AMOUNT_INVALID: 422,
    };
    const status = statusMap[code] ?? 500;
    if (status === 500) {
        console.error("[payout] dispute correction error:", err);
    }
    res.status(status).json({ error: code });
}

router.post("/dispute-corrections", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
        const month = normalizeText(body.month);
        const targetMemberId = normalizeText(body.target_member_id) || req.userId!;
        const rewardMemberId = normalizeText(body.reward_member_id) || normalizeText(body.member_id) || null;
        const correctionKind = normalizeText(body.correction_kind) as DisputeCorrectionKind | null;
        const fromAmount = normalizeNumber(body.from_amount);
        const toAmount = normalizeNumber(body.to_amount);
        const reason = normalizeText(body.reason);

        if (!month || !MONTH_PATTERN.test(month)) {
            throw new Error("DISPUTE_CORRECTION_MONTH_INVALID");
        }
        if (!correctionKind || !DISPUTE_CORRECTION_KINDS.includes(correctionKind)) {
            throw new Error("DISPUTE_CORRECTION_KIND_INVALID");
        }
        if (fromAmount === null) {
            throw new Error("DISPUTE_CORRECTION_FROM_AMOUNT_INVALID");
        }
        if (toAmount === null) {
            throw new Error("DISPUTE_CORRECTION_TO_AMOUNT_INVALID");
        }
        if (!reason) {
            throw new Error("DISPUTE_CORRECTION_REASON_REQUIRED");
        }

        const result = await disputeCorrectionService.createProposal({
            orgId: req.orgId!,
            actor: buildHumanActor(req),
            targetMemberId,
            rewardMemberId,
            month,
            correctionKind,
            fromAmount,
            toAmount,
            reason,
            details: body.details && typeof body.details === "object" && !Array.isArray(body.details)
                ? body.details as Record<string, unknown>
                : {},
            sourceDocumentIds: normalizeStringArray(body.source_document_ids),
        });

        res.status(201).json(result);
    } catch (err) {
        sendDisputeError(res, err);
    }
});

router.get("/dispute-corrections", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const month = normalizeText(req.query.month);
        const status = normalizeText(req.query.status);
        const targetMemberId = normalizeText(req.query.target_member_id);
        const rewardMemberId = normalizeText(req.query.reward_member_id) || normalizeText(req.query.member_id);
        const limitValue = normalizeNumber(req.query.limit);
        const corrections = await disputeCorrectionService.listCorrections({
            orgId: req.orgId!,
            month,
            status,
            targetMemberId,
            rewardMemberId,
            limit: limitValue ?? 50,
        });
        res.json({ corrections });
    } catch (err) {
        sendDisputeError(res, err);
    }
});

export default router;
