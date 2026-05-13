// PATH V3.3 Phase 5: month-end lock + finalize service.
// Spec: docs/REWARD_SYSTEM_V33.md §6, §8
//
// Three operations matching the spec timeline:
//   月末 +3日  → lockDrafts(month)        全申告 lock
//   月末 +7日  → (no-op; objection submit deadline enforced by UI)
//   月末 +8日  → expireOpenObjections + finalizeMonth(month)
//                残った open Objection を expired + path_member_level_history 書き込み

import { supabaseAdmin } from "../lib/supabaseAdmin";
import {
  aggregateMonthlyLevel,
  PathV33Level,
  PathV33Tier,
  PATH_V33_LEVEL_WEIGHT_MILLI,
  PATH_V33_RULE_VERSION,
} from "./PathV33RewardService";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;

function ensureUuid(value: string, code: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new Error(code);
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

export interface LockResult {
  month: string;
  locked_draft_count: number;
  recounted_drafts: number;
}

export interface ExpireResult {
  month: string;
  expired_objection_count: number;
}

export interface FinalizeMemberSummary {
  member_id: string;
  level: PathV33Level;
  score: number;
  weight_milli: number;
  draft_count: number;
  total_work_days: number;
}

export interface FinalizeResult {
  month: string;
  members: FinalizeMemberSummary[];
}

interface DraftRow {
  id: string;
  site_id: string;
  member_id: string;
  tier: PathV33Tier;
  work_days: number;
  locked_at: string | null;
}

export class PathV33MonthService {
  constructor(private readonly orgId: string) {
    if (!UUID_PATTERN.test(orgId)) {
      throw new Error("ORG_CONTEXT_REQUIRED");
    }
  }

  // Month-end sweep: lock any drafts that are still unlocked at finalize time.
  // V3.3 also enforces a per-site 7-day deadline at submit time
  // (PathV33RewardService.submitLevelDraft), so this stays as governance
  // audit trail plus finalized day_log re-snapshotting.
  async lockDrafts(month: string): Promise<LockResult> {
    ensureMonth(month);
    const finalizedSiteIds = await this.listFinalizedSiteIdsInMonth(month);
    if (finalizedSiteIds.length === 0) {
      return { month, locked_draft_count: 0, recounted_drafts: 0 };
    }

    const drafts = await this.listDraftsForSites(finalizedSiteIds);
    if (drafts.length === 0) {
      return { month, locked_draft_count: 0, recounted_drafts: 0 };
    }

    const now = new Date().toISOString();
    const dayCounts = await this.batchCountFinalizedWorkDays(finalizedSiteIds, drafts);

    let recounted = 0;
    for (const draft of drafts) {
      const refreshedWorkDays = dayCounts.get(draft.id) ?? draft.work_days;
      const needsRecount = refreshedWorkDays !== draft.work_days;
      const { error } = await supabaseAdmin
        .from("site_member_level_drafts")
        .update({
          locked_at: now,
          work_days: refreshedWorkDays,
        })
        .eq("id", draft.id)
        .eq("org_id", this.orgId)
        .is("locked_at", null);
      if (error) {
        throw new Error(`Failed to lock draft ${draft.id}: ${error.message}`);
      }
      if (needsRecount) recounted += 1;
    }

    return { month, locked_draft_count: drafts.length, recounted_drafts: recounted };
  }

  // 月末 +8日: any objection still 'open' becomes 'expired' (no tier rewrite).
  async expireOpenObjections(month: string): Promise<ExpireResult> {
    ensureMonth(month);
    const { data, error } = await supabaseAdmin
      .from("level_objections")
      .update({ status: "expired", resolved_at: new Date().toISOString() })
      .eq("org_id", this.orgId)
      .eq("status", "open")
      .eq("target_month", month)
      .select("id");

    if (error) {
      throw new Error(`Failed to expire objections: ${error.message}`);
    }

    const expired = (data ?? []) as Array<{ id?: string }>;

    // Mark the paired proposal rows as rejected so the bell badge clears.
    if (expired.length > 0) {
      const expiredIds = expired.map((row) => String(row.id ?? "")).filter(Boolean);
      const { error: proposalError } = await supabaseAdmin
        .from("proposals")
        .update({
          status: "rejected",
          rejection_reason: "objection.expired",
        })
        .eq("org_id", this.orgId)
        .eq("type", "level.objection")
        .in("payload->>objection_id", expiredIds);
      if (proposalError) {
        console.warn(`[V33] Failed to reject expired objection proposals: ${proposalError.message}`);
      }
    }

    return { month, expired_objection_count: expired.length };
  }

  // 月末 +8日: aggregate per member and upsert to path_member_level_history.
  // V3.2 reward calc continues to read from path_member_level_history, so
  // writing here is the V3.3 hook into the existing reward_run flow.
  async finalizeMonth(month: string): Promise<FinalizeResult> {
    ensureMonth(month);
    const finalizedSiteIds = await this.listFinalizedSiteIdsInMonth(month);
    if (finalizedSiteIds.length === 0) {
      return { month, members: [] };
    }
    const drafts = await this.listDraftsForSites(finalizedSiteIds);

    const draftsByMember = new Map<string, DraftRow[]>();
    for (const d of drafts) {
      const list = draftsByMember.get(d.member_id) ?? [];
      list.push(d);
      draftsByMember.set(d.member_id, list);
    }

    const members: FinalizeMemberSummary[] = [];
    const now = new Date().toISOString();
    for (const [memberId, memberDrafts] of draftsByMember.entries()) {
      const agg = aggregateMonthlyLevel(
        memberDrafts.map((d) => ({ site_id: d.site_id, tier: d.tier, work_days: d.work_days })),
      );

      const snapshot = {
        engine_version: PATH_V33_RULE_VERSION,
        finalized_at: now,
        score: agg.score,
        weight_milli: agg.weight_milli,
        total_work_days: agg.total_work_days,
        drafts: memberDrafts.map((d) => ({
          draft_id: d.id,
          site_id: d.site_id,
          tier: d.tier,
          work_days: d.work_days,
        })),
      };

      const { error } = await supabaseAdmin.from("path_member_level_history").upsert(
        {
          org_id: this.orgId,
          member_id: memberId,
          level: agg.level,
          effective_month: month,
          reason: "v33.finalize",
          evidence_snapshot: snapshot,
          computed_score: agg.score,
          aggregation_snapshot: snapshot,
        },
        { onConflict: "org_id,member_id,effective_month" },
      );
      if (error) {
        throw new Error(`Failed to upsert path_member_level_history for ${memberId}: ${error.message}`);
      }

      members.push({
        member_id: memberId,
        level: agg.level,
        score: agg.score,
        weight_milli: PATH_V33_LEVEL_WEIGHT_MILLI[agg.level],
        draft_count: memberDrafts.length,
        total_work_days: agg.total_work_days,
      });
    }

    return { month, members };
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private async listFinalizedSiteIdsInMonth(month: string): Promise<string[]> {
    // Audit #6: attribute sites to a month via site_closes.closed_at (only
    // finalized closes), not by sites.completed_at OR created_at.
    const { data, error } = await supabaseAdmin
      .from("site_closes")
      .select("site_id, closed_at, status")
      .eq("org_id", this.orgId)
      .eq("status", "finalized")
      .gte("closed_at", `${month}-01T00:00:00.000Z`)
      .lt("closed_at", `${nextMonth(month)}-01T00:00:00.000Z`);
    if (error) {
      throw new Error(`Failed to list finalized site_closes: ${error.message}`);
    }
    const ids = new Set<string>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const siteId = String(row.site_id ?? "");
      if (UUID_PATTERN.test(siteId)) ids.add(siteId);
    }
    return [...ids];
  }

  private async listDraftsForSites(siteIds: string[]): Promise<DraftRow[]> {
    if (siteIds.length === 0) return [];
    const { data, error } = await supabaseAdmin
      .from("site_member_level_drafts")
      .select("id, site_id, member_id, tier, work_days, locked_at")
      .eq("org_id", this.orgId)
      .in("site_id", siteIds);
    if (error) {
      throw new Error(`Failed to fetch drafts: ${error.message}`);
    }
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ""),
      site_id: String(row.site_id ?? ""),
      member_id: String(row.member_id ?? ""),
      tier: Number(row.tier) as PathV33Tier,
      work_days: Number(row.work_days ?? 0),
      locked_at: typeof row.locked_at === "string" ? row.locked_at : null,
    }));
  }

  // For each draft, count the number of distinct dates the member appeared on
  // that site WITHIN a finalized site_close. This snapshots audit #3 at lock
  // time: post-lock, work_days reflects only days actually inside a closed
  // site, even if site_day_logs without a close exist.
  private async batchCountFinalizedWorkDays(
    siteIds: string[],
    drafts: DraftRow[],
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (siteIds.length === 0 || drafts.length === 0) return result;

    const memberIds = Array.from(new Set(drafts.map((d) => d.member_id)));
    const { data, error } = await supabaseAdmin
      .from("site_day_logs")
      .select("site_id, member_id, date, locked_by_site_close_id")
      .eq("org_id", this.orgId)
      .in("site_id", siteIds)
      .in("member_id", memberIds)
      .not("locked_by_site_close_id", "is", null);

    if (error) {
      throw new Error(`Failed to fetch locked day logs: ${error.message}`);
    }

    const datesByKey = new Map<string, Set<string>>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const siteId = String(row.site_id ?? "");
      const memberId = String(row.member_id ?? "");
      const date = String(row.date ?? "");
      if (!siteId || !memberId || !date) continue;
      const key = `${siteId}:${memberId}`;
      const set = datesByKey.get(key) ?? new Set<string>();
      set.add(date);
      datesByKey.set(key, set);
    }

    for (const draft of drafts) {
      const key = `${draft.site_id}:${draft.member_id}`;
      result.set(draft.id, datesByKey.get(key)?.size ?? 0);
    }
    return result;
  }
}
