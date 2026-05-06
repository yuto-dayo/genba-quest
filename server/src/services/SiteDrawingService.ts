import crypto from "node:crypto";
import { supabaseAdmin } from "../lib/supabaseClient";

export const SITE_DRAWING_BUCKET = "genba-drawings";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const SAFE_EXTENSION_FALLBACK = "bin";

export interface SiteDrawingVersion {
    id: string;
    org_id: string;
    site_id: string;
    drawing_id: string;
    version_no: number;
    storage_bucket: string;
    storage_path: string;
    original_filename: string;
    mime_type: string;
    file_size: number;
    sha256: string;
    uploaded_by: string | null;
    change_note: string | null;
    status: string;
    supersedes_version_id: string | null;
    created_at: string;
    signed_url?: string | null;
}

export interface SiteDrawing {
    id: string;
    org_id: string;
    site_id: string;
    title: string;
    drawing_no: string | null;
    discipline: string | null;
    status: string;
    latest_version_no: number;
    current_version_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    current_version?: SiteDrawingVersion | null;
    versions?: SiteDrawingVersion[];
}

interface UploadSiteDrawingVersionInput {
    orgId: string;
    siteId: string;
    userId: string;
    fileBase64: string;
    mimeType: string;
    originalFilename?: string;
    title?: string;
    drawingNo?: string;
    discipline?: string;
    changeNote?: string;
    drawingId?: string;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

export function sanitizeDrawingFilename(filename: string | undefined): string {
    const normalized = normalizeText(filename) || `drawing.${SAFE_EXTENSION_FALLBACK}`;
    const safe = normalized
        .replace(/[\\/]/g, "-")
        .replace(/[^A-Za-z0-9._-]/g, "_")
        .replace(/_{2,}/g, "_")
        .replace(/^[._-]+/, "")
        .slice(0, 120);

    return safe || `drawing.${SAFE_EXTENSION_FALLBACK}`;
}

export function buildDrawingStoragePath(input: {
    orgId: string;
    siteId: string;
    drawingId: string;
    versionNo: number;
    filename: string;
}): string {
    return [
        input.orgId,
        "sites",
        input.siteId,
        "drawings",
        input.drawingId,
        `v${input.versionNo}`,
        sanitizeDrawingFilename(input.filename),
    ].join("/");
}

async function createSignedUrl(version: SiteDrawingVersion): Promise<SiteDrawingVersion> {
    const { data } = await supabaseAdmin.storage
        .from(SITE_DRAWING_BUCKET)
        .createSignedUrl(version.storage_path, DEFAULT_SIGNED_URL_TTL_SECONDS);

    return {
        ...version,
        signed_url: data?.signedUrl || null,
    };
}

async function loadDrawingForAppend(input: {
    orgId: string;
    siteId: string;
    drawingId: string;
}): Promise<SiteDrawing> {
    const { data, error } = await supabaseAdmin
        .from("site_drawings")
        .select("*")
        .eq("id", input.drawingId)
        .eq("org_id", input.orgId)
        .eq("site_id", input.siteId)
        .neq("status", "deleted")
        .maybeSingle();

    if (error) {
        throw error;
    }

    if (!data) {
        throw new Error("DRAWING_NOT_FOUND");
    }

    return data as SiteDrawing;
}

async function createDrawing(input: UploadSiteDrawingVersionInput): Promise<SiteDrawing> {
    const title = normalizeText(input.title) || sanitizeDrawingFilename(input.originalFilename);
    const { data, error } = await supabaseAdmin
        .from("site_drawings")
        .insert({
            org_id: input.orgId,
            site_id: input.siteId,
            title,
            drawing_no: normalizeText(input.drawingNo),
            discipline: normalizeText(input.discipline),
            created_by: input.userId,
        })
        .select("*")
        .single();

    if (error) {
        throw error;
    }

    return data as SiteDrawing;
}

async function loadLatestVersion(drawingId: string): Promise<SiteDrawingVersion | null> {
    const { data, error } = await supabaseAdmin
        .from("site_drawing_versions")
        .select("*")
        .eq("drawing_id", drawingId)
        .order("version_no", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data as SiteDrawingVersion | null) || null;
}

export async function listSiteDrawings(input: {
    orgId: string;
    siteId: string;
}): Promise<SiteDrawing[]> {
    const { data: drawings, error: drawingsError } = await supabaseAdmin
        .from("site_drawings")
        .select("*")
        .eq("org_id", input.orgId)
        .eq("site_id", input.siteId)
        .neq("status", "deleted")
        .order("updated_at", { ascending: false });

    if (drawingsError) {
        throw drawingsError;
    }

    const rows = (drawings || []) as SiteDrawing[];
    const currentVersionIds = rows
        .map((drawing) => drawing.current_version_id)
        .filter((id): id is string => Boolean(id));

    if (currentVersionIds.length === 0) {
        return rows.map((drawing) => ({ ...drawing, current_version: null }));
    }

    const { data: versions, error: versionsError } = await supabaseAdmin
        .from("site_drawing_versions")
        .select("*")
        .in("id", currentVersionIds);

    if (versionsError) {
        throw versionsError;
    }

    const versionsWithUrls = await Promise.all(
        ((versions || []) as SiteDrawingVersion[]).map(createSignedUrl)
    );
    const versionById = new Map(versionsWithUrls.map((version) => [version.id, version]));

    return rows.map((drawing) => ({
        ...drawing,
        current_version: drawing.current_version_id
            ? versionById.get(drawing.current_version_id) || null
            : null,
    }));
}

export async function uploadSiteDrawingVersion(
    input: UploadSiteDrawingVersionInput
): Promise<SiteDrawing> {
    const drawing = input.drawingId
        ? await loadDrawingForAppend({
            orgId: input.orgId,
            siteId: input.siteId,
            drawingId: input.drawingId,
        })
        : await createDrawing(input);

    const fileBuffer = Buffer.from(input.fileBase64, "base64");
    if (fileBuffer.length === 0) {
        throw new Error("DRAWING_FILE_EMPTY");
    }

    const latestVersion = await loadLatestVersion(drawing.id);
    const nextVersionNo = (latestVersion?.version_no || 0) + 1;
    const originalFilename = sanitizeDrawingFilename(input.originalFilename);
    const storagePath = buildDrawingStoragePath({
        orgId: input.orgId,
        siteId: input.siteId,
        drawingId: drawing.id,
        versionNo: nextVersionNo,
        filename: originalFilename,
    });
    const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");

    const { error: uploadError } = await supabaseAdmin.storage
        .from(SITE_DRAWING_BUCKET)
        .upload(storagePath, fileBuffer, {
            contentType: input.mimeType,
            upsert: false,
        });

    if (uploadError) {
        throw uploadError;
    }

    const { data: version, error: versionError } = await supabaseAdmin
        .from("site_drawing_versions")
        .insert({
            org_id: input.orgId,
            site_id: input.siteId,
            drawing_id: drawing.id,
            version_no: nextVersionNo,
            storage_bucket: SITE_DRAWING_BUCKET,
            storage_path: storagePath,
            original_filename: originalFilename,
            mime_type: input.mimeType,
            file_size: fileBuffer.length,
            sha256,
            uploaded_by: input.userId,
            change_note: normalizeText(input.changeNote),
            supersedes_version_id: latestVersion?.id || null,
        })
        .select("*")
        .single();

    if (versionError) {
        throw versionError;
    }

    if (latestVersion) {
        await supabaseAdmin
            .from("site_drawing_versions")
            .update({ status: "superseded" })
            .eq("id", latestVersion.id)
            .eq("drawing_id", drawing.id);
    }

    const { data: updatedDrawing, error: updateError } = await supabaseAdmin
        .from("site_drawings")
        .update({
            current_version_id: (version as SiteDrawingVersion).id,
            latest_version_no: nextVersionNo,
        })
        .eq("id", drawing.id)
        .eq("org_id", input.orgId)
        .select("*")
        .single();

    if (updateError) {
        throw updateError;
    }

    return {
        ...(updatedDrawing as SiteDrawing),
        current_version: await createSignedUrl(version as SiteDrawingVersion),
    };
}
