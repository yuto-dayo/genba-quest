import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { ProposalService } from "../services/ProposalService";
import type { ActorRef, ProposalType } from "../services/PolicyEngine";
import {
    normalizeRecurringExpenseProposalPayload,
    RecurringExpenseService,
    type RecurringExpenseProposalType,
} from "../services/RecurringExpenseService";
import { recurringExpenseGenerator } from "../services/RecurringExpenseGenerator";

const router = Router();
router.use(requireOrgMembership("member"));

function actorFromRequest(req: AuthenticatedRequest): ActorRef {
    return {
        type: "human",
        id: req.userId!,
        name: req.userName || req.userEmail || "Member",
    };
}

function statusForError(error: unknown): number {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message.includes("NOT_FOUND")) return 404;
    if (message.includes("FORBIDDEN") || message === "ORG_ROLE_REQUIRED") return 403;
    if (
        message.includes("INVALID") ||
        message.includes("REQUIRED") ||
        message.includes("RANGE")
    ) {
        return 400;
    }
    return 500;
}

function sendError(res: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    const status = statusForError(error);
    if (status === 500) {
        console.error("[RECURRING_EXPENSES] unexpected error:", error);
        res.status(500).json({ error: "Internal server error" });
        return;
    }
    res.status(status).json({ error: message });
}

function descriptionFor(type: RecurringExpenseProposalType, payload: Record<string, unknown>): string {
    const title = typeof payload.title === "string" && payload.title.trim()
        ? payload.title.trim()
        : "定期立替";
    if (type === "recurring_expense.create") return `定期立替「${title}」を登録`;
    if (type === "recurring_expense.update") return `定期立替「${title}」を変更`;
    return "定期立替を終了";
}

async function assertProposalCreatorAllowed(
    req: AuthenticatedRequest,
    payload: Record<string, unknown>,
): Promise<void> {
    const membership = await resolveActiveOrgMembership(req, "member");
    const memberUserId = typeof payload.member_user_id === "string"
        ? payload.member_user_id
        : typeof payload.member_id === "string"
            ? payload.member_id
            : req.userId;
    if (membership.role !== "admin" && memberUserId !== req.userId) {
        throw new Error("RECURRING_EXPENSE_CREATOR_FORBIDDEN");
    }
}

async function createAndSubmitProposal(
    req: AuthenticatedRequest,
    type: RecurringExpenseProposalType,
    payload: Record<string, unknown>,
) {
    await assertProposalCreatorAllowed(req, payload);
    const normalized = normalizeRecurringExpenseProposalPayload(type, payload);
    const service = new ProposalService(req.orgId!);
    return service.createAndSubmit({
        type: type as ProposalType,
        payload: normalized as unknown as Record<string, unknown>,
        description: descriptionFor(type, normalized as unknown as Record<string, unknown>),
        created_by: actorFromRequest(req),
        org_id: req.orgId!,
    });
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const includeEnded = req.query.include_ended === "1" || req.query.include_ended === "true";
        const service = new RecurringExpenseService(req.orgId!);
        const records = await service.list({
            memberUserId: membership.role === "admin" ? null : req.userId!,
            includeEnded,
        });
        res.json({ recurring_expenses: records });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const result = await createAndSubmitProposal(
            req,
            "recurring_expense.create",
            (req.body ?? {}) as Record<string, unknown>,
        );
        res.status(201).json({
            proposal: result.proposal,
            auto_approved: result.autoApproved,
            auto_executed: result.autoExecuted,
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.patch("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const payload = {
            ...(req.body ?? {}),
            recurring_expense_id: req.params.id,
        } as Record<string, unknown>;
        const result = await createAndSubmitProposal(req, "recurring_expense.update", payload);
        res.json({
            proposal: result.proposal,
            auto_approved: result.autoApproved,
            auto_executed: result.autoExecuted,
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/:id/end", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const payload = {
            ...(req.body ?? {}),
            recurring_expense_id: req.params.id,
        } as Record<string, unknown>;
        const result = await createAndSubmitProposal(req, "recurring_expense.end", payload);
        res.json({
            proposal: result.proposal,
            auto_approved: result.autoApproved,
            auto_executed: result.autoExecuted,
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/_generate-current-month", async (req: AuthenticatedRequest, res: Response) => {
    try {
        await resolveActiveOrgMembership(req, "admin");
        await recurringExpenseGenerator.generateCurrentMonth();
        res.json({ ok: true });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
