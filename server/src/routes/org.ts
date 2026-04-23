import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { OrgBootstrapService } from "../services/OrgBootstrapService";
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

    if (code === "ORG_BOOTSTRAP_FORBIDDEN") {
        res.status(403).json({ error: code });
        return;
    }

    if (code === "ORG_BOOTSTRAP_NAME_REQUIRED" || code === "ORG_BOOTSTRAP_RPC_EMPTY_RESULT") {
        res.status(400).json({ error: code });
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

export default router;
