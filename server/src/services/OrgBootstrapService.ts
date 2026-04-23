import { listActiveMemberships } from "../lib/orgAccess";
import { ensureProfileRecord } from "../lib/ensureProfileRecord";
import { supabaseAdmin } from "../lib/supabaseClient";
import { isOrgBootstrapAllowed } from "./AppEntryService";

export interface OrgBootstrapInput {
    userId: string;
    userEmail: string | null | undefined;
    name: string;
    slug?: string | null;
}

export interface OrgBootstrapResult {
    active_org: {
        id: string;
        name: string;
        slug: string | null;
        status: "active";
    };
    membership: {
        org_id: string;
        user_id: string;
        role: "admin";
        status: "active";
    };
}

interface OrgBootstrapRpcPayload {
    org_id: string;
    org_name: string;
    org_slug: string | null;
    org_status: "active";
    membership_org_id: string;
    membership_user_id: string;
    membership_role: "admin";
    membership_status: "active";
}

interface OrganizationInsertRow {
    id: string;
    name: string;
    slug: string | null;
    status: "active";
}

function normalizeSlug(slug: string | null | undefined): string | null {
    if (typeof slug !== "string") {
        return null;
    }

    const normalized = slug.trim().toLowerCase();
    return normalized || null;
}

function normalizeRpcPayload(data: unknown): OrgBootstrapRpcPayload | null {
    if (!data) {
        return null;
    }

    if (Array.isArray(data)) {
        return (data[0] || null) as OrgBootstrapRpcPayload | null;
    }

    if (typeof data === "object") {
        return data as OrgBootstrapRpcPayload;
    }

    return null;
}

function isMissingBootstrapRpcMessage(message: string): boolean {
    return message.includes("bootstrap_org") &&
        (message.includes("does not exist") || message.includes("Could not find the function"));
}

function isSlugConflictMessage(message: string): boolean {
    return message.includes("ORG_BOOTSTRAP_SLUG_CONFLICT") ||
        message.includes("duplicate key") ||
        message.includes("organizations_slug_key") ||
        message.includes("organizations_slug_lower_idx");
}

async function fallbackBootstrapOrg(input: {
    userId: string;
    name: string;
    slug: string | null;
}): Promise<OrgBootstrapResult> {
    const { data: orgData, error: orgError } = await supabaseAdmin
        .from("organizations")
        .insert({
            name: input.name,
            slug: input.slug,
            status: "active",
        })
        .select("id,name,slug,status")
        .single();

    if (orgError) {
        const message = orgError.message || "";
        if (isSlugConflictMessage(message)) {
            throw new Error("ORG_BOOTSTRAP_SLUG_CONFLICT");
        }
        throw orgError;
    }

    const org = orgData as OrganizationInsertRow | null;
    if (!org) {
        throw new Error("ORG_BOOTSTRAP_RPC_EMPTY_RESULT");
    }

    const { error: membershipError } = await supabaseAdmin
        .from("org_memberships")
        .insert({
            org_id: org.id,
            user_id: input.userId,
            role: "admin",
            status: "active",
            joined_at: new Date().toISOString(),
        });

    if (membershipError) {
        throw membershipError;
    }

    return {
        active_org: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
        },
        membership: {
            org_id: org.id,
            user_id: input.userId,
            role: "admin",
            status: "active",
        },
    };
}

export class OrgBootstrapService {
    async bootstrap(input: OrgBootstrapInput): Promise<OrgBootstrapResult> {
        if (!isOrgBootstrapAllowed(input.userEmail)) {
            throw new Error("ORG_BOOTSTRAP_FORBIDDEN");
        }

        const activeMemberships = await listActiveMemberships(input.userId);
        if (activeMemberships.length > 0) {
            throw new Error("ORG_BOOTSTRAP_NOT_IN_ONBOARDING");
        }

        const normalizedName = input.name.trim();
        if (!normalizedName) {
            throw new Error("ORG_BOOTSTRAP_NAME_REQUIRED");
        }

        const normalizedSlug = normalizeSlug(input.slug);
        await ensureProfileRecord(input.userId);

        const rpcClient = supabaseAdmin as unknown as {
            rpc?: (
                fn: string,
                args?: Record<string, unknown>,
            ) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };

        if (typeof rpcClient.rpc !== "function") {
            return fallbackBootstrapOrg({
                userId: input.userId,
                name: normalizedName,
                slug: normalizedSlug,
            });
        }

        const { data, error } = await rpcClient.rpc("bootstrap_org", {
            p_user_id: input.userId,
            p_name: normalizedName,
            p_slug: normalizedSlug,
        });

        if (error) {
            const message = error.message || "";
            if (message.includes("ORG_BOOTSTRAP_NAME_REQUIRED")) {
                throw new Error("ORG_BOOTSTRAP_NAME_REQUIRED");
            }
            if (isSlugConflictMessage(message)) {
                throw new Error("ORG_BOOTSTRAP_SLUG_CONFLICT");
            }
            if (isMissingBootstrapRpcMessage(message)) {
                return fallbackBootstrapOrg({
                    userId: input.userId,
                    name: normalizedName,
                    slug: normalizedSlug,
                });
            }
            throw error;
        }

        const payload = normalizeRpcPayload(data);
        if (!payload) {
            throw new Error("ORG_BOOTSTRAP_RPC_EMPTY_RESULT");
        }

        console.log("[ORG] bootstrap created:", {
            org_id: payload.org_id,
            user_id: input.userId,
        });

        return {
            active_org: {
                id: payload.org_id,
                name: payload.org_name,
                slug: payload.org_slug,
                status: payload.org_status,
            },
            membership: {
                org_id: payload.membership_org_id,
                user_id: payload.membership_user_id,
                role: payload.membership_role,
                status: payload.membership_status,
            },
        };
    }
}
