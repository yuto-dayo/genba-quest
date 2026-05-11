import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { OrgBootstrapService } from "../services/OrgBootstrapService";
import { OrgInviteAcceptanceService } from "../services/OrgInviteAcceptanceService";
import { listOrgMembers } from "../services/OrgMemberDirectoryService";

const router = Router();

function handleOrgAccessError(res: Response, error: unknown): void {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (code === "INVALID_ORG_ID") {
        res.status(400).json({ error: code });
        return;
    }

    if (code === "ORG_SELECTION_REQUIRED") {
        res.status(409).json({ error: code });
        return;
    }

    if (code === "ORG_BOOTSTRAP_NOT_IN_ONBOARDING" || code === "ORG_BOOTSTRAP_SLUG_CONFLICT") {
        res.status(409).json({ error: code });
        return;
    }

    if (code === "ORG_INVITE_NOT_FOUND") {
        res.status(404).json({ error: code });
        return;
    }

    if (
        code === "ORG_INVITE_NOT_PENDING" ||
        code === "ORG_INVITE_EXPIRED" ||
        code === "ORG_INVITE_EMAIL_MISMATCH"
    ) {
        res.status(409).json({ error: code });
        return;
    }

    if (code === "ORG_BOOTSTRAP_FORBIDDEN") {
        res.status(403).json({ error: code });
        return;
    }

    if (
        code === "ORG_BOOTSTRAP_NAME_REQUIRED" ||
        code === "ORG_BOOTSTRAP_RPC_EMPTY_RESULT" ||
        code === "ORG_INVITE_EMAIL_REQUIRED" ||
        code === "ORG_INVITE_ACCEPT_EMPTY_RESULT" ||
        code === "ORG_CREATION_CODE_REQUIRED"
    ) {
        res.status(400).json({ error: code });
        return;
    }

    if (
        code === "ORG_CREATION_CODE_INVALID" ||
        code === "ORG_CREATION_CODE_EXPIRED" ||
        code === "ORG_CREATION_CODE_REVOKED" ||
        code === "ORG_CREATION_CODE_EXHAUSTED"
    ) {
        res.status(403).json({ error: code });
        return;
    }

    if (code === "ORG_CREATION_RPC_NOT_AVAILABLE") {
        res.status(503).json({ error: code });
        return;
    }

    if (
        code === "USER_CONTEXT_REQUIRED" ||
        code === "ORG_ONBOARDING_REQUIRED" ||
        code === "ORG_MEMBERSHIP_REQUIRED" ||
        code === "ORG_ROLE_REQUIRED"
    ) {
        res.status(403).json({ error: code });
        return;
    }

    console.error("[ORG] access error:", error);
    res.status(500).json({ error: "Internal server error" });
}

router.get("/members", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const members = await listOrgMembers(membership.org_id);
        res.json(members);
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.get("/context", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const { data, error } = await supabaseAdmin
            .from("organizations")
            .select("id,name,slug,status")
            .eq("id", membership.org_id)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            res.status(404).json({ error: "ORG_NOT_FOUND" });
            return;
        }

        res.json({
            org: data,
            membership,
        });
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.post("/bootstrap", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const service = new OrgBootstrapService();
        const result = await service.bootstrap({
            userId: req.userId,
            userEmail: req.userEmail ?? null,
            name: typeof req.body?.name === "string" ? req.body.name : "",
            slug: typeof req.body?.slug === "string" ? req.body.slug : null,
        });

        res.status(201).json(result);
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.post("/bootstrap-with-code", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const service = new OrgBootstrapService();
        const result = await service.bootstrapWithCode({
            userId: req.userId,
            name: typeof req.body?.name === "string" ? req.body.name : "",
            code: typeof req.body?.code === "string" ? req.body.code : "",
            slug: typeof req.body?.slug === "string" ? req.body.slug : null,
        });

        res.status(201).json(result);
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.post("/invites/:inviteId/accept", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const inviteId = Array.isArray(req.params.inviteId)
            ? req.params.inviteId[0]
            : req.params.inviteId;
        if (!inviteId) {
            res.status(400).json({ error: "ORG_INVITE_NOT_FOUND" });
            return;
        }

        const service = new OrgInviteAcceptanceService();
        const result = await service.accept({
            inviteId,
            userId: req.userId,
            userEmail: req.userEmail ?? null,
        });

        res.status(201).json(result);
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

export default router;
