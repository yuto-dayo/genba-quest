// PATH V3.3 transparent governance reward service.
// Spec: docs/REWARD_SYSTEM_V33.md
//
// Phase 1: pure aggregation function only.
// Phase 2: per-site draft submission + monthly preview (this file).

import { supabaseAdmin } from "../lib/supabaseAdmin";
import { DEV_AUTH_USERS, isDevAuthMode } from "../config/devAuthUsers";
import { ActorRef } from "./PolicyEngine";

export const PATH_V33_RULE_VERSION = "3.3.0-transparent";
export const PATH_V33_CALCULATION_SYSTEM = "path_v33_transparent";

export const PATH_V33_LEVEL_WEIGHT_MILLI = {
  L1: 410,
  L2: 512,
  L3: 640,
  L4: 800,
  L5: 1000,
} as const;

export type PathV33Level = keyof typeof PATH_V33_LEVEL_WEIGHT_MILLI;
export type PathV33Tier = 1 | 2 | 3;

export const PATH_V33_TIER_LABELS: Record<PathV33Tier, string> = {
  1: "補助",
  2: "標準",
  3: "主導",
};

export const PATH_V33_LEVEL_LABELS: Record<PathV33Level, string> = {
  L1: "見習い",
  L2: "補助主体",
  L3: "標準",
  L4: "中堅",
  L5: "熟練",
};

// Bucket boundaries: score < min skips. First match wins (descending order).
// Boundary semantics: score >= min → that level. So 1.3 → L2, 1.8 → L3, etc.
export const PATH_V33_SCORE_BUCKETS: ReadonlyArray<{ min: number; level: PathV33Level }> = [
  { min: 2.7, level: "L5" },
  { min: 2.2, level: "L4" },
  { min: 1.8, level: "L3" },
  { min: 1.3, level: "L2" },
  { min: 0, level: "L1" },
];

export interface PathV33Draft {
  site_id: string;
  tier: PathV33Tier;
  work_days: number;
}

export interface PathV33AggregationResult {
  level: PathV33Level;
  weight_milli: number;
  score: number;
  total_work_days: number;
  draft_count: number;
  drafts: PathV33Draft[];
}

export function bucketScoreToLevel(score: number): PathV33Level {
  for (const bucket of PATH_V33_SCORE_BUCKETS) {
    if (score >= bucket.min) {
      return bucket.level;
    }
  }
  return "L1";
}

// Aggregate per-site self-declared tiers into a monthly level via weighted average.
// Pure function — no IO. Drafts with work_days <= 0 are ignored (cannot weight).
// If no usable drafts exist, default to L1 (新人初期レベル per spec §2 Q4).
export function aggregateMonthlyLevel(
  drafts: ReadonlyArray<PathV33Draft>,
): PathV33AggregationResult {
  const usable = drafts.filter((d) => Number.isFinite(d.work_days) && d.work_days > 0);

  if (usable.length === 0) {
    return {
      level: "L1",
      weight_milli: PATH_V33_LEVEL_WEIGHT_MILLI.L1,
      score: 0,
      total_work_days: 0,
      draft_count: 0,
      drafts: [],
    };
  }

  let weightedTierSum = 0;
  let totalDays = 0;
  for (const d of usable) {
    if (d.tier !== 1 && d.tier !== 2 && d.tier !== 3) {
      throw new Error("PATH_V33_INVALID_TIER");
    }
    weightedTierSum += d.tier * d.work_days;
    totalDays += d.work_days;
  }

  const score = weightedTierSum / totalDays;
  const rounded = Math.round(score * 100) / 100;
  const level = bucketScoreToLevel(rounded);

  return {
    level,
    weight_milli: PATH_V33_LEVEL_WEIGHT_MILLI[level],
    score: rounded,
    total_work_days: totalDays,
    draft_count: usable.length,
    drafts: usable.map((d) => ({ site_id: d.site_id, tier: d.tier, work_days: d.work_days })),
  };
}

// Co-sign required count per spec §6: max(2, ceil(team_size / 3)).
// If the target member self-agrees, requirement drops by 1 (floor 1).
export function requiredCoSigns(teamSize: number, targetSelfAgreed: boolean): number {
  if (!Number.isFinite(teamSize) || teamSize < 1) {
    throw new Error("PATH_V33_INVALID_TEAM_SIZE");
  }
  const base = Math.max(2, Math.ceil(teamSize / 3));
  return targetSelfAgreed ? Math.max(1, base - 1) : base;
}

// ─── DB-backed operations ────────────────────────────────────────────────

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

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

function ensureMonth(value: string): string {
  if (!MONTH_PATTERN.test(value)) {
    throw new Error("INVALID_MONTH_FORMAT");
  }
  return value;
}

function nextMonth(month: string): string {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const m = Number(monthStr);
  if (m === 12) {
    return `${year + 1}-01`;
  }
  return `${year}-${String(m + 1).padStart(2, "0")}`;
}

export interface SubmitLevelDraftInput {
  site_id: string;
  tier: PathV33Tier;
  self_comment?: string;
}

export interface LevelDraftRecord {
  id: string;
  org_id: string;
  site_id: string;
  member_id: string;
  tier: PathV33Tier;
  work_days: number;
  self_comment: string;
  evidence: Record<string, unknown>;
  submitted_at: string;
  locked_at: string | null;
}

export interface MonthlyPreviewResult {
  month: string;
  member_id: string;
  current: PathV33AggregationResult;
  prior_level: PathV33Level | null;
  drafts: LevelDraftRecord[];
}

export interface TeamFeedMember {
  member_id: string;
  member_name: string;
  current: PathV33AggregationResult;
  prior_level: PathV33Level | null;
  drafts: LevelDraftRecord[];
}

export interface TeamFeedTimelineEntry {
  draft_id: string;
  member_id: string;
  member_name: string;
  site_id: string;
  site_name: string;
  tier: PathV33Tier;
  work_days: number;
  self_comment: string;
  submitted_at: string;
}

export interface TeamFeedResult {
  month: string;
  members: TeamFeedMember[];
  timeline: TeamFeedTimelineEntry[];
}

export class PathV33RewardService {
  constructor(private readonly orgId: string) {
    if (!UUID_PATTERN.test(orgId)) {
      throw new Error("ORG_CONTEXT_REQUIRED");
    }
  }

  // Compute work_days for (member, site, month) from site_day_logs (distinct dates).
  // V3.3 stores a snapshot at submit time so re-submitting refreshes the count.
  private async fetchExistingDraft(
    siteId: string,
    memberId: string,
  ): Promise<{ locked_at: string | null } | null> {
    const { data, error } = await supabaseAdmin
      .from("site_member_level_drafts")
      .select("locked_at")
      .eq("org_id", this.orgId)
      .eq("site_id", siteId)
      .eq("member_id", memberId)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch existing draft: ${error.message}`);
    }
    if (!data) return null;
    return { locked_at: typeof data.locked_at === "string" ? data.locked_at : null };
  }

  private async countWorkDays(
    memberId: string,
    siteId: string,
    month: string,
  ): Promise<number> {
    const { data, error } = await supabaseAdmin
      .from("site_day_logs")
      .select("date")
      .eq("org_id", this.orgId)
      .eq("member_id", memberId)
      .eq("site_id", siteId)
      .gte("date", `${month}-01`)
      .lt("date", `${nextMonth(month)}-01`);

    if (error) {
      throw new Error(`Failed to count work days: ${error.message}`);
    }

    const dates = new Set<string>();
    for (const row of (data ?? []) as Array<{ date?: string }>) {
      if (typeof row.date === "string") {
        dates.add(row.date);
      }
    }
    return dates.size;
  }

  // Resolve the month bucket a site belongs to. V3.3 attributes the draft to
  // the month containing the site's completed_at (falls back to created_at).
  private async resolveSiteMonth(siteId: string): Promise<string> {
    const { data, error } = await supabaseAdmin
      .from("sites")
      .select("id, org_id, completed_at, created_at")
      .eq("id", siteId)
      .eq("org_id", this.orgId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch site: ${error.message}`);
    }
    if (!data) {
      throw new Error("SITE_NOT_FOUND");
    }

    const anchor =
      (typeof data.completed_at === "string" && data.completed_at) ||
      (typeof data.created_at === "string" && data.created_at) ||
      new Date().toISOString();
    return anchor.slice(0, 7);
  }

  async submitLevelDraft(input: SubmitLevelDraftInput, actor: ActorRef): Promise<{
    draft: LevelDraftRecord;
    preview: MonthlyPreviewResult;
  }> {
    if (actor.type !== "human") {
      throw new Error("PATH_V33_HUMAN_ACTOR_REQUIRED");
    }
    const memberId = ensureUuid(actor.id, "INVALID_MEMBER_ID");
    const siteId = ensureUuid(input.site_id, "INVALID_SITE_ID");
    const tier = ensureTier(input.tier);
    const comment = (input.self_comment ?? "").toString().slice(0, 500);

    const month = await this.resolveSiteMonth(siteId);
    const workDays = await this.countWorkDays(memberId, siteId, month);

    // V3.3 governance: once a draft is locked (by month-end +3 freeze or by
    // an accepted Objection rewriting its tier), the member cannot overwrite
    // it via re-submission. Phase 4 fix per audit finding #1/#2.
    const existing = await this.fetchExistingDraft(siteId, memberId);
    if (existing?.locked_at) {
      throw new Error("PATH_V33_DRAFT_LOCKED");
    }

    const { data, error } = await supabaseAdmin
      .from("site_member_level_drafts")
      .upsert(
        {
          org_id: this.orgId,
          site_id: siteId,
          member_id: memberId,
          tier,
          work_days: workDays,
          self_comment: comment,
          evidence: { actor_name: actor.name ?? null, target_month: month },
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "org_id,site_id,member_id" },
      )
      .select("*")
      .single();

    if (error || !data) {
      throw new Error(`Failed to submit level draft: ${error?.message ?? "no row"}`);
    }

    const draft = this.normalizeDraftRow(data);
    const preview = await this.getMonthlyPreview(memberId, month);
    return { draft, preview };
  }

  async getMonthlyPreview(memberId: string, month: string): Promise<MonthlyPreviewResult> {
    ensureUuid(memberId, "INVALID_MEMBER_ID");
    ensureMonth(month);

    const [drafts, prior] = await Promise.all([
      this.listDraftsForMonth(memberId, month),
      this.fetchPriorMonthLevel(memberId, month),
    ]);

    const current = aggregateMonthlyLevel(
      drafts.map((d) => ({ site_id: d.site_id, tier: d.tier, work_days: d.work_days })),
    );

    return { month, member_id: memberId, current, prior_level: prior, drafts };
  }

  // Fetch drafts whose site lives in the given month. Two-step query because
  // the month attribution lives on sites, not on the draft row.
  private async listDraftsForMonth(
    memberId: string,
    month: string,
  ): Promise<LevelDraftRecord[]> {
    const { data: siteRows, error: siteError } = await supabaseAdmin
      .from("sites")
      .select("id, completed_at, created_at")
      .eq("org_id", this.orgId)
      .is("deleted_at", null);

    if (siteError) {
      throw new Error(`Failed to fetch sites: ${siteError.message}`);
    }

    const monthSiteIds = ((siteRows ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        const anchor =
          (typeof row.completed_at === "string" && row.completed_at) ||
          (typeof row.created_at === "string" && row.created_at) ||
          "";
        return anchor.startsWith(month);
      })
      .map((row) => String(row.id))
      .filter((id) => UUID_PATTERN.test(id));

    if (monthSiteIds.length === 0) {
      return [];
    }

    const { data, error } = await supabaseAdmin
      .from("site_member_level_drafts")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("member_id", memberId)
      .in("site_id", monthSiteIds);

    if (error) {
      throw new Error(`Failed to fetch drafts: ${error.message}`);
    }

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      this.normalizeDraftRow(row),
    );
  }

  private async fetchPriorMonthLevel(
    memberId: string,
    month: string,
  ): Promise<PathV33Level | null> {
    const { data, error } = await supabaseAdmin
      .from("path_member_level_history")
      .select("level, effective_month")
      .eq("org_id", this.orgId)
      .eq("member_id", memberId)
      .lt("effective_month", month)
      .order("effective_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch prior month level: ${error.message}`);
    }

    if (!data || typeof data.level !== "string") {
      return null;
    }
    return (data.level as PathV33Level) in PATH_V33_LEVEL_WEIGHT_MILLI
      ? (data.level as PathV33Level)
      : null;
  }

  async getTeamFeed(month: string): Promise<TeamFeedResult> {
    ensureMonth(month);

    const [members, monthSites] = await Promise.all([
      this.listActiveMembers(),
      this.listSitesInMonth(month),
    ]);
    const monthSiteIdSet = new Set(monthSites.map((s) => s.id));
    const monthSiteNames = new Map(monthSites.map((s) => [s.id, s.name]));

    const memberIds = members.map((m) => m.member_id);
    const memberNameById = new Map(members.map((m) => [m.member_id, m.member_name]));

    const drafts = await this.listDraftsForMembersInSites(memberIds, [...monthSiteIdSet]);
    const draftsByMember = new Map<string, LevelDraftRecord[]>();
    for (const d of drafts) {
      const list = draftsByMember.get(d.member_id) ?? [];
      list.push(d);
      draftsByMember.set(d.member_id, list);
    }

    const priorLevels = await this.fetchPriorMonthLevelsBatch(memberIds, month);

    const memberSummaries: TeamFeedMember[] = members.map((member) => {
      const memberDrafts = draftsByMember.get(member.member_id) ?? [];
      const current = aggregateMonthlyLevel(
        memberDrafts.map((d) => ({ site_id: d.site_id, tier: d.tier, work_days: d.work_days })),
      );
      return {
        member_id: member.member_id,
        member_name: member.member_name,
        current,
        prior_level: priorLevels.get(member.member_id) ?? null,
        drafts: memberDrafts,
      };
    });

    const timeline: TeamFeedTimelineEntry[] = drafts
      .map((d) => ({
        draft_id: d.id,
        member_id: d.member_id,
        member_name: memberNameById.get(d.member_id) ?? d.member_id,
        site_id: d.site_id,
        site_name: monthSiteNames.get(d.site_id) ?? "現場",
        tier: d.tier,
        work_days: d.work_days,
        self_comment: d.self_comment,
        submitted_at: d.submitted_at,
      }))
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));

    return { month, members: memberSummaries, timeline };
  }

  private async listActiveMembers(): Promise<Array<{ member_id: string; member_name: string }>> {
    const { data, error } = await supabaseAdmin
      .from("org_memberships")
      .select("user_id")
      .eq("org_id", this.orgId)
      .eq("status", "active");

    if (error) {
      throw new Error(`Failed to fetch active members: ${error.message}`);
    }

    const memberIds = ((data ?? []) as Array<{ user_id?: string }>)
      .map((row) => String(row.user_id ?? ""))
      .filter((value) => UUID_PATTERN.test(value));
    if (isDevAuthMode()) {
      memberIds.push(...DEV_AUTH_USERS.map((user) => user.id));
    }
    const unique = Array.from(new Set(memberIds));
    const names = await this.loadMemberNames(unique);
    return unique.map((memberId) => ({
      member_id: memberId,
      member_name: names.get(memberId) ?? memberId,
    }));
  }

  private async loadMemberNames(memberIds: string[]): Promise<Map<string, string>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", memberIds);
    if (error) {
      throw new Error(`Failed to fetch profiles: ${error.message}`);
    }
    const names = new Map<string, string>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      names.set(String(row.id), String(row.full_name ?? row.username ?? row.id));
    }
    if (isDevAuthMode()) {
      for (const user of DEV_AUTH_USERS) {
        if (memberIds.includes(user.id)) {
          names.set(user.id, user.name);
        }
      }
    }
    return names;
  }

  private async listSitesInMonth(month: string): Promise<Array<{ id: string; name: string }>> {
    const { data, error } = await supabaseAdmin
      .from("sites")
      .select("id, name, completed_at, created_at")
      .eq("org_id", this.orgId)
      .is("deleted_at", null);
    if (error) {
      throw new Error(`Failed to fetch sites: ${error.message}`);
    }
    return ((data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => {
        const anchor =
          (typeof row.completed_at === "string" && row.completed_at) ||
          (typeof row.created_at === "string" && row.created_at) ||
          "";
        return anchor.startsWith(month);
      })
      .map((row) => ({ id: String(row.id), name: String(row.name ?? "現場") }))
      .filter((row) => UUID_PATTERN.test(row.id));
  }

  private async listDraftsForMembersInSites(
    memberIds: string[],
    siteIds: string[],
  ): Promise<LevelDraftRecord[]> {
    if (memberIds.length === 0 || siteIds.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from("site_member_level_drafts")
      .select("*")
      .eq("org_id", this.orgId)
      .in("member_id", memberIds)
      .in("site_id", siteIds);
    if (error) {
      throw new Error(`Failed to fetch team drafts: ${error.message}`);
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) =>
      this.normalizeDraftRow(row),
    );
  }

  private async fetchPriorMonthLevelsBatch(
    memberIds: string[],
    month: string,
  ): Promise<Map<string, PathV33Level>> {
    if (memberIds.length === 0) return new Map();
    const { data, error } = await supabaseAdmin
      .from("path_member_level_history")
      .select("member_id, level, effective_month")
      .eq("org_id", this.orgId)
      .in("member_id", memberIds)
      .lt("effective_month", month)
      .order("effective_month", { ascending: false });
    if (error) {
      throw new Error(`Failed to fetch prior levels: ${error.message}`);
    }
    const result = new Map<string, PathV33Level>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const memberId = String(row.member_id ?? "");
      if (result.has(memberId)) continue;
      const level = String(row.level ?? "");
      if (level in PATH_V33_LEVEL_WEIGHT_MILLI) {
        result.set(memberId, level as PathV33Level);
      }
    }
    return result;
  }

  private normalizeDraftRow(row: Record<string, unknown>): LevelDraftRecord {
    const tier = Number(row.tier);
    return {
      id: String(row.id ?? ""),
      org_id: String(row.org_id ?? this.orgId),
      site_id: String(row.site_id ?? ""),
      member_id: String(row.member_id ?? ""),
      tier: ensureTier(tier),
      work_days: Number(row.work_days ?? 0),
      self_comment: typeof row.self_comment === "string" ? row.self_comment : "",
      evidence:
        row.evidence && typeof row.evidence === "object"
          ? (row.evidence as Record<string, unknown>)
          : {},
      submitted_at: String(row.submitted_at ?? ""),
      locked_at: typeof row.locked_at === "string" ? row.locked_at : null,
    };
  }
}
