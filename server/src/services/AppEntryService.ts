import { listActiveMemberships } from "../lib/orgAccess";
import { supabaseAdmin } from "../lib/supabaseClient";

export interface AppEntryMembershipSummary {
    org_id: string;
    org_name: string;
    role: "admin" | "member";
}

export interface AppEntryPendingInvite {
    invite_id: string;
    org_id: string;
    org_name: string;
    role: "admin" | "member";
    email_normalized: string;
}

export type AppEntryStateRecord =
    | {
          state: "needs_system_bootstrap";
          viewer_email: string | null;
      }
    | {
          state: "needs_onboarding";
          viewer_email: string | null;
          bootstrap_allowed: boolean;
          bootstrap_with_code_enabled: boolean;
          memberships: [];
          pending_invites: [];
      }
    | {
          state: "needs_invite_action";
          viewer_email: string | null;
          bootstrap_allowed: boolean;
          bootstrap_with_code_enabled: boolean;
          memberships: [];
          pending_invites: AppEntryPendingInvite[];
      }
    | {
          state: "needs_org_selection";
          viewer_email: string | null;
          memberships: AppEntryMembershipSummary[];
      }
    | {
          state: "ready";
          viewer_email: string | null;
          active_org: AppEntryMembershipSummary;
          memberships: AppEntryMembershipSummary[];
      };

interface OrganizationRow {
    id: string;
    name: string;
}

interface PendingInviteRow {
    id: string;
    org_id: string;
    role: "admin" | "member";
    email_normalized: string;
}

function normalizeEmail(email: string | null | undefined): string | null {
    if (typeof email !== "string") {
        return null;
    }

    const normalized = email.trim().toLowerCase();
    return normalized || null;
}

function parseAllowedEmails(raw: string | undefined): Set<string> {
    return new Set(
        (raw || "")
            .split(",")
            .map((value) => normalizeEmail(value))
            .filter((value): value is string => Boolean(value)),
    );
}

export async function countOrganizations(): Promise<number> {
    const { count, error } = await supabaseAdmin
        .from("organizations")
        .select("id", { count: "exact", head: true });

    if (error) {
        throw error;
    }

    return count ?? 0;
}

async function loadOrganizationsByIds(orgIds: string[]): Promise<Map<string, OrganizationRow>> {
    if (orgIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabaseAdmin
        .from("organizations")
        .select("id,name")
        .in("id", orgIds);

    if (error) {
        throw error;
    }

    return new Map(((data || []) as OrganizationRow[]).map((org) => [org.id, org]));
}

async function listPendingInvitesByEmail(email: string): Promise<PendingInviteRow[]> {
    const { data, error } = await supabaseAdmin
        .from("org_invites")
        .select("id,org_id,role,email_normalized")
        .eq("email_normalized", email)
        .eq("status", "pending");

    if (error) {
        throw error;
    }

    return (data || []) as PendingInviteRow[];
}

function isDevBootstrapMode(): boolean {
    return process.env.NODE_ENV === "development" && process.env.DEV_SKIP_AUTH === "true";
}

function isAuthenticatedOrgCreationMode(): boolean {
    return (process.env.ORG_CREATION_MODE || "").trim().toLowerCase() === "authenticated";
}

export function isOrgBootstrapWithCodeEnabled(): boolean {
    if (isDevBootstrapMode()) {
        return true;
    }

    const flag = (process.env.ORG_CREATION_WITH_CODE_ENABLED || "").trim().toLowerCase();
    if (flag === "false" || flag === "0" || flag === "off") {
        return false;
    }

    return true;
}

export function isOrgBootstrapAllowed(viewerEmail: string | null | undefined): boolean {
    if (isDevBootstrapMode()) {
        return true;
    }

    const normalizedEmail = normalizeEmail(viewerEmail);
    if (!normalizedEmail) {
        return false;
    }

    if (isAuthenticatedOrgCreationMode()) {
        return true;
    }

    const allowlist = parseAllowedEmails(process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS);
    return allowlist.has(normalizedEmail);
}

export async function resolveAppEntryState(input: {
    userId: string;
    userEmail: string | null | undefined;
}): Promise<AppEntryStateRecord> {
    const viewerEmail = normalizeEmail(input.userEmail);
    const organizationCount = await countOrganizations();

    if (organizationCount === 0) {
        return {
            state: "needs_system_bootstrap",
            viewer_email: viewerEmail,
        };
    }

    const bootstrapAllowed = isOrgBootstrapAllowed(viewerEmail);
    const memberships = await listActiveMemberships(input.userId);

    if (memberships.length > 0) {
        const orgMap = await loadOrganizationsByIds(memberships.map((membership) => membership.org_id));
        const membershipSummaries = memberships.flatMap((membership) => {
            const org = orgMap.get(membership.org_id);
            if (!org) {
                return [];
            }

            return [{
                org_id: membership.org_id,
                org_name: org.name,
                role: membership.role,
            }];
        });

        if (membershipSummaries.length === 1) {
            return {
                state: "ready",
                viewer_email: viewerEmail,
                active_org: membershipSummaries[0] as AppEntryMembershipSummary,
                memberships: membershipSummaries,
            };
        }

        return {
            state: "needs_org_selection",
            viewer_email: viewerEmail,
            memberships: membershipSummaries,
        };
    }

    const bootstrapWithCodeEnabled = isOrgBootstrapWithCodeEnabled();

    if (!viewerEmail) {
        return {
            state: "needs_onboarding",
            viewer_email: null,
            bootstrap_allowed: bootstrapAllowed,
            bootstrap_with_code_enabled: bootstrapWithCodeEnabled,
            memberships: [],
            pending_invites: [],
        };
    }

    const pendingInvites = await listPendingInvitesByEmail(viewerEmail);

    if (pendingInvites.length === 0) {
        return {
            state: "needs_onboarding",
            viewer_email: viewerEmail,
            bootstrap_allowed: bootstrapAllowed,
            bootstrap_with_code_enabled: bootstrapWithCodeEnabled,
            memberships: [],
            pending_invites: [],
        };
    }

    const orgMap = await loadOrganizationsByIds(pendingInvites.map((invite) => invite.org_id));
    const inviteSummaries = pendingInvites.map((invite) => ({
        invite_id: invite.id,
        org_id: invite.org_id,
        org_name: orgMap.get(invite.org_id)?.name || "不明な組織",
        role: invite.role,
        email_normalized: invite.email_normalized,
    }));

    return {
        state: "needs_invite_action",
        viewer_email: viewerEmail,
        bootstrap_allowed: bootstrapAllowed,
        bootstrap_with_code_enabled: bootstrapWithCodeEnabled,
        memberships: [],
        pending_invites: inviteSummaries,
    };
}
