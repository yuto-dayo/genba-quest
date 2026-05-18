import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { supabaseAdmin } from "../lib/supabaseClient";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { listOrgMembers } from "../services/OrgMemberDirectoryService";

const router = Router();
router.use(requireOrgMembership("member"));

const ORG_ERROR_STATUS_MAP: Record<string, number> = {
    USER_CONTEXT_REQUIRED: 403,
    ORG_MEMBERSHIP_REQUIRED: 403,
    ORG_ONBOARDING_REQUIRED: 403,
    ORG_SELECTION_REQUIRED: 403,
    ORG_ROLE_REQUIRED: 403,
    INVALID_ORG_ID: 400,
};

function isIsoDateString(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function readScope(value: unknown): "organization" | "personal" {
    return value === "personal" ? "personal" : "organization";
}

function respondMappedError(res: Response, err: unknown): boolean {
    if (!(err instanceof Error)) {
        return false;
    }

    const status = ORG_ERROR_STATUS_MAP[err.message];
    if (!status) {
        return false;
    }

    res.status(status).json({ error: err.message });
    return true;
}

/**
 * GET /api/v1/calendar/personal-schedules?from=YYYY-MM-DD&to=YYYY-MM-DD&scope=organization|personal
 *
 * personal_schedules has no org_id in the current schema, so organization scope is
 * derived from active org membership and then filtered to those member user ids.
 */
router.get("/personal-schedules", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const from = req.query.from;
        const to = req.query.to;

        if (!isIsoDateString(from) || !isIsoDateString(to)) {
            res.status(400).json({ error: "from and to must be YYYY-MM-DD" });
            return;
        }

        if (from > to) {
            res.status(400).json({ error: "from must be before or equal to to" });
            return;
        }

        const membership = await resolveActiveOrgMembership(req);
        const scope = readScope(req.query.scope);
        const userIds =
            scope === "personal"
                ? [membership.user_id]
                : (await listOrgMembers(membership.org_id)).map((member) => member.user_id);

        if (userIds.length === 0) {
            res.json([]);
            return;
        }

        let query = supabaseAdmin
            .from("personal_schedules")
            .select("id,user_id,start_date,end_date,type,title,start_time,end_time,address,color,blocks_assignment,visibility,reason,approved,created_at,updated_at")
            .in("user_id", userIds)
            .lte("start_date", to)
            .gte("end_date", from);

        if (scope === "organization") {
            query = query.eq("visibility", "organization");
        }

        const { data, error } = await query.order("start_date", { ascending: true });

        if (error) {
            throw error;
        }

        res.json(data || []);
    } catch (err) {
        if (respondMappedError(res, err)) {
            return;
        }

        console.error("Calendar personal schedules error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

/**
 * DELETE /api/v1/calendar/personal-schedules/:id
 *
 * Minimal self-service undo for the personal calendar cockpit. Proposal history
 * remains intact; this removes only the current user's projection row.
 */
router.delete("/personal-schedules/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const scheduleId = req.params.id;
        if (!scheduleId) {
            res.status(400).json({ error: "schedule id is required" });
            return;
        }

        const membership = await resolveActiveOrgMembership(req);
        const { data, error } = await supabaseAdmin
            .from("personal_schedules")
            .delete()
            .eq("id", scheduleId)
            .eq("user_id", membership.user_id)
            .select("id")
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            res.status(404).json({ error: "Personal schedule not found" });
            return;
        }

        res.json({ ok: true, id: data.id });
    } catch (err) {
        if (respondMappedError(res, err)) {
            return;
        }

        console.error("Calendar personal schedule delete error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
