import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { electronicDocumentService } from "../services/ElectronicDocumentService";

const router = Router();

function parseAmount(value: unknown): number | null {
    if (value === undefined || value === null || value === "") {
        return null;
    }
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function sendDocumentError(res: Response, error: unknown): void {
    const message = error instanceof Error ? error.message : "DOCUMENT_ERROR";
    const statusByCode: Record<string, number> = {
        DOCUMENT_SEARCH_FROM_INVALID: 400,
        DOCUMENT_SEARCH_TO_INVALID: 400,
        ELECTRONIC_DOCUMENT_AMOUNT_INVALID: 400,
        ELECTRONIC_DOCUMENT_COUNTERPARTY_REQUIRED: 400,
        ELECTRONIC_DOCUMENT_FILE_SIZE_REJECTED: 413,
        ELECTRONIC_DOCUMENT_MIME_REJECTED: 400,
        ELECTRONIC_DOCUMENT_TRANSACTION_DATE_INVALID: 400,
        OFFICE_PROCESSING_RULE_EFFECTIVE_FROM_INVALID: 400,
        OFFICE_PROCESSING_RULE_MARKDOWN_REQUIRED: 400,
        OFFICE_PROCESSING_RULE_PDF_MIME_REJECTED: 400,
        OFFICE_PROCESSING_RULE_VERSION_INVALID: 400,
        ORG_ROLE_REQUIRED: 403,
        SOURCE_DOCUMENT_DOWNLOAD_FAILED: 500,
        SOURCE_DOCUMENT_NO_DOWNLOADABLE_SOURCE: 400,
        SOURCE_DOCUMENT_NOT_FOUND: 404,
        SOURCE_DOCUMENT_STORAGE_PATH_OUTSIDE_ORG: 403,
    };
    const status = statusByCode[message] ?? 500;
    if (status === 500) {
        console.error("[DOCUMENTS] unhandled error:", error);
    }
    res.status(status).json({ error: message });
}

router.use(async (req: AuthenticatedRequest, res, next) => {
    try {
        const membership = await resolveActiveOrgMembership(req, "member");
        req.orgId = membership.org_id;
        req.orgMembershipId = membership.id ?? null;
        next();
    } catch (error) {
        const message = error instanceof Error ? error.message : "ORG_ACCESS_ERROR";
        res.status(message === "INVALID_ORG_ID" ? 400 : 403).json({ error: message });
    }
});

router.get("/search", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const minAmount = parseAmount(req.query.minAmount);
        const maxAmount = parseAmount(req.query.maxAmount);
        const documents = await electronicDocumentService.searchDocuments({
            orgId: req.orgId!,
            from: normalizeText(req.query.from),
            to: normalizeText(req.query.to),
            counterparty: normalizeText(req.query.counterparty),
            minAmount,
            maxAmount,
        });
        res.json({ documents });
    } catch (error) {
        sendDocumentError(res, error);
    }
});

router.get("/office-processing-rules", async (req: AuthenticatedRequest, res: Response) => {
    try {
        await resolveActiveOrgMembership(req, "admin");
        const rules = await electronicDocumentService.listOfficeProcessingRules(req.orgId!);
        res.json({ rules });
    } catch (error) {
        sendDocumentError(res, error);
    }
});

router.post("/office-processing-rules", async (req: AuthenticatedRequest, res: Response) => {
    try {
        await resolveActiveOrgMembership(req, "admin");
        const {
            version,
            title,
            markdown_content,
            effective_from,
            pdf_base64,
            pdf_mime_type,
            pdf_original_filename,
        } = req.body;
        const pdfBuffer = typeof pdf_base64 === "string" && pdf_base64
            ? Buffer.from(pdf_base64, "base64")
            : null;
        const rule = await electronicDocumentService.registerOfficeProcessingRule({
            orgId: req.orgId!,
            version: Number(version),
            title: normalizeText(title),
            markdownContent: typeof markdown_content === "string" ? markdown_content : "",
            effectiveFrom: normalizeText(effective_from),
            registeredBy: req.userId!,
            pdfBuffer,
            pdfMimeType: normalizeText(pdf_mime_type),
            pdfOriginalFilename: normalizeText(pdf_original_filename),
        });
        res.status(201).json({ rule });
    } catch (error) {
        sendDocumentError(res, error);
    }
});

router.get("/integrity-report", async (req: AuthenticatedRequest, res: Response) => {
    try {
        await resolveActiveOrgMembership(req, "admin");
        const report = await electronicDocumentService.verifyHashChain(req.orgId!);
        res.json({ report });
    } catch (error) {
        sendDocumentError(res, error);
    }
});

export default router;
