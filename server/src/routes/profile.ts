import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseClient";

const router = Router();

interface ProfileRecord {
    id: string;
    username: string | null;
    full_name: string | null;
    avatar_url: string | null;
}

function normalizeText(value: unknown, maxLength: number): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return trimmed.slice(0, maxLength);
}

router.get("/me", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .select("id,username,full_name,avatar_url")
            .eq("id", req.userId)
            .maybeSingle();

        if (error) {
            throw error;
        }

        if (!data) {
            res.status(404).json({ error: "PROFILE_NOT_FOUND" });
            return;
        }

        res.json({ profile: data as ProfileRecord });
    } catch (err) {
        console.error("[PROFILE] read failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

router.patch("/me", async (req: AuthenticatedRequest, res: Response) => {
    try {
        if (!req.userId) {
            res.status(401).json({ error: "Unauthorized" });
            return;
        }

        const updates: Record<string, string | null> = {};

        if ("full_name" in req.body) {
            updates.full_name = normalizeText(req.body.full_name, 80);
        }

        if ("username" in req.body) {
            const username = normalizeText(req.body.username, 40);
            if (username !== null && username.length < 3) {
                res.status(400).json({ error: "PROFILE_USERNAME_TOO_SHORT" });
                return;
            }
            updates.username = username;
        }

        if (Object.keys(updates).length === 0) {
            res.status(400).json({ error: "PROFILE_NO_FIELDS" });
            return;
        }

        const { data, error } = await supabaseAdmin
            .from("profiles")
            .update(updates)
            .eq("id", req.userId)
            .select("id,username,full_name,avatar_url")
            .single();

        if (error) {
            if (error.code === "23505") {
                res.status(409).json({ error: "PROFILE_USERNAME_TAKEN" });
                return;
            }
            throw error;
        }

        res.json({ profile: data as ProfileRecord });
    } catch (err) {
        console.error("[PROFILE] update failed:", err);
        res.status(500).json({ error: "Internal server error" });
    }
});

export default router;
