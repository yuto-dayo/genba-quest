import { supabaseAdmin } from "../lib/supabaseAdmin";
import { DEV_AUTH_USERS, isDevAuthMode } from "../config/devAuthUsers";
import { hashStableRecord } from "./PathPolicyBundleService";
import { ActorRef, Proposal } from "./PolicyEngine";
import {
  buildWithholdingDecisionSnapshotPayload,
  WithholdingDecisionSnapshotService,
} from "./WithholdingDecisionSnapshotService";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const PATH_V32_SIMPLE_RULE_VERSION = "3.2.0-simple";
export const PATH_V32_SIMPLE_CALCULATION_SYSTEM = "path_v32_simple";
export const PATH_V32_SIMPLE_ENGINE_VERSION = "path_v32_simple-engine-2026-05-05";

export const PATH_V32_LEVEL_WEIGHT_MILLI = {
  L1: 580,
  L2: 760,
  L3: 1000,
  L4: 1320,
  L5: 1740,
} as const;

export type PathV32Level = keyof typeof PATH_V32_LEVEL_WEIGHT_MILLI;
export type PathV32LevelOrNull = PathV32Level | null;
export type PathV32LevelSource = "history" | "profile" | "unset";

interface PathV32MemberPreview {
  member_id: string;
  member_name: string;
  level: PathV32LevelOrNull;
  level_source: PathV32LevelSource;
  level_weight_milli: number;
  month_total_days: number;
  confirmed_work_days: number;
  work_presence_bp: number;
  monthly_weight_num: number;
  total_weight_num_snapshot: number;
  final_share_bp: number;
  raw_amount: number;
  rounded_amount: number;
  member_correction_amount: number;
  total_pay_amount: number;
  calculation_snapshot: Record<string, unknown>;
}

interface PathV32Preview {
  month: string;
  calculation_system: typeof PATH_V32_SIMPLE_CALCULATION_SYSTEM;
  path_rule_version: typeof PATH_V32_SIMPLE_RULE_VERSION;
  monthly_pool: number;
  site_profit_total: number;
  pool_adjustment_total: number;
  member_correction_total: number;
  total_weight_num: number;
  month_total_days: number;
  active_member_count: number;
  warnings: string[];
  members: PathV32MemberPreview[];
  calculation_snapshot: Record<string, unknown>;
}

interface PathRuleVersionRow {
  id: string;
  org_id: string;
  version: string;
  effective_from: string;
  status: "draft" | "active" | "retired";
  fingerprint: string;
  constants_json: Record<string, unknown>;
}

function assert(condition: unknown, code: string): void {
  if (!condition) {
    throw new Error(code);
  }
}

function ensureMonth(value: string): string {
  assert(MONTH_PATTERN.test(value), "INVALID_MONTH_FORMAT");
  return value;
}

function ensureDate(value: string): string {
  assert(DATE_PATTERN.test(value), "INVALID_DATE_FORMAT");
  return value;
}

function ensureUuid(value: string, code: string): string {
  assert(UUID_PATTERN.test(value), code);
  return value;
}

function normalizeMoney(value: number, code = "INVALID_MONEY_VALUE"): number {
  assert(Number.isFinite(value), code);
  return Math.round(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function nextMonth(month: string): string {
  const [year, monthPart] = ensureMonth(month).split("-").map(Number);
  const next = new Date(Date.UTC(year, monthPart - 1, 1));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(month: string): number {
  const [year, monthPart] = ensureMonth(month).split("-").map(Number);
  return new Date(Date.UTC(year, monthPart, 0)).getUTCDate();
}

function normalizeLevel(value: unknown): PathV32LevelOrNull {
  return typeof value === "string" && value in PATH_V32_LEVEL_WEIGHT_MILLI
    ? (value as PathV32Level)
    : null;
}

export function largestRemainderRound(total: number, rawAmounts: number[]): number[] {
  if (rawAmounts.length === 0) {
    return [];
  }

  const floors = rawAmounts.map((amount) => Math.floor(amount));
  let remainder = normalizeMoney(total) - floors.reduce((sum, amount) => sum + amount, 0);
  const order = rawAmounts
    .map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index);

  const result = [...floors];
  for (const item of order) {
    if (remainder <= 0) {
      break;
    }
    result[item.index] += 1;
    remainder -= 1;
  }

  return result;
}

function roundBpToTotal(rawBps: number[], target = 10000): number[] {
  return largestRemainderRound(target, rawBps);
}

export class PathV32SimpleRewardService {
  private readonly withholdingSnapshotService: WithholdingDecisionSnapshotService;

  constructor(private readonly orgId: string) {
    this.withholdingSnapshotService = new WithholdingDecisionSnapshotService(orgId);
  }

  async previewMonthlyDistribution(monthInput: string): Promise<PathV32Preview> {
    const month = ensureMonth(monthInput);
    const monthTotalDays = daysInMonth(month);
    const [siteCloses, activeMembers, levels, corrections] = await Promise.all([
      this.listFinalizedSiteCloses(month),
      this.listActiveMembers(),
      this.listMemberLevels(month),
      this.listAdjustments(month),
    ]);

    const memberIds = activeMembers.map((member) => member.member_id);
    const workDaysByMember = await this.listConfirmedWorkDays(month, siteCloses);
    const siteProfitTotal = normalizeMoney(
      siteCloses.reduce((sum, row) => sum + Number(row.distributable_profit ?? 0), 0),
    );
    const monthlyPool = siteProfitTotal + corrections.pool_adjustment_total;

    const membersWithoutShares = activeMembers.map((member) => {
      const levelSnapshot = levels.get(member.member_id) ?? { level: null, source: "unset" as const };
      const confirmedWorkDays = workDaysByMember.get(member.member_id)?.size ?? 0;
      const monthlyWeightNum = levelSnapshot.level !== null
        ? PATH_V32_LEVEL_WEIGHT_MILLI[levelSnapshot.level] * confirmedWorkDays
        : 0;
      return {
        member,
        level: levelSnapshot.level,
        level_source: levelSnapshot.source,
        confirmed_work_days: confirmedWorkDays,
        monthly_weight_num: monthlyWeightNum,
      };
    });
    const totalWeightNum = membersWithoutShares.reduce((sum, member) => sum + member.monthly_weight_num, 0);
    const rawAmounts = membersWithoutShares.map((member) =>
      totalWeightNum > 0 ? (monthlyPool * member.monthly_weight_num) / totalWeightNum : 0,
    );
    const roundedAmounts = totalWeightNum > 0 ? largestRemainderRound(monthlyPool, rawAmounts) : memberIds.map(() => 0);
    const shareBps =
      totalWeightNum > 0
        ? roundBpToTotal(membersWithoutShares.map((member) => (member.monthly_weight_num / totalWeightNum) * 10000))
        : memberIds.map(() => 0);

    const members = membersWithoutShares.map((member, index) => {
      const levelWeightMilli = member.level !== null ? PATH_V32_LEVEL_WEIGHT_MILLI[member.level] : 0;
      const correction = corrections.member_corrections.get(member.member.member_id) ?? 0;
      const roundedAmount = roundedAmounts[index] ?? 0;
      return {
        member_id: member.member.member_id,
        member_name: member.member.member_name,
        level: member.level,
        level_source: member.level_source,
        level_weight_milli: levelWeightMilli,
        month_total_days: monthTotalDays,
        confirmed_work_days: member.confirmed_work_days,
        work_presence_bp: Math.min(
          10000,
          Math.round((member.confirmed_work_days / monthTotalDays) * 10000),
        ),
        monthly_weight_num: member.monthly_weight_num,
        total_weight_num_snapshot: totalWeightNum,
        final_share_bp: shareBps[index] ?? 0,
        raw_amount: rawAmounts[index] ?? 0,
        rounded_amount: roundedAmount,
        member_correction_amount: correction,
        total_pay_amount: roundedAmount + correction,
        calculation_snapshot: {
          work_dates: Array.from(workDaysByMember.get(member.member.member_id) ?? []).sort(),
          level_source: member.level_source,
        },
      } satisfies PathV32MemberPreview;
    });

    const warnings: string[] = [];
    if (membersWithoutShares.some((member) => member.level === null)) {
      warnings.push("PATH_V32_MEMBER_LEVEL_UNSET");
    }
    if (totalWeightNum === 0 && monthlyPool > 0) {
      warnings.push("PATH_V32_ZERO_TOTAL_WEIGHT");
    }

    const calculationSnapshot = {
      month,
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
      path_rule_version: PATH_V32_SIMPLE_RULE_VERSION,
      level_weight_milli: PATH_V32_LEVEL_WEIGHT_MILLI,
      monthly_pool: monthlyPool,
      site_profit_total: siteProfitTotal,
      pool_adjustment_total: corrections.pool_adjustment_total,
      member_correction_total: corrections.member_correction_total,
      total_member_pay_amount: members.reduce((sum, member) => sum + member.total_pay_amount, 0),
      total_weight_num: totalWeightNum,
      month_total_days: monthTotalDays,
      site_closes: siteCloses.map((row) => ({
        id: row.id,
        site_id: row.site_id,
        closed_at: row.closed_at,
        distributable_profit: row.distributable_profit,
      })),
      pool_adjustments: corrections.pool_adjustments,
      member_corrections: corrections.member_correction_items,
      members,
    };

    return {
      month,
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
      path_rule_version: PATH_V32_SIMPLE_RULE_VERSION,
      monthly_pool: monthlyPool,
      site_profit_total: siteProfitTotal,
      pool_adjustment_total: corrections.pool_adjustment_total,
      member_correction_total: corrections.member_correction_total,
      total_weight_num: totalWeightNum,
      month_total_days: monthTotalDays,
      active_member_count: activeMembers.length,
      warnings,
      members,
      calculation_snapshot: calculationSnapshot,
    };
  }

  async buildMonthlyDistributionProposalPayload(month: string, actor: ActorRef): Promise<Record<string, unknown>> {
    const preview = await this.previewMonthlyDistribution(month);
    if (preview.total_weight_num === 0 && preview.monthly_pool > 0) {
      throw new Error("PATH_V32_ZERO_TOTAL_WEIGHT");
    }

    const rule = await this.resolveActiveRuleVersion(preview.month);
    const canonicalMonthCloseId = await this.ensureCanonicalMonthClose(preview.month, rule.id);
    const memberSnapshots = await this.withholdingSnapshotService.buildMemberSnapshots(
      preview.members.map((member) => member.member_id),
      preview.month,
    );
    const snapshotByMember = new Map(memberSnapshots.map((row) => [row.member_id, row.snapshot]));
    const withholdingPayload = buildWithholdingDecisionSnapshotPayload(memberSnapshots);
    const memberPayouts = preview.members.map((member) => ({
      member_id: member.member_id,
      member_name: member.member_name,
      level: member.level,
      level_source: member.level_source,
      level_weight_milli: member.level_weight_milli,
      month_total_days: member.month_total_days,
      confirmed_work_days: member.confirmed_work_days,
      work_presence_bp: member.work_presence_bp,
      monthly_weight_num: member.monthly_weight_num,
      total_weight_num_snapshot: member.total_weight_num_snapshot,
      final_share_bp: member.final_share_bp,
      raw_amount: member.raw_amount,
      rounded_amount: member.rounded_amount,
      member_correction_amount: member.member_correction_amount,
      total_pay_amount: member.total_pay_amount,
      floor_units: member.confirmed_work_days,
      floor_amount: member.rounded_amount,
      result_amount: 0,
      correction_amount: member.member_correction_amount,
      final_pay: member.total_pay_amount,
      tax_withholding_decision_snapshot: snapshotByMember.get(member.member_id),
      calculation_snapshot: {
        ...member.calculation_snapshot,
        tax_withholding_decision_snapshot: snapshotByMember.get(member.member_id),
      },
    }));
    const calculationSnapshot = {
      ...preview.calculation_snapshot,
      tax_withholding_decision_snapshots: memberSnapshots,
      members: memberPayouts,
    };

    return {
      path_module_version: "v3.2-simple",
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
      path_rule_version: PATH_V32_SIMPLE_RULE_VERSION,
      month: preview.month,
      month_close_id: canonicalMonthCloseId,
      reward_rule_version_id: rule.id,
      monthly_pool: preview.monthly_pool,
      site_profit_total: preview.site_profit_total,
      pool_adjustment_total: preview.pool_adjustment_total,
      member_correction_total: preview.member_correction_total,
      total_weight_num: preview.total_weight_num,
      month_total_days: preview.month_total_days,
      member_payouts: memberPayouts,
      calculation_snapshot: calculationSnapshot,
      ...withholdingPayload,
      created_by_actor: actor,
      input_hash: hashStableRecord(calculationSnapshot),
    };
  }

  buildPoolAdjustmentProposalPayload(
    input: { month: string; amount: number; reason: string; evidence_snapshot?: Record<string, unknown> },
    actor: ActorRef,
  ): Record<string, unknown> {
    return {
      path_module_version: "v3.2-simple",
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
      type: "reward.pool.adjust",
      adjustment_kind: "pool",
      month: ensureMonth(input.month),
      amount: normalizeMoney(input.amount),
      reason: input.reason,
      evidence_snapshot: input.evidence_snapshot ?? {},
      created_by_actor: actor,
      input_hash: hashStableRecord(input),
      total_amount: Math.abs(normalizeMoney(input.amount)),
      currency: "JPY",
    };
  }

  async buildMemberAdjustmentProposalPayload(
    input: {
      target_month: string;
      member_id: string;
      amount: number;
      reason: string;
      evidence_snapshot?: Record<string, unknown>;
    },
    actor: ActorRef,
  ): Promise<Record<string, unknown>> {
    const memberId = ensureUuid(input.member_id, "INVALID_MEMBER_ID");
    const snapshot = await this.withholdingSnapshotService.buildSnapshot(memberId, input.target_month);
    return {
      path_module_version: "v3.2-simple",
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
      type: "reward.adjust",
      adjustment_kind: "member",
      target_month: ensureMonth(input.target_month),
      member_id: memberId,
      amount: normalizeMoney(input.amount),
      reason: input.reason,
      evidence_snapshot: input.evidence_snapshot ?? {},
      member_adjustments: [
        {
          member_id: memberId,
          amount: normalizeMoney(input.amount),
          tax_withholding_decision_snapshot: snapshot,
          explanation: input.evidence_snapshot ?? {},
        },
      ],
      tax_withholding_decision_snapshot: snapshot,
      tax_withholding_decision_snapshots: [{ member_id: memberId, snapshot }],
      created_by_actor: actor,
      input_hash: hashStableRecord(input),
      total_amount: Math.abs(normalizeMoney(input.amount)),
      amount_total: Math.abs(normalizeMoney(input.amount)),
      currency: "JPY",
    };
  }

  async buildLevelUpdateProposalPayload(
    input: {
      member_id: string;
      level: string;
      effective_month: string;
      reason: string;
      evidence_snapshot?: Record<string, unknown>;
    },
    actor: ActorRef,
  ): Promise<Record<string, unknown>> {
    const memberId = ensureUuid(input.member_id, "INVALID_MEMBER_ID");
    const level = normalizeLevel(input.level);
    assert(level, "INVALID_LEVEL");
    const effectiveMonth = ensureMonth(input.effective_month);
    await this.assertMonthNotFixed(effectiveMonth);

    return {
      path_module_version: "v3.2-simple",
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
      member_id: memberId,
      level,
      effective_month: effectiveMonth,
      reason: input.reason,
      evidence_snapshot: input.evidence_snapshot ?? {},
      created_by_actor: actor,
      input_hash: hashStableRecord({
        member_id: memberId,
        level,
        effective_month: effectiveMonth,
        reason: input.reason,
        evidence_snapshot: input.evidence_snapshot ?? {},
      }),
    };
  }

  async syncMonthlyDistributionFromExecutedProposal(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const month = ensureMonth(String(payload.month ?? ""));
    if (Number(payload.total_weight_num ?? 0) === 0 && Number(payload.monthly_pool ?? 0) > 0) {
      throw new Error("PATH_V32_ZERO_TOTAL_WEIGHT");
    }

    const proposalExecutionId = await this.ensureProposalExecutionRecord(proposal);
    const canonicalMonthCloseId = ensureUuid(String(payload.month_close_id ?? ""), "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED");
    const { data: existingCanonicalRun, error: existingCanonicalError } = await supabaseAdmin
      .from("reward_runs")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("proposal_execution_id", proposalExecutionId)
      .maybeSingle();

    if (existingCanonicalError) {
      throw new Error(`Failed to fetch PATH V3.2 reward run: ${existingCanonicalError.message}`);
    }

    let canonicalRunId = typeof existingCanonicalRun?.id === "string" ? existingCanonicalRun.id : null;
    if (!canonicalRunId) {
      const { data: canonicalRun, error: canonicalError } = await supabaseAdmin
        .from("reward_runs")
        .insert(
          {
            org_id: this.orgId,
            run_kind: "calculation",
            month_close_id: canonicalMonthCloseId,
            proposal_execution_id: proposalExecutionId,
            reward_rule_version_id: payload.reward_rule_version_id ?? canonicalMonthCloseId,
            calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
            status: "fixed",
            fixed_at: proposal.executed_at ?? new Date().toISOString(),
            policy_fingerprint: hashStableRecord(payload.calculation_snapshot ?? {}),
            reward_engine_version: PATH_V32_SIMPLE_ENGINE_VERSION,
            rounding_mode: "largest_remainder",
            rounding_scale: 0,
            rounding_minor_unit: 1,
            input_hash: String(payload.input_hash ?? hashStableRecord(payload.calculation_snapshot ?? {})),
            closed_profit: payload.site_profit_total ?? 0,
            path_pool_amount: payload.monthly_pool ?? 0,
            base_pool_amount: payload.monthly_pool ?? 0,
            variable_pool_amount: 0,
            guaranteed_total_amount: 0,
          },
        )
        .select("id")
        .single();

      if (canonicalError) {
        throw new Error(`Failed to sync PATH V3.2 reward run: ${canonicalError.message}`);
      }

      canonicalRunId = String(canonicalRun.id);
    }

    const { data: monthlyClose, error: monthlyCloseError } = await supabaseAdmin
      .from("monthly_distribution_closes")
      .upsert(
        {
          org_id: this.orgId,
          proposal_id: proposal.id,
          month,
          canonical_month_close_id: canonicalMonthCloseId,
          pool_amount: payload.monthly_pool ?? 0,
          floor_rate: 1,
          result_rate: 0,
          nonlinear_exponent: 1,
          path_rule_version_id: payload.reward_rule_version_id ?? null,
          path_rule_version: PATH_V32_SIMPLE_RULE_VERSION,
          path_rule_fingerprint: hashStableRecord(payload.calculation_snapshot ?? {}),
          calculation_snapshot: payload.calculation_snapshot ?? {},
          closed_at: proposal.executed_at ?? new Date().toISOString(),
          closed_by: proposal.executed_by ?? proposal.created_by,
          status: "finalized",
          base_pool_amount: payload.monthly_pool ?? 0,
          role_pool_amount: 0,
          responsibility_pool_amount: 0,
          correction_total_amount: payload.member_correction_total ?? 0,
          rounding_method: "largest_remainder",
          rounding_unit: 1,
          rule_version: PATH_V32_SIMPLE_RULE_VERSION,
          formula_version: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
          snapshot_hash: String(payload.input_hash ?? hashStableRecord(payload.calculation_snapshot ?? {})),
        },
        { onConflict: "org_id,proposal_id" },
      )
      .select("id")
      .single();

    if (monthlyCloseError) {
      throw new Error(`Failed to sync PATH V3.2 monthly close: ${monthlyCloseError.message}`);
    }

    const closeId = String(monthlyClose.id);
    const lines = getRecordArray(payload.member_payouts);
    if (lines.length > 0) {
      const lineResult = await supabaseAdmin.from("monthly_distribution_lines").upsert(
        lines.map((row) => ({
          org_id: this.orgId,
          monthly_distribution_close_id: closeId,
          member_id: row.member_id,
          floor_units: row.floor_units ?? row.confirmed_work_days ?? 0,
          floor_pay: row.floor_amount ?? row.rounded_amount ?? 0,
          raw_result_weight: 0,
          boosted_result_weight: 0,
          speed_class: "normal",
          speed_coeff: 1,
          result_pay: 0,
          correction: row.member_correction_amount ?? row.correction_amount ?? 0,
          total_pay: row.total_pay_amount ?? row.final_pay ?? 0,
          calculation_snapshot: row.calculation_snapshot ?? {},
          correction_amount: row.member_correction_amount ?? row.correction_amount ?? 0,
          total_pay_amount: row.total_pay_amount ?? row.final_pay ?? 0,
          level: row.level,
          level_source: row.level_source,
          level_weight_milli: row.level_weight_milli,
          month_total_days: row.month_total_days,
          confirmed_work_days: row.confirmed_work_days,
          work_presence_bp: row.work_presence_bp,
          monthly_weight_num: row.monthly_weight_num,
          total_weight_num_snapshot: row.total_weight_num_snapshot,
          final_share_bp: row.final_share_bp,
          raw_amount: row.raw_amount,
          rounded_amount: row.rounded_amount,
          member_correction_amount: row.member_correction_amount,
        })),
        { onConflict: "monthly_distribution_close_id,member_id" },
      );

      if (lineResult.error) {
        throw new Error(`Failed to sync PATH V3.2 monthly lines: ${lineResult.error.message}`);
      }
    }

    const firstRevenueBasisId = await this.resolveAnyRevenueBasisId(payload.calculation_snapshot);
    if (firstRevenueBasisId && lines.length > 0) {
      const lineInsertResult = await supabaseAdmin.from("reward_run_lines").upsert(
        lines.map((row) => ({
          org_id: this.orgId,
          reward_run_id: canonicalRunId,
          revenue_basis_id: firstRevenueBasisId,
          recipient_id: row.member_id,
          base_amount: row.rounded_amount ?? row.floor_amount ?? 0,
          delta_amount: row.member_correction_amount ?? row.correction_amount ?? 0,
          payout_amount: row.total_pay_amount ?? row.final_pay ?? 0,
          formula_snapshot_json: row,
        })),
        { onConflict: "reward_run_id,recipient_id", ignoreDuplicates: true },
      );

      if (lineInsertResult.error) {
        throw new Error(`Failed to sync PATH V3.2 canonical lines: ${lineInsertResult.error.message}`);
      }
    }
  }

  async syncLevelUpdateFromExecutedProposal(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const effectiveMonth = ensureMonth(String(payload.effective_month ?? ""));
    await this.assertMonthNotFixed(effectiveMonth);

    const level = normalizeLevel(payload.level);
    assert(level, "INVALID_LEVEL");
    const upsertResult = await supabaseAdmin.from("path_member_level_history").upsert(
      {
        org_id: this.orgId,
        member_id: ensureUuid(String(payload.member_id ?? ""), "INVALID_MEMBER_ID"),
        level,
        effective_month: effectiveMonth,
        proposal_id: proposal.id,
        reason: String(payload.reason ?? ""),
        evidence_snapshot: payload.evidence_snapshot ?? {},
      },
      { onConflict: "org_id,member_id,effective_month" },
    );

    if (upsertResult.error) {
      throw new Error(`Failed to sync PATH member level history: ${upsertResult.error.message}`);
    }
  }

  async syncSiteCloseMemberUnits(siteCloseId: string, siteId: string, dayLogIds: string[]): Promise<void> {
    const validDayLogIds = dayLogIds.filter((id) => UUID_PATTERN.test(id));
    if (validDayLogIds.length === 0) {
      return;
    }

    const { data, error } = await supabaseAdmin
      .from("site_day_logs")
      .select("id, site_id, member_id, date, role_type, memo")
      .eq("org_id", this.orgId)
      .in("id", validDayLogIds);

    if (error) {
      throw new Error(`Failed to fetch close member units: ${error.message}`);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      return;
    }

    const upsertResult = await supabaseAdmin.from("site_close_member_units").upsert(
      rows.map((row) => ({
        org_id: this.orgId,
        site_close_id: siteCloseId,
        site_id: row.site_id ?? siteId,
        member_id: row.member_id,
        work_date: row.date,
        participation_role: row.role_type ?? "member",
        memo: row.memo ?? "",
        source: "site_day_log",
      })),
      { onConflict: "site_close_id,member_id,work_date" },
    );

    if (upsertResult.error) {
      throw new Error(`Failed to sync close member units: ${upsertResult.error.message}`);
    }
  }

  private async listFinalizedSiteCloses(month: string): Promise<Array<Record<string, unknown>>> {
    const { data, error } = await supabaseAdmin
      .from("site_closes")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("status", "finalized")
      .gte("closed_at", `${month}-01T00:00:00.000Z`)
      .lt("closed_at", `${nextMonth(month)}-01T00:00:00.000Z`);

    if (error) {
      throw new Error(`Failed to fetch PATH V3.2 site closes: ${error.message}`);
    }

    return (data ?? []) as Array<Record<string, unknown>>;
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

    const memberIds = (data ?? [])
      .map((row) => String(row.user_id ?? ""))
      .filter((value) => UUID_PATTERN.test(value));
    if (isDevAuthMode()) {
      memberIds.push(...DEV_AUTH_USERS.map((user) => user.id));
    }
    const uniqueMemberIds = Array.from(new Set(memberIds));
    const names = await this.loadMemberNames(uniqueMemberIds);
    return uniqueMemberIds.map((memberId) => ({
      member_id: memberId,
      member_name: names.get(memberId) ?? memberId,
    }));
  }

  private async loadMemberNames(memberIds: string[]): Promise<Map<string, string>> {
    if (memberIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", memberIds);

    if (error) {
      throw new Error(`Failed to fetch member profiles: ${error.message}`);
    }

    const names = new Map(
      (data ?? []).map((row) => [
        String(row.id),
        String(row.full_name ?? row.username ?? row.id),
      ]),
    );

    if (isDevAuthMode()) {
      for (const user of DEV_AUTH_USERS) {
        if (memberIds.includes(user.id)) {
          names.set(user.id, user.name);
        }
      }
    }

    return names;
  }

  private async listMemberLevels(month: string): Promise<Map<string, { level: PathV32Level; source: PathV32LevelSource }>> {
    const result = new Map<string, { level: PathV32Level; source: PathV32LevelSource }>();
    const historyResult = await supabaseAdmin
      .from("path_member_level_history")
      .select("member_id, level, effective_month")
      .eq("org_id", this.orgId)
      .lte("effective_month", month)
      .order("effective_month", { ascending: false });

    if (historyResult.error) {
      throw new Error(`Failed to fetch PATH member level history: ${historyResult.error.message}`);
    }

    ((historyResult.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const memberId = String(row.member_id ?? "");
      const level = normalizeLevel(row.level);
      if (UUID_PATTERN.test(memberId) && level && !result.has(memberId)) {
        result.set(memberId, { level, source: "history" });
      }
    });

    const profileResult = await supabaseAdmin
      .from("member_skill_profiles")
      .select("member_id, current_level")
      .eq("org_id", this.orgId);

    if (profileResult.error) {
      throw new Error(`Failed to fetch member skill profiles: ${profileResult.error.message}`);
    }

    ((profileResult.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const memberId = String(row.member_id ?? "");
      const level = normalizeLevel(row.current_level);
      if (UUID_PATTERN.test(memberId) && level && !result.has(memberId)) {
        result.set(memberId, { level, source: "profile" });
      }
    });

    return result;
  }

  private async listConfirmedWorkDays(
    month: string,
    siteCloses: Array<Record<string, unknown>>,
  ): Promise<Map<string, Set<string>>> {
    const result = new Map<string, Set<string>>();
    const siteCloseIds = siteCloses.map((row) => String(row.id ?? "")).filter((value) => UUID_PATTERN.test(value));
    if (siteCloseIds.length === 0) {
      return result;
    }

    const unitsResult = await supabaseAdmin
      .from("site_close_member_units")
      .select("site_close_id, member_id, work_date")
      .eq("org_id", this.orgId)
      .in("site_close_id", siteCloseIds);

    if (unitsResult.error) {
      throw new Error(`Failed to fetch site close member units: ${unitsResult.error.message}`);
    }

    const closeIdsWithUnits = new Set<string>();
    ((unitsResult.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const closeId = String(row.site_close_id ?? "");
      const memberId = String(row.member_id ?? "");
      const workDate = String(row.work_date ?? "");
      if (!UUID_PATTERN.test(memberId) || !DATE_PATTERN.test(workDate)) {
        return;
      }
      closeIdsWithUnits.add(closeId);
      const dates = result.get(memberId) ?? new Set<string>();
      dates.add(workDate);
      result.set(memberId, dates);
    });

    const fallbackCloseIds = siteCloseIds.filter((id) => !closeIdsWithUnits.has(id));
    if (fallbackCloseIds.length === 0) {
      return result;
    }

    const fallbackResult = await supabaseAdmin
      .from("site_day_logs")
      .select("locked_by_site_close_id, member_id, date")
      .eq("org_id", this.orgId)
      .in("locked_by_site_close_id", fallbackCloseIds)
      .gte("date", `${month}-01`)
      .lt("date", `${nextMonth(month)}-01`);

    if (fallbackResult.error) {
      throw new Error(`Failed to fetch fallback locked day logs: ${fallbackResult.error.message}`);
    }

    ((fallbackResult.data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const memberId = String(row.member_id ?? "");
      const workDate = String(row.date ?? "");
      if (!UUID_PATTERN.test(memberId) || !DATE_PATTERN.test(workDate)) {
        return;
      }
      const dates = result.get(memberId) ?? new Set<string>();
      dates.add(workDate);
      result.set(memberId, dates);
    });

    return result;
  }

  private async listAdjustments(month: string): Promise<{
    pool_adjustment_total: number;
    member_correction_total: number;
    member_corrections: Map<string, number>;
    pool_adjustments: Array<Record<string, unknown>>;
    member_correction_items: Array<Record<string, unknown>>;
  }> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id,status,created_at,payload")
      .eq("org_id", this.orgId)
      .in("type", ["reward.pool.adjust", "reward.adjust"])
      .in("status", ["approved", "executed"])
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      throw new Error(`Failed to fetch PATH V3.2 adjustments: ${error.message}`);
    }

    const memberCorrections = new Map<string, number>();
    const poolAdjustments: Array<Record<string, unknown>> = [];
    const memberCorrectionItems: Array<Record<string, unknown>> = [];
    let poolTotal = 0;
    let memberTotal = 0;

    ((data ?? []) as Array<Record<string, unknown>>).forEach((proposal) => {
      const payload = isRecord(proposal.payload) ? proposal.payload : {};
      if (payload.calculation_system !== PATH_V32_SIMPLE_CALCULATION_SYSTEM) {
        return;
      }
      const targetMonth = String(payload.month ?? payload.target_month ?? "");
      if (targetMonth !== month) {
        return;
      }

      if (payload.adjustment_kind === "pool" || payload.type === "reward.pool.adjust") {
        const amount = normalizeMoney(Number(payload.amount ?? 0));
        poolTotal += amount;
        poolAdjustments.push({ proposal_id: proposal.id, amount, reason: payload.reason ?? "" });
        return;
      }

      const memberId = String(payload.member_id ?? "");
      if (!UUID_PATTERN.test(memberId)) {
        return;
      }
      const amount = normalizeMoney(Number(payload.amount ?? 0));
      memberCorrections.set(memberId, (memberCorrections.get(memberId) ?? 0) + amount);
      memberTotal += amount;
      memberCorrectionItems.push({
        proposal_id: proposal.id,
        member_id: memberId,
        amount,
        reason: payload.reason ?? "",
      });
    });

    return {
      pool_adjustment_total: poolTotal,
      member_correction_total: memberTotal,
      member_corrections: memberCorrections,
      pool_adjustments: poolAdjustments,
      member_correction_items: memberCorrectionItems,
    };
  }

  private async resolveActiveRuleVersion(month: string): Promise<PathRuleVersionRow> {
    const { data, error } = await supabaseAdmin
      .from("path_rule_versions")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("version", PATH_V32_SIMPLE_RULE_VERSION)
      .eq("status", "active")
      .lte("effective_from", `${month}-01`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch PATH V3.2 rule version: ${error.message}`);
    }
    if (data) {
      return data as PathRuleVersionRow;
    }

    const constants = {
      LEVEL_WEIGHT_MILLI: PATH_V32_LEVEL_WEIGHT_MILLI,
      calculation_system: PATH_V32_SIMPLE_CALCULATION_SYSTEM,
    };
    const upsertResult = await supabaseAdmin
      .from("path_rule_versions")
      .upsert(
        {
          org_id: this.orgId,
          version: PATH_V32_SIMPLE_RULE_VERSION,
          effective_from: `${month}-01`,
          status: "active",
          fingerprint: hashStableRecord(constants),
          constants_json: constants,
          created_by: {
            type: "system",
            id: "path-v32-simple-default-rule",
            name: "PATH V3.2 Simple Default Rule",
          },
        },
        { onConflict: "org_id,version" },
      )
      .select("*")
      .single();

    if (upsertResult.error) {
      throw new Error(`Failed to ensure PATH V3.2 rule version: ${upsertResult.error.message}`);
    }

    return upsertResult.data as PathRuleVersionRow;
  }

  private async ensureCanonicalMonthClose(month: string, closeRuleVersionId: string): Promise<string> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("month_closes")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("period_ym", month)
      .eq("status", "fixed")
      .order("fixed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch PATH V3.2 month close: ${existingError.message}`);
    }
    if (existing?.id) {
      return String(existing.id);
    }

    const fixedAt = new Date(`${month}-01T00:00:00.000Z`).toISOString();
    const { data, error } = await supabaseAdmin
      .from("month_closes")
      .insert({
        org_id: this.orgId,
        period_ym: month,
        status: "fixed",
        source_cutoff_at: fixedAt,
        fixed_at: fixedAt,
        fixed_by: {
          type: "system",
          id: "path-v32-simple-anchor",
          name: "PATH V3.2 Simple Anchor",
        },
        close_rule_version_id: closeRuleVersionId,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to create PATH V3.2 month close: ${error.message}`);
    }

    return String(data.id);
  }

  private async assertMonthNotFixed(month: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("reward_runs")
      .select("id, month_closes!inner(period_ym)")
      .eq("org_id", this.orgId)
      .eq("status", "fixed")
      .eq("calculation_system", PATH_V32_SIMPLE_CALCULATION_SYSTEM)
      .eq("month_closes.period_ym", month)
      .limit(1);

    if (error) {
      throw new Error(`Failed to check PATH V3.2 fixed month: ${error.message}`);
    }

    assert((data ?? []).length === 0, "PATH_LEVEL_UPDATE_FIXED_MONTH_REJECTED");
  }

  private async ensureProposalExecutionRecord(proposal: Proposal): Promise<string> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("proposal_executions")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("proposal_id", proposal.id)
      .eq("status", "succeeded")
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch proposal execution: ${existingError.message}`);
    }
    if (existing?.id) {
      return String(existing.id);
    }

    const { data, error } = await supabaseAdmin
      .from("proposal_executions")
      .insert({
        org_id: this.orgId,
        proposal_id: proposal.id,
        status: "succeeded",
        attempt_no: 1,
        started_at: proposal.executed_at ?? new Date().toISOString(),
        finished_at: proposal.executed_at ?? new Date().toISOString(),
        result_json: {
          result_event_id: proposal.result_event_id ?? null,
        },
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to create proposal execution: ${error.message}`);
    }

    return String(data.id);
  }

  private async resolveAnyRevenueBasisId(snapshot: unknown): Promise<string | null> {
    const firstSiteId = getRecordArray(isRecord(snapshot) ? snapshot.site_closes : [])
      .map((row) => String(row.site_id ?? ""))
      .find((value) => UUID_PATTERN.test(value));
    if (!firstSiteId) {
      return null;
    }

    const { data } = await supabaseAdmin
      .from("revenue_basis")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("site_id", firstSiteId)
      .order("recognition_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    return typeof data?.id === "string" ? data.id : null;
  }
}
