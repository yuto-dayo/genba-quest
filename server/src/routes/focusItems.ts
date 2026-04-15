import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { resolveOrgId } from "../lib/org";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

type FocusItemScope = "personal" | "org";
type FocusItemHorizon = "today" | "week" | "later";
type FocusItemStatus = "open" | "done";

interface FocusItemAuthorizationRow {
    id: string;
    org_id: string;
    scope: FocusItemScope;
    created_by: string;
}

const FOCUS_ITEM_SELECT = `
    id,
    org_id,
    scope,
    horizon,
    status,
    title,
    note,
    site_id,
    site_name_snapshot,
    created_by,
    completed_by,
    completed_at,
    created_at,
    updated_at
`;

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function parseScope(value: unknown): FocusItemScope | null {
    return value === "personal" || value === "org" ? value : null;
}

function parseHorizon(value: unknown): FocusItemHorizon | null {
    return value === "today" || value === "week" || value === "later" ? value : null;
}

function parseStatus(value: unknown): FocusItemStatus | null {
    return value === "open" || value === "done" ? value : null;
}

function readParamId(value: string | string[] | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }

    return value;
}

async function resolveSiteSnapshot(
    siteId: string | null,
    orgId: string
): Promise<{ site_id: string | null; site_name_snapshot: string | null }> {
    if (!siteId) {
        return { site_id: null, site_name_snapshot: null };
    }

    const { data, error } = await supabaseAdmin
        .from("sites")
        .select("id, name, deleted_at")
        .eq("id", siteId)
        .eq("org_id", orgId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data || data.deleted_at) {
        throw new Error("SITE_NOT_FOUND");
    }

    return {
        site_id: data.id,
        site_name_snapshot: typeof data.name === "string" ? data.name : null,
    };
}

async function getAuthorizedFocusItem(
    focusItemId: string,
    req: AuthenticatedRequest
): Promise<FocusItemAuthorizationRow | null> {
    const { data, error } = await supabaseAdmin
        .from("focus_items")
        .select("id, org_id, scope, created_by")
        .eq("id", focusItemId)
        .eq("org_id", resolveOrgId(req.orgId))
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        return null;
    }

    if (data.scope === "personal" && data.created_by !== req.userId) {
        throw new Error("FORBIDDEN");
    }

    return data as FocusItemAuthorizationRow;
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const scope = parseScope(req.query.scope);
        const horizon = parseHorizon(req.query.horizon);
        const status = parseStatus(req.query.status) || "open";

        let query = supabaseAdmin
            .from("focus_items")
            .select(FOCUS_ITEM_SELECT)
            .eq("org_id", orgId)
            .eq("status", status)
            .order("created_at", { ascending: false });

        if (scope) {
            query = query.eq("scope", scope);
        }

        if (horizon) {
            query = query.eq("horizon", horizon);
        }

        const { data, error } = await query;

        if (error) {
            throw error;
        }

        const filtered = (data || []).filter((item: any) => {
            if (item.scope === "org") {
                return scope ? scope === "org" : true;
            }

            if (item.created_by !== req.userId) {
                return false;
            }

            return scope ? scope === "personal" : true;
        });

        res.json(filtered);
    } catch (err: any) {
        console.error("[FOCUS_ITEMS] list failed:", err);
        res.status(500).json({ error: "focus items の取得に失敗しました" });
    }
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const title = normalizeText(req.body?.title);
        const scope = parseScope(req.body?.scope);
        const horizon = parseHorizon(req.body?.horizon);
        const note = normalizeText(req.body?.note);
        const siteId = normalizeText(req.body?.site_id);

        if (!title) {
            res.status(400).json({ error: "title is required" });
            return;
        }

        if (!scope) {
            res.status(400).json({ error: "scope must be personal or org" });
            return;
        }

        if (!horizon) {
            res.status(400).json({ error: "horizon must be today, week, or later" });
            return;
        }

        const siteSnapshot = await resolveSiteSnapshot(siteId, orgId);

        const { data, error } = await supabaseAdmin
            .from("focus_items")
            .insert({
                org_id: orgId,
                scope,
                horizon,
                status: "open",
                title,
                note,
                ...siteSnapshot,
                created_by: req.userId,
            })
            .select(FOCUS_ITEM_SELECT)
            .single();

        if (error) {
            throw error;
        }

        res.status(201).json(data);
    } catch (err: any) {
        console.error("[FOCUS_ITEMS] create failed:", err);
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "指定した現場が見つかりません" });
            return;
        }
        res.status(500).json({ error: "focus item の作成に失敗しました" });
    }
});

router.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const focusItemId = readParamId(req.params.id);
        if (!focusItemId) {
            res.status(400).json({ error: "focus item id is required" });
            return;
        }

        const authorized = await getAuthorizedFocusItem(focusItemId, req);
        if (!authorized) {
            res.status(404).json({ error: "focus item not found" });
            return;
        }

        const title = normalizeText(req.body?.title);
        const scope = parseScope(req.body?.scope);
        const horizon = parseHorizon(req.body?.horizon);
        const status = parseStatus(req.body?.status);
        const note = normalizeText(req.body?.note);
        const siteId = normalizeText(req.body?.site_id);

        if (!title) {
            res.status(400).json({ error: "title is required" });
            return;
        }

        if (!scope) {
            res.status(400).json({ error: "scope must be personal or org" });
            return;
        }

        if (!horizon) {
            res.status(400).json({ error: "horizon must be today, week, or later" });
            return;
        }

        if (!status) {
            res.status(400).json({ error: "status must be open or done" });
            return;
        }

        const siteSnapshot = await resolveSiteSnapshot(siteId, authorized.org_id);
        const completionPatch =
            status === "done"
                ? { completed_at: new Date().toISOString(), completed_by: req.userId }
                : { completed_at: null, completed_by: null };

        const { data, error } = await supabaseAdmin
            .from("focus_items")
            .update({
                title,
                scope,
                horizon,
                status,
                note,
                ...siteSnapshot,
                ...completionPatch,
                updated_at: new Date().toISOString(),
            })
            .eq("id", authorized.id)
            .eq("org_id", authorized.org_id)
            .select(FOCUS_ITEM_SELECT)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            res.status(404).json({ error: "focus item not found" });
            return;
        }

        res.json(data);
    } catch (err: any) {
        console.error("[FOCUS_ITEMS] update failed:", err);
        if (err instanceof Error && err.message === "FORBIDDEN") {
            res.status(403).json({ error: "personal focus item は作成者のみ更新できます" });
            return;
        }
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "指定した現場が見つかりません" });
            return;
        }
        res.status(500).json({ error: "focus item の更新に失敗しました" });
    }
});

router.post("/:id/complete", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const focusItemId = readParamId(req.params.id);
        if (!focusItemId) {
            res.status(400).json({ error: "focus item id is required" });
            return;
        }

        const authorized = await getAuthorizedFocusItem(focusItemId, req);
        if (!authorized) {
            res.status(404).json({ error: "focus item not found" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("focus_items")
            .update({
                status: "done",
                completed_at: new Date().toISOString(),
                completed_by: req.userId,
                updated_at: new Date().toISOString(),
            })
            .eq("id", authorized.id)
            .eq("org_id", authorized.org_id)
            .select(FOCUS_ITEM_SELECT)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            res.status(404).json({ error: "focus item not found" });
            return;
        }

        res.json(data);
    } catch (err: any) {
        console.error("[FOCUS_ITEMS] complete failed:", err);
        if (err instanceof Error && err.message === "FORBIDDEN") {
            res.status(403).json({ error: "personal focus item は作成者のみ更新できます" });
            return;
        }
        res.status(500).json({ error: "focus item の完了に失敗しました" });
    }
});

router.post("/:id/reopen", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const focusItemId = readParamId(req.params.id);
        if (!focusItemId) {
            res.status(400).json({ error: "focus item id is required" });
            return;
        }

        const authorized = await getAuthorizedFocusItem(focusItemId, req);
        if (!authorized) {
            res.status(404).json({ error: "focus item not found" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("focus_items")
            .update({
                status: "open",
                completed_at: null,
                completed_by: null,
                updated_at: new Date().toISOString(),
            })
            .eq("id", authorized.id)
            .eq("org_id", authorized.org_id)
            .select(FOCUS_ITEM_SELECT)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            res.status(404).json({ error: "focus item not found" });
            return;
        }

        res.json(data);
    } catch (err: any) {
        console.error("[FOCUS_ITEMS] reopen failed:", err);
        if (err instanceof Error && err.message === "FORBIDDEN") {
            res.status(403).json({ error: "personal focus item は作成者のみ更新できます" });
            return;
        }
        res.status(500).json({ error: "focus item の再開に失敗しました" });
    }
});

export default router;
