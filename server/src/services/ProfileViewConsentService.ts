/**
 * ProfileViewConsentService
 *
 * 拡張プロフィール (振込先 / インボイス番号 / 住所 / 緊急連絡) は admin であっても
 * 本人の Proposal 承認なしには見られない。承認された proposal.view_request Proposal が
 * executed になったとき profile_view_grants 行が発行され、admin は期限内のみ参照できる。
 *
 * DAO 原則の体現:
 *  - admin の覗き見禁止: 一覧 API は呼び出し本人視点 (incoming/outgoing) のみ
 *  - 本人の主権: revoke は target_user_id のみ可能
 *  - 全アクセスを governance_events に追跡 (recordGovernanceEvent ヘルパ経由)
 */

import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import type { ActorRef, Proposal } from "./PolicyEngine";

// ============================================================
// Types
// ============================================================

export interface ProfileViewGrantRecord {
    id: string;
    org_id: string;
    proposal_id: string;
    target_user_id: string;
    requesting_admin_id: string;
    purpose: string;
    granted_at: string;
    expires_at: string;
    revoked_at: string | null;
    revoked_by: string | null;
    revocation_reason: string | null;
    created_at: string;
}

export interface ExtendedProfileFields {
    id: string;
    phone: string | null;
    job_type: string | null;
    employment_kind: string | null;
    trade_name: string | null;
    invoice_registration_number: string | null;
    bank_name: string | null;
    branch_name: string | null;
    account_type: string | null;
    account_number: string | null;
    account_holder_kana: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
    emergency_contact_name: string | null;
    emergency_phone: string | null;
}

export type ProfileViewClient = Pick<SupabaseClient, "from">;

const DEFAULT_GRANT_DURATION_HOURS = 24;
const MAX_GRANT_DURATION_HOURS = 24 * 7; // 1 週間が上限。これより長い覗き見権限は許さない
const EXTENDED_PROFILE_COLUMNS = [
    "id",
    "phone",
    "job_type",
    "employment_kind",
    "trade_name",
    "invoice_registration_number",
    "bank_name",
    "branch_name",
    "account_type",
    "account_number",
    "account_holder_kana",
    "postal_code",
    "prefecture",
    "city",
    "address_line1",
    "address_line2",
    "emergency_contact_name",
    "emergency_phone",
].join(",");

export interface CreateGrantFromProposalResult {
    grant: ProfileViewGrantRecord;
    alreadyExisted: boolean;
}

// ============================================================
// Service
// ============================================================

export class ProfileViewConsentService {
    constructor(private readonly client: ProfileViewClient = supabaseAdmin) {}

    /**
     * Proposal が executed になった瞬間に呼ばれる。
     * 同一 proposal_id に対しては 1 行のみ作る (冪等)。
     */
    async createGrantFromExecutedProposal(
        proposal: Proposal,
    ): Promise<CreateGrantFromProposalResult> {
        if (proposal.type !== "profile.view_request") {
            throw new Error("PROFILE_VIEW_CONSENT_INVALID_PROPOSAL_TYPE");
        }

        const payload = proposal.payload as Record<string, unknown>;
        const targetUserId = stringField(payload, "target_user_id");
        const requestingAdminId = stringField(payload, "requesting_admin_id");
        const purpose = stringField(payload, "purpose");
        const durationHours = clampDurationHours(payload.duration_hours);

        if (!targetUserId || !requestingAdminId || !purpose) {
            throw new Error("PROFILE_VIEW_CONSENT_INVALID_PAYLOAD");
        }

        if (targetUserId === requestingAdminId) {
            throw new Error("PROFILE_VIEW_CONSENT_SELF_GRANT_PROHIBITED");
        }

        // 冪等: 同一 proposal でも複数回呼ばれる可能性を考慮
        const existing = await this.findGrantByProposal(proposal.id);
        if (existing) {
            return { grant: existing, alreadyExisted: true };
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + durationHours * 60 * 60 * 1000);

        const { data, error } = await this.client
            .from("profile_view_grants")
            .insert({
                org_id: proposal.org_id,
                proposal_id: proposal.id,
                target_user_id: targetUserId,
                requesting_admin_id: requestingAdminId,
                purpose,
                granted_at: now.toISOString(),
                expires_at: expiresAt.toISOString(),
            })
            .select("*")
            .single();

        if (error) {
            throw new Error(`Failed to create profile view grant: ${error.message}`);
        }

        return { grant: data as ProfileViewGrantRecord, alreadyExisted: false };
    }

    /**
     * 本人 (target_user_id) が grant を取り消す。
     * 申請者 (admin) には revoke 権限を与えない。
     * governance.profile_view.revoked イベントを残す。
     */
    async revokeGrant(input: {
        grantId: string;
        revokingUserId: string;
        revokingUserName?: string | null;
        reason?: string;
    }): Promise<ProfileViewGrantRecord> {
        const grant = await this.getById(input.grantId);
        if (!grant) {
            throw new Error("PROFILE_VIEW_GRANT_NOT_FOUND");
        }

        if (grant.target_user_id !== input.revokingUserId) {
            throw new Error("PROFILE_VIEW_GRANT_REVOKE_NOT_ALLOWED");
        }

        if (grant.revoked_at) {
            // すでに取り消し済みは冪等 (idempotent) に扱う
            return grant;
        }

        const { data, error } = await this.client
            .from("profile_view_grants")
            .update({
                revoked_at: new Date().toISOString(),
                revoked_by: input.revokingUserId,
                revocation_reason: input.reason?.trim() || null,
            })
            .eq("id", input.grantId)
            .select("*")
            .single();

        if (error) {
            throw new Error(`Failed to revoke profile view grant: ${error.message}`);
        }

        const updated = data as ProfileViewGrantRecord;
        await this.recordGovernanceEvent({
            orgId: grant.org_id,
            proposalId: grant.proposal_id,
            eventType: "governance.profile_view.revoked",
            dedupeKey: `${grant.id}:governance.profile_view.revoked`,
            actor: {
                type: "human",
                id: input.revokingUserId,
                name: input.revokingUserName || "target",
            },
            payload: {
                grant_id: grant.id,
                requesting_admin_id: grant.requesting_admin_id,
                target_user_id: grant.target_user_id,
                reason: input.reason?.trim() || null,
            },
        });

        return updated;
    }

    /**
     * 「拡張プロフィールを実際に閲覧した」事実を governance_events に追記する。
     * 監査トレイル目的。getExtendedProfileForViewer から呼ばれる想定。
     */
    async recordViewAccess(input: {
        grant: ProfileViewGrantRecord;
        viewer: ActorRef;
    }): Promise<void> {
        const accessedAt = new Date().toISOString();
        await this.recordGovernanceEvent({
            orgId: input.grant.org_id,
            proposalId: input.grant.proposal_id,
            eventType: "governance.profile_view.accessed",
            // dedupe を per-access にすると governance_events の unique 制約に
            // ぶつかるので grant.id + ISO timestamp で粒度を確保する。
            dedupeKey: `${input.grant.id}:access:${accessedAt}`,
            actor: input.viewer,
            payload: {
                grant_id: input.grant.id,
                target_user_id: input.grant.target_user_id,
                requesting_admin_id: input.grant.requesting_admin_id,
                accessed_at: accessedAt,
            },
        });
    }

    /**
     * 「自分が拡張情報を見られている (target)」立場で、自分宛の grant を一覧する。
     * 監視 UI ではないため target 視点の限定リストのみを返す。
     */
    async listGrantsForTarget(input: {
        orgId: string;
        targetUserId: string;
    }): Promise<ProfileViewGrantRecord[]> {
        const { data, error } = await this.client
            .from("profile_view_grants")
            .select("*")
            .eq("org_id", input.orgId)
            .eq("target_user_id", input.targetUserId)
            .order("granted_at", { ascending: false });

        if (error) {
            throw new Error(`Failed to list grants for target: ${error.message}`);
        }

        return (data || []) as ProfileViewGrantRecord[];
    }

    /**
     * 「自分 (admin) が申請した」立場で、自分の grant を一覧する。
     * 他 admin の grant は意図的に見せない (= 監視 UI を作らない)。
     */
    async listGrantsForRequester(input: {
        orgId: string;
        requestingAdminId: string;
    }): Promise<ProfileViewGrantRecord[]> {
        const { data, error } = await this.client
            .from("profile_view_grants")
            .select("*")
            .eq("org_id", input.orgId)
            .eq("requesting_admin_id", input.requestingAdminId)
            .order("granted_at", { ascending: false });

        if (error) {
            throw new Error(`Failed to list grants for requester: ${error.message}`);
        }

        return (data || []) as ProfileViewGrantRecord[];
    }

    /**
     * admin が拡張プロフィールを取得する。
     * - 自分自身に対しては grant 不要 (governance_events も発火させない)
     * - 他人については active かつ未失効な grant が必要
     * - 他人の取得時は governance.profile_view.accessed を必ず追記する
     */
    async getExtendedProfileForViewer(input: {
        orgId: string;
        targetUserId: string;
        viewer: ActorRef;
    }): Promise<{ profile: ExtendedProfileFields; grant: ProfileViewGrantRecord | null }> {
        if (input.targetUserId !== input.viewer.id) {
            const grant = await this.findActiveGrant({
                orgId: input.orgId,
                targetUserId: input.targetUserId,
                requestingAdminId: input.viewer.id,
            });
            if (!grant) {
                throw new Error("PROFILE_VIEW_GRANT_REQUIRED");
            }
            const profile = await this.loadExtendedProfile(input.targetUserId);
            await this.recordViewAccess({ grant, viewer: input.viewer });
            return { profile, grant };
        }

        const profile = await this.loadExtendedProfile(input.targetUserId);
        return { profile, grant: null };
    }

    // ============================================================
    // Internal helpers
    // ============================================================

    async getById(grantId: string): Promise<ProfileViewGrantRecord | null> {
        const { data, error } = await this.client
            .from("profile_view_grants")
            .select("*")
            .eq("id", grantId)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to load profile view grant: ${error.message}`);
        }

        return (data || null) as ProfileViewGrantRecord | null;
    }

    async findGrantByProposal(proposalId: string): Promise<ProfileViewGrantRecord | null> {
        const { data, error } = await this.client
            .from("profile_view_grants")
            .select("*")
            .eq("proposal_id", proposalId)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to load grant by proposal: ${error.message}`);
        }

        return (data || null) as ProfileViewGrantRecord | null;
    }

    async findActiveGrant(input: {
        orgId: string;
        targetUserId: string;
        requestingAdminId: string;
    }): Promise<ProfileViewGrantRecord | null> {
        const nowIso = new Date().toISOString();
        const { data, error } = await this.client
            .from("profile_view_grants")
            .select("*")
            .eq("org_id", input.orgId)
            .eq("target_user_id", input.targetUserId)
            .eq("requesting_admin_id", input.requestingAdminId)
            .is("revoked_at", null)
            .gt("expires_at", nowIso)
            .order("granted_at", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to find active grant: ${error.message}`);
        }

        return (data || null) as ProfileViewGrantRecord | null;
    }

    private async recordGovernanceEvent(input: {
        orgId: string;
        proposalId: string;
        eventType: string;
        dedupeKey: string;
        actor: ActorRef;
        payload: Record<string, unknown>;
    }): Promise<void> {
        const { error } = await this.client
            .from("governance_events")
            .upsert(
                {
                    org_id: input.orgId,
                    proposal_id: input.proposalId,
                    aggregate_type: "profile_view_grant",
                    aggregate_id: input.proposalId,
                    event_type: input.eventType,
                    dedupe_key: input.dedupeKey,
                    payload: input.payload,
                    policy_context: {},
                    actor: input.actor,
                },
                { onConflict: "org_id,dedupe_key" },
            );

        if (error) {
            throw new Error(
                `Failed to record profile view governance event: ${error.message}`,
            );
        }
    }

    private async loadExtendedProfile(userId: string): Promise<ExtendedProfileFields> {
        const { data, error } = await this.client
            .from("profiles")
            .select(EXTENDED_PROFILE_COLUMNS)
            .eq("id", userId)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to load extended profile: ${error.message}`);
        }

        if (!data) {
            throw new Error("PROFILE_NOT_FOUND");
        }

        return data as unknown as ExtendedProfileFields;
    }
}

// ============================================================
// Helpers
// ============================================================

function stringField(
    obj: Record<string, unknown>,
    key: string,
): string | null {
    const value = obj[key];
    if (typeof value !== "string") {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
}

function clampDurationHours(raw: unknown): number {
    const numeric = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return DEFAULT_GRANT_DURATION_HOURS;
    }
    return Math.min(Math.max(1, Math.floor(numeric)), MAX_GRANT_DURATION_HOURS);
}

export const profileViewConsentService = new ProfileViewConsentService();

// 後方互換 / テスト用: actor を governance event に取り回しやすくする
export function actorIsTargetOfProposal(
    proposal: Proposal,
    actor: ActorRef,
): boolean {
    if (proposal.type !== "profile.view_request") {
        return false;
    }
    const targetId = (proposal.payload as Record<string, unknown>)?.target_user_id;
    return typeof targetId === "string" && actor.id === targetId;
}
