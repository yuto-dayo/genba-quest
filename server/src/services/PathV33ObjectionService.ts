// PATH V3.3 Phase 4: peer-review Objection + Co-sign service.
// Spec: docs/REWARD_SYSTEM_V33.md §6
//
// Objection lifecycle:
//   open → accepted (co_signs reach required_co_signs)
//   open → expired (expires_at passes without quorum) — Phase 5 cron
//   open → rejected (manual close; not implemented here)
//
// Co-sign accounting:
//   - The objector's submission counts as the first co-sign automatically.
//   - The target member's self-agreement reduces required_co_signs by 1 (min 1).
//   - Each unique signer (by user_id) only counts once.

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { DEV_AUTH_USERS, isDevAuthMode } from "../config/devAuthUsers";
import { ActorRef } from "./PolicyEngine";
import {
  PathV33Tier,
  PATH_V33_LEVEL_WEIGHT_MILLI,
  PathV33Level,
  requiredCoSigns,
} from "./PathV33RewardService";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OBJECTION_TTL_MS = 48 * 60 * 60 * 1000; // 48h discussion period

function ensureUuid(value: unknown, code: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(code);
  }
  return value;
}

function ensureTier(value: unknown): PathV33Tier {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error("PATH_V33_INVALID_TIER");
  }
  return value;
}

export interface CoSignEntry {
  user_id: string;
  user_name: string;
  signed_at: string;
  comment: string;
}

export interface TargetResponse {
  agreed: boolean;
  comment: string;
  responded_at: string;
}

export interface ObjectionRecord {
  id: string;
  org_id: string;
  target_member_id: string;
  target_month: string;
  target_draft_id: string;
  objector_id: string;
  proposed_tier: PathV33Tier;
  reason: string;
  evidence: Record<string, unknown>;
  co_signs: CoSignEntry[];
  target_self_response: TargetResponse | null;
  required_co_signs: number;
  status: "open" | "accepted" | "rejected" | "expired";
  expires_at: string;
  resolved_at: string | null;
  resolved_tier: PathV33Tier | null;
  created_at: string;
  updated_at: string;
}

export interface SubmitObjectionInput {
  target_draft_id: string;
  proposed_tier: PathV33Tier;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface CoSignInput {
  comment?: string;
}

export interface TargetRespondInput {
  agreed: boolean;
  comment?: string;
}

export class PathV33ObjectionService {
  constructor(private readonly orgId: string) {
    if (!UUID_PATTERN.test(orgId)) {
      throw new Error("ORG_CONTEXT_REQUIRED");
    }
  }

  async submit(input: SubmitObjectionInput, actor: ActorRef): Promise<ObjectionRecord> {
    if (actor.type !== "human") {
      throw new Error("PATH_V33_HUMAN_ACTOR_REQUIRED");
    }
    const objectorId = ensureUuid(actor.id, "INVALID_OBJECTOR_ID");
    const draftId = ensureUuid(input.target_draft_id, "INVALID_SITE_ID");
    const proposedTier = ensureTier(input.proposed_tier);
    const reason = (input.reason ?? "").toString().trim();
    if (reason.length === 0) {
      throw new Error("PATH_V33_OBJECTION_REASON_REQUIRED");
    }

    const draft = await this.fetchDraft(draftId);
    if (draft.tier === proposedTier) {
      throw new Error("PATH_V33_OBJECTION_NO_CHANGE");
    }
    if (draft.locked_at) {
      throw new Error("PATH_V33_OBJECTION_LOCKED_DRAFT");
    }

    const month = this.resolveDraftMonth(draft.submitted_at);
    const teamSize = await this.countActiveMembers();
    const required = requiredCoSigns(teamSize, false);

    const objectorName = actor.name ?? objectorId;
    const initialCoSign: CoSignEntry = {
      user_id: objectorId,
      user_name: objectorName,
      signed_at: new Date().toISOString(),
      comment: reason,
    };

    const { data, error } = await supabaseAdmin
      .from("level_objections")
      .insert({
        org_id: this.orgId,
        target_member_id: draft.member_id,
        target_month: month,
        target_draft_id: draftId,
        objector_id: objectorId,
        proposed_tier: proposedTier,
        reason,
        evidence: input.evidence ?? {},
        co_signs: [initialCoSign],
        required_co_signs: required,
        status: "open",
        expires_at: new Date(Date.now() + OBJECTION_TTL_MS).toISOString(),
      })
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to create objection: ${error?.message ?? "no row"}`);
    }

    const objection = this.normalizeRow(data);
    await this.createProposalWrapper(objection, actor);
    return objection;
  }

  async coSign(
    objectionId: string,
    input: CoSignInput,
    actor: ActorRef,
  ): Promise<ObjectionRecord> {
    if (actor.type !== "human") {
      throw new Error("PATH_V33_HUMAN_ACTOR_REQUIRED");
    }
    const signerId = ensureUuid(actor.id, "INVALID_SIGNER_ID");
    const objection = await this.fetchObjection(objectionId);
    if (objection.status !== "open") {
      throw new Error("PATH_V33_OBJECTION_NOT_OPEN");
    }
    if (signerId === objection.target_member_id) {
      throw new Error("PATH_V33_TARGET_CANNOT_COSIGN");
    }
    if (objection.co_signs.some((entry) => entry.user_id === signerId)) {
      throw new Error("PATH_V33_ALREADY_COSIGNED");
    }

    const next: CoSignEntry = {
      user_id: signerId,
      user_name: actor.name ?? signerId,
      signed_at: new Date().toISOString(),
      comment: (input.comment ?? "").toString().trim(),
    };
    const updatedCoSigns = [...objection.co_signs, next];

    if (updatedCoSigns.length >= objection.required_co_signs) {
      return this.acceptObjection(objection, updatedCoSigns);
    }

    const { data, error } = await supabaseAdmin
      .from("level_objections")
      .update({ co_signs: updatedCoSigns })
      .eq("id", objection.id)
      .eq("org_id", this.orgId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to record co-sign: ${error?.message ?? "no row"}`);
    }
    return this.normalizeRow(data);
  }

  async targetRespond(
    objectionId: string,
    input: TargetRespondInput,
    actor: ActorRef,
  ): Promise<ObjectionRecord> {
    if (actor.type !== "human") {
      throw new Error("PATH_V33_HUMAN_ACTOR_REQUIRED");
    }
    const responderId = ensureUuid(actor.id, "INVALID_RESPONDER_ID");
    const objection = await this.fetchObjection(objectionId);
    if (objection.status !== "open") {
      throw new Error("PATH_V33_OBJECTION_NOT_OPEN");
    }
    if (responderId !== objection.target_member_id) {
      throw new Error("PATH_V33_NOT_TARGET_MEMBER");
    }

    const response: TargetResponse = {
      agreed: Boolean(input.agreed),
      comment: (input.comment ?? "").toString().trim(),
      responded_at: new Date().toISOString(),
    };

    // Self-agreement lowers the bar by 1 (floor 1) per spec §6.
    const nextRequired = response.agreed
      ? Math.max(1, objection.required_co_signs - 1)
      : objection.required_co_signs;

    // After lowering the bar, the existing co_signs count may already qualify
    // for acceptance — re-check.
    if (response.agreed && objection.co_signs.length >= nextRequired) {
      return this.acceptObjection(
        { ...objection, required_co_signs: nextRequired, target_self_response: response },
        objection.co_signs,
      );
    }

    const { data, error } = await supabaseAdmin
      .from("level_objections")
      .update({
        target_self_response: response,
        required_co_signs: nextRequired,
      })
      .eq("id", objection.id)
      .eq("org_id", this.orgId)
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to record target response: ${error?.message ?? "no row"}`);
    }
    return this.normalizeRow(data);
  }

  async listOpen(): Promise<ObjectionRecord[]> {
    const { data, error } = await supabaseAdmin
      .from("level_objections")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("status", "open")
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(`Failed to list objections: ${error.message}`);
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => this.normalizeRow(row));
  }

  async getById(objectionId: string): Promise<ObjectionRecord> {
    return this.fetchObjection(objectionId);
  }

  private async fetchObjection(id: string): Promise<ObjectionRecord> {
    ensureUuid(id, "INVALID_OBJECTION_ID");
    const { data, error } = await supabaseAdmin
      .from("level_objections")
      .select("*")
      .eq("id", id)
      .eq("org_id", this.orgId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch objection: ${error.message}`);
    }
    if (!data) {
      throw new Error("PATH_V33_OBJECTION_NOT_FOUND");
    }
    return this.normalizeRow(data);
  }

  private async fetchDraft(draftId: string): Promise<{
    id: string;
    member_id: string;
    site_id: string;
    tier: PathV33Tier;
    submitted_at: string;
    locked_at: string | null;
  }> {
    const { data, error } = await supabaseAdmin
      .from("site_member_level_drafts")
      .select("id, member_id, site_id, tier, submitted_at, locked_at")
      .eq("id", draftId)
      .eq("org_id", this.orgId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch draft: ${error.message}`);
    }
    if (!data) {
      throw new Error("PATH_V33_DRAFT_NOT_FOUND");
    }
    return {
      id: String(data.id),
      member_id: String(data.member_id),
      site_id: String(data.site_id),
      tier: ensureTier(Number(data.tier)),
      submitted_at: String(data.submitted_at ?? ""),
      locked_at: typeof data.locked_at === "string" ? data.locked_at : null,
    };
  }

  private resolveDraftMonth(submittedAt: string): string {
    if (typeof submittedAt === "string" && submittedAt.length >= 7) {
      return submittedAt.slice(0, 7);
    }
    return new Date().toISOString().slice(0, 7);
  }

  private async countActiveMembers(): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from("org_memberships")
      .select("user_id")
      .eq("org_id", this.orgId)
      .eq("status", "active");
    if (error) {
      throw new Error(`Failed to count members: ${error.message}`);
    }
    const ids = new Set(
      ((data ?? []) as Array<{ user_id?: string }>)
        .map((row) => String(row.user_id ?? ""))
        .filter((value) => UUID_PATTERN.test(value)),
    );
    if (isDevAuthMode()) {
      DEV_AUTH_USERS.forEach((user) => ids.add(user.id));
    }
    return Math.max(1, ids.size);
  }

  private async acceptObjection(
    objection: ObjectionRecord,
    coSigns: CoSignEntry[],
  ): Promise<ObjectionRecord> {
    const now = new Date().toISOString();

    // 1. Update the objection row.
    const { data: acceptedRow, error: acceptError } = await supabaseAdmin
      .from("level_objections")
      .update({
        status: "accepted",
        co_signs: coSigns,
        resolved_at: now,
        resolved_tier: objection.proposed_tier,
        target_self_response: objection.target_self_response,
        required_co_signs: objection.required_co_signs,
      })
      .eq("id", objection.id)
      .eq("org_id", this.orgId)
      .select("*")
      .single();

    if (acceptError || !acceptedRow) {
      throw new Error(`Failed to accept objection: ${acceptError?.message ?? "no row"}`);
    }

    // 2. Rewrite the target draft tier to proposed_tier.
    const { error: draftError } = await supabaseAdmin
      .from("site_member_level_drafts")
      .update({ tier: objection.proposed_tier })
      .eq("id", objection.target_draft_id)
      .eq("org_id", this.orgId);
    if (draftError) {
      throw new Error(`Failed to rewrite draft tier: ${draftError.message}`);
    }

    // 3. Mark the paired Proposal as executed (best-effort; non-fatal).
    await supabaseAdmin
      .from("proposals")
      .update({ status: "executed", executed_at: now })
      .eq("org_id", this.orgId)
      .eq("type", "level.objection")
      .contains("payload", { objection_id: objection.id });

    return this.normalizeRow(acceptedRow);
  }

  // Best-effort: insert a Proposal wrapper so the objection surfaces in the
  // existing notification bell + inbox. The proposal stays pending until the
  // objection accepts/expires (acceptObjection / expire cron transitions it).
  private async createProposalWrapper(
    objection: ObjectionRecord,
    actor: ActorRef,
  ): Promise<void> {
    await supabaseAdmin.from("proposals").insert({
      org_id: this.orgId,
      type: "level.objection",
      status: "pending",
      description: `${objection.target_month} レベル申告への異議`,
      payload: {
        objection_id: objection.id,
        target_member_id: objection.target_member_id,
        target_draft_id: objection.target_draft_id,
        proposed_tier: objection.proposed_tier,
        reason: objection.reason,
        required_co_signs: objection.required_co_signs,
        target_month: objection.target_month,
      },
      created_by: actor,
    });
  }

  private normalizeRow(row: Record<string, unknown>): ObjectionRecord {
    const proposedTier = ensureTier(Number(row.proposed_tier));
    const resolvedTierRaw = row.resolved_tier;
    const resolvedTier =
      resolvedTierRaw === null || resolvedTierRaw === undefined
        ? null
        : ensureTier(Number(resolvedTierRaw));
    const statusRaw = String(row.status ?? "open");
    const status =
      statusRaw === "accepted" || statusRaw === "rejected" || statusRaw === "expired"
        ? statusRaw
        : "open";

    return {
      id: String(row.id ?? ""),
      org_id: String(row.org_id ?? this.orgId),
      target_member_id: String(row.target_member_id ?? ""),
      target_month: String(row.target_month ?? ""),
      target_draft_id: String(row.target_draft_id ?? ""),
      objector_id: String(row.objector_id ?? ""),
      proposed_tier: proposedTier,
      reason: typeof row.reason === "string" ? row.reason : "",
      evidence:
        row.evidence && typeof row.evidence === "object"
          ? (row.evidence as Record<string, unknown>)
          : {},
      co_signs: Array.isArray(row.co_signs)
        ? (row.co_signs as Array<Record<string, unknown>>).map((entry) => ({
              user_id: String(entry.user_id ?? ""),
              user_name: String(entry.user_name ?? entry.user_id ?? ""),
              signed_at: String(entry.signed_at ?? ""),
              comment: typeof entry.comment === "string" ? entry.comment : "",
            }))
        : [],
      target_self_response:
        row.target_self_response && typeof row.target_self_response === "object"
          ? {
              agreed: Boolean(
                (row.target_self_response as Record<string, unknown>).agreed,
              ),
              comment: String(
                (row.target_self_response as Record<string, unknown>).comment ?? "",
              ),
              responded_at: String(
                (row.target_self_response as Record<string, unknown>).responded_at ?? "",
              ),
            }
          : null,
      required_co_signs: Math.max(1, Number(row.required_co_signs ?? 2)),
      status,
      expires_at: String(row.expires_at ?? ""),
      resolved_at: typeof row.resolved_at === "string" ? row.resolved_at : null,
      resolved_tier: resolvedTier,
      created_at: String(row.created_at ?? ""),
      updated_at: String(row.updated_at ?? ""),
    };
  }
}

// ─── Pure helpers (exported for unit testing) ─────────────────────────────

export function isCoSignThresholdReached(
  coSignCount: number,
  requiredCoSigns: number,
  selfAgreed: boolean,
): boolean {
  const effectiveRequired = selfAgreed
    ? Math.max(1, requiredCoSigns - 1)
    : requiredCoSigns;
  return coSignCount >= effectiveRequired;
}

// Re-export for symmetry with PathV33RewardService.
export {
  PathV33Tier as PathV33ObjectionTier,
  PATH_V33_LEVEL_WEIGHT_MILLI,
  PathV33Level,
};
