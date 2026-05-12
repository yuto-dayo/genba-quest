import crypto from "node:crypto";

import { supabaseAdmin } from "../lib/supabaseClient";

export type OrgInviteRole = "admin" | "member";
export type OrgInviteStatus = "pending" | "accepted" | "revoked" | "expired";

const DEFAULT_TTL_DAYS = 7;

export interface OrgInviteCreateInput {
    orgId: string;
    invitedBy: string;
    email: string;
    role: OrgInviteRole;
    ttlDays?: number;
}

export interface OrgInviteListInput {
    orgId: string;
    status?: OrgInviteStatus | "all";
}

export interface OrgInviteRevokeInput {
    orgId: string;
    inviteId: string;
    revokedBy: string;
}

export interface OrgInviteRotateInput {
    orgId: string;
    inviteId: string;
    invitedBy: string;
    ttlDays?: number;
}

export interface OrgInviteRecord {
    id: string;
    org_id: string;
    email_normalized: string;
    role: OrgInviteRole;
    status: OrgInviteStatus;
    expires_at: string;
    invited_by: string | null;
    accepted_by: string | null;
    accepted_at: string | null;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
}

function normalizeEmail(value: string | null | undefined): string {
    if (typeof value !== "string") {
        return "";
    }
    return value.trim().toLowerCase();
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
    return error?.code === "23505";
}

export class OrgInviteCreationService {
    async create(input: OrgInviteCreateInput): Promise<OrgInviteRecord> {
        const email = normalizeEmail(input.email);
        if (!email) {
            throw new Error("ORG_INVITE_EMAIL_REQUIRED");
        }

        if (input.role !== "admin" && input.role !== "member") {
            throw new Error("ORG_INVITE_ROLE_INVALID");
        }

        const ttlDays = input.ttlDays && input.ttlDays > 0 ? input.ttlDays : DEFAULT_TTL_DAYS;
        const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
        const tokenHash = crypto.randomBytes(32).toString("hex");

        const { data, error } = await supabaseAdmin
            .from("org_invites")
            .insert({
                org_id: input.orgId,
                email_normalized: email,
                role: input.role,
                status: "pending",
                token_hash: tokenHash,
                expires_at: expiresAt,
                invited_by: input.invitedBy,
            })
            .select("id,org_id,email_normalized,role,status,expires_at,invited_by,accepted_by,accepted_at,revoked_at,created_at,updated_at")
            .single();

        if (error) {
            if (isUniqueViolation(error)) {
                throw new Error("ORG_INVITE_PENDING_DUPLICATE");
            }
            throw error;
        }

        return data as OrgInviteRecord;
    }

    async list(input: OrgInviteListInput): Promise<OrgInviteRecord[]> {
        let query = supabaseAdmin
            .from("org_invites")
            .select("id,org_id,email_normalized,role,status,expires_at,invited_by,accepted_by,accepted_at,revoked_at,created_at,updated_at")
            .eq("org_id", input.orgId)
            .order("created_at", { ascending: false });

        const status = input.status ?? "pending";
        if (status !== "all") {
            query = query.eq("status", status);
        }

        const { data, error } = await query;
        if (error) {
            throw error;
        }

        return (data as OrgInviteRecord[]) || [];
    }

    async rotate(input: OrgInviteRotateInput): Promise<OrgInviteRecord> {
        const { data: existing, error: readError } = await supabaseAdmin
            .from("org_invites")
            .select("id,status,org_id,email_normalized,role")
            .eq("id", input.inviteId)
            .maybeSingle();

        if (readError) {
            throw readError;
        }

        if (!existing || existing.org_id !== input.orgId) {
            throw new Error("ORG_INVITE_NOT_FOUND");
        }

        if (existing.status !== "pending") {
            throw new Error("ORG_INVITE_NOT_PENDING");
        }

        const { error: revokeError } = await supabaseAdmin
            .from("org_invites")
            .update({
                status: "revoked",
                revoked_at: new Date().toISOString(),
            })
            .eq("id", input.inviteId)
            .eq("status", "pending");

        if (revokeError) {
            throw revokeError;
        }

        return this.create({
            orgId: input.orgId,
            invitedBy: input.invitedBy,
            email: existing.email_normalized,
            role: existing.role as OrgInviteRole,
            ttlDays: input.ttlDays,
        });
    }

    async revoke(input: OrgInviteRevokeInput): Promise<OrgInviteRecord> {
        const { data: existing, error: readError } = await supabaseAdmin
            .from("org_invites")
            .select("id,status,org_id")
            .eq("id", input.inviteId)
            .maybeSingle();

        if (readError) {
            throw readError;
        }

        if (!existing) {
            throw new Error("ORG_INVITE_NOT_FOUND");
        }

        if (existing.org_id !== input.orgId) {
            throw new Error("ORG_INVITE_NOT_FOUND");
        }

        if (existing.status !== "pending") {
            throw new Error("ORG_INVITE_NOT_PENDING");
        }

        const { data, error } = await supabaseAdmin
            .from("org_invites")
            .update({
                status: "revoked",
                revoked_at: new Date().toISOString(),
            })
            .eq("id", input.inviteId)
            .eq("status", "pending")
            .select("id,org_id,email_normalized,role,status,expires_at,invited_by,accepted_by,accepted_at,revoked_at,created_at,updated_at")
            .single();

        if (error) {
            throw error;
        }

        return data as OrgInviteRecord;
    }
}
