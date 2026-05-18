import rateLimit, { type Options } from "express-rate-limit";
import type { Request } from "express";
import type { AuthenticatedRequest } from "./authMiddleware";

function isRateLimitDisabled(): boolean {
    return (
        process.env.NODE_ENV === "development" &&
        process.env.DEV_SKIP_AUTH === "true"
    );
}

function userKey(req: Request): string {
    const authed = req as AuthenticatedRequest;
    return authed.userId || req.ip || "anonymous";
}

const commonOptions: Partial<Options> = {
    standardHeaders: "draft-7",
    legacyHeaders: false,
    skip: () => isRateLimitDisabled(),
    keyGenerator: userKey,
    handler: (_req, res) => {
        res.status(429).json({ error: "RATE_LIMITED" });
    },
};

// Broad protection on every authenticated /api/v1 route.
export const globalAuthLimiter = rateLimit({
    ...commonOptions,
    windowMs: 15 * 60 * 1000,
    limit: 600,
});

// Sherpa hits external LLMs on every call; tighter cap to bound spend.
export const sherpaLimiter = rateLimit({
    ...commonOptions,
    windowMs: 60 * 1000,
    limit: 30,
});

// OCR / large-file upload routes — keep low to bound LLM + storage cost.
export const heavyUploadLimiter = rateLimit({
    ...commonOptions,
    windowMs: 5 * 60 * 1000,
    limit: 20,
});
