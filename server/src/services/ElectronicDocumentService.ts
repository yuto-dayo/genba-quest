import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabaseClient";
import { getDriveStorageService } from "./DriveStorageService";

export const ELECTRONIC_DOCUMENT_BUCKET = "genba-electronic-documents";
export const ELECTRONIC_DOCUMENT_MAX_BYTES = 50 * 1024 * 1024;

const ALLOWED_KIND = new Set(["receipt", "invoice", "contract", "purchase_order", "delivery_note", "other"]);

export type ElectronicDocumentKind = "receipt" | "invoice" | "contract" | "purchase_order" | "delivery_note" | "other";

export interface RegisterDocumentInput {
    orgId: string;
    kind: ElectronicDocumentKind;
    transactionDate: string;
    counterpartyName: string;
    amount: number;
    fileBuffer: Buffer;
    originalFilename?: string | null;
    mimeType: string;
    registeredBy: string;
    sourceDocumentId?: string | null;
    sourceTransactionId?: string | null;
    metadata?: Record<string, unknown>;
}

export interface RegisterStoredDocumentInput {
    orgId: string;
    sourceDocumentId: string;
    kind: ElectronicDocumentKind;
    transactionDate: string;
    counterpartyName: string;
    amount: number;
    registeredBy: string;
    sourceTransactionId?: string | null;
    metadata?: Record<string, unknown>;
}

export interface SearchDocumentsInput {
    orgId: string;
    from?: string | null;
    to?: string | null;
    counterparty?: string | null;
    minAmount?: number | null;
    maxAmount?: number | null;
    limit?: number;
}

export interface OfficeProcessingRuleInput {
    orgId: string;
    version: number;
    markdownContent: string;
    registeredBy: string;
    title?: string | null;
    effectiveFrom?: string | null;
    pdfBuffer?: Buffer | null;
    pdfOriginalFilename?: string | null;
    pdfMimeType?: string | null;
}

type StoredDocumentRow = {
    id: string;
    org_id: string;
    doc_type: string;
    storage_path: string | null;
    original_filename: string | null;
    mime_type: string | null;
    drive_file_id: string | null;
};

type AttestationRow = {
    id: string;
    org_id: string;
    electronic_document_id: string;
    attestation_sequence: number | string;
    attested_sha256: string;
    previous_attestation_id: string | null;
    previous_attestation_hash: string | null;
    attestation_hash: string;
    attested_at: string;
};

function sha256Hex(buffer: Buffer | string): string {
    return createHash("sha256").update(buffer).digest("hex");
}

function assertAllowedMime(mimeType: string): void {
    if (mimeType !== "application/pdf" && !mimeType.startsWith("image/")) {
        throw new Error("ELECTRONIC_DOCUMENT_MIME_REJECTED");
    }
}

function assertFileSize(buffer: Buffer): void {
    if (buffer.length <= 0 || buffer.length > ELECTRONIC_DOCUMENT_MAX_BYTES) {
        throw new Error("ELECTRONIC_DOCUMENT_FILE_SIZE_REJECTED");
    }
}

function normalizeKind(kind: string): ElectronicDocumentKind {
    if (ALLOWED_KIND.has(kind)) {
        return kind as ElectronicDocumentKind;
    }
    return "other";
}

function extensionFor(input: { originalFilename?: string | null; mimeType: string }): string {
    const filenameExt = input.originalFilename?.split(".").pop()?.trim().toLowerCase();
    if (filenameExt && /^[a-z0-9]{1,8}$/.test(filenameExt)) {
        return filenameExt;
    }

    if (input.mimeType === "application/pdf") return "pdf";
    if (input.mimeType === "image/jpeg") return "jpg";
    if (input.mimeType === "image/png") return "png";
    if (input.mimeType === "image/webp") return "webp";
    if (input.mimeType === "image/heic") return "heic";
    if (input.mimeType === "image/heif") return "heif";
    if (input.mimeType === "image/tiff") return "tiff";
    return "bin";
}

function assertDate(value: string, code: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
        throw new Error(code);
    }
}

function assertSearchDate(value: string | null | undefined, code: string): void {
    if (value) {
        assertDate(value, code);
    }
}

function normalizeCounterparty(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error("ELECTRONIC_DOCUMENT_COUNTERPARTY_REQUIRED");
    }
    return trimmed;
}

function computeAttestationHash(row: {
    org_id: string;
    electronic_document_id: string;
    attestation_sequence: number | string;
    attested_sha256: string;
    previous_attestation_id: string | null;
    previous_attestation_hash: string | null;
}): string {
    return sha256Hex([
        row.org_id,
        row.electronic_document_id,
        String(row.attestation_sequence),
        row.attested_sha256,
        row.previous_attestation_id ?? "",
        row.previous_attestation_hash ?? "",
    ].join("|"));
}

export class ElectronicDocumentService {
    async registerDocument(input: RegisterDocumentInput) {
        const kind = normalizeKind(input.kind);
        assertDate(input.transactionDate, "ELECTRONIC_DOCUMENT_TRANSACTION_DATE_INVALID");
        assertAllowedMime(input.mimeType);
        assertFileSize(input.fileBuffer);
        if (!Number.isFinite(input.amount) || input.amount < 0) {
            throw new Error("ELECTRONIC_DOCUMENT_AMOUNT_INVALID");
        }

        const ext = extensionFor({
            originalFilename: input.originalFilename,
            mimeType: input.mimeType,
        });
        const storagePath = `${input.orgId}/${kind}/${randomUUID()}.${ext}`;
        const sha256 = sha256Hex(input.fileBuffer);

        const { error: uploadError } = await supabaseAdmin.storage
            .from(ELECTRONIC_DOCUMENT_BUCKET)
            .upload(storagePath, input.fileBuffer, {
                contentType: input.mimeType,
                upsert: false,
            });

        if (uploadError) {
            throw uploadError;
        }

        const { data, error } = await supabaseAdmin.rpc("register_electronic_document", {
            p_org_id: input.orgId,
            p_kind: kind,
            p_transaction_date: input.transactionDate,
            p_counterparty_name: normalizeCounterparty(input.counterpartyName),
            p_amount: input.amount,
            p_storage_path: storagePath,
            p_original_filename: input.originalFilename ?? null,
            p_mime_type: input.mimeType,
            p_file_size_bytes: input.fileBuffer.length,
            p_sha256: sha256,
            p_registered_by: input.registeredBy,
            p_source_document_id: input.sourceDocumentId ?? null,
            p_source_transaction_id: input.sourceTransactionId ?? null,
            p_metadata_json: input.metadata ?? {},
        });

        if (error) {
            await supabaseAdmin.storage.from(ELECTRONIC_DOCUMENT_BUCKET).remove([storagePath]);
            throw error;
        }

        return data;
    }

    async registerFromStoredDocument(input: RegisterStoredDocumentInput) {
        const { data: sourceDoc, error } = await supabaseAdmin
            .from("documents")
            .select("id, org_id, doc_type, storage_path, original_filename, mime_type, drive_file_id")
            .eq("id", input.sourceDocumentId)
            .eq("org_id", input.orgId)
            .single();

        if (error || !sourceDoc) {
            throw new Error("SOURCE_DOCUMENT_NOT_FOUND");
        }

        const row = sourceDoc as StoredDocumentRow;
        let fileBuffer: Buffer;
        let mimeType = row.mime_type || "application/octet-stream";

        if (row.drive_file_id) {
            const driveFile = await getDriveStorageService().downloadAttachmentFromDrive(row.drive_file_id);
            fileBuffer = driveFile.buffer;
            mimeType = driveFile.mimeType || mimeType;
        } else if (row.storage_path) {
            if (!row.storage_path.startsWith(`${input.orgId}/`)) {
                throw new Error("SOURCE_DOCUMENT_STORAGE_PATH_OUTSIDE_ORG");
            }

            const { data: fileData, error: downloadError } = await supabaseAdmin.storage
                .from("genba-documents")
                .download(row.storage_path);

            if (downloadError || !fileData) {
                throw new Error("SOURCE_DOCUMENT_DOWNLOAD_FAILED");
            }

            fileBuffer = Buffer.from(await fileData.arrayBuffer());
        } else {
            throw new Error("SOURCE_DOCUMENT_NO_DOWNLOADABLE_SOURCE");
        }

        return this.registerDocument({
            orgId: input.orgId,
            kind: normalizeKind(input.kind),
            transactionDate: input.transactionDate,
            counterpartyName: input.counterpartyName,
            amount: input.amount,
            fileBuffer,
            originalFilename: row.original_filename,
            mimeType,
            registeredBy: input.registeredBy,
            sourceDocumentId: row.id,
            sourceTransactionId: input.sourceTransactionId ?? null,
            metadata: input.metadata,
        });
    }

    async searchDocuments(input: SearchDocumentsInput) {
        assertSearchDate(input.from, "DOCUMENT_SEARCH_FROM_INVALID");
        assertSearchDate(input.to, "DOCUMENT_SEARCH_TO_INVALID");

        let query = supabaseAdmin
            .from("electronic_documents")
            .select(`
                id,
                org_id,
                kind,
                transaction_date,
                counterparty_name,
                amount,
                storage_bucket,
                storage_path,
                original_filename,
                mime_type,
                file_size_bytes,
                sha256,
                source_document_id,
                source_transaction_id,
                registered_by,
                registered_at,
                retention_until,
                metadata_json,
                created_at
            `)
            .eq("org_id", input.orgId)
            .order("transaction_date", { ascending: false })
            .order("registered_at", { ascending: false })
            .limit(Math.min(Math.max(input.limit ?? 100, 1), 200));

        if (input.from) query = query.gte("transaction_date", input.from);
        if (input.to) query = query.lte("transaction_date", input.to);
        if (input.counterparty) query = query.ilike("counterparty_name", `%${input.counterparty}%`);
        if (input.minAmount !== null && input.minAmount !== undefined) query = query.gte("amount", input.minAmount);
        if (input.maxAmount !== null && input.maxAmount !== undefined) query = query.lte("amount", input.maxAmount);

        const { data, error } = await query;
        if (error) {
            throw error;
        }
        return data || [];
    }

    async listOfficeProcessingRules(orgId: string) {
        const { data, error } = await supabaseAdmin
            .from("office_processing_rules")
            .select("*")
            .eq("org_id", orgId)
            .order("version", { ascending: false });

        if (error) {
            throw error;
        }
        return data || [];
    }

    async registerOfficeProcessingRule(input: OfficeProcessingRuleInput) {
        if (!Number.isInteger(input.version) || input.version <= 0) {
            throw new Error("OFFICE_PROCESSING_RULE_VERSION_INVALID");
        }
        const markdownContent = input.markdownContent.trim();
        if (!markdownContent) {
            throw new Error("OFFICE_PROCESSING_RULE_MARKDOWN_REQUIRED");
        }
        if (input.effectiveFrom) {
            assertDate(input.effectiveFrom, "OFFICE_PROCESSING_RULE_EFFECTIVE_FROM_INVALID");
        }

        let pdfPatch: Record<string, unknown> = {};
        let uploadedPath: string | null = null;

        if (input.pdfBuffer) {
            const mimeType = input.pdfMimeType || "application/pdf";
            if (mimeType !== "application/pdf") {
                throw new Error("OFFICE_PROCESSING_RULE_PDF_MIME_REJECTED");
            }
            assertFileSize(input.pdfBuffer);
            uploadedPath = `${input.orgId}/office_processing_rules/${randomUUID()}.pdf`;
            const { error: uploadError } = await supabaseAdmin.storage
                .from(ELECTRONIC_DOCUMENT_BUCKET)
                .upload(uploadedPath, input.pdfBuffer, {
                    contentType: "application/pdf",
                    upsert: false,
                });
            if (uploadError) {
                throw uploadError;
            }
            pdfPatch = {
                pdf_storage_bucket: ELECTRONIC_DOCUMENT_BUCKET,
                pdf_storage_path: uploadedPath,
                pdf_original_filename: input.pdfOriginalFilename ?? null,
                pdf_mime_type: "application/pdf",
                pdf_file_size_bytes: input.pdfBuffer.length,
                pdf_sha256: sha256Hex(input.pdfBuffer),
            };
        }

        try {
            await supabaseAdmin
                .from("office_processing_rules")
                .update({ status: "superseded" })
                .eq("org_id", input.orgId)
                .eq("status", "active");

            const { data, error } = await supabaseAdmin
                .from("office_processing_rules")
                .insert({
                    org_id: input.orgId,
                    version: input.version,
                    title: input.title?.trim() || undefined,
                    markdown_content: markdownContent,
                    effective_from: input.effectiveFrom || undefined,
                    registered_by: input.registeredBy,
                    ...pdfPatch,
                })
                .select()
                .single();

            if (error) {
                throw error;
            }
            return data;
        } catch (error) {
            if (uploadedPath) {
                await supabaseAdmin.storage.from(ELECTRONIC_DOCUMENT_BUCKET).remove([uploadedPath]);
            }
            throw error;
        }
    }

    async verifyHashChain(orgId: string) {
        const { data, error } = await supabaseAdmin
            .from("document_attestations")
            .select("id, org_id, electronic_document_id, attestation_sequence, attested_sha256, previous_attestation_id, previous_attestation_hash, attestation_hash, attested_at")
            .eq("org_id", orgId)
            .order("attestation_sequence", { ascending: true });

        if (error) {
            throw error;
        }

        const rows = (data || []) as AttestationRow[];
        const issues: Array<{ id: string; sequence: number; error: string }> = [];
        let previous: AttestationRow | null = null;

        for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const sequence = Number(row.attestation_sequence);
            if (sequence !== index + 1) {
                issues.push({ id: row.id, sequence, error: "SEQUENCE_GAP" });
            }
            if ((row.previous_attestation_id ?? null) !== (previous?.id ?? null)) {
                issues.push({ id: row.id, sequence, error: "PREVIOUS_ID_MISMATCH" });
            }
            if ((row.previous_attestation_hash ?? null) !== (previous?.attestation_hash ?? null)) {
                issues.push({ id: row.id, sequence, error: "PREVIOUS_HASH_MISMATCH" });
            }
            const expectedHash = computeAttestationHash(row);
            if (row.attestation_hash !== expectedHash) {
                issues.push({ id: row.id, sequence, error: "ATTESTATION_HASH_MISMATCH" });
            }
            previous = row;
        }

        return {
            ok: issues.length === 0,
            checked_count: rows.length,
            latest_attestation_id: previous?.id ?? null,
            latest_attestation_hash: previous?.attestation_hash ?? null,
            issues,
        };
    }
}

export const electronicDocumentService = new ElectronicDocumentService();
