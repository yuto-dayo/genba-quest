import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveOrgId } from "../lib/org";
import {
    assertActiveClientForOrg,
    assertRestorableClientForOrg,
    listClientsForOrg,
} from "../services/ClientDirectoryService";
import { extractClientFromBusinessCard, getBusinessCardDefaultProvider } from "../services/BusinessCardOcrService";
import { composeStructuredAddress, normalizePostalCode } from "../services/clientAddress";
import { extractSiteDraftFromText } from "../services/SiteDraftTextService";

const router = Router();
const SITE_SELECT = `
    *,
    client:clients(id, name)
`;
const SITE_SCHEDULE_MODES = ["continuous", "weekdays", "custom"] as const;

type SiteScheduleMode = typeof SITE_SCHEDULE_MODES[number];

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeSiteScheduleMode(value: unknown): SiteScheduleMode | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim().toLowerCase();
    return SITE_SCHEDULE_MODES.includes(trimmed as SiteScheduleMode)
        ? trimmed as SiteScheduleMode
        : null;
}

function isIsoDateString(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }

    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function normalizeDateArray(value: unknown): string[] | null {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        return null;
    }

    const normalized = value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => isIsoDateString(item));

    return Array.from(new Set(normalized)).sort((a, b) => a.localeCompare(b));
}

function normalizeWeekdayArray(value: unknown): number[] | null {
    if (value === undefined) {
        return [];
    }

    if (!Array.isArray(value)) {
        return null;
    }

    const normalized = value
        .map((item) => typeof item === "number" ? item : Number(item))
        .filter((item) => Number.isInteger(item) && item >= 0 && item <= 6);

    return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function readParamId(value: string | string[] | undefined): string | null {
    if (typeof value !== "string") {
        return null;
    }

    return value;
}

function buildClientPayload(body: Record<string, unknown>) {
    const postalCode = normalizePostalCode(body.postal_code);
    const prefecture = normalizeText(body.prefecture);
    const city = normalizeText(body.city);
    const addressLine1 = normalizeText(body.address_line1);
    const addressLine2 = normalizeText(body.address_line2);
    const billingPostalCode = normalizePostalCode(body.billing_postal_code);
    const billingPrefecture = normalizeText(body.billing_prefecture);
    const billingCity = normalizeText(body.billing_city);
    const billingAddressLine1 = normalizeText(body.billing_address_line1);
    const billingAddressLine2 = normalizeText(body.billing_address_line2);

    return {
        name: normalizeText(body.name),
        department: normalizeText(body.department),
        contact_person: normalizeText(body.contact_person),
        email: normalizeText(body.email),
        phone: normalizeText(body.phone),
        postal_code: postalCode,
        prefecture,
        city,
        address_line1: addressLine1,
        address_line2: addressLine2,
        address:
            composeStructuredAddress({
                postal_code: postalCode,
                prefecture,
                city,
                address_line1: addressLine1,
                address_line2: addressLine2,
            }) || normalizeText(body.address),
        billing_name: normalizeText(body.billing_name),
        billing_postal_code: billingPostalCode,
        billing_prefecture: billingPrefecture,
        billing_city: billingCity,
        billing_address_line1: billingAddressLine1,
        billing_address_line2: billingAddressLine2,
        billing_address:
            composeStructuredAddress({
                postal_code: billingPostalCode,
                prefecture: billingPrefecture,
                city: billingCity,
                address_line1: billingAddressLine1,
                address_line2: billingAddressLine2,
            }) || normalizeText(body.billing_address),
        payment_terms: normalizeText(body.payment_terms),
        invoice_notes_default: normalizeText(body.invoice_notes_default),
    };
}

function isMissingClientColumnError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return [
        "department",
        "postal_code",
        "prefecture",
        "city",
        "address_line1",
        "address_line2",
        "billing_postal_code",
        "billing_prefecture",
        "billing_city",
        "billing_address_line1",
        "billing_address_line2",
    ].some((column) =>
        message.includes(`Could not find the '${column}' column`) ||
        message.includes(`column "${column}"`)
    );
}

function stripStructuredClientColumns(payload: Record<string, unknown>): Record<string, unknown> {
    const {
        department: _department,
        postal_code: _postalCode,
        prefecture: _prefecture,
        city: _city,
        address_line1: _addressLine1,
        address_line2: _addressLine2,
        billing_postal_code: _billingPostalCode,
        billing_prefecture: _billingPrefecture,
        billing_city: _billingCity,
        billing_address_line1: _billingAddressLine1,
        billing_address_line2: _billingAddressLine2,
        ...legacyPayload
    } = payload;

    return legacyPayload;
}

async function insertClientWithCompatibility(payload: Record<string, unknown>) {
    let writePayload = payload;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await supabaseAdmin
            .from("clients")
            .insert(writePayload)
            .select("*")
            .single();

        if (!error) {
            return data;
        }

        if (attempt === 0 && isMissingClientColumnError(error)) {
            writePayload = stripStructuredClientColumns(writePayload);
            continue;
        }

        throw error;
    }

    throw new Error("CLIENT_INSERT_FAILED");
}

async function updateClientWithCompatibility(
    clientId: string,
    orgId: string,
    payload: Record<string, unknown>
) {
    let writePayload = payload;

    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { data, error } = await supabaseAdmin
            .from("clients")
            .update(writePayload)
            .eq("id", clientId)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .select("*")
            .single();

        if (!error) {
            return data;
        }

        if (attempt === 0 && isMissingClientColumnError(error)) {
            writePayload = stripStructuredClientColumns(writePayload);
            continue;
        }

        throw error;
    }

    throw new Error("CLIENT_UPDATE_FAILED");
}

function isMissingSiteLineItemsTableError(error: unknown): boolean {
    if (!error || typeof error !== "object") {
        return false;
    }

    const code = "code" in error ? error.code : undefined;
    const message = "message" in error ? error.message : undefined;

    return (
        code === "PGRST205" &&
        typeof message === "string" &&
        message.includes("public.site_line_items")
    );
}

function sendSiteLineItemsMigrationError(res: Response) {
    res.status(503).json({
        error:
            "site_line_items テーブルが未適用です。Supabase に `server/sql/032_site_line_items.sql` を適用してください。",
    });
}

async function assertActiveSiteForOrg(siteId: string, orgId: string) {
    const { data, error } = await supabaseAdmin
        .from("sites")
        .select("id, org_id, name")
        .eq("id", siteId)
        .eq("org_id", orgId)
        .is("deleted_at", null)
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        throw new Error("SITE_NOT_FOUND");
    }

    return data;
}

// 現場一覧取得
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const { data, error } = await supabaseAdmin
            .from("sites")
            .select(SITE_SELECT)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// メンバー一覧取得（担当者選択用）
router.get("/members", async (_req: AuthenticatedRequest, res: Response) => {
    try {
        const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("id, full_name, username, avatar_url")
            .order("full_name");

        if (error) throw error;
        res.json(data || []);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 顧客一覧取得（フォーム用）
router.get("/clients", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const normalizedStatus =
            req.query.status === "deleted" || req.query.status === "all"
                ? req.query.status
                : "active";
        const data = await listClientsForOrg(resolveOrgId(req.orgId), normalizedStatus);
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/clients/scan-business-card", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const body = req.body as Record<string, unknown>;
        const fileBase64 = normalizeText(body.file_base64);
        const mimeType = normalizeText(body.mime_type);
        const provider = normalizeText(body.provider) as "gemini" | "openai" | "anthropic" | null;

        if (!fileBase64 || !mimeType) {
            res.status(400).json({ error: "file_base64 and mime_type are required" });
            return;
        }

        if (!mimeType.startsWith("image/")) {
            res.status(400).json({ error: "mime_type must be an image" });
            return;
        }

        const extracted = await extractClientFromBusinessCard(
            fileBase64,
            mimeType,
            provider || getBusinessCardDefaultProvider()
        );

        res.json(extracted);
    } catch (err: any) {
        if (err instanceof Error && err.message === "BUSINESS_CARD_PARSE_FAILED") {
            res.status(422).json({ error: "名刺の読み取り結果を解析できませんでした" });
            return;
        }

        console.error("[CLIENTS] business card scan error:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
    }
});

router.post("/clients", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const payload = buildClientPayload(req.body as Record<string, unknown>);

        if (!payload.name) {
            res.status(400).json({ error: "name is required" });
            return;
        }

        const data = await insertClientWithCompatibility({
            ...payload,
            org_id: resolveOrgId(req.orgId),
            billing_name: payload.billing_name || payload.name,
        });
        res.status(201).json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.put("/clients/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const payload = buildClientPayload(req.body as Record<string, unknown>);

        if (!payload.name) {
            res.status(400).json({ error: "name is required" });
            return;
        }

        const clientId = readParamId(req.params.id);

        if (!clientId) {
            res.status(400).json({ error: "client id is required" });
            return;
        }

        const data = await updateClientWithCompatibility(
            clientId,
            resolveOrgId(req.orgId),
            {
                ...payload,
                billing_name: payload.billing_name || payload.name,
            }
        );
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.delete("/clients/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const reason = normalizeText((req.body as Record<string, unknown>)?.reason);

        if (!reason) {
            res.status(400).json({ error: "reason is required" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("clients")
            .update({
                deleted_at: new Date().toISOString(),
                deleted_by: req.userId!,
                deletion_reason: reason,
            })
            .eq("id", req.params.id)
            .eq("org_id", resolveOrgId(req.orgId))
            .is("deleted_at", null)
            .select("*")
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/clients/:id/restore", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const clientId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

        await assertRestorableClientForOrg(clientId, resolveOrgId(req.orgId));

        const { data, error } = await supabaseAdmin
            .from("clients")
            .update({
                deleted_at: null,
                deleted_by: null,
                deletion_reason: null,
            })
            .eq("id", clientId)
            .eq("org_id", resolveOrgId(req.orgId))
            .not("deleted_at", "is", null)
            .select("*")
            .single();

        if (error) throw error;
        res.json(data);
    } catch (err: any) {
        if (err instanceof Error && err.message === "CLIENT_NOT_RESTORABLE") {
            res.status(404).json({ error: "Client not found" });
            return;
        }

        res.status(500).json({ error: "Internal server error" });
    }
});

router.post("/draft-from-text", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const body = req.body as Record<string, unknown>;
        const text = normalizeText(body.text);

        if (!text) {
            res.status(400).json({ error: "text is required" });
            return;
        }

        const draft = extractSiteDraftFromText(text);

        if (draft.detected_fields === 0) {
            res.status(422).json({ error: "現場情報を抽出できませんでした" });
            return;
        }

        res.json(draft);
    } catch (err: any) {
        console.error("[SITES] draft-from-text error:", err);
        res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
    }
});

// 現場詳細取得
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const { data, error } = await supabaseAdmin
            .from("sites")
            .select(SITE_SELECT)
            .eq("id", req.params.id)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場に紐づくドキュメント一覧
router.get("/:id/documents", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }
        await assertActiveSiteForOrg(siteId, orgId);

        const { data, error } = await supabaseAdmin
            .from("documents")
            .select("id, doc_type, original_filename, mime_type, file_size, storage_path, drive_file_url, created_at")
            .eq("site_id", siteId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        // storage_path がある場合は署名付きURLを生成
        const docsWithUrls = await Promise.all(
            (data || []).map(async (doc) => {
                if (doc.storage_path) {
                    const { data: urlData } = await supabaseAdmin.storage
                        .from("genba-documents")
                        .createSignedUrl(doc.storage_path, 3600); // 1時間有効
                    return { ...doc, signed_url: urlData?.signedUrl || null };
                }
                return { ...doc, signed_url: null };
            })
        );

        res.json(docsWithUrls);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場にドキュメントをアップロード
router.post("/:id/documents", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }
        await assertActiveSiteForOrg(siteId, orgId);

        const { file_base64, mime_type, original_filename } = req.body;

        if (!file_base64 || !mime_type) {
            res.status(400).json({ error: "file_base64 and mime_type are required" });
            return;
        }

        const fileBuffer = Buffer.from(file_base64, "base64");
        const fileSize = fileBuffer.length;

        const crypto = await import("crypto");
        const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

        const timestamp = Date.now();
        const ext = original_filename?.split(".").pop() || "jpg";
        const storagePath = `${req.userId!}/${timestamp}.${ext}`;

        const { error: uploadError } = await supabaseAdmin.storage
            .from("genba-documents")
            .upload(storagePath, fileBuffer, {
                contentType: mime_type,
                upsert: false,
            });

        if (uploadError) throw uploadError;

        const { data, error } = await supabaseAdmin
            .from("documents")
            .insert({
                doc_type: "other",
                storage_path: storagePath,
                original_filename,
                mime_type,
                file_size: fileSize,
                sha256,
                uploaded_by: req.userId!,
                site_id: siteId,
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        console.error("Site document upload error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場登録
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const {
            name,
            address,
            area_sqm,
            work_types,
            estimated_hours,
            revenue,
            client_id,
            description,
            cautions,
            assigned_users,
            started_at,
            expected_completion_at,
            schedule_mode,
            working_weekdays,
            custom_work_dates,
        } = req.body;
        const normalizedScheduleMode = normalizeSiteScheduleMode(schedule_mode) || "continuous";
        const normalizedWorkingWeekdays = normalizeWeekdayArray(working_weekdays);
        const normalizedCustomWorkDates = normalizeDateArray(custom_work_dates);

        if (working_weekdays !== undefined && normalizedWorkingWeekdays === null) {
            res.status(400).json({ error: "working_weekdays must be an array of integers between 0 and 6" });
            return;
        }

        if (custom_work_dates !== undefined && normalizedCustomWorkDates === null) {
            res.status(400).json({ error: "custom_work_dates must be an array of YYYY-MM-DD strings" });
            return;
        }

        if (schedule_mode !== undefined && schedule_mode !== null && !normalizeSiteScheduleMode(schedule_mode)) {
            res.status(400).json({ error: "schedule_mode must be one of continuous, weekdays, custom" });
            return;
        }

        if (
            typeof started_at === "string" &&
            typeof expected_completion_at === "string" &&
            started_at &&
            expected_completion_at &&
            started_at > expected_completion_at
        ) {
            res.status(400).json({ error: "started_at must be earlier than or equal to expected_completion_at" });
            return;
        }

        if (normalizedScheduleMode === "weekdays" && (!normalizedWorkingWeekdays || normalizedWorkingWeekdays.length === 0)) {
            res.status(400).json({ error: "working_weekdays is required when schedule_mode is weekdays" });
            return;
        }

        if (normalizedScheduleMode === "custom" && (!normalizedCustomWorkDates || normalizedCustomWorkDates.length === 0)) {
            res.status(400).json({ error: "custom_work_dates is required when schedule_mode is custom" });
            return;
        }

        if (client_id) {
            try {
                await assertActiveClientForOrg(client_id, orgId);
            } catch {
                res.status(400).json({ error: "client_id is invalid or unavailable" });
                return;
            }
        }

        const { data, error } = await supabaseAdmin
            .from("sites")
            .insert({
                org_id: orgId,
                name,
                address,
                area_sqm,
                work_types,
                estimated_hours,
                revenue,
                client_id,
                description,
                cautions,
                assigned_users,
                started_at,
                expected_completion_at,
                schedule_mode: normalizedScheduleMode,
                working_weekdays: normalizedScheduleMode === "weekdays" ? normalizedWorkingWeekdays : null,
                custom_work_dates: normalizedScheduleMode === "custom" ? normalizedCustomWorkDates : null,
                status: "active",
            })
            .select()
            .single();

        if (error) throw error;
        res.status(201).json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場更新
router.put("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const {
            name,
            address,
            area_sqm,
            work_types,
            estimated_hours,
            actual_hours,
            revenue,
            status,
            description,
            cautions,
            assigned_users,
            started_at,
            expected_completion_at,
            client_id,
            schedule_mode,
            working_weekdays,
            custom_work_dates,
        } = req.body;
        const normalizedScheduleMode = normalizeSiteScheduleMode(schedule_mode) || "continuous";
        const normalizedWorkingWeekdays = normalizeWeekdayArray(working_weekdays);
        const normalizedCustomWorkDates = normalizeDateArray(custom_work_dates);

        if (working_weekdays !== undefined && normalizedWorkingWeekdays === null) {
            res.status(400).json({ error: "working_weekdays must be an array of integers between 0 and 6" });
            return;
        }

        if (custom_work_dates !== undefined && normalizedCustomWorkDates === null) {
            res.status(400).json({ error: "custom_work_dates must be an array of YYYY-MM-DD strings" });
            return;
        }

        if (schedule_mode !== undefined && schedule_mode !== null && !normalizeSiteScheduleMode(schedule_mode)) {
            res.status(400).json({ error: "schedule_mode must be one of continuous, weekdays, custom" });
            return;
        }

        if (
            typeof started_at === "string" &&
            typeof expected_completion_at === "string" &&
            started_at &&
            expected_completion_at &&
            started_at > expected_completion_at
        ) {
            res.status(400).json({ error: "started_at must be earlier than or equal to expected_completion_at" });
            return;
        }

        if (normalizedScheduleMode === "weekdays" && (!normalizedWorkingWeekdays || normalizedWorkingWeekdays.length === 0)) {
            res.status(400).json({ error: "working_weekdays is required when schedule_mode is weekdays" });
            return;
        }

        if (normalizedScheduleMode === "custom" && (!normalizedCustomWorkDates || normalizedCustomWorkDates.length === 0)) {
            res.status(400).json({ error: "custom_work_dates is required when schedule_mode is custom" });
            return;
        }

        if (client_id) {
            try {
                await assertActiveClientForOrg(client_id, orgId);
            } catch {
                res.status(400).json({ error: "client_id is invalid or unavailable" });
                return;
            }
        }

        const { data, error } = await supabaseAdmin
            .from("sites")
            .update({
                name,
                address,
                area_sqm,
                work_types,
                estimated_hours,
                actual_hours,
                revenue,
                status,
                description,
                cautions,
                client_id,
                assigned_users,
                started_at,
                expected_completion_at,
                schedule_mode: normalizedScheduleMode,
                working_weekdays: normalizedScheduleMode === "weekdays" ? normalizedWorkingWeekdays : null,
                custom_work_dates: normalizedScheduleMode === "custom" ? normalizedCustomWorkDates : null,
            })
            .eq("id", req.params.id)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: err instanceof Error ? err.message : "Internal server error" });
    }
});

// 現場削除（論理削除）
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const { reason } = req.body;

        if (!reason || !reason.trim()) {
            res.status(400).json({ error: "削除理由は必須です" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("sites")
            .update({
                status: "deleted",
                deleted_at: new Date().toISOString(),
                deleted_by: req.userId!,
                deletion_reason: reason.trim(),
            })
            .eq("id", req.params.id)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場の工事項目一覧取得
router.get("/:id/line-items", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }
        await assertActiveSiteForOrg(siteId, orgId);

        const { data, error } = await supabaseAdmin
            .from("site_line_items")
            .select("*")
            .eq("site_id", siteId)
            .order("sort_order")
            .order("created_at");

        if (error) throw error;
        res.json(data || []);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        if (isMissingSiteLineItemsTableError(err)) {
            console.error("Site line items fetch error: missing migration 032_site_line_items.sql", err);
            sendSiteLineItemsMigrationError(res);
            return;
        }

        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場の工事項目一括保存（upsert + 不要分削除）
router.put("/:id/line-items", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const { items } = req.body as {
            items: Array<{
                id?: string;
                item_name: string;
                quantity?: number | null;
                unit_name?: string;
                unit_price?: number | null;
                sort_order?: number;
            }>;
        };

        if (!Array.isArray(items)) {
            res.status(400).json({ error: "items array is required" });
            return;
        }

        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }
        const userId = req.userId!;
        const now = new Date().toISOString();
        await assertActiveSiteForOrg(siteId, orgId);

        // 既存のIDを取得
        const { data: existing } = await supabaseAdmin
            .from("site_line_items")
            .select("id")
            .eq("site_id", siteId);

        const existingIds = new Set((existing || []).map((e) => e.id));
        const incomingIds = new Set(items.filter((i) => i.id).map((i) => i.id));

        // 削除: 既存にあるが送信されなかったもの
        const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));
        if (toDelete.length > 0) {
            await supabaseAdmin
                .from("site_line_items")
                .delete()
                .in("id", toDelete);
        }

        // Upsert: 更新 + 新規
        const upsertRows = items.map((item, index) => ({
            ...(item.id && existingIds.has(item.id) ? { id: item.id } : {}),
            site_id: siteId,
            item_name: item.item_name,
            quantity: item.quantity ?? null,
            unit_name: item.unit_name || null,
            unit_price: item.unit_price ?? null,
            sort_order: item.sort_order ?? index,
            ...(item.id && existingIds.has(item.id)
                ? { updated_by: userId, updated_at: now }
                : { created_by: userId, created_at: now, updated_by: userId, updated_at: now }),
        }));

        if (upsertRows.length > 0) {
            const { error } = await supabaseAdmin
                .from("site_line_items")
                .upsert(upsertRows, { onConflict: "id" });
            if (error) throw error;
        }

        // 結果を返す
        const { data, error } = await supabaseAdmin
            .from("site_line_items")
            .select("*")
            .eq("site_id", siteId)
            .order("sort_order")
            .order("created_at");

        if (error) throw error;
        res.json(data || []);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        if (isMissingSiteLineItemsTableError(err)) {
            console.error("Site line items save error: missing migration 032_site_line_items.sql", err);
            sendSiteLineItemsMigrationError(res);
            return;
        }

        console.error("Site line items save error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場完了処理
router.post("/:id/complete", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const { data, error } = await supabaseAdmin
            .from("sites")
            .update({
                status: "completed",
                completed_at: new Date().toISOString(),
            })
            .eq("id", req.params.id)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .select()
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        res.json(data);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
