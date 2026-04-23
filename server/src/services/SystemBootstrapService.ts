import { countOrganizations } from "./AppEntryService";
import { ensureProfileRecord } from "../lib/ensureProfileRecord";
import { supabaseAdmin } from "../lib/supabaseClient";
import type { OrgBootstrapResult } from "./OrgBootstrapService";

export interface SystemBootstrapInput {
    userId: string;
    name: string;
    slug?: string | null;
}

interface SystemBootstrapRpcPayload {
    org_id: string;
    org_name: string;
    org_slug: string | null;
    org_status: "active";
    membership_org_id: string;
    membership_user_id: string;
    membership_role: "admin";
    membership_status: "active";
}

function normalizeSlug(slug: string | null | undefined): string | null {
    if (typeof slug !== "string") {
        return null;
    }

    const normalized = slug.trim().toLowerCase();
    return normalized || null;
}

function normalizeRpcPayload(data: unknown): SystemBootstrapRpcPayload | null {
    if (!data) {
        return null;
    }

    if (Array.isArray(data)) {
        return (data[0] || null) as SystemBootstrapRpcPayload | null;
    }

    if (typeof data === "object") {
        return data as SystemBootstrapRpcPayload;
    }

    return null;
}

export class SystemBootstrapService {
    async bootstrapFirstOrg(input: SystemBootstrapInput): Promise<OrgBootstrapResult> {
        const organizationCount = await countOrganizations();
        if (organizationCount > 0) {
            throw new Error("SYSTEM_BOOTSTRAP_ALREADY_COMPLETED");
        }

        const normalizedName = input.name.trim();
        if (!normalizedName) {
            throw new Error("SYSTEM_BOOTSTRAP_NAME_REQUIRED");
        }

        await ensureProfileRecord(input.userId);

        const rpcClient = supabaseAdmin as unknown as {
            rpc?: (
                fn: string,
                args?: Record<string, unknown>,
            ) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };

        if (typeof rpcClient.rpc !== "function") {
            throw new Error("SYSTEM_BOOTSTRAP_RPC_NOT_AVAILABLE");
        }

        const { data, error } = await rpcClient.rpc("bootstrap_first_org", {
            p_user_id: input.userId,
            p_name: normalizedName,
            p_slug: normalizeSlug(input.slug),
        });

        if (error) {
            const message = error.message || "";
            if (message.includes("SYSTEM_BOOTSTRAP_ALREADY_COMPLETED")) {
                throw new Error("SYSTEM_BOOTSTRAP_ALREADY_COMPLETED");
            }
            if (message.includes("SYSTEM_BOOTSTRAP_NAME_REQUIRED")) {
                throw new Error("SYSTEM_BOOTSTRAP_NAME_REQUIRED");
            }
            if (message.includes("SYSTEM_BOOTSTRAP_SLUG_CONFLICT") || message.includes("ORG_BOOTSTRAP_SLUG_CONFLICT")) {
                throw new Error("SYSTEM_BOOTSTRAP_SLUG_CONFLICT");
            }
            if (
                message.includes("bootstrap_first_org") &&
                (message.includes("does not exist") || message.includes("Could not find the function"))
            ) {
                throw new Error("SYSTEM_BOOTSTRAP_RPC_NOT_AVAILABLE");
            }
            throw error;
        }

        const payload = normalizeRpcPayload(data);
        if (!payload) {
            throw new Error("SYSTEM_BOOTSTRAP_RPC_EMPTY_RESULT");
        }

        console.log("[SYSTEM] first org bootstrapped:", {
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
