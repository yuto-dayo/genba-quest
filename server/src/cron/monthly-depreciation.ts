import type { Response } from "express";
import type { AuthenticatedRequest } from "../middleware/authMiddleware";
import { depreciationService } from "../services/DepreciationService";

export async function handleMonthlyDepreciation(req: AuthenticatedRequest, res: Response) {
    try {
        const rawMonth = typeof req.body?.month === "string" ? req.body.month : "";
        const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(rawMonth)
            ? rawMonth
            : new Date().toISOString().slice(0, 7);
        const result = await depreciationService.bookMonthlyDepreciation(month, {
            type: "system",
            id: "depreciation-cron",
            name: "Depreciation Cron",
        });
        res.json(result);
    } catch (err) {
        const message = err instanceof Error ? err.message : "UNKNOWN_ERROR";
        if (message === "DEPRECIATION_MONTH_INVALID") {
            res.status(400).json({ error: message });
            return;
        }
        console.error("[depreciation-cron] monthly posting failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
}
