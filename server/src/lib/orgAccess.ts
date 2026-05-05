import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { getDevAuthUserById, getDevDefaultOrgId, isDevAuthMode } from "../config/devAuthUsers";
import { supabaseAdmin } from "./supabaseClient";

export type OrgRole = "admin" | "member";
export type OrgMembershipStatus = "active" | "suspended" | "removed";

export interface OrgMembershipRecord {
    org_id: string;
    user_id: string;
    role: OrgRole;
    status: OrgMembershipStatus;
    title?: string | null;
    approval_limit?: number | null;
    joined_at?: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_RANK: Record<OrgRole, number> = {
    member: 1,
    admin: 2,
};

function normalizeRequestedOrgId(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function readRequestedOrgId(req: AuthenticatedRequest): string | null {
    const headerValue = Array.isArray(req.headers["x-org-id"])
        ? req.headers["x-org-id"][0]
        : req.headers["x-org-id"];
    const paramValue = typeof req.params?.orgId === "string" ? req.params.orgId : null;

    return normalizeRequestedOrgId(headerValue) || normalizeRequestedOrgId(paramValue);
}

function assertValidOrgId(orgId: string): void {
    if (!UUID_REGEX.test(orgId)) {
        throw new Error("INVALID_ORG_ID");
    }
}

export async function listActiveMemberships(userId: string): Promise<OrgMembershipRecord[]> {
    const { data, error } = await supabaseAdmin
        .from("org_memberships")
        .select("org_id,user_id,role,status,title,approval_limit,joined_at,created_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .order("created_at", { ascending: true });

    if (error) {
        throw error;
    }

    const memberships = (data || []) as OrgMembershipRecord[];
    if (memberships.length > 0 || !isDevAuthMode()) {
        return memberships;
    }

    const devUser = getDevAuthUserById(userId);
    if (!devUser) {
        return memberships;
    }

    return [{
        org_id: getDevDefaultOrgId(),
        user_id: devUser.id,
        role: devUser.role,
        status: "active",
        title: null,
        approval_limit: devUser.role === "admin" ? null : 0,
        joined_at: null,
    }];
}

export async function requireOrgMembership(input: {
    userId: string;
    orgId: string;
    minRole?: OrgRole;
}): Promise<OrgMembershipRecord> {
    const memberships = await listActiveMemberships(input.userId);
    const membership = memberships.find((candidate) => candidate.org_id === input.orgId);

    if (!membership) {
        throw new Error("ORG_MEMBERSHIP_REQUIRED");
    }

    if (input.minRole && ROLE_RANK[membership.role] < ROLE_RANK[input.minRole]) {
        throw new Error("ORG_ROLE_REQUIRED");
    }

    return membership;
}

export async function resolveActiveOrgMembership(
    req: AuthenticatedRequest,
    minRole?: OrgRole,
): Promise<OrgMembershipRecord> {
    if (!req.userId) {
        throw new Error("USER_CONTEXT_REQUIRED");
    }

    const requestedOrgId = readRequestedOrgId(req);

    if (requestedOrgId) {
        assertValidOrgId(requestedOrgId);
        return requireOrgMembership({
            userId: req.userId,
            orgId: requestedOrgId,
            minRole,
        });
    }

    const memberships = await listActiveMemberships(req.userId);

    if (memberships.length === 0) {
        throw new Error("ORG_ONBOARDING_REQUIRED");
    }

    if (memberships.length > 1) {
        throw new Error("ORG_SELECTION_REQUIRED");
    }

    const membership = memberships[0];
    if (!membership) {
        throw new Error("ORG_ONBOARDING_REQUIRED");
    }

    if (minRole && ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
        throw new Error("ORG_ROLE_REQUIRED");
    }

    return membership;
}

export async function resolveActiveOrg(req: AuthenticatedRequest, minRole?: OrgRole): Promise<string> {
    const membership = await resolveActiveOrgMembership(req, minRole);
    return membership.org_id;
}
