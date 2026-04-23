import { OrgMembershipRecord, OrgMembershipStatus, OrgRole } from "../lib/orgAccess";
import { supabaseAdmin } from "../lib/supabaseClient";

type ProfileRecord = {
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
};

export interface OrgMemberDirectoryRecord {
    id: string;
    user_id: string;
    org_id: string;
    role: OrgRole;
    status: OrgMembershipStatus;
    title: string | null;
    approval_limit: number | null;
    joined_at: string | null;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
    display_name: string | null;
}

function pickDisplayName(profile: ProfileRecord | undefined): string | null {
    if (!profile) {
        return null;
    }

    return profile.full_name || profile.username || null;
}

function compareMembers(a: OrgMemberDirectoryRecord, b: OrgMemberDirectoryRecord): number {
    const left = a.display_name || a.id;
    const right = b.display_name || b.id;
    return left.localeCompare(right, "ja");
}

async function loadProfilesByIds(userIds: string[]): Promise<Map<string, ProfileRecord>> {
    if (userIds.length === 0) {
        return new Map();
    }

    const { data, error } = await supabaseAdmin
        .from("profiles")
        .select("id,full_name,username,avatar_url")
        .in("id", userIds);

    if (error) {
        throw error;
    }

    return new Map(((data || []) as ProfileRecord[]).map((profile) => [profile.id, profile]));
}

export async function listOrgMembers(orgId: string): Promise<OrgMemberDirectoryRecord[]> {
    const { data, error } = await supabaseAdmin
        .from("org_memberships")
        .select("org_id,user_id,role,status,title,approval_limit,joined_at")
        .eq("org_id", orgId)
        .eq("status", "active");

    if (error) {
        throw error;
    }

    const memberships = (data || []) as OrgMembershipRecord[];
    const profileMap = await loadProfilesByIds(memberships.map((membership) => membership.user_id));

    return memberships
        .map((membership) => {
            const profile = profileMap.get(membership.user_id);

            return {
                id: membership.user_id,
                user_id: membership.user_id,
                org_id: membership.org_id,
                role: membership.role,
                status: membership.status,
                title: membership.title ?? null,
                approval_limit: membership.approval_limit ?? null,
                joined_at: membership.joined_at ?? null,
                full_name: profile?.full_name ?? null,
                username: profile?.username ?? null,
                avatar_url: profile?.avatar_url ?? null,
                display_name: pickDisplayName(profile),
            };
        })
        .sort(compareMembers);
}

