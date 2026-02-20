import { Request, Response, NextFunction } from "express";
import { supabaseAdmin } from "../lib/supabaseClient";

export interface AuthenticatedRequest extends Request {
    userId?: string;
    userName?: string;
    orgId?: string;
}

const DEV_MODE = process.env.NODE_ENV === "development" && process.env.DEV_SKIP_AUTH === "true";
// 開発用UUID（実際のSupabaseユーザーIDに合わせる必要あり）
const DEV_USER_ID = process.env.DEV_USER_UUID || "00000000-0000-0000-0000-000000000001";
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveOrgIdFromUser(user: {
    app_metadata?: Record<string, unknown>;
    user_metadata?: Record<string, unknown>;
}): string {
    const candidates = [
        user.app_metadata?.org_id,
        user.user_metadata?.org_id,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === "string" && UUID_REGEX.test(candidate)) {
            return candidate;
        }
    }

    return DEFAULT_ORG_ID;
}

export const authMiddleware = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    // 開発モード: 認証スキップ
    if (DEV_MODE) {
        req.userId = DEV_USER_ID;
        req.userName = "Dev User";
        req.orgId = DEFAULT_ORG_ID;
        return next();
    }

    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }

    const token = authHeader.slice(7);

    try {
        const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

        if (error || !user) {
            return res.status(401).json({ error: "Invalid token" });
        }

        req.userId = user.id;
        req.userName = user.user_metadata?.name || user.email || "Unknown User";
        req.orgId = resolveOrgIdFromUser(user);
        next();
    } catch (err) {
        return res.status(500).json({ error: "Auth error" });
    }
};
