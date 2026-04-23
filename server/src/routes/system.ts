import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { SystemBootstrapService } from "../services/SystemBootstrapService";

const router = Router();

function handleSystemBootstrapError(res: Response, error: unknown): void {
    const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";

    if (code === "SYSTEM_BOOTSTRAP_ALREADY_COMPLETED" || code === "SYSTEM_BOOTSTRAP_SLUG_CONFLICT") {
        res.status(409).json({ error: code });
        return;
    }

    if (code === "SYSTEM_BOOTSTRAP_NAME_REQUIRED" || code === "SYSTEM_BOOTSTRAP_RPC_EMPTY_RESULT") {
        res.status(400).json({ error: code });
        return;
    }

    console.error("[SYSTEM] bootstrap error:", error);
    res.status(500).json({ error: "Internal server error" });
}

router.post("/bootstrap-first-org", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const service = new SystemBootstrapService();
        const result = await service.bootstrapFirstOrg({
            userId: req.userId,
            name: typeof req.body?.name === "string" ? req.body.name : "",
            slug: typeof req.body?.slug === "string" ? req.body.slug : null,
        });

        res.status(201).json(result);
    } catch (error) {
        handleSystemBootstrapError(res, error);
    }
});

export default router;
