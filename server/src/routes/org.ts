import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { OrgBootstrapService } from "../services/OrgBootstrapService";
import { OrgInviteAcceptanceService } from "../services/OrgInviteAcceptanceService";
import { OrgInviteCreationService, type OrgInviteStatus } from "../services/OrgInviteCreationService";
import { listOrgMembers } from "../services/OrgMemberDirectoryService";
import { OrgMembershipManagementService } from "../services/OrgMembershipManagementService";

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
        code === "ORG_INVITE_EMAIL_MISMATCH" ||
        code === "ORG_INVITE_PENDING_DUPLICATE"
    ) {
        res.status(409).json({ error: code });
        return;
    }

    if (code === "ORG_INVITE_ROLE_INVALID" || code === "ORG_MEMBER_ROLE_INVALID") {
        res.status(400).json({ error: code });
        return;
    }

    if (code === "ORG_MEMBER_NOT_FOUND") {
        res.status(404).json({ error: code });
        return;
    }

    if (code === "ORG_MEMBER_LAST_ADMIN" || code === "ORG_MEMBER_REMOVE_SELF") {
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

router.get("/invites", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "admin");
        const service = new OrgInviteCreationService();
        const status = typeof req.query.status === "string"
            ? (req.query.status as OrgInviteStatus | "all")
            : "pending";
        const invites = await service.list({ orgId: membership.org_id, status });
        res.json({ invites });
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.post("/invites", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const membership = await resolveActiveOrgMembership(req, "admin");
        const service = new OrgInviteCreationService();
        const email = typeof req.body?.email === "string" ? req.body.email : "";
        const role = req.body?.role === "admin" ? "admin" : "member";
        const ttlDays = typeof req.body?.ttl_days === "number" ? req.body.ttl_days : undefined;

        const invite = await service.create({
            orgId: membership.org_id,
            invitedBy: req.userId,
            email,
            role,
            ttlDays,
        });

        res.status(201).json({ invite });
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.delete("/invites/:inviteId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const membership = await resolveActiveOrgMembership(req, "admin");
        const inviteId = Array.isArray(req.params.inviteId)
            ? req.params.inviteId[0]
            : req.params.inviteId;
        if (!inviteId) {
            res.status(400).json({ error: "ORG_INVITE_NOT_FOUND" });
            return;
        }

        const service = new OrgInviteCreationService();
        const invite = await service.revoke({
            orgId: membership.org_id,
            inviteId,
            revokedBy: req.userId,
        });

        res.json({ invite });
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.patch("/members/:userId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const membership = await resolveActiveOrgMembership(req, "admin");
        const targetUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
        if (!targetUserId) {
            res.status(404).json({ error: "ORG_MEMBER_NOT_FOUND" });
            return;
        }

        const role = req.body?.role;
        if (role !== "admin" && role !== "member") {
            res.status(400).json({ error: "ORG_MEMBER_ROLE_INVALID" });
            return;
        }

        const service = new OrgMembershipManagementService();
        const updated = await service.updateRole({
            orgId: membership.org_id,
            actorUserId: req.userId,
            targetUserId,
            newRole: role,
        });

        res.json({ membership: updated });
    } catch (error) {
        handleOrgAccessError(res, error);
    }
});

router.delete("/members/:userId", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const membership = await resolveActiveOrgMembership(req, "admin");
        const targetUserId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
        if (!targetUserId) {
            res.status(404).json({ error: "ORG_MEMBER_NOT_FOUND" });
            return;
        }

        const service = new OrgMembershipManagementService();
        const removed = await service.remove({
            orgId: membership.org_id,
            actorUserId: req.userId,
            targetUserId,
        });

        res.json({ membership: removed });
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
