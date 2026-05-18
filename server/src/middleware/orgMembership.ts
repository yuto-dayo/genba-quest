import { NextFunction, Response } from "express";
import { AuthenticatedRequest } from "./authMiddleware";
import { OrgRole, resolveActiveOrgMembership } from "../lib/orgAccess";

type OrgMembershipErrorCode =
    | "USER_CONTEXT_REQUIRED"
    | "INVALID_ORG_ID"
    | "ORG_SELECTION_REQUIRED"
    | "ORG_ONBOARDING_REQUIRED"
    | "ORG_MEMBERSHIP_REQUIRED"
    | "ORG_ROLE_REQUIRED";

const ERROR_STATUS: Record<OrgMembershipErrorCode, number> = {
    USER_CONTEXT_REQUIRED: 401,
    INVALID_ORG_ID: 400,
    ORG_SELECTION_REQUIRED: 409,
    ORG_ONBOARDING_REQUIRED: 409,
    ORG_MEMBERSHIP_REQUIRED: 403,
    ORG_ROLE_REQUIRED: 403,
};

function statusForError(message: string): number {
    return ERROR_STATUS[message as OrgMembershipErrorCode] ?? 500;
}

export function requireOrgMembership(minRole: OrgRole = "member") {
    return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        if (!req.userId) {
            return res.status(401).json({ error: "USER_CONTEXT_REQUIRED" });
        }

        try {
            const membership = await resolveActiveOrgMembership(req, minRole);
            req.orgId = membership.org_id;
            req.orgMembershipId = membership.id ?? null;
            return next();
        } catch (error) {
            const message = error instanceof Error ? error.message : "ORG_ACCESS_ERROR";
            const status = statusForError(message);
            if (status === 500) {
                console.error("[ORG_MEMBERSHIP] unexpected error:", error);
                return res.status(500).json({ error: "ORG_ACCESS_ERROR" });
            }
            return res.status(status).json({ error: message });
        }
    };
}
