import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { resolveAppEntryState } from "../services/AppEntryService";

const router = Router();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const entryState = await resolveAppEntryState({
            userId: req.userId,
            userEmail: req.userEmail ?? null,
        });

        res.json(entryState);
    } catch (error) {
        console.error("[APP_ENTRY] failed to resolve entry state:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
