import { ensureProfileRecord } from "../lib/ensureProfileRecord";
import { supabaseAdmin } from "../lib/supabaseClient";

export interface OrgInviteAcceptInput {
    inviteId: string;
    userId: string;
    userEmail: string | null | undefined;
}

export interface OrgInviteAcceptResult {
    active_org: {
        id: string;
        name: string;
        slug: string | null;
        status: "active";
    };
    membership: {
        org_id: string;
        user_id: string;
        role: "admin" | "member";
        status: "active";
    };
}

interface AcceptInviteRpcPayload {
    org_id: string;
    org_name: string;
    org_slug: string | null;
    org_status: "active";
    membership_org_id: string;
    membership_user_id: string;
    membership_role: "admin" | "member";
    membership_status: "active";
}

interface PendingInviteRow {
    id: string;
    org_id: string;
    email_normalized: string;
    role: "admin" | "member";
    status: "pending" | "accepted" | "revoked" | "expired";
    expires_at: string;
}

interface OrganizationRow {
    id: string;
    name: string;
    slug: string | null;
    status: "active";
}

function normalizeEmail(email: string | null | undefined): string | null {
    if (typeof email !== "string") {
        return null;
    }

    const normalized = email.trim().toLowerCase();
    return normalized || null;
}

function normalizeRpcPayload(data: unknown): AcceptInviteRpcPayload | null {
    if (!data) {
        return null;
    }

    if (Array.isArray(data)) {
        return (data[0] || null) as AcceptInviteRpcPayload | null;
    }

    if (typeof data === "object") {
        return data as AcceptInviteRpcPayload;
    }

    return null;
}

function isMissingAcceptRpcMessage(message: string): boolean {
    return message.includes("accept_org_invite") &&
        (message.includes("does not exist") || message.includes("Could not find the function"));
}

function mapInviteError(message: string): Error {
    if (message.includes("ORG_INVITE_NOT_FOUND")) {
        return new Error("ORG_INVITE_NOT_FOUND");
    }

    if (message.includes("ORG_INVITE_NOT_PENDING")) {
        return new Error("ORG_INVITE_NOT_PENDING");
    }

    if (message.includes("ORG_INVITE_EXPIRED")) {
        return new Error("ORG_INVITE_EXPIRED");
    }

    if (message.includes("ORG_INVITE_EMAIL_MISMATCH")) {
        return new Error("ORG_INVITE_EMAIL_MISMATCH");
    }

    if (message.includes("ORG_INVITE_EMAIL_REQUIRED")) {
        return new Error("ORG_INVITE_EMAIL_REQUIRED");
    }

    return new Error(message || "ORG_INVITE_ACCEPT_FAILED");
}

async function fallbackAcceptInvite(input: {
    inviteId: string;
    userId: string;
    userEmail: string;
}): Promise<OrgInviteAcceptResult> {
    const { data: inviteData, error: inviteError } = await supabaseAdmin
        .from("org_invites")
        .select("id,org_id,email_normalized,role,status,expires_at")
        .eq("id", input.inviteId)
        .maybeSingle();

    if (inviteError) {
        throw inviteError;
    }

    const invite = inviteData as PendingInviteRow | null;
    if (!invite) {
        throw new Error("ORG_INVITE_NOT_FOUND");
    }

    if (invite.status !== "pending") {
        throw new Error("ORG_INVITE_NOT_PENDING");
    }

    if (new Date(invite.expires_at).getTime() < Date.now()) {
        await supabaseAdmin
            .from("org_invites")
            .update({ status: "expired" })
            .eq("id", input.inviteId)
            .eq("status", "pending");
        throw new Error("ORG_INVITE_EXPIRED");
    }

    if (invite.email_normalized !== input.userEmail) {
        throw new Error("ORG_INVITE_EMAIL_MISMATCH");
    }

    const joinedAt = new Date().toISOString();
    const { error: membershipError } = await supabaseAdmin
        .from("org_memberships")
        .upsert(
            {
                org_id: invite.org_id,
                user_id: input.userId,
                role: invite.role,
                status: "active",
                joined_at: joinedAt,
                suspended_at: null,
                suspended_reason: null,
            },
            {
                onConflict: "org_id,user_id",
            },
        );

    if (membershipError) {
        throw membershipError;
    }

    const { error: updateError } = await supabaseAdmin
        .from("org_invites")
        .update({
            status: "accepted",
            accepted_by: input.userId,
            accepted_at: joinedAt,
        })
        .eq("id", input.inviteId)
        .eq("status", "pending");

    if (updateError) {
        throw updateError;
    }

    const { data: orgData, error: orgError } = await supabaseAdmin
        .from("organizations")
        .select("id,name,slug,status")
        .eq("id", invite.org_id)
        .maybeSingle();

    if (orgError) {
        throw orgError;
    }

    const org = orgData as OrganizationRow | null;
    if (!org) {
        throw new Error("ORG_NOT_FOUND");
    }

    return {
        active_org: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
        },
        membership: {
            org_id: invite.org_id,
            user_id: input.userId,
            role: invite.role,
            status: "active",
        },
    };
}

export class OrgInviteAcceptanceService {
    async accept(input: OrgInviteAcceptInput): Promise<OrgInviteAcceptResult> {
        const normalizedEmail = normalizeEmail(input.userEmail);
        if (!normalizedEmail) {
            throw new Error("ORG_INVITE_EMAIL_REQUIRED");
        }

        await ensureProfileRecord(input.userId);

        const rpcClient = supabaseAdmin as unknown as {
            rpc?: (
                fn: string,
                args?: Record<string, unknown>,
            ) => Promise<{ data: unknown; error: { message?: string } | null }>;
        };

        if (typeof rpcClient.rpc !== "function") {
            return fallbackAcceptInvite({
                inviteId: input.inviteId,
                userId: input.userId,
                userEmail: normalizedEmail,
            });
        }

        const { data, error } = await rpcClient.rpc("accept_org_invite", {
            p_invite_id: input.inviteId,
            p_user_id: input.userId,
            p_email: normalizedEmail,
        });

        if (error) {
            const message = error.message || "";
            if (isMissingAcceptRpcMessage(message)) {
                return fallbackAcceptInvite({
                    inviteId: input.inviteId,
                    userId: input.userId,
                    userEmail: normalizedEmail,
                });
            }

            throw mapInviteError(message);
        }

        const payload = normalizeRpcPayload(data);
        if (!payload) {
            throw new Error("ORG_INVITE_ACCEPT_EMPTY_RESULT");
        }

        console.log("[ORG] invite accepted:", {
            invite_id: input.inviteId,
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
