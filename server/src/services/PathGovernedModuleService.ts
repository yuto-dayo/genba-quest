import { supabaseAdmin } from "../lib/supabaseAdmin";
import { DEV_AUTH_USERS, isDevAuthMode } from "../config/devAuthUsers";
import { ActorRef, Proposal } from "./PolicyEngine";
import {
  PATH_POLICY_BUNDLE_KEY,
  PATH_SKILL_STATUS_OPTIONS,
  PATH_TRADE_FAMILIES,
  PathPolicyBundle,
  PathPolicyBundleService,
  PathSkillStatus,
  PathTradeFamily,
  hashStableRecord,
} from "./PathPolicyBundleService";
import { PathV31Service } from "./PathV31Service";
import {
  PATH_V32_SIMPLE_RULE_VERSION,
  PathV32SimpleRewardService,
} from "./PathV32SimpleRewardService";
import {
  PathRewardAnalysisService,
  type RewardAnalysisContextBundle,
} from "./PathRewardAnalysisService";

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PATH_MODULE_PENDING_TYPES = new Set([
  "policy.update",
  "evaluation.finalize",
  "reward.calculate",
  "reward.adjust",
  "reward.pool.adjust",
  "path.level.update",
  "skill.achieve",
  "skill.revoke",
]);
const ACCOUNTING_SYNC_STATUSES = ["posted", "approved"] as const;
const ACCOUNTING_SYNC_KINDS = ["sale", "invoice", "expense"] as const;
const PATH_REWARD_ENGINE_VERSION = "path_v22-engine-2026-04-20";
const PATH_ROUNDING_MODE = "half_up";
const PATH_ROUNDING_SCALE = 0;
const PATH_ROUNDING_MINOR_UNIT = 1;

export type PathRoleLevel = "L1" | "L2" | "L3" | "L4" | "L5";
export type PathDifficultyBand = "S1" | "S2" | "S3";
export type PathRiskBand = "low" | "medium" | "high";
export type PathRoleType = "lead" | "support" | "teaching";
export type PathQualityResult = "pass" | "minor_fix" | "major_fix";
export type PathOpportunityStatus =
  | "not_observed"
  | "opportunity_not_granted"
  | "recheck_required"
  | "observed";
export type PathConfidenceClass = "low" | "medium" | "high";
export type PathFreshnessStatus = "current" | "stale_review_required";
export type PathRestrictionLevel = "none" | "observe_only" | "support_required" | "blocked";

export interface PathMonthlyCloseInputRow {
  id: string;
  org_id: string;
  month: string;
  member_id: string;
  role_level: PathRoleLevel | null;
  trade_family_observations: Record<string, unknown>;
  aqr_input: Record<string, unknown>;
  selected_site_ids: string[];
  comment: string;
  submitted_by: ActorRef | null;
  submitted_at: string;
  updated_at: string;
}

export interface PathEvidenceRecordRow {
  id: string;
  org_id: string;
  month: string;
  member_id: string;
  trade_family: PathTradeFamily | null;
  evidence_class: string;
  origin_event_id: string;
  source_type: string;
  source_ref: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  created_by: ActorRef | null;
  created_at: string;
}

export interface PathAiAnnotationRow {
  id: string;
  org_id: string;
  month: string;
  member_id: string;
  reviewer_kind: "A" | "B";
  adapter_key: string;
  annotation: Record<string, unknown>;
  supporting_evidence_ids: string[];
  challenged_evidence_ids: string[];
  model_version: string;
  prompt_version: string;
  schema_version: string;
  created_by: ActorRef | null;
  created_at: string;
  updated_at: string;
}

export interface PathMonthlyCloseProposalInput {
  month: string;
  member_id: string;
  current_role_level?: PathRoleLevel | null;
  A?: number;
  R?: number;
  Q?: number;
  selected_site_ids?: string[];
  neutral_flags?: string[];
  evidence_ids: string[];
  credited_units: Array<{
    member_id: string;
    unit_type: string;
    units: number;
    source_id?: string;
    metadata?: Record<string, unknown>;
  }>;
  opportunity_audits?: Array<{
    member_id: string;
    trade_family: PathTradeFamily;
    opportunity_status: PathOpportunityStatus;
    eligible_but_unassigned_days?: number;
    opportunity_concentration_score?: number;
    promotion_blocked_by_opportunity?: boolean;
    protected_challenge_count?: number;
    summary?: Record<string, unknown>;
  }>;
  explanation?: Record<string, unknown>;
}

export interface PathWorkPackageContributionInput {
  package_id: string;
  trade_family: PathTradeFamily;
  std_hours: number;
  difficulty_band: PathDifficultyBand;
  responsibility_share: number;
  role_type: PathRoleType;
  quality_result: PathQualityResult;
  rated_units?: number;
}

export interface PathRewardPreviewInput {
  month: string;
  close_id?: string | null;
  month_close_id?: string | null;
  pool: {
    recognized_revenue: number;
    direct_costs: number;
    overhead_allocated: number;
    rule_reserve: number;
    prior_period_adjustments: number;
  };
  members: Array<{
    member_id: string;
    name: string;
    role_level: PathRoleLevel;
    credited_units: number;
    guaranteed_pay?: number;
    A?: number;
    R?: number;
    Q?: number;
    neutral_flags?: string[];
    package_contributions: PathWorkPackageContributionInput[];
  }>;
}

export interface PathRewardPreviewMember {
  member_id: string;
  name: string;
  role_level: PathRoleLevel;
  credited_units: number;
  rated_units: number;
  A: number;
  R: number;
  Q: number;
  monthly_point_total: number;
  monthly_coefficient: number;
  base_weight: number;
  variable_weight: number;
  base_amount: number;
  variable_amount: number;
  calculated_pay: number;
  guaranteed_pay: number;
  guarantee_adjustment: number;
  final_pay: number;
  package_points_total: number;
  explanations: Record<string, unknown>;
}

interface PathRewardExplanationPackageContribution {
  package_id: string;
  trade_family: PathTradeFamily;
  std_hours: number;
  difficulty_band: PathDifficultyBand;
  responsibility_share: number;
  role_type: PathRoleType;
  quality_result: PathQualityResult;
  rated_units: number;
  package_points: number;
  member_points: number;
}

export interface PathRewardPreview {
  calculation_system: "path_v22";
  calculation_version: string;
  month: string;
  close_id: string | null;
  month_close_id: string | null;
  policy_bundle: Pick<
    PathPolicyBundle,
    "id" | "bundle_key" | "version" | "revision" | "effective_from" | "fingerprint"
  >;
  input_hash: string;
  closed_profit: number;
  path_pool_amount: number;
  base_pool_amount: number;
  variable_pool_amount: number;
  guaranteed_total_amount: number;
  members: PathRewardPreviewMember[];
  explanation_snapshots: Array<Record<string, unknown>>;
}

interface CanonicalRewardPreviewCommandResult {
  preview: PathRewardPreview;
  preview_snapshot_id: string;
  reward_rule_version_id: string;
  existing_reward_run: Record<string, unknown> | null;
}

interface CanonicalRewardProposalCommandResult extends CanonicalRewardPreviewCommandResult {
  proposal: Proposal;
  autoApproved: boolean;
  autoExecuted: boolean;
  reused_existing: boolean;
}

interface CanonicalRewardProposalPreparation extends CanonicalRewardPreviewCommandResult {
  existing_proposal: Proposal | null;
  payload: Record<string, unknown>;
  idempotency_key: string;
}

interface RewardExplanationSiteAllocation {
  site_id: string | null;
  site_name: string;
  site_selected: boolean;
  allocation_scope: "selected_site" | "matched_site" | "unmatched_package";
  package_count: number;
  package_ids: string[];
  std_hours_total: number;
  rated_units_total: number;
  package_points_total: number;
  member_points_total: number;
  member_point_share: number;
  variable_weight_allocated: number;
  variable_amount_allocated: number;
}

export interface PathRewardEvidenceRef {
  kind: "site" | "proposal" | "rule" | "section" | "status";
  label: string;
  href?: string | null;
  anchor?: string | null;
  site_id?: string | null;
  proposal_id?: string | null;
  meta?: Record<string, unknown>;
}

export interface PathRewardDeltaReason {
  key:
    | "workload"
    | "high_profit_sites"
    | "corrections"
    | "responsibility"
    | "performance";
  label: string;
  direction: "increase" | "decrease" | "neutral";
  summary: string;
  impact_amount: number | null;
  evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardSiteBreakdownDetail {
  self_explanation: {
    amount: number;
    floor_amount: number;
    result_amount: number;
    correction_amount: number;
    reflected_ratio: number;
    credited_units: number;
    reason_lines: string[];
  };
  site_summary: {
    distributable_profit: number;
    participant_count: number;
    self_rank: number | null;
    self_band: "top" | "upper" | "middle" | "lower" | "solo";
    privacy_mode: "exact_distribution" | "band_only";
    anonymous_relative_distribution: number[];
  };
}

export interface PathRewardSiteBreakdown {
  site_id: string;
  site_name: string;
  amount: number;
  reflected_ratio: number;
  reason_summary: string;
  correction_state: "なし" | "あり";
  evidence_refs: PathRewardEvidenceRef[];
  detail: PathRewardSiteBreakdownDetail;
}

export interface PathRewardCorrectionHistoryItem {
  proposal_id: string;
  status: string;
  reason: string;
  amount: number;
  correction_month: string | null;
  target_month: string | null;
  mode: "adjustment" | "reversal" | "unknown";
  note: string;
  created_at: string;
  evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardCorrectionSummary {
  total_amount: number;
  applied_amount: number;
  count: number;
  has_corrections: boolean;
  items: PathRewardCorrectionHistoryItem[];
}

export interface PathPendingCloseSite {
  site_id: string;
  site_name: string;
  completed_at: string | null;
  close_proposal_status: string | null;
  href: string;
}

export interface PathRewardConfirmationSummary {
  month: string;
  member_id: string;
  member_name: string;
  status: "試算中" | "確定申請中" | "確定済み";
  estimated_amount: number;
  base_amount: number;
  result_amount: number;
  correction_amount: number;
  delta_amount: number | null;
  delta_empty_state: string | null;
  top_reasons: PathRewardDeltaReason[];
  increase_reasons: PathRewardDeltaReason[];
  decrease_reasons: PathRewardDeltaReason[];
  explanation_cards: Array<{
    id: "increase" | "decrease" | "corrections" | "rule";
    title: string;
    body: string;
    evidence_refs: PathRewardEvidenceRef[];
  }>;
  explanation_missing: boolean;
  explanation_missing_message: string | null;
  site_breakdown: PathRewardSiteBreakdown[];
  pending_close_sites: PathPendingCloseSite[];
  corrections: PathRewardCorrectionSummary;
  evidence_refs: PathRewardEvidenceRef[];
  internal_controls: {
    can_manage: boolean;
    month: string;
  };
}

export interface PathTeamRewardSummaryMember {
  member_id: string;
  nickname: string;
  level: "L1" | "L2" | "L3" | "L4" | "L5";
  attendance_days: number;
  amount: number;
  status: "finalized" | "preview" | "pending";
  has_invoice: boolean;
  has_paid: boolean;
}

export interface PathTeamRewardSummary {
  month: string;
  is_finalized: boolean;
  members: PathTeamRewardSummaryMember[];
}

export interface PathRewardQaRequest {
  month: string;
  member_id: string;
  question: string;
  site_id?: string | null;
}

export type PathRewardQaConfidence = "low" | "medium" | "high";

export interface PathRewardQaAmountBreakdown {
  label: string;
  amount: number;
  detail: string;
  evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardQaAdjustment {
  label: string;
  amount: number | null;
  detail: string;
  evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardQaResponse {
  conclusion: string;
  amount_breakdown: PathRewardQaAmountBreakdown[];
  why_changed: string[];
  adjustments: PathRewardQaAdjustment[];
  evidence_refs: PathRewardEvidenceRef[];
  next_action: string | null;
  confidence: PathRewardQaConfidence;
}

interface RewardConfirmationMonthView {
  month: string;
  amount: number;
  base_amount: number;
  result_amount: number;
  correction_amount: number;
  floor_units: number;
  raw_result_weight: number;
  boosted_result_weight: number;
  rule_version: string | null;
  rule_fingerprint: string | null;
  calculation_snapshot: Record<string, unknown>;
  source: "finalized" | "preview" | "empty";
}

export interface PathTradeEndorsementProposalInput {
  member_id: string;
  trade_family: PathTradeFamily;
  skill_status: PathSkillStatus;
  confidence_class: PathConfidenceClass;
  freshness_status: PathFreshnessStatus;
  evidence_ids: string[];
  origin_event_ids: string[];
  assignment_restriction?: {
    restriction_level: PathRestrictionLevel;
    reason_code: string;
    detail?: string;
  } | null;
}

export interface PathRewardAdjustmentProposalInput {
  reward_run_id: string;
  correction_month: string;
  mode: "adjustment" | "reversal";
  reason_code: string;
  member_adjustments: Array<{
    member_id: string;
    amount: number;
    explanation: Record<string, unknown>;
  }>;
  note?: string;
}

interface AutoProfitInputs {
  sales: number;
  outsourcing_cost: number;
  materials_cost: number;
  parking_cost: number;
  transport_cost: number;
  other_direct_cost: number;
  common_cost: number;
  reserve_amount: number;
}

function assert(condition: unknown, code: string): void {
  if (!condition) {
    throw new Error(code);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function ensureMonth(value: string): string {
  assert(MONTH_PATTERN.test(value), "INVALID_MONTH_FORMAT");
  return value;
}

function ensureUuid(value: string, code: string): string {
  assert(UUID_PATTERN.test(value), code);
  return value;
}

function isPathModulePendingProposal(row: Record<string, unknown>): boolean {
  const type = typeof row.type === "string" ? row.type : "";
  const payload = isRecord(row.payload) ? row.payload : null;

  if (!PATH_MODULE_PENDING_TYPES.has(type) || !payload) {
    return false;
  }

  if (type === "policy.update") {
    return payload.module === "path" && payload.bundle_key === PATH_POLICY_BUNDLE_KEY;
  }

  if (type === "evaluation.finalize" || type === "skill.achieve" || type === "skill.revoke") {
    return payload.path_module_version === "v2.2";
  }

  if (type === "reward.calculate" || type === "reward.adjust") {
    return (
      payload.path_module_version === "v2.2" ||
      payload.path_module_version === "v3.2-simple" ||
      payload.calculation_system === "path_v22" ||
      payload.calculation_system === "path_v31" ||
      payload.calculation_system === "path_v32_simple"
    );
  }

  if (type === "reward.pool.adjust" || type === "path.level.update") {
    return payload.calculation_system === "path_v32_simple";
  }

  return false;
}

function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return (
    message.includes(`Could not find the '${columnName}' column`) ||
    message.includes(`column "${columnName}"`) ||
    message.includes(`'${columnName}' column`)
  );
}

function normalizeMoney(value: number, code = "INVALID_MONEY_VALUE"): number {
  assert(Number.isFinite(value), code);
  return Math.round(value);
}

function normalizeTeamRewardLevel(value: unknown): PathTeamRewardSummaryMember["level"] {
  return value === "L1" || value === "L2" || value === "L3" || value === "L4" || value === "L5"
    ? value
    : "L3";
}

function toShortNickname(value: unknown, fallback: string): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  return Array.from(raw).slice(0, 5).join("");
}

function normalizeScore(
  value: unknown,
  code: "INVALID_A_SCORE" | "INVALID_R_SCORE" | "INVALID_Q_SCORE",
): number {
  const resolved = value === undefined || value === null || value === "" ? 1 : Number(value);
  assert(Number.isInteger(resolved) && resolved >= 0 && resolved <= 2, code);
  return resolved;
}

function normalizeNonNegativeNumber(value: unknown, code: string): number {
  const resolved = Number(value);
  assert(Number.isFinite(resolved) && resolved >= 0, code);
  return resolved;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function buildEmptyAutoProfitInputs(): AutoProfitInputs {
  return {
    sales: 0,
    outsourcing_cost: 0,
    materials_cost: 0,
    parking_cost: 0,
    transport_cost: 0,
    other_direct_cost: 0,
    common_cost: 0,
    reserve_amount: 0,
  };
}

function getMonthDateRange(month: string): { startDate: string; endDate: string } {
  const normalizedMonth = ensureMonth(month);
  const [year, monthIndex] = normalizedMonth.split("-").map(Number);
  const lastDay = new Date(year, monthIndex, 0).getDate();

  return {
    startDate: `${normalizedMonth}-01`,
    endDate: `${normalizedMonth}-${String(lastDay).padStart(2, "0")}`,
  };
}

function previousMonthValue(month: string): string {
  const normalizedMonth = ensureMonth(month);
  const [year, monthIndex] = normalizedMonth.split("-").map(Number);
  const date = new Date(year, monthIndex - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function nextMonthValue(month: string): string {
  const normalizedMonth = ensureMonth(month);
  const [year, monthIndex] = normalizedMonth.split("-").map(Number);
  const date = new Date(year, monthIndex, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function directionFromImpact(value: number | null): "increase" | "decrease" | "neutral" {
  if (value === null || value === 0) {
    return "neutral";
  }
  return value > 0 ? "increase" : "decrease";
}

function buildSiteHref(siteId: string): string {
  return `/sites?site=${encodeURIComponent(siteId)}&return=luqo`;
}

function buildProposalHref(proposalId: string): string {
  return `/luqo?proposal=${encodeURIComponent(proposalId)}`;
}

function formatMonthAmountDelta(value: number): string {
  if (value > 0) {
    return `${Math.abs(value).toLocaleString("ja-JP")}円増えました`;
  }
  if (value < 0) {
    return `${Math.abs(value).toLocaleString("ja-JP")}円減りました`;
  }
  return "前月とほぼ同じ金額です";
}

function sumAutoProfitInputs(left: AutoProfitInputs, right: Partial<AutoProfitInputs>): AutoProfitInputs {
  return {
    sales: left.sales + normalizeMoney(right.sales ?? 0),
    outsourcing_cost: left.outsourcing_cost + normalizeMoney(right.outsourcing_cost ?? 0),
    materials_cost: left.materials_cost + normalizeMoney(right.materials_cost ?? 0),
    parking_cost: left.parking_cost + normalizeMoney(right.parking_cost ?? 0),
    transport_cost: left.transport_cost + normalizeMoney(right.transport_cost ?? 0),
    other_direct_cost: left.other_direct_cost + normalizeMoney(right.other_direct_cost ?? 0),
    common_cost: left.common_cost + normalizeMoney(right.common_cost ?? 0),
    reserve_amount: left.reserve_amount + normalizeMoney(right.reserve_amount ?? 0),
  };
}

function readProposalAmount(payload: unknown): number | null {
  if (!isRecord(payload)) {
    return null;
  }

  const rawAmount = payload.amount ?? payload.amount_total;
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return Math.round(amount);
}

function distributeByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) {
    return [];
  }
  if (total === 0) {
    return weights.map(() => 0);
  }

  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  assert(sum > 0, "INVALID_WEIGHT_TOTAL");

  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return remaining;
    }
    const amount = Math.round((total * weight) / sum);
    remaining -= amount;
    return amount;
  });
}

function getNumberMap(
  bundle: PathPolicyBundle,
  key: string,
): Record<string, number> {
  const source = bundle.policy_constants[key] as Record<string, unknown> | undefined;
  if (!source) {
    return {};
  }

  return Object.entries(source).reduce<Record<string, number>>((acc, [entryKey, value]) => {
    if (typeof value === "number") {
      acc[entryKey] = value;
    }
    return acc;
  }, {});
}

function resolveMonthlyCoefficient(bundle: PathPolicyBundle, monthlyPointTotal: number): number {
  const rules = Array.isArray(bundle.policy_constants["MONTHLY_COEFFICIENT_RULES"])
    ? (bundle.policy_constants["MONTHLY_COEFFICIENT_RULES"] as Array<Record<string, unknown>>)
    : [];

  const matched = rules.find((rule) => {
    const min = typeof rule.min === "number" ? rule.min : 0;
    const max = typeof rule.max === "number" ? rule.max : min;
    return monthlyPointTotal >= min && monthlyPointTotal <= max;
  });

  if (!matched || typeof matched.coefficient !== "number") {
    throw new Error("INVALID_MONTHLY_POINT_TOTAL");
  }

  return matched.coefficient;
}

function mapProposalToPolicyContext(bundle: PathPolicyBundle, inputHash: string): Record<string, unknown> {
  return {
    bundle_key: bundle.bundle_key,
    version: bundle.version,
    revision: bundle.revision,
    fingerprint: bundle.fingerprint,
    input_hash: inputHash,
    effective_from: bundle.effective_from,
  };
}

function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

export class PathGovernedModuleService {
  private readonly policyBundleService: PathPolicyBundleService;

  constructor(private readonly orgId: string) {
    this.policyBundleService = new PathPolicyBundleService(orgId);
  }

  async upsertMonthlyCloseInput(
    input: {
      month: string;
      member_id: string;
      role_level?: PathRoleLevel | null;
      trade_family_observations?: Record<string, unknown>;
      aqr_input?: Record<string, unknown>;
      selected_site_ids?: string[];
      comment?: string;
    },
    actor: ActorRef,
  ): Promise<PathMonthlyCloseInputRow> {
    const month = ensureMonth(input.month);
    const member_id = ensureUuid(input.member_id, "INVALID_MEMBER_ID");
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("path_monthly_close_inputs")
      .upsert(
        {
          org_id: this.orgId,
          month,
          member_id,
          role_level: input.role_level ?? null,
          trade_family_observations: input.trade_family_observations ?? {},
          aqr_input: input.aqr_input ?? {},
          selected_site_ids: input.selected_site_ids ?? [],
          comment: typeof input.comment === "string" ? input.comment.trim() : "",
          submitted_by: actor,
          submitted_at: now,
          updated_at: now,
        },
        { onConflict: "org_id,month,member_id" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save path monthly close input: ${error.message}`);
    }

    return data as PathMonthlyCloseInputRow;
  }

  async listMonthlyCloseInputs(params?: {
    month?: string;
    member_id?: string;
    limit?: number;
  }): Promise<PathMonthlyCloseInputRow[]> {
    let query = supabaseAdmin
      .from("path_monthly_close_inputs")
      .select("*")
      .eq("org_id", this.orgId)
      .order("submitted_at", { ascending: false });

    if (params?.month) {
      query = query.eq("month", ensureMonth(params.month));
    }
    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch path monthly close inputs: ${error.message}`);
    }

    return (data ?? []) as PathMonthlyCloseInputRow[];
  }

  async recordEvidence(
    input: {
      month: string;
      member_id: string;
      trade_family?: PathTradeFamily | null;
      evidence_class: string;
      origin_event_id: string;
      source_type: string;
      source_ref?: string | null;
      summary?: string;
      metadata?: Record<string, unknown>;
    },
    actor: ActorRef,
  ): Promise<PathEvidenceRecordRow> {
    const { data, error } = await supabaseAdmin
      .from("path_evidence_records")
      .insert({
        org_id: this.orgId,
        month: ensureMonth(input.month),
        member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
        trade_family: input.trade_family ?? null,
        evidence_class: input.evidence_class,
        origin_event_id: input.origin_event_id,
        source_type: input.source_type,
        source_ref: input.source_ref ?? null,
        summary: input.summary ?? "",
        metadata: input.metadata ?? {},
        created_by: actor,
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save path evidence record: ${error.message}`);
    }

    return data as PathEvidenceRecordRow;
  }

  async listEvidence(params?: {
    month?: string;
    member_id?: string;
    trade_family?: PathTradeFamily;
    limit?: number;
  }): Promise<PathEvidenceRecordRow[]> {
    let query = supabaseAdmin
      .from("path_evidence_records")
      .select("*")
      .eq("org_id", this.orgId)
      .order("created_at", { ascending: false });

    if (params?.month) {
      query = query.eq("month", ensureMonth(params.month));
    }
    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (params?.trade_family) {
      query = query.eq("trade_family", params.trade_family);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch path evidence records: ${error.message}`);
    }

    return (data ?? []) as PathEvidenceRecordRow[];
  }

  async upsertAiAnnotation(
    input: {
      month: string;
      member_id: string;
      reviewer_kind: "A" | "B";
      adapter_key: string;
      annotation: Record<string, unknown>;
      supporting_evidence_ids?: string[];
      challenged_evidence_ids?: string[];
      model_version?: string;
      prompt_version?: string;
      schema_version?: string;
    },
    actor: ActorRef,
  ): Promise<PathAiAnnotationRow> {
    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("path_ai_review_annotations")
      .upsert(
        {
          org_id: this.orgId,
          month: ensureMonth(input.month),
          member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
          reviewer_kind: input.reviewer_kind,
          adapter_key: input.adapter_key,
          annotation: input.annotation,
          supporting_evidence_ids: input.supporting_evidence_ids ?? [],
          challenged_evidence_ids: input.challenged_evidence_ids ?? [],
          model_version: input.model_version ?? "deterministic-v1",
          prompt_version: input.prompt_version ?? "deterministic-v1",
          schema_version: input.schema_version ?? "path-review-v1",
          created_by: actor,
          created_at: now,
          updated_at: now,
        },
        { onConflict: "org_id,month,member_id,reviewer_kind" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save path AI annotation: ${error.message}`);
    }

    return data as PathAiAnnotationRow;
  }

  async listAiAnnotations(params?: {
    month?: string;
    member_id?: string;
    reviewer_kind?: "A" | "B";
    limit?: number;
  }): Promise<PathAiAnnotationRow[]> {
    let query = supabaseAdmin
      .from("path_ai_review_annotations")
      .select("*")
      .eq("org_id", this.orgId)
      .order("created_at", { ascending: false });

    if (params?.month) {
      query = query.eq("month", ensureMonth(params.month));
    }
    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (params?.reviewer_kind) {
      query = query.eq("reviewer_kind", params.reviewer_kind);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch path AI annotations: ${error.message}`);
    }

    return (data ?? []) as PathAiAnnotationRow[];
  }

  async upsertSiteItemProfitSnapshot(input: {
    month: string;
    site_id: string;
    item_key: string;
    item_name: string;
    trade_family: PathTradeFamily;
    revenue: number;
    material_cost: number;
    subcontract_cost: number;
    direct_cost: number;
    estimated_std_hours: number;
    difficulty_band: PathDifficultyBand;
    metadata?: Record<string, unknown>;
  }): Promise<Record<string, unknown>> {
    const revenue = normalizeMoney(input.revenue);
    const material_cost = normalizeMoney(input.material_cost);
    const subcontract_cost = normalizeMoney(input.subcontract_cost);
    const direct_cost = normalizeMoney(input.direct_cost);
    const gross_profit = revenue - material_cost - subcontract_cost - direct_cost;
    const now = new Date().toISOString();

    const { data, error } = await supabaseAdmin
      .from("path_site_item_profit_snapshots")
      .upsert(
        {
          org_id: this.orgId,
          month: ensureMonth(input.month),
          site_id: ensureUuid(input.site_id, "INVALID_SITE_ID"),
          item_key: input.item_key,
          item_name: input.item_name,
          trade_family: input.trade_family,
          revenue,
          material_cost,
          subcontract_cost,
          direct_cost,
          gross_profit,
          estimated_std_hours: input.estimated_std_hours,
          difficulty_band: input.difficulty_band,
          metadata: input.metadata ?? {},
          updated_at: now,
        },
        { onConflict: "org_id,month,site_id,item_key" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save site item profit snapshot: ${error.message}`);
    }

    return (data ?? {}) as Record<string, unknown>;
  }

  async listSiteItemProfitSummary(params?: {
    month?: string;
    site_id?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    let query = supabaseAdmin
      .from("path_site_item_profit_snapshots")
      .select("*")
      .eq("org_id", this.orgId)
      .order("month", { ascending: false })
      .order("item_name", { ascending: true });

    if (params?.month) {
      query = query.eq("month", ensureMonth(params.month));
    }
    if (params?.site_id) {
      query = query.eq("site_id", ensureUuid(params.site_id, "INVALID_SITE_ID"));
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch site item profit summary: ${error.message}`);
    }

    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length > 0 || !params?.month) {
      return rows;
    }

    const { startDate, endDate } = getMonthDateRange(params.month);
    const [canonicalRevenueRows, accountingInputs] = await Promise.all([
      this.buildCanonicalRevenueSummaryRows({
        month: params.month,
        site_id: params.site_id,
      }),
      this.buildAccountingAutoProfitInputs({
        startDate,
        endDate,
        site_id: params.site_id,
        limit: params.limit,
      }),
    ]);

    const canonicalRevenueSales = canonicalRevenueRows.reduce(
      (sum, row) => sum + Number(row.revenue ?? 0),
      0,
    );
    const autoInputs = {
      ...accountingInputs,
      sales: canonicalRevenueSales > 0 ? canonicalRevenueSales : accountingInputs.sales,
    };

    const totalDetected =
      autoInputs.sales +
      autoInputs.outsourcing_cost +
      autoInputs.materials_cost +
      autoInputs.parking_cost +
      autoInputs.transport_cost +
      autoInputs.other_direct_cost +
      autoInputs.common_cost +
      autoInputs.reserve_amount;

    if (totalDetected === 0) {
      return [];
    }

    const directCost =
      autoInputs.transport_cost + autoInputs.other_direct_cost + autoInputs.parking_cost;
    const month = ensureMonth(params.month);
    const summaryRows = [...canonicalRevenueRows];
    const shouldAddAccountingRow =
      canonicalRevenueRows.length === 0 ||
      directCost > 0 ||
      autoInputs.materials_cost > 0 ||
      autoInputs.outsourcing_cost > 0 ||
      autoInputs.common_cost > 0 ||
      autoInputs.reserve_amount > 0;

    if (shouldAddAccountingRow) {
      summaryRows.push({
        id: `auto-rollup:${this.orgId}:${month}:${params.site_id ?? "all"}`,
        org_id: this.orgId,
        month,
        site_id: params.site_id ?? this.orgId,
        item_key: `auto-rollup:${params.site_id ?? "all"}`,
        item_name:
          canonicalRevenueRows.length > 0 ? "会計コスト自動集計" : "会計自動集計",
        trade_family: "common_site_operations",
        revenue: canonicalRevenueRows.length > 0 ? 0 : accountingInputs.sales,
        material_cost: autoInputs.materials_cost,
        subcontract_cost: autoInputs.outsourcing_cost,
        direct_cost: directCost,
        gross_profit:
          (canonicalRevenueRows.length > 0 ? 0 : accountingInputs.sales) -
          autoInputs.materials_cost -
          autoInputs.outsourcing_cost -
          directCost,
        estimated_std_hours: 0,
        difficulty_band: "S1",
        metadata: {
          source_kind:
            canonicalRevenueRows.length > 0
              ? "accounting_cost_rollup"
              : "accounting_transactions_rollup",
          source_label:
            canonicalRevenueRows.length > 0
              ? "会計コスト自動集計"
              : "会計トランザクション自動集計",
          auto_profit_inputs: autoInputs,
          canonical_revenue_sales: canonicalRevenueSales,
          accounting_sales_fallback: accountingInputs.sales,
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }

    return summaryRows;
  }

  private async buildAccountingAutoProfitInputs(params: {
    startDate: string;
    endDate: string;
    site_id?: string;
    limit?: number;
  }): Promise<AutoProfitInputs> {
    let accountingQuery = supabaseAdmin
      .from("accounting_transactions")
      .select(
        "id,kind,site_id,cost_center,category,expense_item_code,description,amount_total,recorded_date,site:sites(id,org_id)",
      )
      .in("status", Array.from(ACCOUNTING_SYNC_STATUSES))
      .in("kind", Array.from(ACCOUNTING_SYNC_KINDS))
      .gte("recorded_date", params.startDate)
      .lte("recorded_date", params.endDate)
      .order("recorded_date", { ascending: true });

    if (params.site_id) {
      accountingQuery = accountingQuery.eq("site_id", ensureUuid(params.site_id, "INVALID_SITE_ID"));
    }
    if (typeof params.limit === "number") {
      accountingQuery = accountingQuery.limit(Math.max(params.limit * 5, params.limit));
    }

    const { data: accountingRows, error: accountingError } = await accountingQuery;
    if (accountingError) {
      throw new Error(`Failed to fetch accounting rollup for PATH sync: ${accountingError.message}`);
    }

    const scopedRows = (accountingRows ?? []).filter((row) => {
      const siteRecord = isRecord(row.site) ? row.site : null;
      return siteRecord?.org_id === this.orgId;
    });

    return scopedRows.reduce<AutoProfitInputs>((acc, row) => {
      const kind = typeof row.kind === "string" ? row.kind : "";
      const amount = Number(row.amount_total ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) {
        return acc;
      }

      if (kind === "sale" || kind === "invoice") {
        return sumAutoProfitInputs(acc, { sales: amount });
      }

      const costCenter = typeof row.cost_center === "string" ? row.cost_center : "";
      const category = typeof row.category === "string" ? row.category : "";
      const expenseItemCode =
        typeof row.expense_item_code === "string" ? row.expense_item_code.toLowerCase() : "";
      const description = typeof row.description === "string" ? row.description.toLowerCase() : "";

      if (costCenter === "HQ") {
        return sumAutoProfitInputs(acc, { common_cost: amount });
      }

      if (category === "material") {
        return sumAutoProfitInputs(acc, { materials_cost: amount });
      }

      if (category === "travel" || category === "fuel") {
        return sumAutoProfitInputs(acc, { transport_cost: amount });
      }

      if (
        expenseItemCode.includes("subcontract") ||
        description.includes("外注") ||
        description.includes("協力会社") ||
        description.includes("下請")
      ) {
        return sumAutoProfitInputs(acc, { outsourcing_cost: amount });
      }

      return sumAutoProfitInputs(acc, { other_direct_cost: amount });
    }, buildEmptyAutoProfitInputs());
  }

  private async buildCanonicalRevenueSummaryRows(params: {
    month: string;
    site_id?: string;
  }): Promise<Record<string, unknown>[]> {
    const { startDate, endDate } = getMonthDateRange(params.month);
    let revenueBasisQuery = supabaseAdmin
      .from("revenue_basis")
      .select("id, site_id, recognition_date, site:sites(id, org_id, revenue, name)")
      .eq("org_id", this.orgId)
      .eq("status", "active")
      .gte("recognition_date", startDate)
      .lte("recognition_date", endDate);

    if (params.site_id) {
      revenueBasisQuery = revenueBasisQuery.eq("site_id", ensureUuid(params.site_id, "INVALID_SITE_ID"));
    }

    const { data: revenueBasisRows, error: revenueBasisError } = await revenueBasisQuery;
    if (revenueBasisError) {
      throw new Error(`Failed to fetch canonical revenue basis rollup: ${revenueBasisError.message}`);
    }

    const basisRows = (revenueBasisRows ?? []) as Array<Record<string, unknown>>;
    if (basisRows.length === 0) {
      return [];
    }

    const revenueBasisIds = basisRows
      .map((row) => (typeof row.id === "string" ? row.id : null))
      .filter((value): value is string => Boolean(value));

    const proposalAmounts = new Map<string, number>();
    if (revenueBasisIds.length > 0) {
      const { data: proposalRows, error: proposalError } = await supabaseAdmin
        .from("proposals")
        .select("revenue_basis_id, payload")
        .eq("org_id", this.orgId)
        .eq("type", "income.create")
        .in("status", ["approved", "executed"])
        .in("revenue_basis_id", revenueBasisIds);

      if (proposalError) {
        throw new Error(`Failed to fetch canonical income proposal rollup: ${proposalError.message}`);
      }

      for (const row of (proposalRows ?? []) as Array<Record<string, unknown>>) {
        const revenueBasisId =
          typeof row.revenue_basis_id === "string" ? row.revenue_basis_id : null;
        if (!revenueBasisId || proposalAmounts.has(revenueBasisId)) {
          continue;
        }

        const amount = readProposalAmount(row.payload);
        if (amount !== null) {
          proposalAmounts.set(revenueBasisId, amount);
        }
      }
    }

    const groupedRows = new Map<
      string,
      { siteId: string; siteName: string; revenue: number; revenueBasisIds: string[] }
    >();

    for (const row of basisRows) {
      const revenueBasisId = typeof row.id === "string" ? row.id : null;
      const siteRecord = isRecord(row.site) ? row.site : null;
      const siteId = typeof row.site_id === "string" ? row.site_id : null;
      if (!siteId) {
        continue;
      }
      const fallbackRevenue = Number(siteRecord?.revenue ?? 0);
      const amount =
        revenueBasisId && proposalAmounts.has(revenueBasisId)
          ? proposalAmounts.get(revenueBasisId) ?? 0
          : Number.isFinite(fallbackRevenue) && fallbackRevenue > 0
            ? Math.round(fallbackRevenue)
            : 0;

      const current = groupedRows.get(siteId) ?? {
        siteId,
        siteName:
          typeof siteRecord?.name === "string" && siteRecord.name.trim().length > 0
            ? siteRecord.name
            : `現場 ${siteId.slice(0, 8)}`,
        revenue: 0,
        revenueBasisIds: [],
      };
      current.revenue += amount;
      if (revenueBasisId) {
        current.revenueBasisIds.push(revenueBasisId);
      }
      groupedRows.set(siteId, current);
    }

    const now = new Date().toISOString();
    return Array.from(groupedRows.values())
      .filter((row) => row.revenue > 0)
      .map((row) => ({
        id: `canonical-revenue:${this.orgId}:${params.month}:${row.siteId}`,
        org_id: this.orgId,
        month: ensureMonth(params.month),
        site_id: row.siteId,
        item_key: `canonical-revenue:${row.siteId}`,
        item_name: row.siteName,
        trade_family: "common_site_operations",
        revenue: row.revenue,
        material_cost: 0,
        subcontract_cost: 0,
        direct_cost: 0,
        gross_profit: row.revenue,
        estimated_std_hours: 0,
        difficulty_band: "S1",
        metadata: {
          source_kind: "revenue_basis_income_create",
          source_label: "完了現場売上",
          revenue_basis_ids: row.revenueBasisIds,
        },
        created_at: now,
        updated_at: now,
      }));
  }

  private buildRewardPreview(
    bundle: PathPolicyBundle,
    input: PathRewardPreviewInput,
  ): PathRewardPreview {
    const month = ensureMonth(input.month);
    assert(Array.isArray(input.members) && input.members.length > 0, "MEMBERS_REQUIRED");
    const levelCoefficients = getNumberMap(bundle, "LEVEL_COEFFICIENTS");
    const difficultyCoefficients = getNumberMap(bundle, "DIFFICULTY_COEFFICIENTS");
    const familyCoefficients = getNumberMap(bundle, "FAMILY_COEFFICIENTS");
    const roleCoefficients = getNumberMap(bundle, "ROLE_COEFFICIENTS");
    const qualityCoefficients = getNumberMap(bundle, "QUALITY_GATE_COEFFICIENTS");
    const basePoolRate = Number(bundle.policy_constants["BASE_POOL_RATE"] ?? 0.85);

    const closed_profit = normalizeMoney(
      input.pool.recognized_revenue -
        input.pool.direct_costs -
        input.pool.overhead_allocated -
        input.pool.rule_reserve +
        input.pool.prior_period_adjustments,
    );
    const distributable_amount = closed_profit;
    const path_pool_amount = 0;
    let base_pool_amount = Math.round(distributable_amount * basePoolRate);
    let variable_pool_amount = distributable_amount - base_pool_amount;

    const membersDerived = input.members.map((member) => {
      ensureUuid(member.member_id, "INVALID_MEMBER_ID");
      assert(["L1", "L2", "L3", "L4", "L5"].includes(member.role_level), "INVALID_LEVEL");

      const A = normalizeScore(member.A, "INVALID_A_SCORE");
      const R = normalizeScore(member.R, "INVALID_R_SCORE");
      const Q = normalizeScore(member.Q, "INVALID_Q_SCORE");
      const monthly_point_total = A + R + Q;
      const monthly_coefficient = resolveMonthlyCoefficient(bundle, monthly_point_total);
      const level_coefficient = levelCoefficients[member.role_level] ?? 1;
      const base_weight = round4(member.credited_units * level_coefficient);

      const package_contributions = member.package_contributions.map((contribution) => {
        const std_hours = normalizeNonNegativeNumber(contribution.std_hours, "INVALID_STD_HOURS");
        const responsibility_share = normalizeNonNegativeNumber(
          contribution.responsibility_share,
          "INVALID_RESPONSIBILITY_SHARE",
        );
        const rated_units = normalizeNonNegativeNumber(
          contribution.rated_units ?? contribution.responsibility_share,
          "INVALID_RESPONSIBILITY_SHARE",
        );
        const difficulty = difficultyCoefficients[contribution.difficulty_band] ?? 1;
        const family = familyCoefficients[contribution.trade_family] ?? 1;
        const role = roleCoefficients[contribution.role_type] ?? 1;
        const quality = qualityCoefficients[contribution.quality_result] ?? 1;
        const package_points = round4(std_hours * difficulty * family);
        const member_points = round4(
          package_points * responsibility_share * role * quality,
        );

        return {
          package_id: contribution.package_id,
          trade_family: contribution.trade_family,
          std_hours,
          difficulty_band: contribution.difficulty_band,
          responsibility_share,
          role_type: contribution.role_type,
          quality_result: contribution.quality_result,
          rated_units,
          package_points,
          member_points,
        } satisfies PathRewardExplanationPackageContribution;
      });

      const package_points_total = round4(
        package_contributions.reduce((sum, contribution) => sum + contribution.member_points, 0),
      );
      const rated_units = round4(
        package_contributions.reduce((sum, contribution) => sum + contribution.rated_units, 0),
      );
      const variable_weight = round4(package_points_total * monthly_coefficient);
      const guaranteed_pay = normalizeMoney(member.guaranteed_pay ?? 0);

      return {
        ...member,
        A,
        R,
        Q,
        rated_units,
        monthly_point_total,
        monthly_coefficient,
        base_weight,
        variable_weight,
        package_points_total,
        package_contributions,
        guaranteed_pay,
      };
    });

    const totalBaseWeight = membersDerived.reduce((sum, member) => sum + member.base_weight, 0);
    assert(totalBaseWeight > 0, "BASE_WEIGHT_REQUIRED");

    const variableWeights = membersDerived.map((member) => member.variable_weight);
    const variableWeightTotal = variableWeights.reduce((sum, weight) => sum + weight, 0);
    if (variableWeightTotal <= 0) {
      base_pool_amount += variable_pool_amount;
      variable_pool_amount = 0;
    }

    const baseAmounts = distributeByWeights(
      base_pool_amount,
      membersDerived.map((member) => member.base_weight),
    );
    const variableAmounts =
      variable_pool_amount > 0
        ? distributeByWeights(variable_pool_amount, variableWeights)
        : membersDerived.map(() => 0);

    const members = membersDerived.map((member, index) => {
      const base_amount = baseAmounts[index] ?? 0;
      const variable_amount = variableAmounts[index] ?? 0;
      const calculated_pay = base_amount + variable_amount;
      const final_pay = Math.max(calculated_pay, member.guaranteed_pay);
      const guarantee_adjustment = final_pay - calculated_pay;

      const explanations = {
        policy_fingerprint: bundle.fingerprint,
        level_coefficient: levelCoefficients[member.role_level] ?? 1,
        monthly_coefficient: member.monthly_coefficient,
        monthly_point_total: member.monthly_point_total,
        base_weight: member.base_weight,
        variable_weight: member.variable_weight,
        package_points_total: member.package_points_total,
        neutral_flags: member.neutral_flags ?? [],
        reason_codes: [
          member.neutral_flags?.length ? "NEUTRAL_HANDLING_APPLIED" : "MONTHLY_RATING_APPLIED",
          guarantee_adjustment > 0 ? "GUARANTEE_FLOOR_APPLIED" : "CALCULATED_PAY_APPLIED",
        ],
      };

      return {
        member_id: member.member_id,
        name: member.name,
        role_level: member.role_level,
        credited_units: member.credited_units,
        rated_units: member.rated_units,
        A: member.A,
        R: member.R,
        Q: member.Q,
        monthly_point_total: member.monthly_point_total,
        monthly_coefficient: member.monthly_coefficient,
        base_weight: member.base_weight,
        variable_weight: member.variable_weight,
        base_amount,
        variable_amount,
        calculated_pay,
        guaranteed_pay: member.guaranteed_pay,
        guarantee_adjustment,
        final_pay,
        package_points_total: member.package_points_total,
        explanations,
      } satisfies PathRewardPreviewMember;
    });

    const guaranteed_total_amount = members.reduce(
      (sum, member) => sum + member.guarantee_adjustment,
      0,
    );
    const input_hash = hashStableRecord({ month, pool: input.pool, members: input.members });
    const explanation_snapshots = members.map((member) => ({
      ...member,
      month,
      policy_fingerprint: bundle.fingerprint,
      closed_profit,
      path_pool_amount,
      base_pool_amount,
      variable_pool_amount,
      package_contributions:
        membersDerived.find((candidate) => candidate.member_id === member.member_id)?.package_contributions ?? [],
    }));

    return {
      calculation_system: "path_v22",
      calculation_version: bundle.version,
      month,
      close_id: input.close_id ?? null,
      month_close_id:
        typeof input.month_close_id === "string" && input.month_close_id.length > 0
          ? input.month_close_id
          : null,
      policy_bundle: {
        id: bundle.id,
        bundle_key: bundle.bundle_key,
        version: bundle.version,
        revision: bundle.revision,
        effective_from: bundle.effective_from,
        fingerprint: bundle.fingerprint,
      },
      input_hash,
      closed_profit,
      path_pool_amount,
      base_pool_amount,
      variable_pool_amount,
      guaranteed_total_amount,
      members,
      explanation_snapshots,
    };
  }

  async calculateRewardPreview(input: PathRewardPreviewInput): Promise<PathRewardPreview> {
    const month = ensureMonth(input.month);
    const bundle = await this.policyBundleService.resolveActiveBundle(month);
    return this.buildRewardPreview(bundle, input);
  }

  async buildMonthlyCloseProposalPayload(
    input: PathMonthlyCloseProposalInput,
  ): Promise<Record<string, unknown>> {
    const month = ensureMonth(input.month);
    const member_id = ensureUuid(input.member_id, "INVALID_MEMBER_ID");
    const bundle = await this.policyBundleService.resolveActiveBundle(month);
    const A = normalizeScore(input.A, "INVALID_A_SCORE");
    const R = normalizeScore(input.R, "INVALID_R_SCORE");
    const Q = normalizeScore(input.Q, "INVALID_Q_SCORE");
    const input_hash = hashStableRecord({
      month,
      member_id,
      current_role_level: input.current_role_level ?? null,
      A,
      R,
      Q,
      selected_site_ids: input.selected_site_ids ?? [],
      neutral_flags: input.neutral_flags ?? [],
      evidence_ids: input.evidence_ids,
      credited_units: input.credited_units,
      opportunity_audits: input.opportunity_audits ?? [],
    });

    return {
      path_module_version: "v2.2",
      month,
      member_id,
      current_role_level: input.current_role_level ?? null,
      A,
      R,
      Q,
      selected_site_ids: input.selected_site_ids ?? [],
      neutral_flags: input.neutral_flags ?? [],
      evidence_ids: input.evidence_ids,
      credited_units: input.credited_units,
      opportunity_audits: input.opportunity_audits ?? [],
      close_status: "closed",
      explanation: input.explanation ?? {},
      policy_context: mapProposalToPolicyContext(bundle, input_hash),
      input_hash,
    };
  }

  buildRewardRunProposalPayload(
    preview: PathRewardPreview,
    actor: ActorRef,
    options?: {
      preview_snapshot_id?: string | null;
      reward_rule_version_id?: string | null;
    },
  ): Record<string, unknown> {
    return {
      calculation_system: preview.calculation_system,
      calculation_version: preview.calculation_version,
      path_module_version: "v2.2",
      month: preview.month,
      close_id: preview.close_id,
      month_close_id: preview.month_close_id ?? preview.close_id,
      reward_rule_version_id: options?.reward_rule_version_id ?? preview.policy_bundle.id,
      reward_engine_version: PATH_REWARD_ENGINE_VERSION,
      rounding_mode: PATH_ROUNDING_MODE,
      rounding_scale: PATH_ROUNDING_SCALE,
      rounding_minor_unit: PATH_ROUNDING_MINOR_UNIT,
      preview_snapshot_id: options?.preview_snapshot_id ?? null,
      policy_context: preview.policy_bundle,
      input_hash: preview.input_hash,
      closed_profit: preview.closed_profit,
      path_pool_amount: preview.path_pool_amount,
      base_pool_amount: preview.base_pool_amount,
      variable_pool_amount: preview.variable_pool_amount,
      guaranteed_total_amount: preview.guaranteed_total_amount,
      member_payouts: preview.members,
      explanations: preview.explanation_snapshots,
      journal_created_by: actor.id,
      amount_total: preview.members.reduce((sum, member) => sum + member.final_pay, 0),
      total_amount: preview.members.reduce((sum, member) => sum + member.final_pay, 0),
      currency: "JPY",
    };
  }

  private async loadPolicyBundleBySnapshot(record: {
    period_ym?: string | null;
    policy_bundle_version_id?: string | null;
    policy_fingerprint?: string | null;
  }): Promise<PathPolicyBundle> {
    const bundleId =
      typeof record.policy_bundle_version_id === "string" && record.policy_bundle_version_id.length > 0
        ? record.policy_bundle_version_id
        : null;
    const fingerprint =
      typeof record.policy_fingerprint === "string" && record.policy_fingerprint.length > 0
        ? record.policy_fingerprint
        : null;

    let query = supabaseAdmin
      .from("policy_bundle_versions")
      .select("*")
      .eq("org_id", this.orgId);

    if (bundleId) {
      query = query.eq("id", bundleId);
    } else if (fingerprint) {
      query = query.eq("fingerprint", fingerprint);
    } else {
      return this.policyBundleService.resolveActiveBundle(record.period_ym ?? undefined);
    }

    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`Failed to fetch PATH policy bundle snapshot: ${error.message}`);
    }

    return (data as PathPolicyBundle | null) ??
      this.policyBundleService.resolveActiveBundle(record.period_ym ?? undefined);
  }

  private async getFixedMonthClose(monthCloseId: string): Promise<Record<string, unknown>> {
    const normalizedMonthCloseId = ensureUuid(monthCloseId, "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED");
    const { data, error } = await supabaseAdmin
      .from("month_closes")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("id", normalizedMonthCloseId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch canonical month close: ${error.message}`);
    }
    assert(data, "MONTH_CLOSE_NOT_FOUND");
    assert(data.status === "fixed", "REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE");
    return data as Record<string, unknown>;
  }

  private async getLatestFixedMonthCloseByMonth(month: string): Promise<Record<string, unknown> | null> {
    const normalizedMonth = ensureMonth(month);
    const { data, error } = await supabaseAdmin
      .from("month_closes")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("period_ym", normalizedMonth)
      .eq("status", "fixed")
      .order("fixed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch latest fixed month close: ${error.message}`);
    }

    return (data as Record<string, unknown> | null) ?? null;
  }

  private async loadMemberNameMap(memberIds: string[]): Promise<Map<string, string>> {
    const normalizedIds = Array.from(new Set(memberIds.filter((value) => UUID_PATTERN.test(value))));
    if (normalizedIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", normalizedIds);

    if (error) {
      throw new Error(`Failed to fetch member profiles for reward basis: ${error.message}`);
    }

    const memberNameMap = new Map(
      ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
        const id = typeof row.id === "string" ? row.id : "";
        const name =
          typeof row.full_name === "string" && row.full_name.trim().length > 0
            ? row.full_name.trim()
            : typeof row.username === "string" && row.username.trim().length > 0
              ? row.username.trim()
              : id;
        return [id, name] as const;
      }),
    );

    for (const devUser of DEV_AUTH_USERS) {
      if (
        normalizedIds.includes(devUser.id) &&
        (!memberNameMap.has(devUser.id) || memberNameMap.get(devUser.id) === devUser.id)
      ) {
        memberNameMap.set(devUser.id, devUser.name);
      }
    }

    return memberNameMap;
  }

  private sumCreditedUnits(payload: Record<string, unknown>, memberId: string, fallback = 0): number {
    const rows = getRecordArray(payload.credited_units);
    if (rows.length === 0) {
      return normalizeNonNegativeNumber(fallback, "INVALID_RESPONSIBILITY_SHARE");
    }

    const total = rows.reduce((sum, row) => {
      const rowMemberId =
        typeof row.member_id === "string" && row.member_id.length > 0 ? row.member_id : memberId;
      if (rowMemberId !== memberId) {
        return sum;
      }

      return sum + normalizeNonNegativeNumber(row.units ?? 0, "INVALID_RESPONSIBILITY_SHARE");
    }, 0);

    return round4(total || fallback);
  }

  private async ensureRewardBasisSnapshot(monthCloseId: string): Promise<Record<string, unknown>> {
    const close = await this.getFixedMonthClose(monthCloseId);
    const period = ensureMonth(String(close.period_ym ?? ""));

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("reward_basis_snapshots")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("month_close_id", monthCloseId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch reward basis snapshot: ${existingError.message}`);
    }

    const [bundle, monthCloseLinesResult, finalizationsResult, evaluationProposalResult, workPackageResult] =
      await Promise.all([
        existing
          ? this.loadPolicyBundleBySnapshot(existing as Record<string, unknown>)
          : this.policyBundleService.resolveActiveBundle(period),
        supabaseAdmin
          .from("month_close_lines")
          .select("id, revenue_basis_id, site_id, sales_amount, cost_amount, recognized_at")
          .eq("org_id", this.orgId)
          .eq("month_close_id", monthCloseId),
        supabaseAdmin
          .from("monthly_evaluation_finalizations")
          .select("member_id, work_days, A, R, Q, current_level, finalized_at")
          .eq("org_id", this.orgId)
          .eq("month", period),
        supabaseAdmin
          .from("proposals")
          .select("id, payload, executed_at")
          .eq("org_id", this.orgId)
          .eq("type", "evaluation.finalize")
          .eq("status", "executed"),
        supabaseAdmin
          .from("path_work_packages")
          .select("id, package_key, site_id, trade_family, estimated_std_hours, difficulty_band")
          .eq("org_id", this.orgId)
          .eq("month", period),
      ]);

    if (monthCloseLinesResult.error) {
      throw new Error(`Failed to fetch month close lines for reward basis: ${monthCloseLinesResult.error.message}`);
    }
    if (finalizationsResult.error) {
      throw new Error(`Failed to fetch finalizations for reward basis: ${finalizationsResult.error.message}`);
    }
    if (evaluationProposalResult.error) {
      throw new Error(`Failed to fetch evaluation proposals for reward basis: ${evaluationProposalResult.error.message}`);
    }
    if (workPackageResult.error) {
      throw new Error(`Failed to fetch work packages for reward basis: ${workPackageResult.error.message}`);
    }

    const monthCloseLines = ((monthCloseLinesResult.data ?? []) as Array<Record<string, unknown>>).sort((left, right) =>
      String(left.revenue_basis_id ?? "").localeCompare(String(right.revenue_basis_id ?? "")),
    );
    const recognizedRevenue = normalizeMoney(
      monthCloseLines.reduce((sum, row) => sum + Number(row.sales_amount ?? 0), 0),
    );
    const directCosts = normalizeMoney(
      monthCloseLines.reduce((sum, row) => sum + Number(row.cost_amount ?? 0), 0),
    );
    const overheadAllocated = 0;
    const ruleReserve = 0;
    const priorPeriodAdjustments = 0;
    const closedProfit = normalizeMoney(
      recognizedRevenue - directCosts - overheadAllocated - ruleReserve + priorPeriodAdjustments,
    );

    const evaluationPayloadByMember = new Map<string, Record<string, unknown>>();
    for (const row of (evaluationProposalResult.data ?? []) as Array<Record<string, unknown>>) {
      const payload = isRecord(row.payload) ? row.payload : null;
      if (!payload || payload.month !== period) {
        continue;
      }
      const memberId = typeof payload.member_id === "string" ? payload.member_id : null;
      if (!memberId || evaluationPayloadByMember.has(memberId)) {
        continue;
      }
      evaluationPayloadByMember.set(memberId, payload);
    }

    const finalizationByMember = new Map<string, Record<string, unknown>>();
    for (const row of (finalizationsResult.data ?? []) as Array<Record<string, unknown>>) {
      const memberId = typeof row.member_id === "string" ? row.member_id : null;
      if (memberId && !finalizationByMember.has(memberId)) {
        finalizationByMember.set(memberId, row);
      }
    }

    const workPackages = (workPackageResult.data ?? []) as Array<Record<string, unknown>>;
    const workPackageIds = workPackages
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean);
    const workPackageById = new Map(
      workPackages.map((row) => [String(row.id ?? ""), row] as const).filter(([id]) => Boolean(id)),
    );

    const assignmentsResult =
      workPackageIds.length > 0
        ? await supabaseAdmin
            .from("path_work_package_assignments")
            .select("work_package_id, member_id, responsibility_share, role_type, quality_result, rated_units")
            .eq("org_id", this.orgId)
            .in("work_package_id", workPackageIds)
        : { data: [], error: null };

    if (assignmentsResult.error) {
      throw new Error(`Failed to fetch work package assignments for reward basis: ${assignmentsResult.error.message}`);
    }

    const memberIds = Array.from(
      new Set(
        [
          ...Array.from(evaluationPayloadByMember.keys()),
          ...Array.from(finalizationByMember.keys()),
          ...((assignmentsResult.data ?? []) as Array<Record<string, unknown>>)
            .map((row) => (typeof row.member_id === "string" ? row.member_id : ""))
            .filter(Boolean),
        ].filter((value) => UUID_PATTERN.test(value)),
      ),
    );
    const memberNameMap = await this.loadMemberNameMap(memberIds);

    const siteLineMap = new Map<
      string,
      { revenue_basis_id: string | null; month_close_line_id: string | null }
    >();
    for (const row of monthCloseLines) {
      const siteId = typeof row.site_id === "string" ? row.site_id : null;
      if (!siteId || siteLineMap.has(siteId)) {
        continue;
      }
      siteLineMap.set(siteId, {
        revenue_basis_id: typeof row.revenue_basis_id === "string" ? row.revenue_basis_id : null,
        month_close_line_id: typeof row.id === "string" ? row.id : null,
      });
    }

    const rewardRuleVersionId =
      typeof close.close_rule_version_id === "string" && UUID_PATTERN.test(close.close_rule_version_id)
        ? close.close_rule_version_id
        : ensureUuid(bundle.id, "REWARD_CALCULATE_PATH_V22_REQUIRED");
    const policyBundleVersionId = UUID_PATTERN.test(bundle.id) ? bundle.id : null;

    const snapshotPayload = {
      org_id: this.orgId,
      month_close_id: monthCloseId,
      period_ym: period,
      reward_rule_version_id: rewardRuleVersionId,
      policy_bundle_version_id: policyBundleVersionId,
      policy_fingerprint: bundle.fingerprint,
      reward_engine_version: PATH_REWARD_ENGINE_VERSION,
      rounding_mode: PATH_ROUNDING_MODE,
      rounding_scale: PATH_ROUNDING_SCALE,
      rounding_minor_unit: PATH_ROUNDING_MINOR_UNIT,
      recognized_revenue: recognizedRevenue,
      direct_costs: directCosts,
      overhead_allocated: overheadAllocated,
      rule_reserve: ruleReserve,
      prior_period_adjustments: priorPeriodAdjustments,
      closed_profit: closedProfit,
      source_refs_json: monthCloseLines.map((row) => ({
        month_close_line_id: row.id ?? null,
        revenue_basis_id: row.revenue_basis_id ?? null,
      })),
      metadata: {
        month_close_line_count: monthCloseLines.length,
        member_count: memberIds.length,
      },
    };

    const snapshotResult = await supabaseAdmin
      .from("reward_basis_snapshots")
      .upsert(snapshotPayload, { onConflict: "month_close_id" })
      .select("*")
      .single();

    if (snapshotResult.error) {
      throw new Error(`Failed to upsert reward basis snapshot: ${snapshotResult.error.message}`);
    }

    const snapshot = snapshotResult.data as Record<string, unknown>;
    const snapshotId = String(snapshot.id ?? "");

    await supabaseAdmin
      .from("reward_basis_member_snapshots")
      .delete()
      .eq("org_id", this.orgId)
      .eq("reward_basis_snapshot_id", snapshotId);
    await supabaseAdmin
      .from("reward_basis_package_snapshots")
      .delete()
      .eq("org_id", this.orgId)
      .eq("reward_basis_snapshot_id", snapshotId);

    const memberRows = memberIds.map((memberId) => {
      const finalize = finalizationByMember.get(memberId) ?? {};
      const payload = evaluationPayloadByMember.get(memberId) ?? {};
      const aScore = normalizeScore(payload.A ?? finalize.A ?? 0, "INVALID_A_SCORE");
      const rScore = normalizeScore(payload.R ?? finalize.R ?? 0, "INVALID_R_SCORE");
      const qScore = normalizeScore(payload.Q ?? finalize.Q ?? 0, "INVALID_Q_SCORE");
      const monthlyPointTotal = aScore + rScore + qScore;
      return {
        org_id: this.orgId,
        reward_basis_snapshot_id: snapshotId,
        member_id: memberId,
        member_name: memberNameMap.get(memberId) ?? memberId,
        role_level:
          (payload.current_role_level as PathRoleLevel | undefined) ??
          (finalize.current_level as PathRoleLevel | undefined) ??
          "L1",
        credited_units: this.sumCreditedUnits(payload, memberId, Number(finalize.work_days ?? 0)),
        guaranteed_pay_amount: 0,
        guaranteed_pay_basis: { source: "default_zero" },
        a_score: aScore,
        r_score: rScore,
        q_score: qScore,
        monthly_point_total: monthlyPointTotal,
        monthly_coefficient: resolveMonthlyCoefficient(bundle, monthlyPointTotal),
        neutral_flags: Array.isArray(payload.neutral_flags) ? payload.neutral_flags : [],
        source_refs_json: [
          typeof payload.member_id === "string" ? { proposal_member_id: payload.member_id } : null,
          finalize.member_id ? { finalization_member_id: finalize.member_id } : null,
        ].filter(Boolean),
      };
    });

    if (memberRows.length > 0) {
      const { error } = await supabaseAdmin.from("reward_basis_member_snapshots").insert(memberRows);
      if (error) {
        throw new Error(`Failed to insert reward basis member snapshots: ${error.message}`);
      }
    }

    const packageRows = ((assignmentsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((assignment) => {
        const workPackage = workPackageById.get(String(assignment.work_package_id ?? ""));
        if (!workPackage) {
          return null;
        }
        const siteId = typeof workPackage.site_id === "string" ? workPackage.site_id : null;
        const closeLine = siteId ? siteLineMap.get(siteId) ?? null : null;
        return {
          org_id: this.orgId,
          reward_basis_snapshot_id: snapshotId,
          member_id: assignment.member_id,
          work_package_id: workPackage.id,
          package_key: workPackage.package_key,
          month_close_line_id: closeLine?.month_close_line_id ?? null,
          revenue_basis_id: closeLine?.revenue_basis_id ?? null,
          site_id: siteId,
          trade_family: workPackage.trade_family,
          std_hours: normalizeNonNegativeNumber(
            workPackage.estimated_std_hours ?? 0,
            "INVALID_STD_HOURS",
          ),
          difficulty_band: workPackage.difficulty_band,
          responsibility_share: normalizeNonNegativeNumber(
            assignment.responsibility_share ?? 0,
            "INVALID_RESPONSIBILITY_SHARE",
          ),
          role_type: assignment.role_type,
          quality_result: assignment.quality_result,
          rated_units: normalizeNonNegativeNumber(
            assignment.rated_units ?? assignment.responsibility_share ?? 0,
            "INVALID_RESPONSIBILITY_SHARE",
          ),
          source_refs_json: [
            { work_package_id: workPackage.id },
            { assignment_member_id: assignment.member_id ?? null },
          ],
        };
      })
      .filter(Boolean) as Array<Record<string, unknown>>;

    if (packageRows.length > 0) {
      const { error } = await supabaseAdmin.from("reward_basis_package_snapshots").insert(packageRows);
      if (error) {
        throw new Error(`Failed to insert reward basis package snapshots: ${error.message}`);
      }
    }

    return snapshot;
  }

  private async ensureRewardPreviewSnapshot(
    monthCloseId: string,
  ): Promise<{ preview: PathRewardPreview; previewSnapshot: Record<string, unknown>; basisSnapshot: Record<string, unknown> }> {
    const monthClose = await this.getFixedMonthClose(monthCloseId);
    const basisSnapshot = await this.ensureRewardBasisSnapshot(monthCloseId);

    const [memberRowsResult, packageRowsResult] = await Promise.all([
      supabaseAdmin
        .from("reward_basis_member_snapshots")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("reward_basis_snapshot_id", basisSnapshot.id),
      supabaseAdmin
        .from("reward_basis_package_snapshots")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("reward_basis_snapshot_id", basisSnapshot.id),
    ]);

    if (memberRowsResult.error) {
      throw new Error(`Failed to fetch reward basis member rows: ${memberRowsResult.error.message}`);
    }
    if (packageRowsResult.error) {
      throw new Error(`Failed to fetch reward basis package rows: ${packageRowsResult.error.message}`);
    }

    const bundle = await this.loadPolicyBundleBySnapshot(basisSnapshot as Record<string, unknown>);
    const packageRows = (packageRowsResult.data ?? []) as Array<Record<string, unknown>>;
    const members = ((memberRowsResult.data ?? []) as Array<Record<string, unknown>>).map((member) => ({
      member_id: String(member.member_id ?? ""),
      name: String(member.member_name ?? member.member_id ?? ""),
      role_level: (member.role_level as PathRoleLevel | undefined) ?? "L1",
      credited_units: Number(member.credited_units ?? 0),
      guaranteed_pay: Number(member.guaranteed_pay_amount ?? 0),
      A: Number(member.a_score ?? 0),
      R: Number(member.r_score ?? 0),
      Q: Number(member.q_score ?? 0),
      neutral_flags: Array.isArray(member.neutral_flags) ? (member.neutral_flags as string[]) : [],
      package_contributions: packageRows
        .filter((row) => row.member_id === member.member_id)
        .map((row) => ({
          package_id: String(row.package_key ?? row.work_package_id ?? ""),
          trade_family: row.trade_family as PathTradeFamily,
          std_hours: Number(row.std_hours ?? 0),
          difficulty_band: row.difficulty_band as PathDifficultyBand,
          responsibility_share: Number(row.responsibility_share ?? 0),
          role_type: row.role_type as PathRoleType,
          quality_result: row.quality_result as PathQualityResult,
          rated_units: Number(row.rated_units ?? 0),
        })),
    }));

    const preview = this.buildRewardPreview(bundle, {
      month: String(monthClose.period_ym ?? ""),
      close_id: monthCloseId,
      month_close_id: monthCloseId,
      pool: {
        recognized_revenue: Number(basisSnapshot.recognized_revenue ?? 0),
        direct_costs: Number(basisSnapshot.direct_costs ?? 0),
        overhead_allocated: Number(basisSnapshot.overhead_allocated ?? 0),
        rule_reserve: Number(basisSnapshot.rule_reserve ?? 0),
        prior_period_adjustments: Number(basisSnapshot.prior_period_adjustments ?? 0),
      },
      members,
    });

    const previewSnapshotPayload = {
      org_id: this.orgId,
      month_close_id: monthCloseId,
      reward_basis_snapshot_id: basisSnapshot.id,
      reward_rule_version_id: basisSnapshot.reward_rule_version_id,
      policy_bundle_version_id: basisSnapshot.policy_bundle_version_id,
      policy_fingerprint: basisSnapshot.policy_fingerprint,
      reward_engine_version: PATH_REWARD_ENGINE_VERSION,
      rounding_mode: PATH_ROUNDING_MODE,
      rounding_scale: PATH_ROUNDING_SCALE,
      rounding_minor_unit: PATH_ROUNDING_MINOR_UNIT,
      input_hash: preview.input_hash,
      preview_json: preview,
      closed_profit: preview.closed_profit,
      path_pool_amount: preview.path_pool_amount,
      base_pool_amount: preview.base_pool_amount,
      variable_pool_amount: preview.variable_pool_amount,
      guaranteed_total_amount: preview.guaranteed_total_amount,
      final_pay_total: preview.members.reduce((sum, member) => sum + member.final_pay, 0),
      member_count: preview.members.length,
    };

    const previewSnapshotResult = await supabaseAdmin
      .from("reward_preview_snapshots")
      .upsert(previewSnapshotPayload, { onConflict: "month_close_id" })
      .select("*")
      .single();

    if (previewSnapshotResult.error) {
      throw new Error(`Failed to upsert reward preview snapshot: ${previewSnapshotResult.error.message}`);
    }

    return {
      preview,
      previewSnapshot: previewSnapshotResult.data as Record<string, unknown>,
      basisSnapshot: basisSnapshot as Record<string, unknown>,
    };
  }

  private async findExistingCanonicalRewardRun(
    monthCloseId: string,
    rewardRuleVersionId: string,
  ): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabaseAdmin
      .from("reward_runs")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("month_close_id", monthCloseId)
      .eq("reward_rule_version_id", rewardRuleVersionId)
      .eq("run_kind", "calculation")
      .eq("status", "fixed")
      .order("fixed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch canonical reward run: ${error.message}`);
    }

    return (data as Record<string, unknown> | null) ?? null;
  }

  private async findExistingRewardCalculateProposal(
    monthCloseId: string,
    rewardRuleVersionId: string,
  ): Promise<Proposal | null> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("type", "reward.calculate")
      .eq("month_close_id", monthCloseId)
      .eq("reward_rule_version_id", rewardRuleVersionId)
      .in("status", ["draft", "pending", "approved", "executed"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch existing reward proposal: ${error.message}`);
    }

    return (data as Proposal | null) ?? null;
  }

  async previewRewardRunByMonthCloseId(
    monthCloseId: string,
  ): Promise<CanonicalRewardPreviewCommandResult> {
    const normalizedMonthCloseId = ensureUuid(
      monthCloseId,
      "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED",
    );
    const { preview, previewSnapshot, basisSnapshot } = await this.ensureRewardPreviewSnapshot(
      normalizedMonthCloseId,
    );
    const existingRewardRun = await this.findExistingCanonicalRewardRun(
      normalizedMonthCloseId,
      String(basisSnapshot.reward_rule_version_id ?? ""),
    );

    return {
      preview,
      preview_snapshot_id: String(previewSnapshot.id ?? ""),
      reward_rule_version_id: String(basisSnapshot.reward_rule_version_id ?? ""),
      existing_reward_run: existingRewardRun,
    };
  }

  async prepareRewardRunProposalByMonthCloseId(
    monthCloseId: string,
    actor: ActorRef,
  ): Promise<CanonicalRewardProposalPreparation> {
    const normalizedMonthCloseId = ensureUuid(
      monthCloseId,
      "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED",
    );
    const previewResult = await this.previewRewardRunByMonthCloseId(normalizedMonthCloseId);
    const existingProposal = await this.findExistingRewardCalculateProposal(
      normalizedMonthCloseId,
      previewResult.reward_rule_version_id,
    );

    return {
      ...previewResult,
      existing_proposal: existingProposal,
      payload: this.buildRewardRunProposalPayload(previewResult.preview, actor, {
        preview_snapshot_id: previewResult.preview_snapshot_id,
        reward_rule_version_id: previewResult.reward_rule_version_id,
      }),
      idempotency_key: `reward.calculate:${normalizedMonthCloseId}:${previewResult.reward_rule_version_id}`,
    };
  }

  async buildTradeEndorsementProposalPayload(
    input: PathTradeEndorsementProposalInput,
  ): Promise<Record<string, unknown>> {
    ensureUuid(input.member_id, "INVALID_MEMBER_ID");
    assert(PATH_TRADE_FAMILIES.includes(input.trade_family), "INVALID_TRADE_FAMILY");
    assert(PATH_SKILL_STATUS_OPTIONS.includes(input.skill_status), "INVALID_SKILL_STATUS");

    const bundle = await this.policyBundleService.resolveActiveBundle();
    const input_hash = hashStableRecord(input);

    return {
      path_module_version: "v2.2",
      member_id: input.member_id,
      trade_family: input.trade_family,
      skill_status: input.skill_status,
      confidence_class: input.confidence_class,
      freshness_status: input.freshness_status,
      evidence_ids: input.evidence_ids,
      origin_event_ids: input.origin_event_ids,
      assignment_restriction: input.assignment_restriction ?? null,
      manual_approval_required: input.skill_status === "stable_independent",
      policy_context: mapProposalToPolicyContext(bundle, input_hash),
      input_hash,
    };
  }

  async buildRewardAdjustmentProposalPayload(
    input: PathRewardAdjustmentProposalInput,
    actor: ActorRef,
  ): Promise<Record<string, unknown>> {
    ensureUuid(input.reward_run_id, "INVALID_REWARD_RUN_ID");
    const correction_month = ensureMonth(input.correction_month);
    const [canonicalRunResult, projectionRunResult] = await Promise.all([
      supabaseAdmin
        .from("reward_runs")
        .select("id, month_close_id, reward_rule_version_id, policy_fingerprint, policy_bundle_version_id")
        .eq("org_id", this.orgId)
        .eq("id", input.reward_run_id)
        .maybeSingle(),
      supabaseAdmin
        .from("path_reward_runs")
        .select("id, month, status, policy_fingerprint, policy_bundle_version_id, reward_payload")
        .eq("org_id", this.orgId)
        .eq("id", input.reward_run_id)
        .maybeSingle(),
    ]);

    if (canonicalRunResult.error) {
      throw new Error(`Failed to fetch canonical reward run for adjustment: ${canonicalRunResult.error.message}`);
    }
    if (projectionRunResult.error) {
      throw new Error(`Failed to fetch projection reward run for adjustment: ${projectionRunResult.error.message}`);
    }

    let targetMonth: string | null = null;
    let canonicalMonthCloseId: string | null = null;
    let policyFingerprint: string | null = null;
    let policyBundleVersionId: string | null = null;

    if (canonicalRunResult.data) {
      canonicalMonthCloseId =
        typeof canonicalRunResult.data.month_close_id === "string"
          ? canonicalRunResult.data.month_close_id
          : null;
      policyFingerprint =
        typeof canonicalRunResult.data.policy_fingerprint === "string"
          ? canonicalRunResult.data.policy_fingerprint
          : null;
      policyBundleVersionId =
        typeof canonicalRunResult.data.policy_bundle_version_id === "string"
          ? canonicalRunResult.data.policy_bundle_version_id
          : null;

      if (canonicalMonthCloseId) {
        const close = await this.getFixedMonthClose(canonicalMonthCloseId);
        targetMonth = typeof close.period_ym === "string" ? close.period_ym : null;
      }
    }

    if (!targetMonth && projectionRunResult.data) {
      targetMonth =
        typeof projectionRunResult.data.month === "string" ? projectionRunResult.data.month : null;
      const rewardPayload = isRecord(projectionRunResult.data.reward_payload)
        ? projectionRunResult.data.reward_payload
        : null;
      canonicalMonthCloseId =
        canonicalMonthCloseId ||
        (typeof rewardPayload?.month_close_id === "string" && rewardPayload.month_close_id.length > 0
          ? rewardPayload.month_close_id
          : null);
      policyFingerprint =
        policyFingerprint ||
        (typeof projectionRunResult.data.policy_fingerprint === "string"
          ? projectionRunResult.data.policy_fingerprint
          : null);
      policyBundleVersionId =
        policyBundleVersionId ||
        (typeof projectionRunResult.data.policy_bundle_version_id === "string"
          ? projectionRunResult.data.policy_bundle_version_id
          : null);
    }

    assert(targetMonth, "REWARD_RUN_MONTH_MISSING");
    const resolvedTargetMonth = targetMonth as string;
    if (!(correction_month > resolvedTargetMonth)) {
      throw new Error("CLOSED_PERIOD_MUTATION_PROHIBITED");
    }

    const bundle = await this.policyBundleService.resolveActiveBundle(correction_month);
    const input_hash = hashStableRecord(input);

    return {
      calculation_system: "path_v22",
      calculation_version: bundle.version,
      path_module_version: "v2.2",
      run_type: input.mode,
      reward_run_id: input.reward_run_id,
      target_month: resolvedTargetMonth,
      correction_month,
      month_close_id: canonicalMonthCloseId,
      reason_code: input.reason_code,
      member_adjustments: input.member_adjustments,
      note: input.note ?? "",
      journal_created_by: actor.id,
      policy_context: {
        ...mapProposalToPolicyContext(bundle, input_hash),
        fingerprint: policyFingerprint ?? bundle.fingerprint,
        bundle_id: policyBundleVersionId ?? null,
      },
      input_hash,
      amount_total: input.member_adjustments.reduce((sum, item) => sum + Math.abs(item.amount), 0),
      total_amount: input.member_adjustments.reduce((sum, item) => sum + Math.abs(item.amount), 0),
      currency: "JPY",
    };
  }

  async syncProjectionFromExecutedProposal(proposal: Proposal): Promise<void> {
    if (proposal.status !== "executed") {
      return;
    }

    if (proposal.type === "policy.update" && proposal.payload?.module === "path") {
      await this.syncPolicyBundlePublication(proposal);
      return;
    }

    if (proposal.type === "evaluation.finalize" && proposal.payload?.path_module_version === "v2.2") {
      await this.syncMonthClose(proposal);
      return;
    }

    if (
      (proposal.type === "skill.achieve" || proposal.type === "skill.revoke") &&
      proposal.payload?.path_module_version === "v2.2"
    ) {
      await this.syncTradeEndorsement(proposal);
      return;
    }

    if (
      (proposal.type === "reward.calculate" || proposal.type === "reward.adjust") &&
      proposal.payload?.calculation_system === "path_v22"
    ) {
      await this.syncRewardRun(proposal);
    }
  }

  private async resolveBundleIdFromPolicyContext(
    policyContext: Record<string, unknown> | null | undefined,
  ): Promise<string | null> {
    if (!policyContext || typeof policyContext.fingerprint !== "string") {
      return null;
    }

    const { data, error } = await supabaseAdmin
      .from("policy_bundle_versions")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("fingerprint", policyContext.fingerprint)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to resolve policy bundle id: ${error.message}`);
    }

    return data?.id ?? null;
  }

  private async syncPolicyBundlePublication(proposal: Proposal): Promise<void> {
    const bundlePayload = proposal.payload;
    const fingerprint = String(bundlePayload.fingerprint ?? "");
    assert(fingerprint.length > 0, "POLICY_FINGERPRINT_REQUIRED");

    await supabaseAdmin
      .from("policy_bundle_versions")
      .upsert(
        {
          org_id: this.orgId,
          bundle_key: bundlePayload.bundle_key ?? PATH_POLICY_BUNDLE_KEY,
          version: bundlePayload.version ?? "2.2.0",
          revision: bundlePayload.revision ?? 1,
          effective_from: bundlePayload.effective_from ?? new Date().toISOString().slice(0, 10),
          status: "active",
          fingerprint,
          policy_constants: bundlePayload.policy_constants ?? {},
          authority_matrix: bundlePayload.authority_matrix ?? {},
          risk_rules: bundlePayload.risk_rules ?? {},
          auto_approval_rules: bundlePayload.auto_approval_rules ?? {},
          published_proposal_id: proposal.id,
          created_by: proposal.executed_by ?? proposal.created_by,
        },
        { onConflict: "org_id,bundle_key,version,revision" },
      );
  }

  private async syncMonthClose(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const policyContext = (payload.policy_context as Record<string, unknown>) ?? null;
    const closeId = await this.resolveBundleIdFromPolicyContext(policyContext);
    const finalized_at = proposal.executed_at ?? new Date().toISOString();

    const baseRecord = {
      org_id: this.orgId,
      proposal_id: proposal.id,
      month: payload.month,
      member_id: payload.member_id,
      policy_bundle_version_id: closeId,
      policy_fingerprint: String(policyContext?.fingerprint ?? ""),
      input_hash: payload.input_hash ?? "",
      current_role_level: payload.current_role_level ?? null,
      neutral_flags: payload.neutral_flags ?? [],
      evidence_ids: payload.evidence_ids ?? [],
      close_status: payload.close_status ?? "closed",
      explanation: payload.explanation ?? {},
      finalized_by: proposal.executed_by ?? proposal.created_by,
      finalized_at,
    };

    let { data, error } = await supabaseAdmin
      .from("path_month_closes")
      .upsert(
        {
          ...baseRecord,
          a: payload.A ?? 1,
          r: payload.R ?? 1,
          q: payload.Q ?? 1,
        },
        { onConflict: "org_id,month,member_id" },
      )
      .select("id")
      .single();

    if (
      error &&
      (isMissingColumnError(error, "A") ||
        isMissingColumnError(error, "R") ||
        isMissingColumnError(error, "Q") ||
        isMissingColumnError(error, "a") ||
        isMissingColumnError(error, "r") ||
        isMissingColumnError(error, "q"))
    ) {
      const fallbackExplanation =
        typeof baseRecord.explanation === "object" && baseRecord.explanation !== null
          ? {
              ...(baseRecord.explanation as Record<string, unknown>),
              aqr_snapshot: {
                A: payload.A ?? 1,
                R: payload.R ?? 1,
                Q: payload.Q ?? 1,
              },
            }
          : {
              aqr_snapshot: {
                A: payload.A ?? 1,
                R: payload.R ?? 1,
                Q: payload.Q ?? 1,
              },
            };

      const fallbackResult = await supabaseAdmin
        .from("path_month_closes")
        .upsert(
          {
            ...baseRecord,
            explanation: fallbackExplanation,
          },
          { onConflict: "org_id,month,member_id" },
        )
        .select("id")
        .single();

      data = fallbackResult.data;
      error = fallbackResult.error;
    }

    if (error) {
      throw new Error(`Failed to sync path month close: ${error.message}`);
    }
    if (!data?.id) {
      throw new Error("Failed to sync path month close: missing close id");
    }

    if (payload.current_role_level && UUID_PATTERN.test(String(payload.member_id ?? ""))) {
      await supabaseAdmin.from("member_skill_profiles").upsert(
        {
          org_id: this.orgId,
          member_id: payload.member_id,
          current_level: payload.current_role_level,
          current_level_since: finalized_at,
          updated_at: finalized_at,
        },
        { onConflict: "org_id,member_id" },
      );
    }

    const close_id = data.id;
    const creditedUnits = Array.isArray(payload.credited_units)
      ? (payload.credited_units as Array<Record<string, unknown>>)
      : [];

    for (const unit of creditedUnits) {
      await supabaseAdmin.from("path_credited_units").upsert(
        {
          org_id: this.orgId,
          close_id,
          member_id: unit.member_id ?? payload.member_id,
          unit_type: unit.unit_type ?? "work_day",
          units: unit.units ?? 0,
          source_id: unit.source_id ?? null,
          metadata: unit.metadata ?? {},
        },
        { onConflict: "org_id,close_id,member_id,unit_type,source_id" },
      );
    }

    const audits = Array.isArray(payload.opportunity_audits)
      ? (payload.opportunity_audits as Array<Record<string, unknown>>)
      : [];
    for (const audit of audits) {
      await supabaseAdmin.from("path_opportunity_audits").upsert(
        {
          org_id: this.orgId,
          month: payload.month,
          member_id: audit.member_id ?? payload.member_id,
          trade_family: audit.trade_family,
          opportunity_status: audit.opportunity_status,
          eligible_but_unassigned_days: audit.eligible_but_unassigned_days ?? 0,
          opportunity_concentration_score: audit.opportunity_concentration_score ?? 0,
          promotion_blocked_by_opportunity: audit.promotion_blocked_by_opportunity ?? false,
          protected_challenge_count: audit.protected_challenge_count ?? 0,
          summary: audit.summary ?? {},
          source_proposal_id: proposal.id,
        },
        { onConflict: "org_id,month,member_id,trade_family" },
      );
    }

    const fixedCanonicalClose = await this.getLatestFixedMonthCloseByMonth(String(payload.month ?? ""));
    if (fixedCanonicalClose?.id) {
      await this.ensureRewardPreviewSnapshot(String(fixedCanonicalClose.id));
    }
  }

  private async syncTradeEndorsement(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const policyContext = (payload.policy_context as Record<string, unknown>) ?? null;
    await supabaseAdmin.from("path_trade_endorsements").upsert(
      {
        org_id: this.orgId,
        member_id: payload.member_id,
        trade_family: payload.trade_family,
        skill_status: payload.skill_status,
        confidence_class: payload.confidence_class,
        freshness_status: payload.freshness_status,
        evidence_class_counts: payload.evidence_class_counts ?? {},
        origin_event_ids: payload.origin_event_ids ?? [],
        source_proposal_id: proposal.id,
        approved_by: proposal.executed_by ?? proposal.created_by,
        approved_at: proposal.executed_at ?? new Date().toISOString(),
      },
      { onConflict: "org_id,member_id,trade_family" },
    );

    if (payload.assignment_restriction && typeof payload.assignment_restriction === "object") {
      const restriction = payload.assignment_restriction as Record<string, unknown>;
      await supabaseAdmin.from("path_assignment_restrictions").insert({
        org_id: this.orgId,
        member_id: payload.member_id,
        trade_family: payload.trade_family,
        restriction_level: restriction.restriction_level ?? "support_required",
        reason_code: restriction.reason_code ?? "manual_review",
        detail: restriction.detail ?? "",
        source_proposal_id: proposal.id,
        created_by: proposal.executed_by ?? proposal.created_by,
      });
    }

    if (policyContext?.fingerprint) {
      void policyContext;
    }
  }

  private async ensureProposalExecutionRecord(proposal: Proposal): Promise<Record<string, unknown>> {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("proposal_executions")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("proposal_id", proposal.id)
      .eq("status", "succeeded")
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch proposal execution: ${existingError.message}`);
    }

    if (existing) {
      return existing as Record<string, unknown>;
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
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create proposal execution: ${error.message}`);
    }

    return data as Record<string, unknown>;
  }

  private async ensurePayoutPostingGroup(input: {
    proposalExecutionId: string;
    rewardRunId: string;
    month: string;
    description: string;
    reversesPostingGroupId?: string | null;
  }): Promise<Record<string, unknown>> {
    const groupType = input.reversesPostingGroupId ? "payout_reverse" : "payout_post";
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("posting_groups")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("reward_run_id", input.rewardRunId)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch payout posting group: ${existingError.message}`);
    }

    if (existing) {
      return existing as Record<string, unknown>;
    }

    const { data, error } = await supabaseAdmin
      .from("posting_groups")
      .insert({
        org_id: this.orgId,
        group_type: groupType,
        proposal_execution_id: input.proposalExecutionId,
        reward_run_id: input.rewardRunId,
        reverses_posting_group_id: input.reversesPostingGroupId ?? null,
        accounting_date: `${ensureMonth(input.month)}-01`,
        posted_at: new Date().toISOString(),
        currency: "JPY",
        description: input.description,
      })
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to create payout posting group: ${error.message}`);
    }

    return data as Record<string, unknown>;
  }

  private async syncRewardRun(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const policyContext = (payload.policy_context as Record<string, unknown>) ?? null;
    const policy_bundle_version_id = await this.resolveBundleIdFromPolicyContext(policyContext);
    const monthCloseId =
      typeof payload.month_close_id === "string" && payload.month_close_id.length > 0
        ? payload.month_close_id
        : null;
    assert(monthCloseId, "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED");
    const resolvedMonthCloseId = monthCloseId as string;

    const proposalExecution = await this.ensureProposalExecutionRecord(proposal);
    const previewResult = await this.ensureRewardPreviewSnapshot(resolvedMonthCloseId);
    const rewardRuleVersionId = String(
      payload.reward_rule_version_id ??
        previewResult.basisSnapshot.reward_rule_version_id ??
        previewResult.preview.policy_bundle.id,
    );
    const runKind = proposal.type === "reward.adjust" ? "adjustment" : "calculation";

    const { data: existingCanonicalRun, error: existingCanonicalRunError } = await supabaseAdmin
      .from("reward_runs")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("proposal_execution_id", proposalExecution.id)
      .maybeSingle();

    if (existingCanonicalRunError) {
      throw new Error(`Failed to fetch canonical reward run: ${existingCanonicalRunError.message}`);
    }

    const canonicalRunPayload = {
      org_id: this.orgId,
      run_kind: runKind,
      month_close_id: resolvedMonthCloseId,
      proposal_execution_id: proposalExecution.id,
      reward_rule_version_id: rewardRuleVersionId,
      calculation_system: "path_v22",
      adjusts_reward_run_id:
        proposal.type === "reward.adjust" && typeof payload.reward_run_id === "string"
          ? payload.reward_run_id
          : null,
      status: "fixed",
      fixed_at: proposal.executed_at ?? new Date().toISOString(),
      policy_bundle_version_id,
      policy_fingerprint: String(policyContext?.fingerprint ?? previewResult.preview.policy_bundle.fingerprint),
      reward_engine_version: String(payload.reward_engine_version ?? PATH_REWARD_ENGINE_VERSION),
      rounding_mode: String(payload.rounding_mode ?? PATH_ROUNDING_MODE),
      rounding_scale: Number(payload.rounding_scale ?? PATH_ROUNDING_SCALE),
      rounding_minor_unit: Number(payload.rounding_minor_unit ?? PATH_ROUNDING_MINOR_UNIT),
      input_hash: String(payload.input_hash ?? previewResult.preview.input_hash),
      preview_snapshot_id: previewResult.previewSnapshot.id,
      closed_profit: Number(payload.closed_profit ?? previewResult.preview.closed_profit),
      path_pool_amount: Number(payload.path_pool_amount ?? previewResult.preview.path_pool_amount),
      base_pool_amount: Number(payload.base_pool_amount ?? previewResult.preview.base_pool_amount),
      variable_pool_amount: Number(
        payload.variable_pool_amount ?? previewResult.preview.variable_pool_amount,
      ),
      guaranteed_total_amount: Number(
        payload.guaranteed_total_amount ?? previewResult.preview.guaranteed_total_amount,
      ),
    };

    let canonicalRunRecord = existingCanonicalRun as Record<string, unknown> | null;
    if (!canonicalRunRecord) {
      const canonicalInsertResult = await supabaseAdmin
        .from("reward_runs")
        .insert(canonicalRunPayload)
        .select("*")
        .single();

      if (canonicalInsertResult.error) {
        throw new Error(`Failed to create canonical reward run: ${canonicalInsertResult.error.message}`);
      }

      canonicalRunRecord = canonicalInsertResult.data as Record<string, unknown>;
    }

    if (!canonicalRunRecord) {
      throw new Error("Failed to create canonical reward run");
    }

    const canonicalRewardRunId = String(canonicalRunRecord.id ?? "");

    if (!existingCanonicalRun) {
      const rewardBasisPackageResult = await supabaseAdmin
        .from("reward_basis_package_snapshots")
        .select("member_id, month_close_line_id, revenue_basis_id")
        .eq("org_id", this.orgId)
        .eq("reward_basis_snapshot_id", previewResult.basisSnapshot.id);

      const monthCloseLinesResult = await supabaseAdmin
        .from("month_close_lines")
        .select("id, revenue_basis_id")
        .eq("org_id", this.orgId)
        .eq("month_close_id", resolvedMonthCloseId)
        .order("created_at", { ascending: true });

      if (rewardBasisPackageResult.error) {
        throw new Error(
          `Failed to fetch reward basis package snapshots for canonical run: ${rewardBasisPackageResult.error.message}`,
        );
      }
      if (monthCloseLinesResult.error) {
        throw new Error(
          `Failed to fetch month close lines for canonical run: ${monthCloseLinesResult.error.message}`,
        );
      }

      const firstMonthCloseLine = ((monthCloseLinesResult.data ?? []) as Array<Record<string, unknown>>)[0] ?? null;
      const lineAnchorByMember = new Map<
        string,
        { month_close_line_id: string | null; revenue_basis_id: string | null }
      >();
      for (const row of (rewardBasisPackageResult.data ?? []) as Array<Record<string, unknown>>) {
        const memberId = typeof row.member_id === "string" ? row.member_id : null;
        if (!memberId || lineAnchorByMember.has(memberId)) {
          continue;
        }
        lineAnchorByMember.set(memberId, {
          month_close_line_id:
            typeof row.month_close_line_id === "string" ? row.month_close_line_id : null,
          revenue_basis_id: typeof row.revenue_basis_id === "string" ? row.revenue_basis_id : null,
        });
      }

      const memberPayouts = Array.isArray(payload.member_payouts)
        ? (payload.member_payouts as Array<Record<string, unknown>>)
        : Array.isArray(payload.member_adjustments)
          ? (payload.member_adjustments as Array<Record<string, unknown>>)
          : [];

      const canonicalRunLines = memberPayouts
        .map((member) => {
          const memberId = typeof member.member_id === "string" ? member.member_id : "";
          if (!UUID_PATTERN.test(memberId)) {
            return null;
          }
          const lineAnchor =
            lineAnchorByMember.get(memberId) ??
            {
              month_close_line_id:
                typeof firstMonthCloseLine?.id === "string" ? firstMonthCloseLine.id : null,
              revenue_basis_id:
                typeof firstMonthCloseLine?.revenue_basis_id === "string"
                  ? firstMonthCloseLine.revenue_basis_id
                  : null,
            };
          if (!lineAnchor.revenue_basis_id) {
            return null;
          }

          const baseAmount =
            proposal.type === "reward.adjust" ? 0 : Number(member.base_amount ?? 0);
          const payoutAmount =
            proposal.type === "reward.adjust"
              ? Number(member.amount ?? 0)
              : Number(member.final_pay ?? member.final_amount ?? member.amount ?? 0);
          const deltaAmount =
            proposal.type === "reward.adjust"
              ? payoutAmount
              : payoutAmount - baseAmount;

          return {
            org_id: this.orgId,
            reward_run_id: canonicalRewardRunId,
            month_close_line_id: lineAnchor.month_close_line_id,
            revenue_basis_id: lineAnchor.revenue_basis_id,
            recipient_id: memberId,
            base_amount: normalizeMoney(baseAmount),
            delta_amount: normalizeMoney(deltaAmount),
            payout_amount: normalizeMoney(payoutAmount),
            formula_snapshot_json: member,
          };
      })
        .filter(Boolean) as Array<Record<string, unknown>>;

      if (canonicalRunLines.length > 0) {
        const insertCanonicalLinesResult = await supabaseAdmin
          .from("reward_run_lines")
          .insert(canonicalRunLines);

        if (insertCanonicalLinesResult.error) {
          throw new Error(
            `Failed to insert canonical reward run lines: ${insertCanonicalLinesResult.error.message}`,
          );
        }
      }
    }

    const runPayload = {
      org_id: this.orgId,
      proposal_id: proposal.id,
      month: String(payload.month ?? payload.correction_month ?? ""),
      close_id: (payload.close_id as string | null | undefined) ?? null,
      policy_bundle_version_id,
      policy_fingerprint: String(policyContext?.fingerprint ?? ""),
      input_hash: String(payload.input_hash ?? ""),
      run_type: proposal.type === "reward.adjust" ? payload.run_type ?? "adjustment" : "standard",
      correction_of_reward_run_id:
        proposal.type === "reward.adjust" ? payload.reward_run_id ?? null : null,
      target_month: (payload.target_month as string | null | undefined) ?? null,
      closed_profit: payload.closed_profit ?? 0,
      path_pool_amount: payload.path_pool_amount ?? 0,
      base_pool_amount: payload.base_pool_amount ?? 0,
      variable_pool_amount: payload.variable_pool_amount ?? 0,
      guarantee_total_amount: payload.guaranteed_total_amount ?? 0,
      status: "approved",
      reward_payload: payload,
      approved_by: proposal.executed_by ?? proposal.created_by,
      approved_at: proposal.executed_at ?? new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("path_reward_runs")
      .upsert(runPayload, { onConflict: "org_id,proposal_id" })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to sync path reward run: ${error.message}`);
    }

    const rewardRunId = data.id;
    const explanations = Array.isArray(payload.explanations)
      ? (payload.explanations as Array<Record<string, unknown>>)
      : [];
    for (const explanation of explanations) {
      if (!UUID_PATTERN.test(String(explanation.member_id ?? ""))) {
        continue;
      }
      await supabaseAdmin.from("path_explanation_snapshots").upsert(
        {
          org_id: this.orgId,
          reward_run_id: rewardRunId,
          proposal_id: proposal.id,
          month: explanation.month ?? payload.month ?? payload.correction_month,
          member_id: explanation.member_id,
          explanation_json: explanation,
          rendered_at: proposal.executed_at ?? new Date().toISOString(),
        },
        { onConflict: "org_id,proposal_id,member_id" },
      );
    }

    const memberPayouts = Array.isArray(payload.member_payouts)
      ? (payload.member_payouts as Array<Record<string, unknown>>)
      : Array.isArray(payload.member_adjustments)
        ? (payload.member_adjustments as Array<Record<string, unknown>>)
        : [];

    const postingKind =
      proposal.type === "reward.adjust"
        ? ((payload.run_type as "adjustment" | "reversal" | undefined) ?? "adjustment")
        : "payout";
    const payoutPostingGroup = await this.ensurePayoutPostingGroup({
      proposalExecutionId: String(proposalExecution.id),
      rewardRunId: canonicalRewardRunId,
      month: String(payload.target_month ?? payload.month ?? previewResult.preview.month),
      description: `PATH ${postingKind} ${String(payload.target_month ?? payload.month ?? previewResult.preview.month)}`,
    });

    const rewardRunUpdateResult = await supabaseAdmin
      .from("reward_runs")
      .update({
        payout_posting_group_id: payoutPostingGroup.id,
      })
      .eq("org_id", this.orgId)
      .eq("id", canonicalRewardRunId)
      .select("*")
      .single();

    if (rewardRunUpdateResult.error) {
      throw new Error(`Failed to link payout posting group: ${rewardRunUpdateResult.error.message}`);
    }

    const canonicalLineResult = await supabaseAdmin
      .from("reward_run_lines")
      .select("recipient_id, revenue_basis_id, payout_amount")
      .eq("org_id", this.orgId)
      .eq("reward_run_id", canonicalRewardRunId);

    if (canonicalLineResult.error) {
      throw new Error(`Failed to fetch canonical reward run lines: ${canonicalLineResult.error.message}`);
    }

    const canonicalLines = (canonicalLineResult.data ?? []) as Array<Record<string, unknown>>;
    const journalCreatedBy =
      typeof payload.journal_created_by === "string" && UUID_PATTERN.test(payload.journal_created_by)
        ? payload.journal_created_by
        : null;

    if (journalCreatedBy) {
      for (const line of canonicalLines) {
        const memberId = String(line.recipient_id ?? "");
        if (!UUID_PATTERN.test(memberId)) {
          continue;
        }

        const rawAmount = Number(line.payout_amount ?? 0);
        const amount =
          postingKind === "payout" ? rawAmount : Math.abs(rawAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          continue;
        }

        const entry = await this.createAccountingEntryForPayout({
          member_id: memberId,
          amount: Math.round(amount),
          posting_kind: postingKind,
          month: String(payload.month ?? payload.target_month ?? previewResult.preview.month),
          correction_month:
            proposal.type === "reward.adjust" ? String(payload.correction_month ?? "") : null,
          created_by: journalCreatedBy,
          posting_group_id: String(payoutPostingGroup.id),
          revenue_basis_id:
            typeof line.revenue_basis_id === "string" ? line.revenue_basis_id : null,
        });

        await supabaseAdmin.from("finance_payout_postings").upsert(
          {
            org_id: this.orgId,
            proposal_id: proposal.id,
            reward_run_id: rewardRunId,
            canonical_reward_run_id: canonicalRewardRunId,
            posting_group_id: payoutPostingGroup.id,
            member_id: memberId,
            posting_kind: postingKind,
            accounting_entry_id: entry,
            amount: Math.round(amount),
            currency: "JPY",
            target_month: String(payload.target_month ?? payload.month ?? previewResult.preview.month),
            correction_month:
              proposal.type === "reward.adjust" ? String(payload.correction_month ?? "") : null,
            posted_at: proposal.executed_at ?? new Date().toISOString(),
          },
          { onConflict: "org_id,proposal_id,member_id,posting_kind" },
        );
      }
    }

    const canonicalMemberIds = new Set(
      canonicalLines
        .map((row) => (typeof row.recipient_id === "string" ? row.recipient_id : ""))
        .filter(Boolean),
    );
    const projectionMemberIds = new Set(
      memberPayouts
        .map((row) => (typeof row.member_id === "string" ? row.member_id : ""))
        .filter(Boolean),
    );
    const canonicalTotal = normalizeMoney(
      canonicalLines.reduce((sum, row) => sum + Number(row.payout_amount ?? 0), 0),
    );
    const projectionTotal = normalizeMoney(
      memberPayouts.reduce(
        (sum, row) => sum + Number(row.final_pay ?? row.final_amount ?? row.amount ?? 0),
        0,
      ),
    );
    const hardMismatches = [
      canonicalMemberIds.size !== projectionMemberIds.size ? "member_count_mismatch" : null,
      JSON.stringify(Array.from(canonicalMemberIds).sort()) !==
      JSON.stringify(Array.from(projectionMemberIds).sort())
        ? "member_set_mismatch"
        : null,
      canonicalTotal !== projectionTotal ? "final_pay_total_mismatch" : null,
      normalizeMoney(Number(payload.base_pool_amount ?? previewResult.preview.base_pool_amount)) !==
      normalizeMoney(Number(previewResult.preview.base_pool_amount))
        ? "base_pool_amount_mismatch"
        : null,
      normalizeMoney(Number(payload.variable_pool_amount ?? previewResult.preview.variable_pool_amount)) !==
      normalizeMoney(Number(previewResult.preview.variable_pool_amount))
        ? "variable_pool_amount_mismatch"
        : null,
      resolvedMonthCloseId !== String(previewResult.preview.month_close_id ?? "")
        ? "month_close_id_mismatch"
        : null,
      rewardRuleVersionId !== String(previewResult.preview.policy_bundle.id ?? "")
        ? "reward_rule_version_id_mismatch"
        : null,
      String(policyContext?.fingerprint ?? previewResult.preview.policy_bundle.fingerprint) !==
      String(previewResult.preview.policy_bundle.fingerprint)
        ? "policy_fingerprint_mismatch"
        : null,
      String(payload.reward_engine_version ?? PATH_REWARD_ENGINE_VERSION) !== PATH_REWARD_ENGINE_VERSION
        ? "reward_engine_version_mismatch"
        : null,
      String(payload.rounding_mode ?? PATH_ROUNDING_MODE) !== PATH_ROUNDING_MODE ||
      Number(payload.rounding_scale ?? PATH_ROUNDING_SCALE) !== PATH_ROUNDING_SCALE ||
      Number(payload.rounding_minor_unit ?? PATH_ROUNDING_MINOR_UNIT) !== PATH_ROUNDING_MINOR_UNIT
        ? "rounding_semantics_mismatch"
        : null,
    ].filter((value): value is string => Boolean(value));

    if (hardMismatches.length > 0) {
      throw new Error(`PATH_CANONICAL_PROJECTION_DIFF_HARD_FAIL:${hardMismatches.join(",")}`);
    }

    const receiptPayload = {
      month_close_id: resolvedMonthCloseId,
      reward_rule_version_id: rewardRuleVersionId,
      policy_bundle_version_id,
      policy_fingerprint: String(policyContext?.fingerprint ?? previewResult.preview.policy_bundle.fingerprint),
      reward_engine_version: PATH_REWARD_ENGINE_VERSION,
      rounding_mode: PATH_ROUNDING_MODE,
      rounding_scale: PATH_ROUNDING_SCALE,
      rounding_minor_unit: PATH_ROUNDING_MINOR_UNIT,
      closed_profit: Number(payload.closed_profit ?? previewResult.preview.closed_profit),
      base_pool_amount: Number(payload.base_pool_amount ?? previewResult.preview.base_pool_amount),
      variable_pool_amount: Number(
        payload.variable_pool_amount ?? previewResult.preview.variable_pool_amount,
      ),
      member_count: canonicalMemberIds.size,
      final_pay_total: canonicalTotal,
      diff_summary: {
        hard_failures: [],
        soft_warnings: [],
        projection_reward_run_id: rewardRunId,
        canonical_reward_run_id: canonicalRewardRunId,
      },
      receipt_json: {
        month_close_id: resolvedMonthCloseId,
        reward_rule_version_id: rewardRuleVersionId,
        policy_fingerprint: String(policyContext?.fingerprint ?? previewResult.preview.policy_bundle.fingerprint),
        reward_engine_version: PATH_REWARD_ENGINE_VERSION,
        rounding: {
          mode: PATH_ROUNDING_MODE,
          scale: PATH_ROUNDING_SCALE,
          minor_unit: PATH_ROUNDING_MINOR_UNIT,
        },
        closed_profit: Number(payload.closed_profit ?? previewResult.preview.closed_profit),
        base_pool_amount: Number(payload.base_pool_amount ?? previewResult.preview.base_pool_amount),
        variable_pool_amount: Number(
          payload.variable_pool_amount ?? previewResult.preview.variable_pool_amount,
        ),
        member_count: canonicalMemberIds.size,
        final_pay_total: canonicalTotal,
        source_refs: previewResult.basisSnapshot.source_refs_json ?? [],
        actor: proposal.executed_by ?? proposal.created_by,
        timestamp: proposal.executed_at ?? new Date().toISOString(),
      },
      created_by: proposal.executed_by ?? proposal.created_by,
    };

    const receiptResult = await supabaseAdmin
      .from("reward_run_receipts")
      .upsert(
        {
          org_id: this.orgId,
          reward_run_id: canonicalRewardRunId,
          ...receiptPayload,
        },
        { onConflict: "reward_run_id" },
      );

    if (receiptResult.error) {
      throw new Error(`Failed to upsert reward run receipt: ${receiptResult.error.message}`);
    }
  }

  private async createAccountingEntryForPayout(input: {
    member_id: string;
    amount: number;
    posting_kind: "payout" | "adjustment" | "reversal";
    month: string;
    correction_month: string | null;
    created_by: string;
    posting_group_id: string;
    revenue_basis_id: string | null;
  }): Promise<string> {
    const memo = `PATH ${input.posting_kind} ${input.member_id} ${input.correction_month ?? input.month}`;
    const entryDate =
      input.correction_month && MONTH_PATTERN.test(input.correction_month)
        ? `${input.correction_month}-01`
        : `${ensureMonth(input.month)}-01`;

    const { data: entry, error: entryError } = await supabaseAdmin
      .from("accounting_journal_entries")
      .insert({
        org_id: this.orgId,
        transaction_id: null,
        posting_group_id: input.posting_group_id,
        entry_date: entryDate,
        memo,
        posted_at: new Date().toISOString(),
        created_by: input.created_by,
      })
      .select("id")
      .single();

    if (entryError) {
      throw new Error(`Failed to create accounting payout entry: ${entryError.message}`);
    }

    const debitAccount = input.posting_kind === "reversal" ? "1100" : "2130";
    const creditAccount = input.posting_kind === "reversal" ? "2130" : "1100";

    const { error: linesError } = await supabaseAdmin.from("accounting_journal_lines").insert([
      {
        org_id: this.orgId,
        entry_id: entry.id,
        line_no: 1,
        account_code: debitAccount,
        account_name: debitAccount === "2130" ? "未払報酬" : "現金預金",
        debit: input.amount,
        credit: 0,
        description: memo,
        counterparty_id: input.member_id,
        revenue_basis_id: input.revenue_basis_id,
      },
      {
        org_id: this.orgId,
        entry_id: entry.id,
        line_no: 2,
        account_code: creditAccount,
        account_name: creditAccount === "2130" ? "未払報酬" : "現金預金",
        debit: 0,
        credit: input.amount,
        description: memo,
        counterparty_id: input.member_id,
        revenue_basis_id: input.revenue_basis_id,
      },
    ]);

    if (linesError) {
      throw new Error(`Failed to create accounting payout lines: ${linesError.message}`);
    }

    return entry.id as string;
  }

  async getMemberRewardExplanation(memberId: string, month: string): Promise<Record<string, unknown> | null> {
    const normalizedMemberId = ensureUuid(memberId, "INVALID_MEMBER_ID");
    const normalizedMonth = ensureMonth(month);
    const [explanationResult, closeInputResult] = await Promise.all([
      supabaseAdmin
        .from("path_explanation_snapshots")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("member_id", normalizedMemberId)
        .eq("month", normalizedMonth)
        .order("rendered_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("path_monthly_close_inputs")
        .select("selected_site_ids")
        .eq("org_id", this.orgId)
        .eq("member_id", normalizedMemberId)
        .eq("month", normalizedMonth)
        .maybeSingle(),
    ]);

    if (explanationResult.error) {
      throw new Error(`Failed to fetch member reward explanation: ${explanationResult.error.message}`);
    }
    if (closeInputResult.error) {
      throw new Error(`Failed to fetch member reward explanation sites: ${closeInputResult.error.message}`);
    }

    const base = (explanationResult.data as Record<string, unknown> | null) ?? null;
    if (!base) {
      return null;
    }

    const selected_site_ids = Array.isArray(closeInputResult.data?.selected_site_ids)
      ? closeInputResult.data?.selected_site_ids
      : [];
    const explanationPayload = isRecord(base.explanation_json)
      ? {
          ...base,
          ...base.explanation_json,
        }
      : base;
    const site_allocations = await this.buildRewardExplanationSiteAllocations(
      explanationPayload,
      normalizedMonth,
      selected_site_ids,
    );

    return {
      ...base,
      selected_site_ids,
      allocation_basis:
        site_allocations.length > 0
          ? "package_points.variable_only"
          : "selected_sites_only",
      site_allocations,
    };
  }

  private async buildRewardExplanationSiteAllocations(
    explanation: Record<string, unknown>,
    month: string,
    selectedSiteIds: string[],
  ): Promise<RewardExplanationSiteAllocation[]> {
    const packageContributions = getRecordArray(explanation.package_contributions)
      .map((entry) => this.normalizeExplanationPackageContribution(entry))
      .filter(
        (
          entry,
        ): entry is PathRewardExplanationPackageContribution => entry !== null,
      );

    if (packageContributions.length === 0) {
      return [];
    }

    const normalizedMonth = ensureMonth(month);
    const packageIds = Array.from(
      new Set(packageContributions.map((entry) => entry.package_id)),
    );
    const [workPackageResult, bundle] = await Promise.all([
      supabaseAdmin
        .from("path_work_packages")
        .select("package_key, site_id")
        .eq("org_id", this.orgId)
        .eq("month", normalizedMonth)
        .in("package_key", packageIds),
      this.policyBundleService.resolveActiveBundle(normalizedMonth),
    ]);

    if (workPackageResult.error) {
      throw new Error(
        `Failed to fetch reward explanation work packages: ${workPackageResult.error.message}`,
      );
    }

    const difficultyCoefficients = getNumberMap(bundle, "DIFFICULTY_COEFFICIENTS");
    const familyCoefficients = getNumberMap(bundle, "FAMILY_COEFFICIENTS");
    const roleCoefficients = getNumberMap(bundle, "ROLE_COEFFICIENTS");
    const qualityCoefficients = getNumberMap(bundle, "QUALITY_GATE_COEFFICIENTS");
    const normalizedContributions = packageContributions.map((entry) => {
      const computedPackagePoints = round4(
        entry.std_hours *
          (difficultyCoefficients[entry.difficulty_band] ?? 1) *
          (familyCoefficients[entry.trade_family] ?? 1),
      );
      const computedMemberPoints = round4(
        computedPackagePoints *
          entry.responsibility_share *
          (roleCoefficients[entry.role_type] ?? 1) *
          (qualityCoefficients[entry.quality_result] ?? 1),
      );

      return {
        ...entry,
        package_points:
          entry.package_points > 0 ? entry.package_points : computedPackagePoints,
        member_points:
          entry.member_points > 0 ? entry.member_points : computedMemberPoints,
      };
    });

    const workPackages = (workPackageResult.data ?? []) as Array<Record<string, unknown>>;
    const packageSiteMap = new Map<string, string>();
    const siteIds = Array.from(
      new Set(
        workPackages
          .map((row) => (typeof row.site_id === "string" ? row.site_id : ""))
          .filter(Boolean),
      ),
    );

    for (const row of workPackages) {
      const packageKey =
        typeof row.package_key === "string" ? row.package_key.trim() : "";
      const siteId = typeof row.site_id === "string" ? row.site_id : "";
      if (packageKey && siteId) {
        packageSiteMap.set(packageKey, siteId);
      }
    }

    const siteNameMap = await this.getSiteNameMap(siteIds);
    const totalMemberPoints = round4(
      normalizedContributions.reduce((sum, entry) => sum + entry.member_points, 0),
    );
    if (totalMemberPoints <= 0) {
      return [];
    }

    const variableAmountTotal = normalizeMoney(
      Number(explanation.variable_amount ?? 0),
      "INVALID_MONEY_VALUE",
    );
    const variableWeightTotal = round4(Number(explanation.variable_weight ?? 0) || 0);

    const allocationMap = new Map<
      string,
      Omit<RewardExplanationSiteAllocation, "member_point_share" | "variable_weight_allocated" | "variable_amount_allocated">
    >();

    for (const contribution of normalizedContributions) {
      const matchedSiteId = packageSiteMap.get(contribution.package_id) ?? null;
      const allocationKey = matchedSiteId ?? "__unmatched__";
      const site_selected = Boolean(matchedSiteId && selectedSiteIds.includes(matchedSiteId));
      const current =
        allocationMap.get(allocationKey) ??
        {
          site_id: matchedSiteId,
          site_name: matchedSiteId
            ? siteNameMap.get(matchedSiteId) || `現場 ${matchedSiteId.slice(0, 8)}`
            : "未紐付けパッケージ",
          site_selected,
          allocation_scope: matchedSiteId
            ? (site_selected ? "selected_site" : "matched_site")
            : "unmatched_package",
          package_count: 0,
          package_ids: [],
          std_hours_total: 0,
          rated_units_total: 0,
          package_points_total: 0,
          member_points_total: 0,
        };

      current.site_selected = current.site_selected || site_selected;
      current.package_count += 1;
      current.package_ids.push(contribution.package_id);
      current.std_hours_total = round4(
        current.std_hours_total + contribution.std_hours,
      );
      current.rated_units_total = round4(
        current.rated_units_total + contribution.rated_units,
      );
      current.package_points_total = round4(
        current.package_points_total + contribution.package_points,
      );
      current.member_points_total = round4(
        current.member_points_total + contribution.member_points,
      );
      allocationMap.set(allocationKey, current);
    }

    const allocations = Array.from(allocationMap.values());
    const variableAmounts =
      variableAmountTotal > 0
        ? distributeByWeights(
            variableAmountTotal,
            allocations.map((entry) => entry.member_points_total),
          )
        : allocations.map(() => 0);

    return allocations
      .map((entry, index) => {
        const member_point_share = round4(entry.member_points_total / totalMemberPoints);
        return {
          ...entry,
          member_point_share,
          variable_weight_allocated: round4(variableWeightTotal * member_point_share),
          variable_amount_allocated: variableAmounts[index] ?? 0,
        } satisfies RewardExplanationSiteAllocation;
      })
      .sort((left, right) => {
        if (left.site_selected !== right.site_selected) {
          return left.site_selected ? -1 : 1;
        }
        return right.variable_amount_allocated - left.variable_amount_allocated;
      });
  }

  private normalizeExplanationPackageContribution(
    value: Record<string, unknown>,
  ): PathRewardExplanationPackageContribution | null {
    const package_id = typeof value.package_id === "string" ? value.package_id.trim() : "";
    if (!package_id) {
      return null;
    }

    const trade_family = value.trade_family;
    const difficulty_band = value.difficulty_band;
    const role_type = value.role_type;
    const quality_result = value.quality_result;

    if (
      !PATH_TRADE_FAMILIES.includes(trade_family as PathTradeFamily) ||
      !["S1", "S2", "S3"].includes(String(difficulty_band)) ||
      !["lead", "support", "teaching"].includes(String(role_type)) ||
      !["pass", "minor_fix", "major_fix"].includes(String(quality_result))
    ) {
      return null;
    }

    return {
      package_id,
      trade_family: trade_family as PathTradeFamily,
      std_hours: normalizeNonNegativeNumber(value.std_hours ?? 0, "INVALID_STD_HOURS"),
      difficulty_band: difficulty_band as PathDifficultyBand,
      responsibility_share: normalizeNonNegativeNumber(
        value.responsibility_share ?? 0,
        "INVALID_RESPONSIBILITY_SHARE",
      ),
      role_type: role_type as PathRoleType,
      quality_result: quality_result as PathQualityResult,
      rated_units: normalizeNonNegativeNumber(
        value.rated_units ?? 0,
        "INVALID_RESPONSIBILITY_SHARE",
      ),
      package_points: round4(Number(value.package_points ?? 0) || 0),
      member_points: round4(Number(value.member_points ?? 0) || 0),
    };
  }

  private async getSiteNameMap(siteIds: string[]): Promise<Map<string, string>> {
    if (siteIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseAdmin
      .from("sites")
      .select("id, name")
      .eq("org_id", this.orgId)
      .in("id", siteIds);

    if (error) {
      throw new Error(`Failed to fetch reward explanation sites: ${error.message}`);
    }

    return new Map(
      ((data ?? []) as Array<Record<string, unknown>>)
        .map((row) => {
          const id = typeof row.id === "string" ? row.id : "";
          const name = typeof row.name === "string" ? row.name : "";
          return id ? ([id, name] as const) : null;
        })
        .filter((entry): entry is readonly [string, string] => Boolean(entry)),
    );
  }

  async getMemberCurrentProfile(memberId: string): Promise<Record<string, unknown>> {
    const normalizedMemberId = ensureUuid(memberId, "INVALID_MEMBER_ID");

    const [profileResult, endorsementsResult, restrictionsResult] = await Promise.all([
      supabaseAdmin
        .from("member_skill_profiles")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("member_id", normalizedMemberId)
        .maybeSingle(),
      supabaseAdmin
        .from("path_trade_endorsements")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("member_id", normalizedMemberId)
        .order("approved_at", { ascending: false }),
      supabaseAdmin
        .from("path_assignment_restrictions")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("member_id", normalizedMemberId)
        .is("ended_at", null)
        .order("started_at", { ascending: false }),
    ]);

    if (profileResult.error) {
      throw new Error(`Failed to fetch member skill profile: ${profileResult.error.message}`);
    }
    if (endorsementsResult.error) {
      throw new Error(`Failed to fetch trade endorsements: ${endorsementsResult.error.message}`);
    }
    if (restrictionsResult.error) {
      throw new Error(`Failed to fetch assignment restrictions: ${restrictionsResult.error.message}`);
    }

    return {
      role_level: profileResult.data?.current_level ?? null,
      profile: profileResult.data ?? null,
      trade_endorsements: endorsementsResult.data ?? [],
      assignment_restrictions: restrictionsResult.data ?? [],
    };
  }

  async listPendingProposalQueue(limit = 50): Promise<Record<string, unknown>[]> {
    const normalizedLimit = Math.max(1, Math.min(Math.floor(limit), 200));
    const queryLimit = Math.min(normalizedLimit * 3, 200);
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id,type,status,description,created_by,policy_ref,required_approvals,created_at,payload")
      .eq("org_id", this.orgId)
      .eq("status", "pending")
      .in("type", Array.from(PATH_MODULE_PENDING_TYPES))
      .order("created_at", { ascending: false })
      .limit(queryLimit);

    if (error) {
      throw new Error(`Failed to fetch pending proposal queue: ${error.message}`);
    }

    return ((data ?? []) as Record<string, unknown>[])
      .filter(isPathModulePendingProposal)
      .slice(0, normalizedLimit);
  }

  async listAuditTrail(limit = 100): Promise<Record<string, unknown>[]> {
    const { data, error } = await supabaseAdmin
      .from("governance_events")
      .select("*")
      .eq("org_id", this.orgId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch governance audit trail: ${error.message}`);
    }

    return (data ?? []) as Record<string, unknown>[];
  }

  async getMonthCloseSummary(month: string): Promise<Record<string, unknown>> {
    const normalizedMonth = ensureMonth(month);
    const [closesResult, rewardRunsResult, closeInputsResult, canonicalCloseResult, previewSnapshotResult, canonicalRewardRunResult] = await Promise.all([
      supabaseAdmin
        .from("path_month_closes")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("month", normalizedMonth)
        .order("finalized_at", { ascending: false }),
      supabaseAdmin
        .from("path_reward_runs")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("month", normalizedMonth)
        .order("approved_at", { ascending: false }),
      supabaseAdmin
        .from("path_monthly_close_inputs")
        .select("member_id, selected_site_ids")
        .eq("org_id", this.orgId)
        .eq("month", normalizedMonth),
      supabaseAdmin
        .from("month_closes")
        .select("id, period_ym, status, fixed_at, close_rule_version_id")
        .eq("org_id", this.orgId)
        .eq("period_ym", normalizedMonth)
        .eq("status", "fixed")
        .order("fixed_at", { ascending: false }),
      supabaseAdmin
        .from("reward_preview_snapshots")
        .select("id, month_close_id, updated_at, member_count")
        .eq("org_id", this.orgId),
      supabaseAdmin
        .from("reward_runs")
        .select("id, month_close_id, status, fixed_at, reward_rule_version_id")
        .eq("org_id", this.orgId)
        .eq("run_kind", "calculation")
        .eq("status", "fixed")
        .order("fixed_at", { ascending: false }),
    ]);

    if (closesResult.error) {
      throw new Error(`Failed to fetch month closes: ${closesResult.error.message}`);
    }
    if (rewardRunsResult.error) {
      throw new Error(`Failed to fetch reward runs: ${rewardRunsResult.error.message}`);
    }
    if (closeInputsResult.error) {
      throw new Error(`Failed to fetch month close inputs: ${closeInputsResult.error.message}`);
    }
    if (canonicalCloseResult.error) {
      throw new Error(`Failed to fetch canonical month closes: ${canonicalCloseResult.error.message}`);
    }
    if (previewSnapshotResult.error) {
      throw new Error(`Failed to fetch reward preview snapshots: ${previewSnapshotResult.error.message}`);
    }
    if (canonicalRewardRunResult.error) {
      throw new Error(`Failed to fetch canonical reward runs: ${canonicalRewardRunResult.error.message}`);
    }

    const selectedSiteIdsByMember = new Map<string, string[]>(
      ((closeInputsResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => {
          const memberId = typeof row.member_id === "string" ? row.member_id : null;
          if (!memberId) {
            return null;
          }

          return [
            memberId,
            Array.isArray(row.selected_site_ids) ? (row.selected_site_ids as string[]) : [],
          ] as const;
        })
        .filter((row): row is readonly [string, string[]] => Boolean(row)),
    );

    const previewByMonthCloseId = new Map<string, Record<string, unknown>>(
      ((previewSnapshotResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => {
          const monthCloseId = typeof row.month_close_id === "string" ? row.month_close_id : null;
          return monthCloseId ? ([monthCloseId, row] as const) : null;
        })
        .filter((row): row is readonly [string, Record<string, unknown>] => Boolean(row)),
    );
    const rewardRunByMonthCloseId = new Map<string, Record<string, unknown>>(
      ((canonicalRewardRunResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => {
          const monthCloseId = typeof row.month_close_id === "string" ? row.month_close_id : null;
          return monthCloseId ? ([monthCloseId, row] as const) : null;
        })
        .filter((row): row is readonly [string, Record<string, unknown>] => Boolean(row)),
    );
    const eligibleCloses = ((canonicalCloseResult.data ?? []) as Array<Record<string, unknown>>).map((row) => {
      const monthCloseId = String(row.id ?? "");
      const previewSnapshot = previewByMonthCloseId.get(monthCloseId) ?? null;
      const canonicalRewardRun = rewardRunByMonthCloseId.get(monthCloseId) ?? null;
      return {
        id: monthCloseId,
        month_close_id: monthCloseId,
        month: row.period_ym,
        status: row.status,
        fixed_at: row.fixed_at ?? null,
        reward_rule_version_id: row.close_rule_version_id ?? null,
        preview_snapshot_id: previewSnapshot?.id ?? null,
        preview_cached: Boolean(previewSnapshot),
        member_count: previewSnapshot?.member_count ?? null,
        canonical_reward_run_id: canonicalRewardRun?.id ?? null,
        blocked_reason: canonicalRewardRun ? "active_run_exists" : null,
      };
    });

    return {
      month: normalizedMonth,
      closes: ((closesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
        ...row,
        selected_site_ids:
          selectedSiteIdsByMember.get(String(row.member_id ?? "")) ?? [],
      })),
      reward_runs: rewardRunsResult.data ?? [],
      eligible_closes: eligibleCloses,
      latest_eligible_month_close_id: eligibleCloses[0]?.id ?? null,
      canonical_reward_runs: canonicalRewardRunResult.data ?? [],
    };
  }

  private async loadRewardConfirmationMonthView(
    month: string,
    memberId: string,
  ): Promise<RewardConfirmationMonthView> {
    const normalizedMonth = ensureMonth(month);
    const normalizedMemberId = ensureUuid(memberId, "INVALID_MEMBER_ID");
    const { data: monthlyCloses, error: monthlyCloseError } = await supabaseAdmin
      .from("monthly_distribution_closes")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("month", normalizedMonth)
      .order("closed_at", { ascending: false })
      .limit(12);

    if (monthlyCloseError) {
      throw new Error(`Failed to fetch reward confirmation close: ${monthlyCloseError.message}`);
    }

    const closeRows = ((monthlyCloses ?? []) as Array<Record<string, unknown>>).filter((row) =>
      UUID_PATTERN.test(String(row.id ?? "")),
    );

    const activeMemberIds = await this.listActiveRewardConfirmationMemberIds();
    for (const monthlyClose of closeRows) {
      if (String(monthlyClose.path_rule_version ?? "") !== PATH_V32_SIMPLE_RULE_VERSION) {
        continue;
      }

      const { data: lines, error: lineError } = await supabaseAdmin
        .from("monthly_distribution_lines")
        .select("*")
        .eq("org_id", this.orgId)
        .eq("monthly_distribution_close_id", monthlyClose.id as string);

      if (lineError) {
        throw new Error(`Failed to fetch reward confirmation lines: ${lineError.message}`);
      }

      const lineRows = ((lines ?? []) as Array<Record<string, unknown>>).filter((row) =>
        UUID_PATTERN.test(String(row.member_id ?? "")),
      );
      const lineMemberIds = new Set(lineRows.map((row) => String(row.member_id ?? "")));
      const isTeamComplete =
        activeMemberIds.length === 0
          ? lineRows.length > 0
          : activeMemberIds.every((activeMemberId) => lineMemberIds.has(activeMemberId));
      if (!isTeamComplete) {
        continue;
      }

      const line = lineRows.find((row) => String(row.member_id ?? "") === normalizedMemberId) ?? null;
      if (!line) {
        continue;
      }

      return {
        month: normalizedMonth,
        amount: normalizeMoney(Number(line?.total_pay ?? 0)),
        base_amount: normalizeMoney(Number(line?.floor_pay ?? 0)),
        result_amount: normalizeMoney(Number(line?.result_pay ?? 0)),
        correction_amount: normalizeMoney(Number(line?.correction ?? 0)),
        floor_units: round4(Number(line?.floor_units ?? 0)),
        raw_result_weight: round4(Number(line?.raw_result_weight ?? 0)),
        boosted_result_weight: round4(Number(line?.boosted_result_weight ?? 0)),
        rule_version:
          typeof monthlyClose.path_rule_version === "string" ? monthlyClose.path_rule_version : null,
        rule_fingerprint:
          typeof monthlyClose.path_rule_fingerprint === "string"
            ? monthlyClose.path_rule_fingerprint
            : null,
        calculation_snapshot: isRecord(monthlyClose.calculation_snapshot)
          ? (monthlyClose.calculation_snapshot as Record<string, unknown>)
          : {},
        source: "finalized",
      };
    }

    const v32Preview = await this.loadV32RewardConfirmationPreviewMonthView(normalizedMonth, normalizedMemberId);
    return v32Preview;
  }

  private async loadV32RewardConfirmationPreviewMonthView(
    month: string,
    memberId: string,
  ): Promise<RewardConfirmationMonthView> {
    const preview = await new PathV32SimpleRewardService(this.orgId).previewMonthlyDistribution(month);
    const member = preview.members.find((item) => item.member_id === memberId) ?? null;
    const memberCorrection = normalizeMoney(Number(member?.member_correction_amount ?? 0));
    const roundedAmount = normalizeMoney(Number(member?.rounded_amount ?? 0));

    return {
      month,
      amount: normalizeMoney(Number(member?.total_pay_amount ?? 0)),
      base_amount: 0,
      result_amount: roundedAmount,
      correction_amount: memberCorrection,
      floor_units: round4(Number(member?.confirmed_work_days ?? 0)),
      raw_result_weight: round4(Number(member?.monthly_weight_num ?? 0)),
      boosted_result_weight: round4(Number(member?.monthly_weight_num ?? 0)),
      rule_version: preview.path_rule_version,
      rule_fingerprint: hashStableRecord(preview.calculation_snapshot ?? {}),
      calculation_snapshot: isRecord(preview.calculation_snapshot)
        ? (preview.calculation_snapshot as Record<string, unknown>)
        : {},
      source: member ? "preview" : "empty",
    };
  }

  async getTeamRewardSummary(month: string): Promise<PathTeamRewardSummary> {
    const normalizedMonth = ensureMonth(month);
    const memberIds = await this.listActiveRewardConfirmationMemberIds();
    if (memberIds.length === 0) {
      return { month: normalizedMonth, is_finalized: false, members: [] };
    }

    const [memberNameMap, invoiceState] = await Promise.all([
      this.loadMemberNameMap(memberIds),
      this.loadTeamRewardInvoiceState(normalizedMonth, memberIds),
    ]);
    const finalized = await this.loadFinalizedTeamRewardSummary(normalizedMonth, memberIds, memberNameMap, invoiceState);
    if (finalized) {
      return finalized;
    }

    const preview = await new PathV32SimpleRewardService(this.orgId).previewMonthlyDistribution(normalizedMonth);
    return {
      month: normalizedMonth,
      is_finalized: false,
      members: preview.members
        .map((member) => {
          const state = invoiceState.get(member.member_id) ?? { has_invoice: false, has_paid: false };
          return {
            member_id: member.member_id,
            nickname: toShortNickname(memberNameMap.get(member.member_id) ?? member.member_name, member.member_id),
            level: normalizeTeamRewardLevel(member.level),
            attendance_days: Number(member.confirmed_work_days ?? 0),
            amount: normalizeMoney(Number(member.total_pay_amount ?? member.rounded_amount ?? 0)),
            status: "preview" as const,
            has_invoice: state.has_invoice,
            has_paid: state.has_paid,
          };
        })
        .sort((left, right) => right.amount - left.amount),
    };
  }

  private async loadTeamRewardInvoiceState(
    month: string,
    memberIds: string[],
  ): Promise<Map<string, { has_invoice: boolean; has_paid: boolean }>> {
    if (memberIds.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseAdmin
      .from("member_invoices")
      .select("member_id,status,source")
      .eq("org_id", this.orgId)
      .eq("period_month", month)
      .in("member_id", memberIds)
      .in("source", ["path_reward", "monthly_distribution"])
      .neq("status", "void");

    if (error) {
      throw new Error(`Failed to fetch team reward invoice state: ${error.message}`);
    }

    const state = new Map<string, { has_invoice: boolean; has_paid: boolean }>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const memberId = typeof row.member_id === "string" ? row.member_id : "";
      if (!UUID_PATTERN.test(memberId)) {
        continue;
      }
      const current = state.get(memberId) ?? { has_invoice: false, has_paid: false };
      current.has_invoice = true;
      current.has_paid = current.has_paid || row.status === "paid";
      state.set(memberId, current);
    }
    return state;
  }

  private async loadFinalizedTeamRewardSummary(
    month: string,
    memberIds: string[],
    memberNameMap: Map<string, string>,
    invoiceState: Map<string, { has_invoice: boolean; has_paid: boolean }>,
  ): Promise<PathTeamRewardSummary | null> {
    const { data: monthlyCloses, error: closeError } = await supabaseAdmin
      .from("monthly_distribution_closes")
      .select("id,path_rule_version,closed_at")
      .eq("org_id", this.orgId)
      .eq("month", month)
      .eq("status", "finalized")
      .order("closed_at", { ascending: false })
      .limit(12);

    if (closeError) {
      throw new Error(`Failed to fetch team reward closes: ${closeError.message}`);
    }

    const closeRows = ((monthlyCloses ?? []) as Array<Record<string, unknown>>)
      .filter((row) => UUID_PATTERN.test(String(row.id ?? "")))
      .filter((row) => String(row.path_rule_version ?? "") === PATH_V32_SIMPLE_RULE_VERSION);
    if (closeRows.length === 0) {
      return null;
    }

    const closeIds = closeRows.map((row) => String(row.id));
    const { data: lineData, error: lineError } = await supabaseAdmin
      .from("monthly_distribution_lines")
      .select("monthly_distribution_close_id,member_id,floor_units,floor_pay,result_pay,total_pay,total_pay_amount,level,confirmed_work_days,rounded_amount")
      .eq("org_id", this.orgId)
      .in("monthly_distribution_close_id", closeIds);

    if (lineError) {
      throw new Error(`Failed to fetch team reward lines: ${lineError.message}`);
    }

    const linesByCloseId = new Map<string, Array<Record<string, unknown>>>();
    for (const line of (lineData ?? []) as Array<Record<string, unknown>>) {
      const closeId = typeof line.monthly_distribution_close_id === "string" ? line.monthly_distribution_close_id : "";
      if (!UUID_PATTERN.test(closeId)) {
        continue;
      }
      const rows = linesByCloseId.get(closeId) ?? [];
      rows.push(line);
      linesByCloseId.set(closeId, rows);
    }

    for (const close of closeRows) {
      const closeId = String(close.id);
      const lines = linesByCloseId.get(closeId) ?? [];
      const memberLineMap = new Map(
        lines
          .filter((line) => UUID_PATTERN.test(String(line.member_id ?? "")))
          .map((line) => [String(line.member_id), line] as const),
      );
      if (!memberIds.every((memberId) => memberLineMap.has(memberId))) {
        continue;
      }

      return {
        month,
        is_finalized: true,
        members: memberIds
          .map((memberId) => {
            const line = memberLineMap.get(memberId) ?? {};
            const state = invoiceState.get(memberId) ?? { has_invoice: false, has_paid: false };
            const hasResultAmount =
              line.result_pay != null ||
              line.rounded_amount != null ||
              line.total_pay_amount != null ||
              line.total_pay != null;
            return {
              member_id: memberId,
              nickname: toShortNickname(memberNameMap.get(memberId), memberId),
              level: normalizeTeamRewardLevel(line.level),
              attendance_days: Number(line.confirmed_work_days ?? line.floor_units ?? 0),
              amount: normalizeMoney(
                Number(line.total_pay_amount ?? line.total_pay ?? line.result_pay ?? line.rounded_amount ?? line.floor_pay ?? 0),
              ),
              status: hasResultAmount ? "finalized" as const : "pending" as const,
              has_invoice: state.has_invoice,
              has_paid: state.has_paid,
            };
          })
          .sort((left, right) => right.amount - left.amount),
      };
    }

    return null;
  }

  private async listActiveRewardConfirmationMemberIds(): Promise<string[]> {
    const { data, error } = await supabaseAdmin
      .from("org_memberships")
      .select("user_id")
      .eq("org_id", this.orgId)
      .eq("status", "active");

    if (error) {
      throw new Error(`Failed to fetch active reward members: ${error.message}`);
    }

    const memberIds = ((data ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.user_id ?? ""))
      .filter((value): value is string => UUID_PATTERN.test(value));

    if (isDevAuthMode()) {
      memberIds.push(...DEV_AUTH_USERS.map((user) => user.id));
    }

    return Array.from(new Set(memberIds));
  }

  private async buildRewardConfirmationSiteBreakdown(params: {
    memberId: string;
    memberName: string;
    calculationSnapshot: Record<string, unknown>;
    baseAmount: number;
    resultAmount: number;
    correctionSummary: PathRewardCorrectionSummary;
    explanation: Record<string, unknown> | null;
  }): Promise<PathRewardSiteBreakdown[]> {
    const siteCloses = getRecordArray(params.calculationSnapshot.site_closes);
    if (siteCloses.length === 0) {
      return [];
    }
    const calculationSystem = String(params.calculationSnapshot.calculation_system ?? "");
    const isV32SimpleSnapshot = calculationSystem === "path_v32_simple";
    const totalDistributableProfit = normalizeMoney(
      siteCloses.reduce((sum, row) => sum + Number(row.distributable_profit ?? 0), 0),
    );
    const snapshotMemberRows = getRecordArray(params.calculationSnapshot.members);
    const snapshotActiveMemberCount =
      Number(params.calculationSnapshot.active_member_count ?? snapshotMemberRows.length) || 0;

    const siteIds = siteCloses
      .map((row) => (typeof row.site_id === "string" ? row.site_id : ""))
      .filter((value): value is string => UUID_PATTERN.test(value));
    const siteNameMap = await this.getSiteNameMap(siteIds);
    const explanationAllocations = params.explanation
      ? (getRecordArray(params.explanation.site_allocations) as Array<Record<string, unknown>>)
      : [];
    const allocationMap = new Map(
      explanationAllocations
        .map((row) => {
          const siteId = typeof row.site_id === "string" ? row.site_id : null;
          return siteId ? ([siteId, row] as const) : null;
        })
        .filter((entry): entry is readonly [string, Record<string, unknown>] => Boolean(entry)),
    );

    const draftRows = siteCloses
      .map((close) => {
        const siteId = typeof close.site_id === "string" ? close.site_id : "";
        if (!UUID_PATTERN.test(siteId)) {
          return null;
        }
        const shareSnapshot = getRecordArray(close.share_snapshot);
        const memberShare =
          shareSnapshot.find((row) => String(row.member_id ?? "") === params.memberId) ?? null;
        const explanationAllocation = allocationMap.get(siteId) ?? null;
        const distributableProfit = normalizeMoney(Number(close.distributable_profit ?? 0));
        const v32SiteShare =
          isV32SimpleSnapshot && totalDistributableProfit > 0
            ? distributableProfit / totalDistributableProfit
            : 0;
        const reflectedRatio = round4(
          Number(memberShare?.result_share ?? explanationAllocation?.member_point_share ?? v32SiteShare) || 0,
        );
        const creditedUnits = round4(Number(memberShare?.credited_units ?? 0) || 0);
        const rawContribution = round4(
          isV32SimpleSnapshot && !memberShare && !explanationAllocation
            ? distributableProfit
            : distributableProfit * reflectedRatio,
        );
        const correctionItem = params.correctionSummary.items.find(
          (item) => String(item.evidence_refs[0]?.site_id ?? "") === siteId,
        );

        if (!memberShare && !explanationAllocation && !isV32SimpleSnapshot) {
          return null;
        }

        return {
          site_id: siteId,
          site_name:
            siteNameMap.get(siteId) ||
            (typeof explanationAllocation?.site_name === "string"
              ? explanationAllocation.site_name
              : `現場 ${siteId.slice(0, 8)}`),
          distributable_profit: distributableProfit,
          participant_count: shareSnapshot.length || snapshotActiveMemberCount,
          reflected_ratio: reflectedRatio,
          credited_units: creditedUnits,
          raw_contribution: rawContribution,
          variable_amount_hint: normalizeMoney(
            Number(explanationAllocation?.variable_amount_allocated ?? 0),
          ),
          correction_item: correctionItem ?? null,
          share_snapshot: shareSnapshot,
        };
      })
      .filter(Boolean) as Array<{
      site_id: string;
      site_name: string;
      distributable_profit: number;
      participant_count: number;
      reflected_ratio: number;
      credited_units: number;
      raw_contribution: number;
      variable_amount_hint: number;
      correction_item: PathRewardCorrectionHistoryItem | null;
      share_snapshot: Array<Record<string, unknown>>;
    }>;

    if (draftRows.length === 0) {
      return [];
    }

    const floorWeights = draftRows.map((row) => row.credited_units);
    const resultWeights = draftRows.map((row) =>
      row.variable_amount_hint > 0 ? row.variable_amount_hint : row.raw_contribution,
    );
    const correctionWeights = draftRows.map((row) => resultWeights[draftRows.indexOf(row)] || 0);
    const floorAllocations = distributeByWeights(params.baseAmount, floorWeights);
    const resultAllocations = distributeByWeights(params.resultAmount, resultWeights);
    const correctionAllocations =
      params.correctionSummary.applied_amount !== 0
        ? distributeByWeights(params.correctionSummary.applied_amount, correctionWeights)
        : draftRows.map(() => 0);

    return draftRows
      .map((row, index) => {
        const totalAmount =
          normalizeMoney((floorAllocations[index] ?? 0) + (resultAllocations[index] ?? 0) + (correctionAllocations[index] ?? 0));
        const rankedShares = row.share_snapshot
          .map((entry) => round4(Number(entry.result_share ?? 0) || 0))
          .filter((value) => value > 0)
          .sort((left, right) => right - left);
        const selfRank =
          rankedShares.length > 0 && row.reflected_ratio > 0
            ? rankedShares.findIndex((value) => value === row.reflected_ratio) + 1
            : null;
        const selfBand =
          row.participant_count <= 1
            ? "solo"
            : selfRank === 1
              ? "top"
              : selfRank !== null && selfRank <= Math.ceil(row.participant_count / 3)
                ? "upper"
                : selfRank !== null && selfRank >= row.participant_count
                  ? "lower"
                  : "middle";
        const anonymousRelativeDistribution =
          row.participant_count >= 4
            ? rankedShares.map((value) => round4(value))
            : [];
        const reasonLines =
          isV32SimpleSnapshot && row.share_snapshot.length === 0
            ? [
                "V3.2ではこの現場の利益がチーム共通の分配原資に入っています。",
                "個別現場の担当比重ではなく、月の稼働日数とレベルで分配しています。",
                row.correction_item
                  ? `この月の補正が ${Math.abs(row.correction_item.amount).toLocaleString("ja-JP")}円あります。`
                  : "この現場に紐づく補正は確認されていません。",
              ]
            : [
                row.credited_units > 0
                  ? `最低保証に ${row.credited_units.toFixed(2)} ユニット分が反映されています。`
                  : "最低保証への反映はありません。",
                row.reflected_ratio > 0
                  ? `成果反映ではこの現場の比重が ${Math.round(row.reflected_ratio * 100)}% でした。`
                  : "成果反映は小さめです。",
                row.correction_item
                  ? `この月の補正が ${Math.abs(row.correction_item.amount).toLocaleString("ja-JP")}円あります。`
                  : "この現場に紐づく補正は確認されていません。",
              ];
        return {
          site_id: row.site_id,
          site_name: row.site_name,
          amount: totalAmount,
          reflected_ratio: row.reflected_ratio,
          reason_summary:
            isV32SimpleSnapshot && row.share_snapshot.length === 0
              ? "現場利益がV3.2の共通原資に反映されています"
              : row.distributable_profit > 0 && row.reflected_ratio > 0
              ? "現場利益と担当比重が配分に反映されています"
              : row.credited_units > 0
                ? "稼働ユニットが最低保証に反映されています"
                : "この現場の反映は小さめです",
          correction_state: row.correction_item ? "あり" : "なし",
          evidence_refs: [
            {
              kind: "site",
              label: `${row.site_name} の現場詳細`,
              href: buildSiteHref(row.site_id),
              site_id: row.site_id,
            },
            {
              kind: "status",
              label: `分配原資 ${row.distributable_profit.toLocaleString("ja-JP")}円`,
              site_id: row.site_id,
            },
          ],
          detail: {
            self_explanation: {
              amount: totalAmount,
              floor_amount: floorAllocations[index] ?? 0,
              result_amount: resultAllocations[index] ?? 0,
              correction_amount: correctionAllocations[index] ?? 0,
              reflected_ratio: row.reflected_ratio,
              credited_units: row.credited_units,
              reason_lines: reasonLines,
            },
            site_summary: {
              distributable_profit: row.distributable_profit,
              participant_count: row.participant_count,
              self_rank: selfRank,
              self_band: selfBand,
              privacy_mode:
                row.participant_count >= 4 ? "exact_distribution" : "band_only",
              anonymous_relative_distribution: anonymousRelativeDistribution,
            },
          },
        } satisfies PathRewardSiteBreakdown;
      })
      .sort((left, right) => right.amount - left.amount);
  }

  private async listRewardCorrectionsForMember(
    month: string,
    memberId: string,
  ): Promise<PathRewardCorrectionSummary> {
    const normalizedMonth = ensureMonth(month);
    const normalizedMemberId = ensureUuid(memberId, "INVALID_MEMBER_ID");
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id,status,created_at,payload")
      .eq("org_id", this.orgId)
      .eq("type", "reward.adjust")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      throw new Error(`Failed to fetch reward corrections: ${error.message}`);
    }

    const items = ((data ?? []) as Array<Record<string, unknown>>)
      .map((proposal) => {
        const payload = isRecord(proposal.payload) ? proposal.payload : null;
        if (!payload || String(payload.target_month ?? "") !== normalizedMonth) {
          return null;
        }
        const memberAdjustment = getRecordArray(payload.member_adjustments).find(
          (entry) => String(entry.member_id ?? "") === normalizedMemberId,
        );
        if (!memberAdjustment) {
          return null;
        }
        const explanation = isRecord(memberAdjustment.explanation)
          ? (memberAdjustment.explanation as Record<string, unknown>)
          : {};
        const siteId =
          typeof explanation.site_id === "string" && UUID_PATTERN.test(explanation.site_id)
            ? explanation.site_id
            : null;
        return {
          proposal_id: String(proposal.id ?? ""),
          status: String(proposal.status ?? "pending"),
          reason: String(payload.reason_code ?? "manual_review"),
          amount: normalizeMoney(Number(memberAdjustment.amount ?? 0)),
          correction_month:
            typeof payload.correction_month === "string" ? payload.correction_month : null,
          target_month:
            typeof payload.target_month === "string" ? payload.target_month : null,
          mode:
            payload.run_type === "adjustment" || payload.run_type === "reversal"
              ? (payload.run_type as "adjustment" | "reversal")
              : "unknown",
          note: typeof payload.note === "string" ? payload.note : "",
          created_at:
            typeof proposal.created_at === "string" ? proposal.created_at : new Date().toISOString(),
          evidence_refs: [
            {
              kind: "proposal",
              label: `補正申請 ${String(proposal.id ?? "").slice(0, 8)}`,
              href: buildProposalHref(String(proposal.id ?? "")),
              proposal_id: String(proposal.id ?? ""),
              site_id: siteId,
            },
          ],
        } satisfies PathRewardCorrectionHistoryItem;
      })
      .filter(Boolean) as PathRewardCorrectionHistoryItem[];

    return {
      total_amount: normalizeMoney(items.reduce((sum, item) => sum + item.amount, 0)),
      applied_amount: normalizeMoney(
        items
          .filter((item) => item.status === "executed")
          .reduce((sum, item) => sum + item.amount, 0),
      ),
      count: items.length,
      has_corrections: items.length > 0,
      items,
    };
  }

  private async listPendingCloseSites(month: string): Promise<PathPendingCloseSite[]> {
    const normalizedMonth = ensureMonth(month);
    const { data: sitesData, error: sitesError } = await supabaseAdmin
      .from("sites")
      .select("id,name,completed_at")
      .eq("org_id", this.orgId)
      .eq("status", "completed")
      .gte("completed_at", `${normalizedMonth}-01T00:00:00.000Z`)
      .lt("completed_at", `${nextMonthValue(normalizedMonth)}-01T00:00:00.000Z`);

    if (sitesError) {
      throw new Error(`Failed to fetch pending close sites: ${sitesError.message}`);
    }

    const sites = (sitesData ?? []) as Array<Record<string, unknown>>;
    const siteIds = sites
      .map((site) => String(site.id ?? ""))
      .filter((value): value is string => UUID_PATTERN.test(value));
    if (siteIds.length === 0) {
      return [];
    }

    const [closesResult, proposalsResult] = await Promise.all([
      supabaseAdmin
        .from("site_closes")
        .select("site_id,status")
        .eq("org_id", this.orgId)
        .in("site_id", siteIds),
      supabaseAdmin
        .from("proposals")
        .select("site_id,status,created_at")
        .eq("org_id", this.orgId)
        .eq("type", "site.close.finalize")
        .in("site_id", siteIds)
        .in("status", ["draft", "pending", "approved"])
        .order("created_at", { ascending: false }),
    ]);

    if (closesResult.error) {
      throw new Error(`Failed to fetch site closes for pending close sites: ${closesResult.error.message}`);
    }
    if (proposalsResult.error) {
      throw new Error(`Failed to fetch close proposals for pending close sites: ${proposalsResult.error.message}`);
    }

    const finalizedCloseSiteIds = new Set(
      ((closesResult.data ?? []) as Array<Record<string, unknown>>)
        .filter((close) => String(close.status ?? "") === "finalized")
        .map((close) => String(close.site_id ?? ""))
        .filter((value): value is string => UUID_PATTERN.test(value)),
    );
    const proposalStatusBySiteId = new Map<string, string>();
    ((proposalsResult.data ?? []) as Array<Record<string, unknown>>).forEach((proposal) => {
      const siteId = String(proposal.site_id ?? "");
      if (UUID_PATTERN.test(siteId) && !proposalStatusBySiteId.has(siteId)) {
        proposalStatusBySiteId.set(siteId, String(proposal.status ?? "pending"));
      }
    });

    return sites
      .map((site) => {
        const siteId = String(site.id ?? "");
        if (!UUID_PATTERN.test(siteId) || finalizedCloseSiteIds.has(siteId)) {
          return null;
        }

        return {
          site_id: siteId,
          site_name: String(site.name ?? `現場 ${siteId.slice(0, 8)}`),
          completed_at: typeof site.completed_at === "string" ? site.completed_at : null,
          close_proposal_status: proposalStatusBySiteId.get(siteId) ?? null,
          href: buildSiteHref(siteId),
        } satisfies PathPendingCloseSite;
      })
      .filter((site): site is PathPendingCloseSite => site !== null);
  }

  private buildRewardDeltaReasons(params: {
    month: string;
    current: RewardConfirmationMonthView;
    previous: RewardConfirmationMonthView | null;
    siteBreakdown: PathRewardSiteBreakdown[];
    corrections: PathRewardCorrectionSummary;
    ruleVersion: string | null;
  }): PathRewardDeltaReason[] {
    const averageSiteProfit =
      params.siteBreakdown.length > 0
        ? params.siteBreakdown.reduce(
            (sum, item) => sum + Number(item.detail.site_summary.distributable_profit ?? 0),
            0,
          ) / params.siteBreakdown.length
        : 0;
    const highProfitAmount = normalizeMoney(
      params.siteBreakdown
        .filter((item) => Number(item.detail.site_summary.distributable_profit ?? 0) >= averageSiteProfit)
        .reduce((sum, item) => sum + item.amount, 0),
    );
    const highResponsibilityAmount = normalizeMoney(
      params.siteBreakdown
        .filter((item) => item.reflected_ratio >= 0.2)
        .reduce((sum, item) => sum + item.amount, 0),
    );
    const previousHighProfitAmount = params.previous
      ? normalizeMoney(
          Number((params.previous.calculation_snapshot as Record<string, unknown>).high_profit_amount ?? 0),
        )
      : null;
    const previousHighResponsibilityAmount = params.previous
      ? normalizeMoney(
          Number(
            (params.previous.calculation_snapshot as Record<string, unknown>).high_responsibility_amount ?? 0,
          ),
        )
      : null;

    const rawCandidates: Array<{
      key: PathRewardDeltaReason["key"];
      label: string;
      impact_amount: number | null;
      evidence_refs: PathRewardEvidenceRef[];
      summary: string;
    }> = [
      {
        key: "workload",
        label: "稼働量差分",
        impact_amount: params.previous ? params.current.base_amount - params.previous.base_amount : params.current.base_amount,
        evidence_refs: [
          {
            kind: "status",
            label: `最低保証 ${params.current.base_amount.toLocaleString("ja-JP")}円`,
          },
        ],
        summary: params.previous
          ? `最低保証の差で ${formatMonthAmountDelta(
              params.current.base_amount - params.previous.base_amount,
            )}`
          : "今月の稼働ユニットが最低保証に反映されています",
      },
      {
        key: "high_profit_sites",
        label: "高利益現場比率差分",
        impact_amount:
          previousHighProfitAmount !== null
            ? highProfitAmount - previousHighProfitAmount
            : highProfitAmount,
        evidence_refs: params.siteBreakdown.slice(0, 2).flatMap((item) => item.evidence_refs),
        summary: params.previous
          ? `利益の大きい現場の寄与で ${formatMonthAmountDelta(
              highProfitAmount - (previousHighProfitAmount ?? 0),
            )}`
          : "利益の大きい現場への参加比率が今月の見込みに効いています",
      },
      {
        key: "corrections",
        label: "補正有無",
        impact_amount: params.corrections.applied_amount,
        evidence_refs: [
          {
            kind: "section",
            label: "補正 / 調整を見る",
            anchor: "reward-corrections",
          },
        ],
        summary: params.corrections.has_corrections
          ? `補正が ${Math.abs(params.corrections.applied_amount).toLocaleString("ja-JP")}円反映されています`
          : "補正は入っていません",
      },
      {
        key: "responsibility",
        label: "責任比重差分",
        impact_amount:
          previousHighResponsibilityAmount !== null
            ? highResponsibilityAmount - previousHighResponsibilityAmount
            : highResponsibilityAmount,
        evidence_refs: params.siteBreakdown.slice(0, 2).flatMap((item) => item.evidence_refs),
        summary: params.previous
          ? `担当比重の差で ${formatMonthAmountDelta(
              highResponsibilityAmount - (previousHighResponsibilityAmount ?? 0),
            )}`
          : "担当比重の大きい現場が今月の見込みを押し上げています",
      },
      {
        key: "performance",
        label: "スピード/評価反映差分",
        impact_amount: params.previous ? params.current.result_amount - params.previous.result_amount : params.current.result_amount,
        evidence_refs: [
          {
            kind: "rule",
            label: params.ruleVersion ? `反映ルール ${params.ruleVersion}` : "反映ルール",
          },
        ],
        summary: params.previous
          ? `成果反映の差で ${formatMonthAmountDelta(
              params.current.result_amount - params.previous.result_amount,
            )}`
          : "成果反映の比重が今月の金額に乗っています",
      },
    ];

    const fixedPriority: PathRewardDeltaReason["key"][] = [
      "workload",
      "high_profit_sites",
      "corrections",
      "responsibility",
      "performance",
    ];

    return rawCandidates
      .sort((left, right) => {
        const leftImpact = left.impact_amount === null ? -1 : Math.abs(left.impact_amount);
        const rightImpact = right.impact_amount === null ? -1 : Math.abs(right.impact_amount);
        if (leftImpact !== rightImpact) {
          return rightImpact - leftImpact;
        }
        return fixedPriority.indexOf(left.key) - fixedPriority.indexOf(right.key);
      })
      .slice(0, 3)
      .map((candidate) => ({
        ...candidate,
        direction: directionFromImpact(candidate.impact_amount),
      }));
  }

  async getRewardConfirmationSummary(
    month: string,
    memberId: string,
  ): Promise<PathRewardConfirmationSummary> {
    const normalizedMonth = ensureMonth(month);
    const normalizedMemberId = ensureUuid(memberId, "INVALID_MEMBER_ID");
    const previousMonth = previousMonthValue(normalizedMonth);
    const memberNameMap = await this.loadMemberNameMap([normalizedMemberId]);
    const memberName = memberNameMap.get(normalizedMemberId) ?? normalizedMemberId;
    const [currentView, previousView, explanation, corrections, pendingCloseSites, rewardProposals] = await Promise.all([
      this.loadRewardConfirmationMonthView(normalizedMonth, normalizedMemberId),
      this.loadRewardConfirmationMonthView(previousMonth, normalizedMemberId).catch(() => null),
      this.getMemberRewardExplanation(normalizedMemberId, normalizedMonth).catch(() => null),
      this.listRewardCorrectionsForMember(normalizedMonth, normalizedMemberId),
      this.listPendingCloseSites(normalizedMonth),
      supabaseAdmin
        .from("proposals")
        .select("id,status,created_at,payload")
        .eq("org_id", this.orgId)
        .eq("type", "reward.calculate")
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

    if (rewardProposals.error) {
      throw new Error(`Failed to fetch reward confirmation proposals: ${rewardProposals.error.message}`);
    }

    const matchingRewardProposals = ((rewardProposals.data ?? []) as Array<Record<string, unknown>>).filter((proposal) => {
      const payload = isRecord(proposal.payload) ? proposal.payload : null;
      return (
        (payload?.calculation_system === "path_v31" || payload?.calculation_system === "path_v32_simple") &&
        typeof payload.month === "string" &&
        payload.month === normalizedMonth
      );
    });
    const latestProposal = matchingRewardProposals[0] ?? null;
    const status: PathRewardConfirmationSummary["status"] =
      currentView.source === "finalized"
        ? "確定済み"
        : latestProposal && ["draft", "pending", "approved"].includes(String(latestProposal.status ?? ""))
          ? "確定申請中"
          : "試算中";

    const siteBreakdown = await this.buildRewardConfirmationSiteBreakdown({
      memberId: normalizedMemberId,
      memberName,
      calculationSnapshot: currentView.calculation_snapshot,
      baseAmount: currentView.base_amount,
      resultAmount: currentView.result_amount,
      correctionSummary: corrections,
      explanation: explanation,
    });
    currentView.calculation_snapshot.high_profit_amount = normalizeMoney(
      siteBreakdown
        .filter((item) => item.detail.site_summary.distributable_profit > 0)
        .slice(0, Math.max(1, Math.ceil(siteBreakdown.length / 2)))
        .reduce((sum, item) => sum + item.amount, 0),
    );
    currentView.calculation_snapshot.high_responsibility_amount = normalizeMoney(
      siteBreakdown
        .filter((item) => item.reflected_ratio >= 0.2)
        .reduce((sum, item) => sum + item.amount, 0),
    );
    const topReasons = this.buildRewardDeltaReasons({
      month: normalizedMonth,
      current: currentView,
      previous: previousView,
      siteBreakdown,
      corrections,
      ruleVersion: currentView.rule_version,
    });
    const estimatedAmount = normalizeMoney(currentView.amount + corrections.applied_amount);
    const deltaAmount = previousView
      ? normalizeMoney(estimatedAmount - (previousView.amount ?? 0))
      : null;
    const explanationMissing = !explanation;
    const evidenceRefs: PathRewardEvidenceRef[] = [
      ...(siteBreakdown[0]?.evidence_refs ?? []),
      {
        kind: "rule",
        label: currentView.rule_version ? `反映ルール ${currentView.rule_version}` : "反映ルール",
      },
      ...(latestProposal?.id
        ? [
            {
              kind: "proposal" as const,
              label: `確定申請 ${String(latestProposal.id).slice(0, 8)}`,
              href: buildProposalHref(String(latestProposal.id)),
              proposal_id: String(latestProposal.id),
            },
          ]
        : []),
    ];

    return {
      month: normalizedMonth,
      member_id: normalizedMemberId,
      member_name: memberName,
      status,
      estimated_amount: estimatedAmount,
      base_amount: currentView.base_amount,
      result_amount: currentView.result_amount,
      correction_amount: corrections.applied_amount,
      delta_amount: previousView ? deltaAmount : null,
      delta_empty_state: previousView ? null : "先月の比較データはまだありません",
      top_reasons: topReasons,
      increase_reasons: topReasons.filter((reason) => reason.direction === "increase"),
      decrease_reasons: topReasons.filter((reason) => reason.direction === "decrease"),
      explanation_cards: [
        {
          id: "increase",
          title: "増えた理由",
          body:
            topReasons.find((reason) => reason.direction === "increase")?.summary ??
            "大きく増えた要因は見つかりませんでした。",
          evidence_refs:
            topReasons.find((reason) => reason.direction === "increase")?.evidence_refs ?? [],
        },
        {
          id: "decrease",
          title: "減った理由",
          body:
            topReasons.find((reason) => reason.direction === "decrease")?.summary ??
            "大きく減った要因は見つかりませんでした。",
          evidence_refs:
            topReasons.find((reason) => reason.direction === "decrease")?.evidence_refs ?? [],
        },
        {
          id: "corrections",
          title: "補正の有無と件数",
          body: corrections.has_corrections
            ? `${corrections.count}件の補正があり、反映済み合計は ${corrections.applied_amount.toLocaleString("ja-JP")}円です。`
            : "補正は入っていません。",
          evidence_refs: [
            {
              kind: "section",
              label: "補正 / 調整を見る",
              anchor: "reward-corrections",
            },
          ],
        },
        {
          id: "rule",
          title: "反映ルールの版",
          body: currentView.rule_version
            ? `${currentView.rule_version} を使って計算しています。`
            : "反映ルールの版はまだ確認できていません。",
          evidence_refs: [
            {
              kind: "rule",
              label: currentView.rule_version
                ? `反映ルール ${currentView.rule_version}`
                : "反映ルール",
              meta: {
                fingerprint: currentView.rule_fingerprint,
              },
            },
          ],
        },
      ],
      explanation_missing: explanationMissing,
      explanation_missing_message: explanationMissing
        ? "詳細な説明データがまだ揃っていません"
        : null,
      site_breakdown: siteBreakdown,
      pending_close_sites: pendingCloseSites,
      corrections,
      evidence_refs: evidenceRefs,
      internal_controls: {
        can_manage: true,
        month: normalizedMonth,
      },
    };
  }

  private buildRewardAnalysisContext(summary: PathRewardConfirmationSummary): RewardAnalysisContextBundle {
    const evidenceMap = new Map<string, PathRewardEvidenceRef>();
    const evidenceKeyBySignature = new Map<string, string>();
    const safeEvidenceRefs: RewardAnalysisContextBundle["context"]["evidence_refs"] = [];

    const sanitizeEvidenceLabel = (ref: PathRewardEvidenceRef) => {
      const baseLabel =
        ref.kind === "proposal"
          ? ref.label.includes("補正")
            ? "補正申請"
            : "確定申請"
          : ref.label;
      return baseLabel
        .replace(UUID_PATTERN, "参照")
        .replace(/\b[0-9a-f]{8}\b/gi, "参照")
        .trim();
    };

    const registerEvidence = (ref: PathRewardEvidenceRef) => {
      const signature = JSON.stringify({
        kind: ref.kind,
        label: sanitizeEvidenceLabel(ref),
        anchor: ref.anchor ?? null,
      });
      const existingKey = evidenceKeyBySignature.get(signature);
      if (existingKey) {
        return existingKey;
      }
      const evidenceKey = `ev_${safeEvidenceRefs.length + 1}`;
      evidenceKeyBySignature.set(signature, evidenceKey);
      evidenceMap.set(evidenceKey, ref);
      safeEvidenceRefs.push({
        evidence_key: evidenceKey,
        kind: ref.kind,
        label: sanitizeEvidenceLabel(ref),
        anchor: ref.anchor ?? null,
      });
      return evidenceKey;
    };

    const registerMany = (refs: PathRewardEvidenceRef[]) =>
      Array.from(new Set(refs.map((ref) => registerEvidence(ref))));

    const siteBreakdown = summary.site_breakdown.map((site, index) => ({
      label:
        site.site_name && !/\b[0-9a-f]{8}\b/i.test(site.site_name)
          ? site.site_name
          : `現場${index + 1}`,
      amount: site.amount,
      reflected_ratio: site.reflected_ratio,
      correction_state: site.correction_state,
      reason_summary: site.reason_summary,
      own_contribution: {
        floor_amount: site.detail.self_explanation.floor_amount,
        result_amount: site.detail.self_explanation.result_amount,
        correction_amount: site.detail.self_explanation.correction_amount,
        credited_units: site.detail.self_explanation.credited_units,
        reason_lines: site.detail.self_explanation.reason_lines,
      },
      anonymous_relative_position: {
        participant_count: site.detail.site_summary.participant_count,
        self_band: site.detail.site_summary.self_band,
      },
      evidence_keys: registerMany(site.evidence_refs),
    }));

    const corrections = {
      total_amount: summary.corrections.total_amount,
      applied_amount: summary.corrections.applied_amount,
      count: summary.corrections.count,
      has_corrections: summary.corrections.has_corrections,
      items: summary.corrections.items.map((item) => ({
        status: item.status,
        reason: item.reason,
        amount: item.amount,
        correction_month: item.correction_month,
        target_month: item.target_month,
        mode: item.mode,
        evidence_keys: registerMany(item.evidence_refs),
      })),
    };

    registerMany([
      ...summary.evidence_refs,
      ...summary.top_reasons.flatMap((reason) => reason.evidence_refs),
      ...summary.explanation_cards.flatMap((card) => card.evidence_refs),
    ]);

    const ruleLabel =
      summary.explanation_cards.find((card) => card.id === "rule")?.evidence_refs[0]?.label ??
      summary.evidence_refs.find((ref) => ref.kind === "rule")?.label ??
      null;
    const ruleVersion =
      ruleLabel && ruleLabel !== "反映ルール" ? ruleLabel.replace(/^反映ルール\s*/, "") : null;

    return {
      context: {
        estimated_amount: summary.estimated_amount,
        delta_amount: summary.delta_amount,
        site_breakdown: siteBreakdown,
        corrections,
        rule_version: ruleVersion,
        evidence_refs: safeEvidenceRefs,
      },
      evidenceMap,
    };
  }

  private buildRewardQaAmountBreakdown(
    summary: PathRewardConfirmationSummary,
    targetSite?: PathRewardSiteBreakdown | null,
  ): PathRewardQaAmountBreakdown[] {
    if (targetSite) {
      return [
        {
          label: `${targetSite.site_name} の合計`,
          amount: targetSite.amount,
          detail: targetSite.reason_summary,
          evidence_refs: targetSite.evidence_refs,
        },
        {
          label: "最低保証",
          amount: targetSite.detail.self_explanation.floor_amount,
          detail: "この現場での自分の稼働ユニット分です。",
          evidence_refs: targetSite.evidence_refs,
        },
        {
          label: "成果反映",
          amount: targetSite.detail.self_explanation.result_amount,
          detail: "この現場での担当比重や成果反映分です。",
          evidence_refs: targetSite.evidence_refs,
        },
      ];
    }

    return [
      {
        label: "今月の見込み",
        amount: summary.estimated_amount,
        detail: "最低保証、成果反映、反映済み補正を合わせた金額です。",
        evidence_refs: summary.evidence_refs,
      },
      {
        label: "最低保証",
        amount: summary.base_amount,
        detail: "稼働ユニットを中心に反映された土台の金額です。",
        evidence_refs: summary.top_reasons.find((reason) => reason.key === "workload")?.evidence_refs ?? [],
      },
      {
        label: "成果反映",
        amount: summary.result_amount,
        detail: "現場利益、担当比重、評価反映などによる金額です。",
        evidence_refs:
          summary.top_reasons.find((reason) => reason.key === "performance")?.evidence_refs ??
          summary.evidence_refs.filter((ref) => ref.kind === "rule"),
      },
      {
        label: "補正",
        amount: summary.correction_amount,
        detail: "この月に反映済みの調整額です。",
        evidence_refs: [
          {
            kind: "section",
            label: "補正 / 調整を見る",
            anchor: "reward-corrections",
          },
          ...summary.corrections.items.flatMap((item) => item.evidence_refs),
        ],
      },
    ];
  }

  private buildRewardQaAdjustments(summary: PathRewardConfirmationSummary): PathRewardQaAdjustment[] {
    return summary.corrections.items.map((item) => ({
      label: item.correction_month ? `${item.correction_month} 反映予定` : "反映月を確認してください",
      amount: item.amount,
      detail: `${item.reason} / ${item.status}`,
      evidence_refs: item.evidence_refs,
    }));
  }

  private buildRewardQaResponse(params: {
    summary: PathRewardConfirmationSummary;
    conclusion: string;
    whyChanged: string[];
    evidenceRefs: PathRewardEvidenceRef[];
    nextAction: string | null;
    confidence?: PathRewardQaConfidence;
    targetSite?: PathRewardSiteBreakdown | null;
  }): PathRewardQaResponse {
    return {
      conclusion: params.conclusion,
      amount_breakdown: this.buildRewardQaAmountBreakdown(params.summary, params.targetSite),
      why_changed: params.whyChanged.length > 0 ? params.whyChanged : ["根拠データから大きな差分は見つかりませんでした。"],
      adjustments: this.buildRewardQaAdjustments(params.summary),
      evidence_refs: params.evidenceRefs,
      next_action: params.nextAction,
      confidence: params.confidence ?? (params.summary.explanation_missing ? "low" : "medium"),
    };
  }

  private answerRewardConfirmationQuestionDeterministic(
    summary: PathRewardConfirmationSummary,
    input: PathRewardQaRequest,
  ): PathRewardQaResponse {
    const normalizedQuestion = input.question.trim();
    const lowered = normalizedQuestion.toLowerCase();
    const targetSite =
      (input.site_id
        ? summary.site_breakdown.find((item) => item.site_id === input.site_id)
        : null) ??
      summary.site_breakdown[0] ??
      null;

    if (lowered.includes("補正")) {
      return this.buildRewardQaResponse({
        summary,
        conclusion: summary.corrections.has_corrections
          ? `この月には ${summary.corrections.count} 件の補正があり、反映済み合計は ${summary.corrections.applied_amount.toLocaleString("ja-JP")}円です。`
          : "この月に反映済みの補正はありません。",
        whyChanged: summary.corrections.has_corrections
          ? summary.corrections.items.map(
              (item) => `${item.reason} / ${item.status} / ${item.amount.toLocaleString("ja-JP")}円`,
            )
          : ["補正履歴は見つかりませんでした。"],
        evidenceRefs: [
          {
            kind: "section",
            label: "補正 / 調整を見る",
            anchor: "reward-corrections",
          },
          ...summary.corrections.items.flatMap((item) => item.evidence_refs),
        ],
        nextAction: null,
      });
    }

    if (lowered.includes("ルール")) {
      const ruleCard = summary.explanation_cards.find((card) => card.id === "rule");
      return this.buildRewardQaResponse({
        summary,
        conclusion: ruleCard?.body ?? "反映ルールの版を確認できませんでした。",
        whyChanged: [
          "表示中の金額はその月の反映ルール版に基づいています。",
          "詳細は根拠欄からルール版と指紋を辿れます。",
        ],
        evidenceRefs: ruleCard?.evidence_refs ?? summary.evidence_refs.filter((ref) => ref.kind === "rule"),
        nextAction: null,
      });
    }

    if (lowered.includes("来月") || lowered.includes("増やす")) {
      const workloadReason = summary.top_reasons.find((reason) => reason.key === "workload");
      const siteReason = summary.top_reasons.find((reason) => reason.key === "high_profit_sites");
      const responsibilityReason = summary.top_reasons.find((reason) => reason.key === "responsibility");
      const nextActions = [
        workloadReason && workloadReason.impact_amount !== null && workloadReason.impact_amount <= 0
          ? "稼働ユニットが少ない月は最低保証が伸びにくいので、まず稼働量を確保すると効きやすいです。"
          : null,
        siteReason && siteReason.impact_amount !== null && siteReason.impact_amount <= 0
          ? "利益の大きい現場への参加比率が低い月は見込みが伸びにくいので、その比率を上げると効きやすいです。"
          : null,
        responsibilityReason && responsibilityReason.impact_amount !== null && responsibilityReason.impact_amount <= 0
          ? "担当比重が大きい現場ほど成果反映が乗りやすいので、責任を持つ場面を増やすと効きやすいです。"
          : null,
      ].filter((value): value is string => Boolean(value));
      return this.buildRewardQaResponse({
        summary,
        conclusion:
          nextActions[0] ??
          "今ある根拠だけでは、次に効く行動を断定できるほどの差分は見つかりませんでした。",
        whyChanged: summary.top_reasons.map((reason) => reason.summary),
        evidenceRefs: summary.top_reasons.flatMap((reason) => reason.evidence_refs),
        nextAction: nextActions[0] ?? "根拠が足りないため、これ以上の提案はまだ出せません。",
      });
    }

    if ((lowered.includes("現場") || lowered.includes("配分")) && targetSite) {
      return this.buildRewardQaResponse({
        summary,
        targetSite,
        conclusion: `${targetSite.site_name} は ${targetSite.amount.toLocaleString("ja-JP")}円が反映されています。`,
        whyChanged: targetSite.detail.self_explanation.reason_lines,
        evidenceRefs: targetSite.evidence_refs,
        nextAction:
          targetSite.reflected_ratio <= 0
            ? "この現場では成果反映が小さいため、担当比重や高利益現場の比率を確認すると次の改善点が見えます。"
            : null,
      });
    }

    return this.buildRewardQaResponse({
      summary,
      conclusion:
        summary.delta_amount === null
          ? `今月の見込みは ${summary.estimated_amount.toLocaleString("ja-JP")}円です。`
          : `今月の見込みは ${summary.estimated_amount.toLocaleString("ja-JP")}円で、先月比は ${summary.delta_amount.toLocaleString("ja-JP")}円です。`,
      whyChanged: summary.top_reasons.map((reason) => reason.summary),
      evidenceRefs: summary.top_reasons.flatMap((reason) => reason.evidence_refs),
      nextAction: null,
    });
  }

  async answerRewardConfirmationQuestion(
    input: PathRewardQaRequest,
  ): Promise<PathRewardQaResponse> {
    const summary = await this.getRewardConfirmationSummary(input.month, input.member_id);
    const analysisContext = this.buildRewardAnalysisContext(summary);
    return new PathRewardAnalysisService().analyzeRewardConfirmation(
      analysisContext,
      input.question.trim(),
      () => this.answerRewardConfirmationQuestionDeterministic(summary, input),
    );
  }

  async getOpportunityAuditSummary(month: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await supabaseAdmin
      .from("path_opportunity_audits")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("month", ensureMonth(month))
      .order("member_id", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch opportunity audits: ${error.message}`);
    }

    return (data ?? []) as Record<string, unknown>[];
  }
}
