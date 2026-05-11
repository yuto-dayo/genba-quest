import { OrgMembershipRecord, OrgRole } from "../lib/orgAccess";
import { supabaseAdmin } from "../lib/supabaseClient";

export interface UpdateMemberRoleInput {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
    newRole: OrgRole;
}

export interface RemoveMemberInput {
    orgId: string;
    actorUserId: string;
    targetUserId: string;
}

async function loadActiveMembership(orgId: string, userId: string): Promise<OrgMembershipRecord | null> {
    const { data, error } = await supabaseAdmin
        .from("org_memberships")
        .select("id,org_id,user_id,role,status,title,approval_limit,joined_at")
        .eq("org_id", orgId)
        .eq("user_id", userId)
        .eq("status", "active")
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data as OrgMembershipRecord | null) ?? null;
}

async function countActiveAdmins(orgId: string): Promise<number> {
    const { count, error } = await supabaseAdmin
        .from("org_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "active")
        .eq("role", "admin");

    if (error) {
        throw error;
    }

    return count ?? 0;
}

export class OrgMembershipManagementService {
    async updateRole(input: UpdateMemberRoleInput): Promise<OrgMembershipRecord> {
        if (input.newRole !== "admin" && input.newRole !== "member") {
            throw new Error("ORG_MEMBER_ROLE_INVALID");
        }

        const target = await loadActiveMembership(input.orgId, input.targetUserId);
        if (!target) {
            throw new Error("ORG_MEMBER_NOT_FOUND");
        }

        if (target.role === input.newRole) {
            return target;
        }

        if (target.role === "admin" && input.newRole === "member") {
            const adminCount = await countActiveAdmins(input.orgId);
            if (adminCount <= 1) {
                throw new Error("ORG_MEMBER_LAST_ADMIN");
            }
        }

        const { data, error } = await supabaseAdmin
            .from("org_memberships")
            .update({ role: input.newRole, updated_at: new Date().toISOString() })
            .eq("org_id", input.orgId)
            .eq("user_id", input.targetUserId)
            .eq("status", "active")
            .select("id,org_id,user_id,role,status,title,approval_limit,joined_at")
            .single();

        if (error) {
            throw error;
        }

        return data as OrgMembershipRecord;
    }

    async remove(input: RemoveMemberInput): Promise<OrgMembershipRecord> {
        if (input.actorUserId === input.targetUserId) {
            throw new Error("ORG_MEMBER_REMOVE_SELF");
        }

        const target = await loadActiveMembership(input.orgId, input.targetUserId);
        if (!target) {
            throw new Error("ORG_MEMBER_NOT_FOUND");
        }

        if (target.role === "admin") {
            const adminCount = await countActiveAdmins(input.orgId);
            if (adminCount <= 1) {
                throw new Error("ORG_MEMBER_LAST_ADMIN");
            }
        }

        const { data, error } = await supabaseAdmin
            .from("org_memberships")
            .update({ status: "removed", updated_at: new Date().toISOString() })
            .eq("org_id", input.orgId)
            .eq("user_id", input.targetUserId)
            .eq("status", "active")
            .select("id,org_id,user_id,role,status,title,approval_limit,joined_at")
            .single();

        if (error) {
            throw error;
        }

        return data as OrgMembershipRecord;
    }
}
