import { Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveOrgId } from "../lib/org";
import { listOrgMembers } from "../services/OrgMemberDirectoryService";
import {
    assertActiveClientForOrg,
    assertRestorableClientForOrg,
    listClientsForOrg,
} from "../services/ClientDirectoryService";
import { extractClientFromBusinessCard, getBusinessCardDefaultProvider } from "../services/BusinessCardOcrService";
import {
    SiteCompleteWithCloseService,
    type CompleteSiteWithCloseHttpResponse,
} from "../services/SiteCompleteWithCloseService";
import { SiteCompletionService } from "../services/SiteCompletionService";
import {
    listSiteDrawings,
    uploadSiteDrawingVersion,
} from "../services/SiteDrawingService";
import { composeStructuredAddress, normalizePostalCode } from "../services/clientAddress";
import { extractSiteDraftFromText } from "../services/SiteDraftTextService";

const router = Router();
const SITE_SELECT = `
    *,
    client:clients(id, name, contact_person, phone)
`;
const SITE_SCHEDULE_MODES = ["continuous", "weekdays", "custom"] as const;
const SITE_COMPLETION_ERROR_STATUS_MAP: Record<string, number> = {
    USER_CONTEXT_REQUIRED: 403,
    ORG_MEMBERSHIP_REQUIRED: 403,
    RPC_MEMBERSHIP_REQUIRED: 403,
    ORG_ONBOARDING_REQUIRED: 403,
    ORG_SELECTION_REQUIRED: 403,
    ORG_ROLE_REQUIRED: 403,
    INVALID_EFFECTIVE_COMPLETED_AT: 400,
    INVALID_EFFECTIVE_REVERSED_AT: 400,
    INVALID_EXPECTED_SITE_UPDATED_AT: 400,
    CLIENT_REQUEST_ID_REQUIRED: 400,
    INVALID_RECOGNIZED_REVENUE: 400,
    INVALID_COMPLETE_WITH_CLOSE_REQUEST: 400,
    COMPLETE_WITH_CLOSE_REQUEST_SITE_MISMATCH: 400,
    DAY_LOGS_REQUIRED: 400,
    SITE_NOT_FOUND: 404,
    DAY_LOGS_NOT_FOUND: 404,
    SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME: 409,
    SITE_COMPLETION_ALREADY_ACTIVE: 409,
    SITE_COMPLETION_NOT_ACTIVE: 409,
    SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS: 409,
    SITE_COMPLETE_WITH_CLOSE_PAYLOAD_CONFLICT: 409,
    SITE_EXPECTED_VERSION_CONFLICT: 409,
    SITE_DAY_LOGS_CONFLICT: 409,
    SITE_COMPLETION_RPC_NOT_AVAILABLE: 503,
    SITE_COMPLETION_REVERSAL_RPC_NOT_AVAILABLE: 503,
    SITE_COMPLETE_WITH_CLOSE_RECOVERY_REQUIRED: 500,
};

type SiteScheduleMode = typeof SITE_SCHEDULE_MODES[number];

function sanitizeStoragePathSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

function isOrgScopedStoragePath(orgId: string, storagePath: string | null | undefined): storagePath is string {
    return typeof storagePath === "string" && storagePath.startsWith(`${orgId}/`);
}

function buildSiteDocumentStoragePath(input: {
    orgId: string;
    siteId: string;
    userId: string;
    timestamp: number;
    extension: string;
}): string {
    return [
        sanitizeStoragePathSegment(input.orgId),
        "sites",
        sanitizeStoragePathSegment(input.siteId),
        "documents",
        sanitizeStoragePathSegment(input.userId),
        `${input.timestamp}.${sanitizeStoragePathSegment(input.extension || "bin")}`,
    ].join("/");
}

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

function normalizeAssignedUsers(value: unknown): string[] | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const normalized = value
        .map((item) => (typeof item === "string" ? item.trim() : null))
        .filter((item): item is string => Boolean(item));

    if (normalized.length !== value.length) {
        return null;
    }

    return Array.from(new Set(normalized));
}

function normalizeOptionalTimestamp(value: unknown, errorCode: string): string | undefined {
    if (value === undefined || value === null || value === "") {
        return undefined;
    }

    if (typeof value !== "string") {
        throw new Error(errorCode);
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        throw new Error(errorCode);
    }

    return parsed.toISOString();
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

type SiteClosePhase =
    | "active"
    | "completed_unclosed"
    | "completed_close_pending"
    | "completed_close_rejected"
    | "completed_close_executed";

type SiteCloseProposalSummary = {
    id: string;
    status: string;
    required_approvals: number;
    created_at: string;
    executed_at?: string | null;
};

async function enrichSitesWithCloseState<T extends Record<string, unknown>>(
    orgId: string,
    rows: T[],
): Promise<Array<T & { close_phase: SiteClosePhase; active_close_proposal?: SiteCloseProposalSummary | null }>> {
    const siteIds = rows
        .map((row) => (typeof row.id === "string" ? row.id : ""))
        .filter((value) => value.length > 0);

    if (siteIds.length === 0) {
        return rows.map((row) => ({
            ...row,
            close_phase: (row.status === "completed" ? "completed_unclosed" : "active") as SiteClosePhase,
            active_close_proposal: null,
        }));
    }

    const [proposalResult, siteCloseResult] = await Promise.all([
        supabaseAdmin
            .from("proposals")
            .select("id, site_id, status, required_approvals, created_at, executed_at")
            .eq("org_id", orgId)
            .eq("type", "site.close.finalize")
            .in("site_id", siteIds)
            .in("status", ["draft", "pending", "approved", "rejected"])
            .order("created_at", { ascending: false }),
        supabaseAdmin
            .from("site_closes")
            .select("id, site_id, status, closed_at")
            .eq("org_id", orgId)
            .in("site_id", siteIds)
            .order("closed_at", { ascending: false }),
    ]);

    if (proposalResult.error) {
        throw proposalResult.error;
    }
    if (siteCloseResult.error) {
        throw siteCloseResult.error;
    }

    const activeProposalBySite = new Map<string, SiteCloseProposalSummary>();
    const rejectedProposalSites = new Set<string>();
    for (const row of proposalResult.data || []) {
        const siteId = typeof row.site_id === "string" ? row.site_id : "";
        if (!siteId) {
            continue;
        }
        if ((row.status === "draft" || row.status === "pending" || row.status === "approved") && !activeProposalBySite.has(siteId)) {
            activeProposalBySite.set(siteId, {
                id: String(row.id),
                status: String(row.status),
                required_approvals: Number(row.required_approvals ?? 0),
                created_at: String(row.created_at),
                executed_at: typeof row.executed_at === "string" ? row.executed_at : null,
            });
        }
        if (row.status === "rejected" && !activeProposalBySite.has(siteId)) {
            rejectedProposalSites.add(siteId);
        }
    }

    const finalizedCloseSites = new Set<string>();
    for (const row of siteCloseResult.data || []) {
        const siteId = typeof row.site_id === "string" ? row.site_id : "";
        if (!siteId || finalizedCloseSites.has(siteId)) {
            continue;
        }
        if (row.status === "finalized") {
            finalizedCloseSites.add(siteId);
        }
    }

    return rows.map((row) => {
        const siteId = typeof row.id === "string" ? row.id : "";
        const basePhase: SiteClosePhase = row.status === "completed" ? "completed_unclosed" : "active";
        if (basePhase === "active") {
            return {
                ...row,
                close_phase: "active" as const,
                active_close_proposal: null,
            };
        }

        const activeProposal = activeProposalBySite.get(siteId) ?? null;
        if (activeProposal) {
            return {
                ...row,
                close_phase: "completed_close_pending" as const,
                active_close_proposal: activeProposal,
            };
        }

        if (finalizedCloseSites.has(siteId)) {
            return {
                ...row,
                close_phase: "completed_close_executed" as const,
                active_close_proposal: null,
            };
        }

        if (rejectedProposalSites.has(siteId)) {
            return {
                ...row,
                close_phase: "completed_close_rejected" as const,
                active_close_proposal: null,
            };
        }

        return {
            ...row,
            close_phase: "completed_unclosed" as const,
            active_close_proposal: null,
        };
    });
}

async function resolveSiteRouteMembership(req: AuthenticatedRequest, minRole?: "admin" | "member") {
    return resolveActiveOrgMembership(req, minRole);
}

function createSiteCompleteWithCloseService(orgId: string): SiteCompleteWithCloseService {
    return new SiteCompleteWithCloseService(orgId);
}

function getActorUserId(req: AuthenticatedRequest): string {
    if (!req.userId) {
        throw new Error("USER_CONTEXT_REQUIRED");
    }

    return req.userId;
}

function buildHumanActor(req: AuthenticatedRequest) {
    return {
        type: "human" as const,
        id: getActorUserId(req),
        name: req.userName || "Unknown User",
    };
}

function handleSiteCompletionError(res: Response, error: unknown) {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (code in SITE_COMPLETION_ERROR_STATUS_MAP) {
        res.status(SITE_COMPLETION_ERROR_STATUS_MAP[code]).json({ error: code });
        return;
    }

    console.error("[SITE_COMPLETION] error:", error);
    res.status(500).json({ error: "Internal server error" });
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
        const enriched = await enrichSitesWithCloseState(orgId, (data || []) as Record<string, unknown>[]);
        res.json(enriched);
    } catch (err: any) {
        res.status(500).json({ error: "Internal server error" });
    }
});

// メンバー一覧取得（担当者選択用）
router.get("/members", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        const members = await listOrgMembers(membership.org_id);
        res.json(members);
    } catch (err: any) {
        const code = err instanceof Error ? err.message : "UNKNOWN_ERROR";

        if (code === "INVALID_ORG_ID") {
            res.status(400).json({ error: code });
            return;
        }

        if (code === "ORG_SELECTION_REQUIRED") {
            res.status(409).json({ error: code });
            return;
        }

        if (
            code === "USER_CONTEXT_REQUIRED" ||
            code === "ORG_ONBOARDING_REQUIRED" ||
            code === "ORG_MEMBERSHIP_REQUIRED" ||
            code === "RPC_MEMBERSHIP_REQUIRED" ||
            code === "ORG_ROLE_REQUIRED"
        ) {
            res.status(403).json({ error: code });
            return;
        }

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
        const [enriched] = await enrichSitesWithCloseState(orgId, [data as Record<string, unknown>]);
        res.json(enriched);
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
            .eq("org_id", orgId)
            .eq("site_id", siteId)
            .order("created_at", { ascending: false });

        if (error) throw error;

        // storage_path がある場合は署名付きURLを生成
        const docsWithUrls = await Promise.all(
            (data || []).map(async (doc) => {
                if (isOrgScopedStoragePath(orgId, doc.storage_path)) {
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
        const storagePath = buildSiteDocumentStoragePath({
            orgId,
            siteId,
            userId: req.userId!,
            timestamp,
            extension: ext,
        });

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
                org_id: orgId,
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

// 現場に紐づく図面一覧
router.get("/:id/drawings", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }

        await assertActiveSiteForOrg(siteId, orgId);
        const drawings = await listSiteDrawings({ orgId, siteId });
        res.json(drawings);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        console.error("Site drawings list error:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

// 現場図面を新規作成、または既存図面に新しい版を追加
router.post("/:id/drawings", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }

        if (!req.userId) {
            res.status(401).json({ error: "User context required" });
            return;
        }

        await assertActiveSiteForOrg(siteId, orgId);

        const {
            file_base64,
            mime_type,
            original_filename,
            title,
            drawing_no,
            discipline,
            change_note,
            drawing_id,
        } = req.body;

        if (!file_base64 || !mime_type) {
            res.status(400).json({ error: "file_base64 and mime_type are required" });
            return;
        }

        const drawing = await uploadSiteDrawingVersion({
            orgId,
            siteId,
            userId: req.userId,
            fileBase64: file_base64,
            mimeType: mime_type,
            originalFilename: original_filename,
            title,
            drawingNo: drawing_no,
            discipline,
            changeNote: change_note,
            drawingId: drawing_id,
        });

        res.status(201).json(drawing);
    } catch (err: any) {
        if (err instanceof Error && err.message === "SITE_NOT_FOUND") {
            res.status(404).json({ error: "Site not found" });
            return;
        }
        if (err instanceof Error && err.message === "DRAWING_NOT_FOUND") {
            res.status(404).json({ error: "Drawing not found" });
            return;
        }
        if (err instanceof Error && err.message === "DRAWING_FILE_EMPTY") {
            res.status(400).json({ error: "Drawing file is empty" });
            return;
        }
        console.error("Site drawing upload error:", err);
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

        if (
            normalizedScheduleMode === "continuous" &&
            !(typeof started_at === "string" && started_at) &&
            !(typeof expected_completion_at === "string" && expected_completion_at)
        ) {
            res.status(400).json({ error: "started_at or expected_completion_at is required when schedule_mode is continuous" });
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

        // status は active/tentative/in_progress のみ許可。
        // completed は POST /:id/complete(/complete-with-close)、deleted は DELETE 経由でしか遷移できない。
        if (status !== undefined && status !== null && !["active", "tentative", "in_progress"].includes(status)) {
            res.status(400).json({ error: "status must be one of active, tentative, in_progress (use /complete or DELETE for other transitions)" });
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

        if (
            normalizedScheduleMode === "continuous" &&
            !(typeof started_at === "string" && started_at) &&
            !(typeof expected_completion_at === "string" && expected_completion_at)
        ) {
            res.status(400).json({ error: "started_at or expected_completion_at is required when schedule_mode is continuous" });
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

// 現場担当のON/OFF（カレンダーの軽い担当切替用）
router.put("/:id/assigned-users", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const orgId = resolveOrgId(req.orgId);
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }

        const assignedUsers = normalizeAssignedUsers(req.body?.assigned_users);
        if (!assignedUsers) {
            res.status(400).json({ error: "assigned_users must be an array of member ids" });
            return;
        }

        const { data: currentSite, error: currentError } = await supabaseAdmin
            .from("sites")
            .select("id, assigned_users")
            .eq("id", siteId)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .maybeSingle();

        if (currentError) throw currentError;
        if (!currentSite) {
            res.status(404).json({ error: "Site not found" });
            return;
        }

        const previousAssignedUsers = Array.isArray(currentSite.assigned_users)
            ? currentSite.assigned_users.filter((item): item is string => typeof item === "string")
            : [];
        const removedUsers = previousAssignedUsers.filter((userId) => !assignedUsers.includes(userId));
        const addedUsers = assignedUsers.filter((userId) => !previousAssignedUsers.includes(userId));

        const { data, error } = await supabaseAdmin
            .from("sites")
            .update({ assigned_users: assignedUsers })
            .eq("id", siteId)
            .eq("org_id", orgId)
            .is("deleted_at", null)
            .select(SITE_SELECT)
            .maybeSingle();

        if (error) throw error;
        if (!data) {
            res.status(404).json({ error: "Site not found" });
            return;
        }

        if (addedUsers.length > 0) {
            const { error: profileAssignError } = await supabaseAdmin
                .from("profiles")
                .update({ current_site_id: siteId })
                .in("id", addedUsers);
            if (profileAssignError) throw profileAssignError;
        }

        if (removedUsers.length > 0) {
            const { error: profileUnassignError } = await supabaseAdmin
                .from("profiles")
                .update({ current_site_id: null })
                .in("id", removedUsers)
                .eq("current_site_id", siteId);
            if (profileUnassignError) throw profileUnassignError;
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
router.post("/:id/complete-with-close", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveSiteRouteMembership(req, "member");
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }

        const response: CompleteSiteWithCloseHttpResponse = await createSiteCompleteWithCloseService(
            membership.org_id,
        ).execute(
            siteId,
            ((req.body as Record<string, unknown> | undefined) || {}),
            buildHumanActor(req),
            membership.id,
        );

        const maybeSite = response.body.site;
        if (
            maybeSite &&
            typeof maybeSite === "object" &&
            !Array.isArray(maybeSite) &&
            typeof (maybeSite as Record<string, unknown>).id === "string"
        ) {
            const [enriched] = await enrichSitesWithCloseState(membership.org_id, [
                maybeSite as Record<string, unknown>,
            ]);
            response.body.site = enriched;
        }

        res.status(response.statusCode).json(response.body);
    } catch (error) {
        handleSiteCompletionError(res, error);
    }
});

router.post("/:id/complete", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveSiteRouteMembership(req, "admin");
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }

        const result = await new SiteCompletionService(membership.org_id).completeSite({
            siteId,
            actorUserId: getActorUserId(req),
            membershipId: membership.id,
            effectiveCompletedAt: normalizeOptionalTimestamp(
                (req.body as Record<string, unknown> | undefined)?.effective_completed_at,
                "INVALID_EFFECTIVE_COMPLETED_AT"
            ),
        });

        const [enrichedSite] = await enrichSitesWithCloseState(membership.org_id, [
            result.site as Record<string, unknown>,
        ]);

        res.json({
            ...result,
            site: enrichedSite,
        });
    } catch (error) {
        handleSiteCompletionError(res, error);
    }
});

router.post("/:id/complete/reverse", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const membership = await resolveSiteRouteMembership(req, "admin");
        const siteId = readParamId(req.params.id);
        if (!siteId) {
            res.status(400).json({ error: "site id is required" });
            return;
        }

        const body = (req.body as Record<string, unknown> | undefined) || {};
        const result = await new SiteCompletionService(membership.org_id).reverseSiteCompletion({
            siteId,
            actorUserId: getActorUserId(req),
            membershipId: membership.id,
            effectiveReversedAt: normalizeOptionalTimestamp(
                body.effective_reversed_at,
                "INVALID_EFFECTIVE_REVERSED_AT"
            ),
            reason: normalizeText(body.reason),
        });

        const [enrichedSite] = await enrichSitesWithCloseState(membership.org_id, [
            result.site as Record<string, unknown>,
        ]);

        res.json({
            ...result,
            site: enrichedSite,
        });
    } catch (error) {
        handleSiteCompletionError(res, error);
    }
});

export default router;
