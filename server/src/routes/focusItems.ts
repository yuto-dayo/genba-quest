import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { resolveOrgId } from "../lib/org";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

type FocusItemScope = "personal" | "org";
type FocusItemHorizon = "today" | "week" | "later";
type FocusItemStatus = "open" | "done";
type FocusItemResolutionKind =
    | "completed_as_planned"
    | "completed_with_change"
    | "not_completed";

interface FocusItemAuthorizationRow {
    id: string;
    org_id: string;
    scope: FocusItemScope;
    created_by: string;
    status: FocusItemStatus;
    title: string;
    note: string | null;
    horizon: FocusItemHorizon;
    site_id: string | null;
    resolution_kind: FocusItemResolutionKind | null;
    resolution_note: string | null;
    resolved_at: string | null;
    resolved_by: string | null;
    completed_at: string | null;
    completed_by: string | null;
    focus_date: string | null;
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
    resolution_kind,
    resolution_note,
    resolved_at,
    resolved_by,
    focus_date,
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

function parseResolutionKind(value: unknown): FocusItemResolutionKind | null {
    return value === "completed_as_planned"
        || value === "completed_with_change"
        || value === "not_completed"
        ? value
        : null;
}

function readParamId(value: string | string[] | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }

    return value;
}

function readQueryValue(value: unknown): string | null {
    if (typeof value === "string") {
        return value;
    }
    if (Array.isArray(value) && typeof value[0] === "string") {
        return value[0];
    }
    return null;
}

function parseDateOnly(value: unknown): string | null {
    const text = readQueryValue(value) ?? (typeof value === "string" ? value : null);
    if (!text) {
        return null;
    }
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function parseIsoTimestamp(value: unknown): string | null {
    const text = readQueryValue(value) ?? (typeof value === "string" ? value : null);
    if (!text) {
        return null;
    }

    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return new Date(parsed).toISOString();
}

function parseBooleanQuery(value: unknown): boolean | null {
    const text = readQueryValue(value);
    if (text === null) {
        return null;
    }
    if (text === "true") {
        return true;
    }
    if (text === "false") {
        return false;
    }
    return null;
}

function getServerDateKey(baseDate: Date = new Date()): string {
    const year = baseDate.getFullYear();
    const month = String(baseDate.getMonth() + 1).padStart(2, "0");
    const day = String(baseDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
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
        .select(
            "id, org_id, scope, created_by, status, title, note, horizon, site_id, resolution_kind, resolution_note, resolved_at, resolved_by, completed_at, completed_by, focus_date"
        )
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

async function selectFocusItemForResponse(
    id: string,
    orgId: string
): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabaseAdmin
        .from("focus_items")
        .select(FOCUS_ITEM_SELECT)
        .eq("id", id)
        .eq("org_id", orgId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data as Record<string, unknown> | null;
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const scope = parseScope(req.query.scope);
        const horizon = parseHorizon(req.query.horizon);
        const status = parseStatus(req.query.status) || "open";
        const includeLegacyDoneRaw = parseBooleanQuery(req.query.include_legacy_done);
        const includeLegacyDone = includeLegacyDoneRaw ?? false;

        if (includeLegacyDoneRaw === null && readQueryValue(req.query.include_legacy_done) !== null) {
            res.status(400).json({ error: "include_legacy_done must be true or false" });
            return;
        }

        const focusDateFromRaw = readQueryValue(req.query.focus_date_from);
        const focusDateToRaw = readQueryValue(req.query.focus_date_to);
        const resolvedFromRaw = readQueryValue(req.query.resolved_from);
        const resolvedToRaw = readQueryValue(req.query.resolved_to);

        const focusDateFrom = focusDateFromRaw ? parseDateOnly(focusDateFromRaw) : null;
        const focusDateTo = focusDateToRaw ? parseDateOnly(focusDateToRaw) : null;
        const resolvedFrom = resolvedFromRaw ? parseIsoTimestamp(resolvedFromRaw) : null;
        const resolvedTo = resolvedToRaw ? parseIsoTimestamp(resolvedToRaw) : null;

        if (focusDateFromRaw && !focusDateFrom) {
            res.status(400).json({ error: "focus_date_from must be YYYY-MM-DD" });
            return;
        }
        if (focusDateToRaw && !focusDateTo) {
            res.status(400).json({ error: "focus_date_to must be YYYY-MM-DD" });
            return;
        }
        if (resolvedFromRaw && !resolvedFrom) {
            res.status(400).json({ error: "resolved_from must be ISO timestamp" });
            return;
        }
        if (resolvedToRaw && !resolvedTo) {
            res.status(400).json({ error: "resolved_to must be ISO timestamp" });
            return;
        }

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

        if (focusDateFrom) {
            query = query.gte("focus_date", focusDateFrom);
        }

        if (focusDateTo) {
            query = query.lte("focus_date", focusDateTo);
        }

        if (resolvedFrom) {
            query = query.gte("resolved_at", resolvedFrom);
        }

        if (resolvedTo) {
            query = query.lt("resolved_at", resolvedTo);
        }

        if (status === "done" && !includeLegacyDone) {
            query = query.not("resolution_kind", "is", null);
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
        const focusDateRaw = req.body?.focus_date;
        const focusDate = typeof focusDateRaw === "string" ? parseDateOnly(focusDateRaw) : null;

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

        if (focusDateRaw !== undefined && !focusDate) {
            res.status(400).json({ error: "focus_date must be YYYY-MM-DD" });
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
                focus_date: focusDate || getServerDateKey(),
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
        const focusDateRaw = req.body?.focus_date;
        const focusDate = typeof focusDateRaw === "string" ? parseDateOnly(focusDateRaw) : null;

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

        if (focusDateRaw !== undefined && !focusDate) {
            res.status(400).json({ error: "focus_date must be YYYY-MM-DD" });
            return;
        }

        const siteSnapshot = await resolveSiteSnapshot(siteId, authorized.org_id);
        const nowIso = new Date().toISOString();
        const completionPatch =
            status === "done"
                ? {
                      completed_at: authorized.completed_at || nowIso,
                      completed_by: authorized.completed_by || req.userId,
                      resolved_at: authorized.resolved_at || nowIso,
                      resolved_by: authorized.resolved_by || req.userId,
                  }
                : {
                      completed_at: null,
                      completed_by: null,
                      resolved_at: null,
                      resolved_by: null,
                      resolution_kind: null,
                      resolution_note: null,
                  };

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
                focus_date: focusDate || authorized.focus_date || getServerDateKey(),
                updated_at: nowIso,
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

        if (authorized.status === "done") {
            const current = await selectFocusItemForResponse(authorized.id, authorized.org_id);
            if (!current) {
                res.status(404).json({ error: "focus item not found" });
                return;
            }
            res.json(current);
            return;
        }

        const nowIso = new Date().toISOString();

        const { data, error } = await supabaseAdmin
            .from("focus_items")
            .update({
                status: "done",
                resolution_kind: "completed_as_planned",
                completed_at: nowIso,
                completed_by: req.userId,
                resolved_at: nowIso,
                resolved_by: req.userId,
                updated_at: nowIso,
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

router.post("/:id/resolve", async (req: AuthenticatedRequest, res: Response) => {
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

        const resolutionKind = parseResolutionKind(req.body?.resolution_kind);
        if (!resolutionKind) {
            res.status(400).json({ error: "Invalid resolution_kind" });
            return;
        }

        const hasResolutionNote = Object.prototype.hasOwnProperty.call(req.body ?? {}, "resolution_note");
        const rawResolutionNote = hasResolutionNote ? req.body?.resolution_note : undefined;

        let resolutionNotePatch: string | null | undefined;
        if (hasResolutionNote) {
            if (rawResolutionNote === null) {
                resolutionNotePatch = null;
            } else if (typeof rawResolutionNote === "string") {
                resolutionNotePatch = rawResolutionNote.trim().length > 0 ? rawResolutionNote.trim() : null;
            } else {
                res.status(400).json({ error: "resolution_note must be string or null" });
                return;
            }
        }

        const nowIso = new Date().toISOString();
        const patch: Record<string, unknown> = {
            status: "done",
            resolution_kind: resolutionKind,
            updated_at: nowIso,
        };

        if (authorized.status === "open") {
            patch.resolved_at = nowIso;
            patch.resolved_by = req.userId;
            patch.completed_at = nowIso;
            patch.completed_by = req.userId;
        } else {
            patch.resolved_at = authorized.resolved_at || nowIso;
            patch.resolved_by = authorized.resolved_by || req.userId;
            patch.completed_at = authorized.completed_at || (patch.resolved_at as string);
            patch.completed_by = authorized.completed_by || req.userId;
        }

        if (hasResolutionNote) {
            patch.resolution_note = resolutionNotePatch;
        }

        const { data, error } = await supabaseAdmin
            .from("focus_items")
            .update(patch)
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
        console.error("[FOCUS_ITEMS] resolve failed:", err);
        if (err instanceof Error && err.message === "FORBIDDEN") {
            res.status(403).json({ error: "personal focus item は作成者のみ更新できます" });
            return;
        }
        res.status(500).json({ error: "focus item の解決に失敗しました" });
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
                resolution_kind: null,
                resolution_note: null,
                resolved_at: null,
                resolved_by: null,
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
