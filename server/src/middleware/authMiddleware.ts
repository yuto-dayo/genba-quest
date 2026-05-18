import { Request, Response, NextFunction } from "express";
import {
    getDefaultDevAuthUser,
    assertDevAuthRemoteSafety,
    getDevAuthUserByKey,
    getDevDefaultOrgId,
    isDevAuthMode,
} from "../config/devAuthUsers";
import { supabaseAdmin } from "../lib/supabaseClient";

export interface AuthenticatedRequest extends Request {
    userId?: string;
    userName?: string;
    userEmail?: string | null;
    orgId?: string;
    orgMembershipId?: string | null;
}

function readFirstHeaderValue(value: string | string[] | undefined): string | null {
    if (Array.isArray(value)) {
        return value[0] ?? null;
    }

    return value ?? null;
}

function readDevUserKey(req: Request): string | null {
    const headerValue = readFirstHeaderValue(req.headers["x-dev-user-key"]);
    const queryValue = typeof req.query?.dev_user === "string" ? req.query.dev_user : null;
    return headerValue || queryValue || process.env.DEV_USER_KEY || null;
}

export const authMiddleware = async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) => {
    // 開発モード: 認証スキップ
    if (isDevAuthMode()) {
        try {
            assertDevAuthRemoteSafety();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unsafe dev auth configuration";
            return res.status(500).json({ error: message });
        }

        const requestedDevUserKey = readDevUserKey(req);
        const selectedDevUser = getDevAuthUserByKey(requestedDevUserKey) ?? getDefaultDevAuthUser();
        const useLegacyUserEnv = !requestedDevUserKey && process.env.DEV_USER_UUID;
        req.userId = useLegacyUserEnv ? process.env.DEV_USER_UUID : selectedDevUser.id;
        req.userName = useLegacyUserEnv ? process.env.DEV_USER_NAME || "Dev User" : selectedDevUser.name;
        req.userEmail = useLegacyUserEnv
            ? process.env.DEV_USER_EMAIL || "dev@example.com"
            : selectedDevUser.email;
        req.orgId = getDevDefaultOrgId();
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
        req.userEmail = user.email ?? null;
        // org is resolved downstream by requireOrgMembership against org_memberships.
        next();
    } catch (err) {
        return res.status(500).json({ error: "Auth error" });
    }
};
