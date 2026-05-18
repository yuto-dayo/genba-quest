import { Router, Response } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { depreciationService, type DepreciableAssetClassification, type DepreciationMethod } from "../services/DepreciationService";
import type { ActorRef } from "../services/PolicyEngine";

const router = Router();

router.use(requireOrgMembership("member"));

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function normalizeNumber(value: unknown): number | null {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}

function buildHumanActor(req: AuthenticatedRequest): ActorRef {
    return {
        type: "human",
        id: req.userId!,
        name: req.userName || "Member",
    };
}

function statusForDepreciationError(message: string): number {
    const code = message.includes(":") ? message.split(":")[0] : message;
    const map: Record<string, number> = {
        DEPRECIATION_AMOUNT_INVALID: 400,
        DEPRECIATION_ACQUISITION_DATE_INVALID: 400,
        DEPRECIATION_TITLE_REQUIRED: 400,
        DEPRECIATION_CATEGORY_REQUIRED: 400,
        DEPRECIATION_MONTH_INVALID: 400,
        DEPRECIATION_MAPPING_MISSING: 422,
    };
    return map[code] ?? 500;
}

function sendDepreciationError(res: Response, err: unknown): void {
    const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
    const code = message.includes(":") ? message.split(":")[0] : message;
    const status = statusForDepreciationError(message);
    if (status === 500) {
        console.error("[depreciation] unhandled error:", err);
    }
    res.status(status).json({ error: status === 500 ? "Internal server error" : code });
}

router.get("/special-usage", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const fiscalYear = Number(req.query.fiscal_year || new Date().getFullYear());
        if (!Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2100) {
            res.status(400).json({ error: "DEPRECIATION_FISCAL_YEAR_INVALID" });
            return;
        }

        const usage = await depreciationService.getSpecialUsage(req.orgId!, fiscalYear);
        res.json(usage);
    } catch (err) {
        sendDepreciationError(res, err);
    }
});

router.get("/assets", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const assets = await depreciationService.listAssets(req.orgId!);
        res.json({ assets });
    } catch (err) {
        sendDepreciationError(res, err);
    }
});

router.post("/assets", async (req: AuthenticatedRequest, res: Response) => {
    try {
        const body = req.body && typeof req.body === "object" ? req.body as Record<string, unknown> : {};
        const title = normalizeText(body.title);
        const category = normalizeText(body.category);
        const acquisitionAmount = normalizeNumber(body.acquisition_amount);
        const acquisitionDate = normalizeText(body.acquisition_date);

        if (!title) throw new Error("DEPRECIATION_TITLE_REQUIRED");
        if (!category) throw new Error("DEPRECIATION_CATEGORY_REQUIRED");
        if (acquisitionAmount === null) throw new Error("DEPRECIATION_AMOUNT_INVALID");
        if (!acquisitionDate) throw new Error("DEPRECIATION_ACQUISITION_DATE_INVALID");

        const result = await depreciationService.registerAsset({
            orgId: req.orgId!,
            actor: buildHumanActor(req),
            memberId: normalizeText(body.member_id),
            category,
            title,
            acquisitionAmount,
            acquisitionDate,
            usefulLifeYears: normalizeNumber(body.useful_life_years),
            depreciationMethod: normalizeText(body.depreciation_method) as DepreciationMethod | null,
            residualValue: normalizeNumber(body.residual_value),
            sourceTransactionId: normalizeText(body.source_transaction_id),
            proposalId: normalizeText(body.proposal_id),
            requestedClassification: normalizeText(body.requested_classification) as DepreciableAssetClassification | null,
        });

        res.status(201).json(result);
    } catch (err) {
        sendDepreciationError(res, err);
    }
});

export default router;
