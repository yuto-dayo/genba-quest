import { supabaseAdmin } from "../lib/supabaseAdmin";
import {
  PATH_V31_CUTOVER_DATE,
  PATH_V31_CUTOVER_MONTH,
  PATH_V31_DEFAULT_RULE_CONSTANTS,
  PATH_V31_ENGINE_VERSION,
  PATH_V31_RULE_VERSION,
} from "../lib/pathV31Config";
import { ActorRef, Proposal } from "./PolicyEngine";
import {
  PATH_TRADE_FAMILIES,
  PathTradeFamily,
  hashStableRecord,
} from "./PathPolicyBundleService";
import { PathV32SimpleRewardService } from "./PathV32SimpleRewardService";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type PathV31RoleType = "assist" | "lead" | "solo" | "support";
type PathV31ShareMode = "auto_points" | "fixed_template";
type DifficultyBand = "S1" | "S2" | "S3";
type RiskBand = "low" | "medium" | "high";
type SpeedClass = "slow" | "normal" | "fast";
type OutcomeStatus = "ok" | "rework" | "unknown";

interface PathRuleVersionRow {
  id: string;
  org_id: string;
  version: string;
  effective_from: string;
  status: "draft" | "active" | "retired";
  fingerprint: string;
  constants_json: Record<string, unknown>;
}

interface DayLogInput {
  id?: string;
  date: string;
  site_id: string;
  member_id: string;
  trade_families: PathTradeFamily[];
  role_type: PathV31RoleType;
  credited_unit: number;
  memo?: string;
}

interface SiteCloseInput {
  site_id: string;
  included_day_log_ids: string[];
  recognized_revenue: number;
  material_cost: number;
  external_cost: number;
  direct_cost: number;
  overhead_allocated: number;
  known_rework_cost: number;
  approved_adjustments: number;
  difficulty_band: DifficultyBand;
  share_mode: PathV31ShareMode;
  fixed_template_key?: string | null;
  fixed_template_reason_code?: string | null;
  fixed_template_members?: Array<{
    member_id: string;
    share_ratio: number;
    role_type?: PathV31RoleType;
    source_day_log_ids?: string[];
  }>;
  outcome_snapshots?: Array<{
    member_id: string;
    outcome_status: OutcomeStatus;
    rework_units?: number;
    source?: string;
    notes?: string;
  }>;
  closed_at?: string | null;
}

interface SiteShareMemberSnapshot {
  member_id: string;
  credited_units: number;
  raw_points: number;
  role_type_mix: Record<string, number>;
  result_share: number;
  result_eligible: boolean;
  source_day_log_ids: string[];
}

interface MonthlyDistributionMemberPreview {
  member_id: string;
  member_name: string;
  floor_units: number;
  floor_pay: number;
  raw_result_weight: number;
  boosted_result_weight: number;
  speed_class: SpeedClass;
  speed_coeff: number;
  result_pay: number;
  correction: number;
  total_pay: number;
  calculation_snapshot: Record<string, unknown>;
}

interface MonthlyDistributionPreview {
  month: string;
  pool_amount: number;
  floor_rate: number;
  result_rate: number;
  nonlinear_exponent: number;
  members: MonthlyDistributionMemberPreview[];
  path_rule_version_id: string;
  path_rule_version: string;
  path_rule_fingerprint: string;
  calculation_snapshot: Record<string, unknown>;
}

function assert(condition: unknown, code: string): void {
  if (!condition) {
    throw new Error(code);
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? error.code : "";
  const message = "message" in error && typeof error.message === "string" ? error.message : "";
  return code === "23505" || message.includes("duplicate key value") || message.includes("23505");
}

function ensureUuid(value: string, code: string): string {
  assert(UUID_PATTERN.test(value), code);
  return value;
}

function ensureMonth(value: string): string {
  assert(MONTH_PATTERN.test(value), "INVALID_MONTH_FORMAT");
  return value;
}

function ensureDate(value: string): string {
  assert(DATE_PATTERN.test(value), "INVALID_DATE_FORMAT");
  return value;
}

function normalizeMoney(value: number, code = "INVALID_MONEY_VALUE"): number {
  assert(Number.isFinite(value), code);
  return Math.round(value);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function normalizeUnit(value: number): number {
  assert(Number.isFinite(value) && value > 0, "INVALID_CREDITED_UNIT");
  const rounded = Math.round(value * 4) / 4;
  assert(Math.abs(rounded - value) < 0.000001, "INVALID_CREDITED_UNIT_INCREMENT");
  return rounded;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function distributeByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) {
    return [];
  }

  const totalWeight = weights.reduce((sum, value) => sum + value, 0);
  if (totalWeight <= 0) {
    return weights.map(() => 0);
  }

  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return remaining;
    }
    const amount = Math.round((total * weight) / totalWeight);
    remaining -= amount;
    return amount;
  });
}

function roleCoefficient(constants: Record<string, unknown>, roleType: PathV31RoleType): number {
  const map = isRecord(constants.ROLE_COEFFICIENTS) ? constants.ROLE_COEFFICIENTS : {};
  return Number(map[roleType] ?? 0);
}

function getFixedTemplateDefinition(rule: PathRuleVersionRow, key: string): Array<Record<string, unknown>> {
  const fixedTemplates = isRecord(rule.constants_json.FIXED_TEMPLATES)
    ? rule.constants_json.FIXED_TEMPLATES
    : PATH_V31_DEFAULT_RULE_CONSTANTS.FIXED_TEMPLATES;
  const template = (fixedTemplates as Record<string, unknown>)[key];
  assert(Array.isArray(template), "INVALID_FIXED_TEMPLATE_KEY");
  return template as Array<Record<string, unknown>>;
}

function normalizeTradeFamilies(value: unknown): PathTradeFamily[] {
  const families = coerceArray<unknown>(value)
    .map((entry) => String(entry))
    .filter((entry): entry is PathTradeFamily => PATH_TRADE_FAMILIES.includes(entry as PathTradeFamily));
  assert(families.length > 0, "INVALID_TRADE_FAMILY");
  return Array.from(new Set(families));
}

function nextMonth(month: string): string {
  const normalized = ensureMonth(month);
  const [year, monthPart] = normalized.split("-").map(Number);
  const next = new Date(Date.UTC(year, monthPart - 1, 1));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}

export class PathV31Service {
  constructor(private readonly orgId: string) {}

  private async assertSiteAllowsPathMutation(siteId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("sites")
      .select("id, status")
      .eq("org_id", this.orgId)
      .eq("id", siteId)
      .is("deleted_at", null)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch site: ${error.message}`);
    }

    if (!data) {
      throw new Error("SITE_NOT_FOUND");
    }

    const site = data as { status?: string | null };
    if (String(site.status ?? "") === "completed") {
      throw new Error("SITE_COMPLETED_DAY_LOG_IMMUTABLE");
    }
  }

  private async assertNoActiveSiteCloseProposal(siteId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("site_id", siteId)
      .eq("type", "site.close.finalize")
      .in("status", ["draft", "pending", "approved"])
      .limit(1);

    if (error) {
      throw new Error(`Failed to fetch active site close proposals: ${error.message}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      throw new Error("SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS");
    }
  }

  private async ensureDefaultRuleVersion(): Promise<PathRuleVersionRow> {
    const { data, error } = await supabaseAdmin
      .from("path_rule_versions")
      .upsert(
        {
          org_id: this.orgId,
          version: PATH_V31_RULE_VERSION,
          effective_from: PATH_V31_CUTOVER_DATE,
          status: "active",
          fingerprint: hashStableRecord(PATH_V31_DEFAULT_RULE_CONSTANTS),
          constants_json: PATH_V31_DEFAULT_RULE_CONSTANTS as unknown as Record<string, unknown>,
          created_by: {
            type: "system",
            id: "path-v31-default-rule",
            name: "PATH V3.1 Default Rule",
          },
        },
        { onConflict: "org_id,version" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to ensure default path rule version: ${error.message}`);
    }

    return data as PathRuleVersionRow;
  }

  async resolveActiveRuleVersion(effectiveDateOrMonth?: string): Promise<PathRuleVersionRow> {
    const normalizedEffectiveInput =
      typeof effectiveDateOrMonth === "string" &&
      /^\d{4}-\d{2}-\d{2}T/.test(effectiveDateOrMonth)
        ? effectiveDateOrMonth.slice(0, 10)
        : effectiveDateOrMonth;
    const effectiveFrom = normalizedEffectiveInput
      ? (DATE_PATTERN.test(normalizedEffectiveInput)
          ? normalizedEffectiveInput
          : `${ensureMonth(normalizedEffectiveInput)}-01`)
      : PATH_V31_CUTOVER_DATE;

    const { data, error } = await supabaseAdmin
      .from("path_rule_versions")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("status", "active")
      .lte("effective_from", effectiveFrom)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch path rule versions: ${error.message}`);
    }

    return (data as PathRuleVersionRow | null) ?? (await this.ensureDefaultRuleVersion());
  }

  async listDayLogs(params?: {
    site_id?: string;
    member_id?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<Record<string, unknown>[]> {
    let query = supabaseAdmin
      .from("site_day_logs")
      .select("*")
      .eq("org_id", this.orgId)
      .order("date", { ascending: false })
      .order("created_at", { ascending: false });

    if (params?.site_id) {
      query = query.eq("site_id", ensureUuid(params.site_id, "INVALID_SITE_ID"));
    }
    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (params?.from) {
      query = query.gte("date", ensureDate(params.from));
    }
    if (params?.to) {
      query = query.lte("date", ensureDate(params.to));
    }
    if (typeof params?.limit === "number") {
      query = query.limit(Math.max(1, Math.min(200, Math.floor(params.limit))));
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch site day logs: ${error.message}`);
    }

    return (data ?? []) as Record<string, unknown>[];
  }

  async upsertDayLog(input: DayLogInput, actor: ActorRef): Promise<Record<string, unknown>> {
    const date = ensureDate(input.date);
    ensureUuid(input.site_id, "INVALID_SITE_ID");
    ensureUuid(input.member_id, "INVALID_MEMBER_ID");
    assert(input.member_id === actor.id, "DAY_LOG_MEMBER_FORBIDDEN");
    await this.assertSiteAllowsPathMutation(input.site_id);

    const tradeFamilies = normalizeTradeFamilies(input.trade_families);
    const creditedUnit = normalizeUnit(input.credited_unit);

    const payload = {
      trade_families: tradeFamilies,
      role_type: input.role_type,
      credited_unit: creditedUnit,
      memo: input.memo ?? "",
    };

    const updateExistingLog = async (existing: Record<string, unknown>): Promise<Record<string, unknown>> => {
      if (String(existing.member_id ?? "") !== actor.id) {
        throw new Error("DAY_LOG_MEMBER_FORBIDDEN");
      }
      if (existing.locked_by_site_close_id) {
        throw new Error("DAY_LOG_LOCKED");
      }

      const { data, error } = await supabaseAdmin
        .from("site_day_logs")
        .update(payload)
        .eq("org_id", this.orgId)
        .eq("id", String(existing.id ?? ""))
        .select("*")
        .single();

      if (error) {
        throw new Error(`Failed to save site day log: ${error.message}`);
      }

      return data as Record<string, unknown>;
    };

    if (input.id) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from("site_day_logs")
        .select("id, member_id, locked_by_site_close_id")
        .eq("org_id", this.orgId)
        .eq("id", input.id)
        .maybeSingle();

      if (existingError) {
        throw new Error(`Failed to fetch site day log: ${existingError.message}`);
      }

      assert(existing, "DAY_LOGS_NOT_FOUND");
      return updateExistingLog(existing as Record<string, unknown>);
    }

    const { data: existingByNaturalKey, error: existingByNaturalKeyError } = await supabaseAdmin
      .from("site_day_logs")
      .select("id, member_id, locked_by_site_close_id")
      .eq("org_id", this.orgId)
      .eq("date", date)
      .eq("site_id", input.site_id)
      .eq("member_id", input.member_id)
      .maybeSingle();

    if (existingByNaturalKeyError) {
      throw new Error(`Failed to fetch site day log: ${existingByNaturalKeyError.message}`);
    }

    if (existingByNaturalKey) {
      return updateExistingLog(existingByNaturalKey as Record<string, unknown>);
    }

    const insertPayload = {
      org_id: this.orgId,
      date,
      site_id: input.site_id,
      member_id: input.member_id,
      ...payload,
    };

    const { data, error } = await supabaseAdmin
      .from("site_day_logs")
      .insert(insertPayload)
      .select("*")
      .single();

    if (!error) {
      return data as Record<string, unknown>;
    }

    if (!isDuplicateKeyError(error)) {
      throw new Error(`Failed to save site day log: ${error.message}`);
    }

    const { data: racedExisting, error: racedExistingError } = await supabaseAdmin
      .from("site_day_logs")
      .select("id, member_id, locked_by_site_close_id")
      .eq("org_id", this.orgId)
      .eq("date", date)
      .eq("site_id", input.site_id)
      .eq("member_id", input.member_id)
      .maybeSingle();

    if (racedExistingError) {
      throw new Error(`Failed to fetch site day log: ${racedExistingError.message}`);
    }

    assert(racedExisting, "DAY_LOGS_NOT_FOUND");
    return updateExistingLog(racedExisting as Record<string, unknown>);
  }

  private async loadDayLogs(ids: string[]): Promise<Array<Record<string, unknown>>> {
    const normalizedIds = Array.from(new Set(ids.filter((value) => UUID_PATTERN.test(value))));
    assert(normalizedIds.length > 0, "DAY_LOGS_REQUIRED");

    const { data, error } = await supabaseAdmin
      .from("site_day_logs")
      .select("*")
      .eq("org_id", this.orgId)
      .in("id", normalizedIds);

    if (error) {
      throw new Error(`Failed to fetch site day logs: ${error.message}`);
    }

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    assert(rows.length === normalizedIds.length, "DAY_LOGS_NOT_FOUND");
    rows.forEach((row) => {
      if (row.locked_by_site_close_id) {
        throw new Error("SITE_CLOSE_REOPEN_REQUIRED");
      }
    });
    return rows;
  }

  async listSiteCloses(params?: { month?: string; site_id?: string; limit?: number }): Promise<Record<string, unknown>[]> {
    let query = supabaseAdmin
      .from("site_closes")
      .select("*")
      .eq("org_id", this.orgId)
      .order("closed_at", { ascending: false });

    if (params?.month) {
      const month = ensureMonth(params.month);
      query = query.gte("closed_at", `${month}-01T00:00:00.000Z`);
      query = query.lt("closed_at", `${nextMonth(month)}-01T00:00:00.000Z`);
    }
    if (params?.site_id) {
      query = query.eq("site_id", params.site_id);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(Math.max(1, Math.min(200, Math.floor(params.limit))));
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch site closes: ${error.message}`);
    }

    return (data ?? []) as Record<string, unknown>[];
  }

  async previewSiteClose(input: SiteCloseInput): Promise<Record<string, unknown>> {
    ensureUuid(input.site_id, "INVALID_SITE_ID");
    await this.assertNoActiveSiteCloseProposal(input.site_id);
    const rule = await this.resolveActiveRuleVersion(input.closed_at ?? PATH_V31_CUTOVER_DATE);
    const dayLogs = await this.loadDayLogs(input.included_day_log_ids);
    dayLogs.forEach((row) => {
      if (String(row.site_id ?? "") !== input.site_id) {
        throw new Error("DAY_LOG_SITE_MISMATCH");
      }
    });

    const closedAt = input.closed_at ? new Date(input.closed_at).toISOString() : new Date().toISOString();
    const profit = normalizeMoney(
      normalizeMoney(input.recognized_revenue) -
        normalizeMoney(input.material_cost) -
        normalizeMoney(input.external_cost) -
        normalizeMoney(input.direct_cost) -
        normalizeMoney(input.overhead_allocated) -
        normalizeMoney(input.known_rework_cost) +
        normalizeMoney(input.approved_adjustments),
    );

    const memberMap = new Map<string, SiteShareMemberSnapshot>();
    for (const row of dayLogs) {
      const memberId = String(row.member_id ?? "");
      const roleType = String(row.role_type ?? "") as PathV31RoleType;
      const creditedUnit = Number(row.credited_unit ?? 0);
      const current = memberMap.get(memberId) ?? {
        member_id: memberId,
        credited_units: 0,
        raw_points: 0,
        role_type_mix: {},
        result_share: 0,
        result_eligible: false,
        source_day_log_ids: [],
      };
      current.credited_units = round4(current.credited_units + creditedUnit);
      current.raw_points = round4(current.raw_points + creditedUnit * roleCoefficient(rule.constants_json, roleType));
      current.role_type_mix[roleType] = round4((current.role_type_mix[roleType] ?? 0) + creditedUnit);
      current.source_day_log_ids.push(String(row.id ?? ""));
      memberMap.set(memberId, current);
    }

    const shareMembers = Array.from(memberMap.values());
    let shareSnapshot: SiteShareMemberSnapshot[];
    if (input.share_mode === "fixed_template") {
      const fixedMembers = input.fixed_template_members ?? [];
      assert(fixedMembers.length > 0, "FIXED_TEMPLATE_MEMBERS_REQUIRED");
      if (input.fixed_template_key) {
        const definition = getFixedTemplateDefinition(rule, input.fixed_template_key);
        assert(definition.length === fixedMembers.length, "FIXED_TEMPLATE_MEMBER_COUNT_MISMATCH");
      }
      const totalRatio = fixedMembers.reduce((sum, row) => sum + Number(row.share_ratio ?? 0), 0);
      assert(Math.abs(totalRatio - 1) < 0.0001, "INVALID_FIXED_TEMPLATE_RATIO_TOTAL");
      shareSnapshot = fixedMembers.map((row) => {
        const existing = memberMap.get(row.member_id);
        return {
          member_id: row.member_id,
          credited_units: round4(existing?.credited_units ?? 0),
          raw_points: round4(existing?.raw_points ?? 0),
          role_type_mix: existing?.role_type_mix ?? {},
          result_share: round4(Number(row.share_ratio ?? 0)),
          result_eligible: Number(row.share_ratio ?? 0) > 0,
          source_day_log_ids: row.source_day_log_ids ?? existing?.source_day_log_ids ?? [],
        };
      });
    } else {
      const totalPoints = shareMembers.reduce((sum, member) => sum + member.raw_points, 0);
      shareSnapshot = shareMembers.map((member) => ({
        ...member,
        result_share: totalPoints > 0 && member.raw_points > 0 ? round4(member.raw_points / totalPoints) : 0,
        result_eligible: member.raw_points > 0,
      }));
    }

    const outcomeSnapshots = (input.outcome_snapshots ?? []).map((row) => ({
      member_id: ensureUuid(row.member_id, "INVALID_MEMBER_ID"),
      outcome_status: row.outcome_status,
      rework_units: normalizeMoney(Number(row.rework_units ?? 0), "INVALID_REWORK_UNITS"),
      source: row.source ?? "manual",
      notes: row.notes ?? "",
    }));

    const calculationSnapshot = {
      path_rule_version_id: rule.id,
      path_rule_version: rule.version,
      path_rule_fingerprint: rule.fingerprint,
      constants: rule.constants_json,
      share_mode: input.share_mode,
      fixed_template_key: input.fixed_template_key ?? null,
      fixed_template_reason_code: input.fixed_template_reason_code ?? null,
      day_log_ids: dayLogs.map((row) => String(row.id)),
      day_logs: dayLogs.map((row) => ({
        id: row.id,
        date: row.date,
        member_id: row.member_id,
        role_type: row.role_type,
        trade_families: row.trade_families,
        credited_unit: row.credited_unit,
      })),
      share_snapshot: shareSnapshot,
      profit: {
        recognized_revenue: normalizeMoney(input.recognized_revenue),
        material_cost: normalizeMoney(input.material_cost),
        external_cost: normalizeMoney(input.external_cost),
        direct_cost: normalizeMoney(input.direct_cost),
        overhead_allocated: normalizeMoney(input.overhead_allocated),
        known_rework_cost: normalizeMoney(input.known_rework_cost),
        approved_adjustments: normalizeMoney(input.approved_adjustments),
        distributable_profit: profit,
      },
      outcome_snapshots: outcomeSnapshots,
      closed_at: closedAt,
      cutover_month: PATH_V31_CUTOVER_MONTH,
    };

    return {
      site_id: input.site_id,
      closed_at: closedAt,
      distributable_profit: profit,
      difficulty_band: input.difficulty_band,
      share_mode: input.share_mode,
      fixed_template_key: input.fixed_template_key ?? null,
      fixed_template_reason_code: input.fixed_template_reason_code ?? null,
      share_snapshot: shareSnapshot,
      outcome_snapshots: outcomeSnapshots,
      path_rule_version_id: rule.id,
      path_rule_version: rule.version,
      path_rule_fingerprint: rule.fingerprint,
      calculation_snapshot: calculationSnapshot,
    };
  }

  async buildSiteCloseProposalPayload(input: SiteCloseInput, actor: ActorRef): Promise<Record<string, unknown>> {
    const preview = await this.previewSiteClose(input);
    return {
      path_module_version: "v3.1",
      site_id: input.site_id,
      included_day_log_ids: input.included_day_log_ids,
      recognized_revenue: normalizeMoney(input.recognized_revenue),
      material_cost: normalizeMoney(input.material_cost),
      external_cost: normalizeMoney(input.external_cost),
      direct_cost: normalizeMoney(input.direct_cost),
      overhead_allocated: normalizeMoney(input.overhead_allocated),
      known_rework_cost: normalizeMoney(input.known_rework_cost),
      approved_adjustments: normalizeMoney(input.approved_adjustments),
      distributable_profit: preview.distributable_profit,
      difficulty_band: input.difficulty_band,
      share_mode: input.share_mode,
      fixed_template_key: input.fixed_template_key ?? null,
      fixed_template_reason_code: input.fixed_template_reason_code ?? null,
      share_snapshot: preview.share_snapshot,
      outcome_snapshots: preview.outcome_snapshots,
      path_rule_version_id: preview.path_rule_version_id,
      path_rule_version: preview.path_rule_version,
      path_rule_fingerprint: preview.path_rule_fingerprint,
      calculation_snapshot: preview.calculation_snapshot,
      closed_at: preview.closed_at,
      created_by_actor: actor,
    };
  }

  async buildSiteCloseReopenProposalPayload(
    input: { site_close_id: string; reason_code: string; note?: string },
    actor: ActorRef,
  ): Promise<Record<string, unknown>> {
    const siteCloseId = ensureUuid(input.site_close_id, "INVALID_SITE_CLOSE_ID");
    const { data, error } = await supabaseAdmin
      .from("site_closes")
      .select("id, site_id, status, calculation_snapshot")
      .eq("org_id", this.orgId)
      .eq("id", siteCloseId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch site close: ${error.message}`);
    }
    assert(data, "SITE_CLOSE_NOT_FOUND");
    const siteClose = data as Record<string, unknown>;
    assert(siteClose.status === "finalized", "SITE_CLOSE_NOT_FINALIZED");

    return {
      path_module_version: "v3.1",
      site_close_id: siteCloseId,
      site_id: siteClose.site_id,
      reason_code: input.reason_code,
      note: input.note ?? "",
      calculation_snapshot: siteClose.calculation_snapshot ?? {},
      reopened_by_actor: actor,
    };
  }

  private async loadMemberNames(memberIds: string[]): Promise<Map<string, string>> {
    const ids = Array.from(new Set(memberIds.filter((value) => UUID_PATTERN.test(value))));
    if (ids.length === 0) {
      return new Map();
    }

    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, username")
      .in("id", ids);

    if (error) {
      throw new Error(`Failed to fetch member profiles: ${error.message}`);
    }

    return new Map(
      (data ?? []).map((row) => [
        String(row.id),
        String(row.full_name ?? row.username ?? row.id),
      ]),
    );
  }

  async previewMonthlyDistribution(monthInput: string): Promise<MonthlyDistributionPreview> {
    const month = ensureMonth(monthInput);
    const rule = await this.resolveActiveRuleVersion(month);

    const { data, error } = await supabaseAdmin
      .from("site_closes")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("status", "finalized")
      .gte("closed_at", `${month}-01T00:00:00.000Z`)
      .lt("closed_at", `${nextMonth(month)}-01T00:00:00.000Z`);

    if (error) {
      throw new Error(`Failed to fetch site closes for monthly distribution: ${error.message}`);
    }

    const siteCloses = (data ?? []) as Array<Record<string, unknown>>;
    const siteCloseIds = siteCloses.map((row) => String(row.id ?? "")).filter(Boolean);
    const dayLogsResult =
      siteCloseIds.length > 0
        ? await supabaseAdmin
            .from("site_day_logs")
            .select("*")
            .eq("org_id", this.orgId)
            .in("locked_by_site_close_id", siteCloseIds)
        : { data: [], error: null };

    if (dayLogsResult.error) {
      throw new Error(`Failed to fetch locked day logs: ${dayLogsResult.error.message}`);
    }

    const dayLogs = (dayLogsResult.data ?? []) as Array<Record<string, unknown>>;
    const dayLogsByCloseId = new Map<string, Array<Record<string, unknown>>>();
    dayLogs.forEach((row) => {
      const closeId = String(row.locked_by_site_close_id ?? "");
      const current = dayLogsByCloseId.get(closeId) ?? [];
      current.push(row);
      dayLogsByCloseId.set(closeId, current);
    });

    const memberIds = Array.from(
      new Set(dayLogs.map((row) => String(row.member_id ?? "")).filter((value) => UUID_PATTERN.test(value))),
    );
    const names = await this.loadMemberNames(memberIds);

    const floorUnits = new Map<string, number>();
    dayLogs.forEach((row) => {
      const memberId = String(row.member_id ?? "");
      floorUnits.set(memberId, round4((floorUnits.get(memberId) ?? 0) + Number(row.credited_unit ?? 0)));
    });

    const rawResultWeights = new Map<string, number>();
    siteCloses.forEach((row) => {
      const profit = Math.max(0, Number(row.distributable_profit ?? 0));
      const shareSnapshot = coerceArray<Record<string, unknown>>(row.share_snapshot);
      shareSnapshot.forEach((item) => {
        const memberId = String(item.member_id ?? "");
        rawResultWeights.set(
          memberId,
          round4((rawResultWeights.get(memberId) ?? 0) + profit * Number(item.result_share ?? 0)),
        );
      });
    });

    const floorRate = Number(rule.constants_json.FLOOR_RATE ?? PATH_V31_DEFAULT_RULE_CONSTANTS.FLOOR_RATE);
    const resultRate = Number(rule.constants_json.RESULT_RATE ?? PATH_V31_DEFAULT_RULE_CONSTANTS.RESULT_RATE);
    const gamma = Number(
      rule.constants_json.NONLINEAR_EXPONENT ?? PATH_V31_DEFAULT_RULE_CONSTANTS.NONLINEAR_EXPONENT,
    );
    const poolAmount = Math.max(
      0,
      normalizeMoney(siteCloses.reduce((sum, row) => sum + Number(row.distributable_profit ?? 0), 0)),
    );
    const floorPool = Math.round(poolAmount * floorRate);
    const resultPool = poolAmount - floorPool;

    const memberOrder = Array.from(new Set([...floorUnits.keys(), ...rawResultWeights.keys()]));
    const boostedWeights = memberOrder.map((memberId) => {
      const raw = rawResultWeights.get(memberId) ?? 0;
      return raw > 0 ? round4(raw ** gamma) : 0;
    });
    const floorPays = distributeByWeights(floorPool, memberOrder.map((memberId) => floorUnits.get(memberId) ?? 0));
    const resultPays = distributeByWeights(resultPool, boostedWeights);

    const members: MonthlyDistributionMemberPreview[] = memberOrder.map((memberId, index) => ({
      member_id: memberId,
      member_name: names.get(memberId) ?? memberId,
      floor_units: round4(floorUnits.get(memberId) ?? 0),
      floor_pay: floorPays[index] ?? 0,
      raw_result_weight: round4(rawResultWeights.get(memberId) ?? 0),
      boosted_result_weight: round4(boostedWeights[index] ?? 0),
      speed_class: "normal",
      speed_coeff: 1,
      result_pay: resultPays[index] ?? 0,
      correction: 0,
      total_pay: (floorPays[index] ?? 0) + (resultPays[index] ?? 0),
      calculation_snapshot: {
        site_close_ids: siteCloses
          .filter((row) =>
            coerceArray<Record<string, unknown>>(row.share_snapshot).some(
              (item) => String(item.member_id ?? "") === memberId,
            ),
          )
          .map((row) => row.id),
      },
    }));

    const calculationSnapshot = {
      month,
      pool_amount: poolAmount,
      floor_pool_amount: floorPool,
      result_pool_amount: resultPool,
      floor_rate: floorRate,
      result_rate: resultRate,
      nonlinear_exponent: gamma,
      path_rule_version_id: rule.id,
      path_rule_version: rule.version,
      path_rule_fingerprint: rule.fingerprint,
      site_closes: siteCloses.map((row) => ({
        id: row.id,
        site_id: row.site_id,
        closed_at: row.closed_at,
        distributable_profit: row.distributable_profit,
        share_snapshot: row.share_snapshot,
        included_day_log_ids: (dayLogsByCloseId.get(String(row.id ?? "")) ?? []).map((entry) => entry.id),
      })),
      members,
    };

    return {
      month,
      pool_amount: poolAmount,
      floor_rate: floorRate,
      result_rate: resultRate,
      nonlinear_exponent: gamma,
      members,
      path_rule_version_id: rule.id,
      path_rule_version: rule.version,
      path_rule_fingerprint: rule.fingerprint,
      calculation_snapshot: calculationSnapshot,
    };
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
      throw new Error(`Failed to fetch canonical month close: ${existingError.message}`);
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
          id: "path-v31-anchor",
          name: "PATH V3.1 Anchor",
        },
        close_rule_version_id: closeRuleVersionId,
      })
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to create canonical month close: ${error.message}`);
    }

    return String(data.id);
  }

  async buildMonthlyDistributionProposalPayload(month: string, actor: ActorRef): Promise<Record<string, unknown>> {
    const preview = await this.previewMonthlyDistribution(month);
    const canonicalMonthCloseId = await this.ensureCanonicalMonthClose(
      ensureMonth(month),
      preview.path_rule_version_id,
    );
    return {
      path_module_version: "v3.1",
      calculation_system: "path_v31",
      month: ensureMonth(month),
      month_close_id: canonicalMonthCloseId,
      reward_rule_version_id: preview.path_rule_version_id,
      pool_amount: preview.pool_amount,
      floor_rate: preview.floor_rate,
      result_rate: preview.result_rate,
      nonlinear_exponent: preview.nonlinear_exponent,
      member_payouts: preview.members.map((member) => ({
        member_id: member.member_id,
        member_name: member.member_name,
        floor_units: member.floor_units,
        floor_amount: member.floor_pay,
        raw_result_weight: member.raw_result_weight,
        boosted_result_weight: member.boosted_result_weight,
        speed_class: member.speed_class,
        speed_coeff: member.speed_coeff,
        result_amount: member.result_pay,
        correction_amount: member.correction,
        final_pay: member.total_pay,
        calculation_snapshot: member.calculation_snapshot,
      })),
      path_rule_version_id: preview.path_rule_version_id,
      path_rule_version: preview.path_rule_version,
      path_rule_fingerprint: preview.path_rule_fingerprint,
      calculation_snapshot: preview.calculation_snapshot,
      created_by_actor: actor,
    };
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

  async syncSiteCloseFromExecutedProposal(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const shareSnapshot = coerceArray<Record<string, unknown>>(payload.share_snapshot);
    const closedAt = String(payload.closed_at ?? proposal.executed_at ?? new Date().toISOString());
    const { data, error } = await supabaseAdmin
      .from("site_closes")
      .upsert(
        {
          org_id: this.orgId,
          site_id: payload.site_id,
          proposal_id: proposal.id,
          recognized_revenue: payload.recognized_revenue ?? 0,
          material_cost: payload.material_cost ?? 0,
          external_cost: payload.external_cost ?? 0,
          direct_cost: payload.direct_cost ?? 0,
          overhead_allocated: payload.overhead_allocated ?? 0,
          known_rework_cost: payload.known_rework_cost ?? 0,
          approved_adjustments: payload.approved_adjustments ?? 0,
          distributable_profit: payload.distributable_profit ?? 0,
          difficulty_band: payload.difficulty_band,
          share_mode: payload.share_mode,
          fixed_template_key: payload.fixed_template_key ?? null,
          fixed_template_reason_code: payload.fixed_template_reason_code ?? null,
          share_snapshot: shareSnapshot,
          path_rule_version_id: payload.path_rule_version_id ?? null,
          path_rule_version: payload.path_rule_version ?? PATH_V31_RULE_VERSION,
          path_rule_fingerprint: payload.path_rule_fingerprint ?? "",
          calculation_snapshot: payload.calculation_snapshot ?? {},
          closed_at: closedAt,
          closed_by: proposal.executed_by ?? proposal.created_by,
          status: "finalized",
        },
        { onConflict: "org_id,proposal_id" },
      )
      .select("id")
      .single();

    if (error) {
      throw new Error(`Failed to sync site close: ${error.message}`);
    }

    const siteCloseId = String(data.id);
    const dayLogIds = coerceArray<string>(payload.included_day_log_ids);
    if (dayLogIds.length > 0) {
      const updateLogsResult = await supabaseAdmin
        .from("site_day_logs")
        .update({ locked_by_site_close_id: siteCloseId })
        .eq("org_id", this.orgId)
        .in("id", dayLogIds);

      if (updateLogsResult.error) {
        throw new Error(`Failed to lock site day logs: ${updateLogsResult.error.message}`);
      }

      await new PathV32SimpleRewardService(this.orgId).syncSiteCloseMemberUnits(
        siteCloseId,
        String(payload.site_id ?? ""),
        dayLogIds,
      );
    }

    const outcomeSnapshots = coerceArray<Record<string, unknown>>(payload.outcome_snapshots);
    if (outcomeSnapshots.length > 0) {
      const insertResult = await supabaseAdmin.from("site_member_outcome_snapshots").upsert(
        outcomeSnapshots.map((row) => ({
          org_id: this.orgId,
          site_close_id: siteCloseId,
          member_id: row.member_id,
          outcome_status: row.outcome_status,
          rework_units: row.rework_units ?? 0,
          source: row.source ?? "manual",
          notes: row.notes ?? "",
        })),
        { onConflict: "site_close_id,member_id" },
      );

      if (insertResult.error) {
        throw new Error(`Failed to sync site member outcomes: ${insertResult.error.message}`);
      }
    }

    await this.refreshSkillLedgersBySiteCloseIds([siteCloseId]);
  }

  async syncSiteCloseReopenFromExecutedProposal(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const siteCloseId = ensureUuid(String(payload.site_close_id ?? ""), "INVALID_SITE_CLOSE_ID");

    const closeResult = await supabaseAdmin
      .from("site_closes")
      .update({
        status: "reopened",
        reopened_by_proposal_id: proposal.id,
      })
      .eq("org_id", this.orgId)
      .eq("id", siteCloseId);

    if (closeResult.error) {
      throw new Error(`Failed to reopen site close: ${closeResult.error.message}`);
    }

    const unlockResult = await supabaseAdmin
      .from("site_day_logs")
      .update({ locked_by_site_close_id: null })
      .eq("org_id", this.orgId)
      .eq("locked_by_site_close_id", siteCloseId);

    if (unlockResult.error) {
      throw new Error(`Failed to unlock site day logs: ${unlockResult.error.message}`);
    }

    await this.refreshSkillLedgersBySiteCloseIds([siteCloseId]);
  }

  async syncMonthlyDistributionFromExecutedProposal(proposal: Proposal): Promise<void> {
    const payload = proposal.payload as Record<string, unknown>;
    const month = ensureMonth(String(payload.month ?? ""));
    const proposalExecutionId = await this.ensureProposalExecutionRecord(proposal);
    const canonicalMonthCloseId = ensureUuid(String(payload.month_close_id ?? ""), "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED");

    const { data: canonicalRun, error: canonicalError } = await supabaseAdmin
      .from("reward_runs")
      .upsert(
        {
          org_id: this.orgId,
          run_kind: "calculation",
          month_close_id: canonicalMonthCloseId,
          proposal_execution_id: proposalExecutionId,
          reward_rule_version_id: payload.reward_rule_version_id,
          calculation_system: "path_v31",
          status: "fixed",
          fixed_at: proposal.executed_at ?? new Date().toISOString(),
          policy_fingerprint: payload.path_rule_fingerprint ?? "",
          reward_engine_version: PATH_V31_ENGINE_VERSION,
          rounding_mode: "half_up",
          rounding_scale: 0,
          rounding_minor_unit: 1,
          input_hash: hashStableRecord(payload.calculation_snapshot ?? {}),
          closed_profit: payload.pool_amount ?? 0,
          path_pool_amount: payload.pool_amount ?? 0,
          base_pool_amount: Math.round(Number(payload.pool_amount ?? 0) * Number(payload.floor_rate ?? 0.35)),
          variable_pool_amount:
            Number(payload.pool_amount ?? 0) -
            Math.round(Number(payload.pool_amount ?? 0) * Number(payload.floor_rate ?? 0.35)),
          guaranteed_total_amount: 0,
        },
        { onConflict: "proposal_execution_id" },
      )
      .select("id")
      .single();

    if (canonicalError) {
      throw new Error(`Failed to sync canonical reward run: ${canonicalError.message}`);
    }

    const { data: monthlyClose, error: monthlyCloseError } = await supabaseAdmin
      .from("monthly_distribution_closes")
      .upsert(
        {
          org_id: this.orgId,
          proposal_id: proposal.id,
          month,
          canonical_month_close_id: canonicalMonthCloseId,
          pool_amount: payload.pool_amount ?? 0,
          floor_rate: payload.floor_rate ?? 0.35,
          result_rate: payload.result_rate ?? 0.65,
          nonlinear_exponent: payload.nonlinear_exponent ?? 1.12,
          path_rule_version_id: payload.path_rule_version_id,
          path_rule_version: payload.path_rule_version ?? PATH_V31_RULE_VERSION,
          path_rule_fingerprint: payload.path_rule_fingerprint ?? "",
          calculation_snapshot: payload.calculation_snapshot ?? {},
          closed_at: proposal.executed_at ?? new Date().toISOString(),
          closed_by: proposal.executed_by ?? proposal.created_by,
          status: "finalized",
        },
        { onConflict: "org_id,proposal_id" },
      )
      .select("id")
      .single();

    if (monthlyCloseError) {
      throw new Error(`Failed to sync monthly distribution close: ${monthlyCloseError.message}`);
    }

    const monthlyDistributionCloseId = String(monthlyClose.id);
    const lines = coerceArray<Record<string, unknown>>(payload.member_payouts);
    if (lines.length > 0) {
      const lineResult = await supabaseAdmin.from("monthly_distribution_lines").upsert(
        lines.map((row) => ({
          org_id: this.orgId,
          monthly_distribution_close_id: monthlyDistributionCloseId,
          member_id: row.member_id,
          floor_units: row.floor_units ?? 0,
          floor_pay: row.floor_amount ?? 0,
          raw_result_weight: row.raw_result_weight ?? 0,
          boosted_result_weight: row.boosted_result_weight ?? 0,
          speed_class: row.speed_class ?? "normal",
          speed_coeff: row.speed_coeff ?? 1,
          result_pay: row.result_amount ?? 0,
          correction: row.correction_amount ?? 0,
          total_pay: row.final_pay ?? 0,
          calculation_snapshot: row.calculation_snapshot ?? {},
        })),
        { onConflict: "monthly_distribution_close_id,member_id" },
      );

      if (lineResult.error) {
        throw new Error(`Failed to sync monthly distribution lines: ${lineResult.error.message}`);
      }
    }

    const canonicalRunId = String(canonicalRun.id);
    const firstCloseSiteId = coerceArray<Record<string, unknown>>(
      (payload.calculation_snapshot as Record<string, unknown> | undefined)?.site_closes,
    )
      .map((row) => String(row.site_id ?? ""))
      .find((value) => UUID_PATTERN.test(value));

    if (firstCloseSiteId) {
      const { data: revenueBasis } = await supabaseAdmin
        .from("revenue_basis")
        .select("id")
        .eq("org_id", this.orgId)
        .eq("site_id", firstCloseSiteId)
        .order("recognition_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (revenueBasis?.id) {
        const lineInsertResult = await supabaseAdmin.from("reward_run_lines").insert(
          lines.map((row) => ({
            org_id: this.orgId,
            reward_run_id: canonicalRunId,
            revenue_basis_id: revenueBasis.id,
            recipient_id: row.member_id,
            base_amount: row.floor_amount ?? 0,
            delta_amount: Number(row.final_pay ?? 0) - Number(row.floor_amount ?? 0),
            payout_amount: row.final_pay ?? 0,
            formula_snapshot_json: row,
          })),
        );

        if (lineInsertResult.error) {
          throw new Error(`Failed to sync canonical reward run lines: ${lineInsertResult.error.message}`);
        }
      }
    }
  }

  private async refreshSkillLedgersBySiteCloseIds(siteCloseIds: string[]): Promise<void> {
    const validIds = siteCloseIds.filter((value) => UUID_PATTERN.test(value));
    if (validIds.length === 0) {
      return;
    }

    const logsResult = await supabaseAdmin
      .from("site_day_logs")
      .select("id, date, member_id, trade_families, role_type, credited_unit, locked_by_site_close_id")
      .eq("org_id", this.orgId)
      .in("locked_by_site_close_id", validIds);

    if (logsResult.error) {
      throw new Error(`Failed to fetch locked logs for skill ledger refresh: ${logsResult.error.message}`);
    }

    const affectedMemberIds = Array.from(
      new Set((logsResult.data ?? []).map((row) => String(row.member_id ?? "")).filter((value) => UUID_PATTERN.test(value))),
    );
    if (affectedMemberIds.length === 0) {
      return;
    }

    const allLogsResult = await supabaseAdmin
      .from("site_day_logs")
      .select("id, date, member_id, trade_families, role_type, credited_unit, locked_by_site_close_id")
      .eq("org_id", this.orgId)
      .in("member_id", affectedMemberIds)
      .not("locked_by_site_close_id", "is", null);

    if (allLogsResult.error) {
      throw new Error(`Failed to fetch full locked logs for skill ledger refresh: ${allLogsResult.error.message}`);
    }

    const closeIds = Array.from(
      new Set(
        (allLogsResult.data ?? [])
          .map((row) => String(row.locked_by_site_close_id ?? ""))
          .filter((value) => UUID_PATTERN.test(value)),
      ),
    );

    const outcomeResult =
      closeIds.length > 0
        ? await supabaseAdmin
            .from("site_member_outcome_snapshots")
            .select("site_close_id, member_id, outcome_status")
            .eq("org_id", this.orgId)
            .in("site_close_id", closeIds)
        : { data: [], error: null };

    if (outcomeResult.error) {
      throw new Error(`Failed to fetch site member outcomes for skill ledger refresh: ${outcomeResult.error.message}`);
    }

    const outcomeByCloseAndMember = new Map<string, OutcomeStatus>();
    (outcomeResult.data ?? []).forEach((row) => {
      outcomeByCloseAndMember.set(
        `${row.site_close_id}:${row.member_id}`,
        row.outcome_status as OutcomeStatus,
      );
    });

    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ledgerMap = new Map<string, Record<string, unknown>>();

    (allLogsResult.data ?? []).forEach((row) => {
      const memberId = String(row.member_id ?? "");
      const roleType = String(row.role_type ?? "") as PathV31RoleType;
      const date = String(row.date ?? "");
      const closeId = String(row.locked_by_site_close_id ?? "");
      const outcomeStatus = outcomeByCloseAndMember.get(`${closeId}:${memberId}`) ?? "unknown";
      const tradeFamilies = normalizeTradeFamilies(row.trade_families);
      const splitUnits = Number(row.credited_unit ?? 0) / tradeFamilies.length;
      tradeFamilies.forEach((tradeFamily) => {
        const key = `${memberId}:${tradeFamily}`;
        const current = ledgerMap.get(key) ?? {
          org_id: this.orgId,
          member_id: memberId,
          trade_family: tradeFamily,
          assist_units: 0,
          lead_units: 0,
          solo_units: 0,
          recent_90d_units: 0,
          ok_count: 0,
          rework_count: 0,
          last_performed_at: null,
          derived_labels: [],
          metadata: {
            cutover_date: PATH_V31_CUTOVER_DATE,
            outcome_source: "site_member_outcome_snapshots",
          },
        };
        if (roleType === "assist") {
          current.assist_units = round4(Number(current.assist_units) + splitUnits);
        }
        if (roleType === "lead") {
          current.lead_units = round4(Number(current.lead_units) + splitUnits);
        }
        if (roleType === "solo") {
          current.solo_units = round4(Number(current.solo_units) + splitUnits);
        }
        if (new Date(`${date}T00:00:00.000Z`) >= ninetyDaysAgo) {
          current.recent_90d_units = round4(Number(current.recent_90d_units) + splitUnits);
        }
        if (!current.last_performed_at || String(current.last_performed_at) < date) {
          current.last_performed_at = date;
        }
        if (outcomeStatus === "ok") {
          current.ok_count = Number(current.ok_count) + 1;
        } else if (outcomeStatus === "rework") {
          current.rework_count = Number(current.rework_count) + 1;
        }
        const derivedLabels: string[] = [];
        if (Number(current.assist_units) + Number(current.lead_units) + Number(current.solo_units) === 0) {
          derivedLabels.push("unverified");
        }
        if (Number(current.assist_units) > 0) {
          derivedLabels.push("assist_history");
        }
        if (Number(current.lead_units) > 0) {
          derivedLabels.push("lead_history");
        }
        if (Number(current.solo_units) > 0) {
          derivedLabels.push("solo_history");
        }
        if (
          Number(current.lead_units) + Number(current.solo_units) >= 2 &&
          Number(current.rework_count) <= Number(current.ok_count)
        ) {
          derivedLabels.push("stable_candidate");
        }
        current.derived_labels = Array.from(new Set(derivedLabels));
        ledgerMap.set(key, current);
      });
    });

    for (const memberId of affectedMemberIds) {
      const deleteResult = await supabaseAdmin
        .from("skill_ledgers")
        .delete()
        .eq("org_id", this.orgId)
        .eq("member_id", memberId);
      if (deleteResult.error) {
        throw new Error(`Failed to clear skill ledger rows: ${deleteResult.error.message}`);
      }
    }

    const rows = Array.from(ledgerMap.values());
    if (rows.length > 0) {
      const insertResult = await supabaseAdmin.from("skill_ledgers").insert(rows);
      if (insertResult.error) {
        throw new Error(`Failed to insert skill ledger rows: ${insertResult.error.message}`);
      }
    }
  }

  async getMemberExperience(memberId: string): Promise<Record<string, unknown>> {
    const normalizedMemberId = ensureUuid(memberId, "INVALID_MEMBER_ID");
    const { data, error } = await supabaseAdmin
      .from("skill_ledgers")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("member_id", normalizedMemberId)
      .order("trade_family", { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch skill ledger rows: ${error.message}`);
    }

    return {
      member_id: normalizedMemberId,
      ledgers: (data ?? []) as Record<string, unknown>[],
      cutover_date: PATH_V31_CUTOVER_DATE,
    };
  }

  async recommendLeadAssignment(
    input: {
      date: string;
      site_id: string;
      trade_family: PathTradeFamily;
      difficulty_band: DifficultyBand;
      risk_band?: RiskBand;
      candidate_member_ids: string[];
      chosen_member_id?: string | null;
      override_reason_code?: string | null;
      excluded_member_ids?: string[];
      restricted_member_ids?: string[];
      incident_blocked_member_ids?: string[];
      bad_condition_member_ids?: string[];
    },
    actor: ActorRef,
  ): Promise<Record<string, unknown>> {
    const date = ensureDate(input.date);
    const riskBand = input.risk_band ?? "low";
    const candidateIds = Array.from(
      new Set(input.candidate_member_ids.filter((value) => UUID_PATTERN.test(value))),
    );
    assert(candidateIds.length > 0, "CANDIDATES_REQUIRED");

    const { data, error } = await supabaseAdmin
      .from("skill_ledgers")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("trade_family", input.trade_family)
      .in("member_id", candidateIds);

    if (error) {
      throw new Error(`Failed to fetch skill ledgers for recommendation: ${error.message}`);
    }

    const ledgers = (data ?? []) as Array<Record<string, unknown>>;
    const ledgerByMember = new Map(ledgers.map((row) => [String(row.member_id), row]));
    const names = await this.loadMemberNames(candidateIds);
    const blocked = new Set([
      ...(input.excluded_member_ids ?? []),
      ...(input.restricted_member_ids ?? []),
      ...(input.incident_blocked_member_ids ?? []),
      ...(input.bad_condition_member_ids ?? []),
    ]);
    const difficultyScoreMap: Record<DifficultyBand, number> = { S1: 1, S2: 2, S3: 3 };

    const recommendations = candidateIds
      .filter((memberId) => {
        if (blocked.has(memberId)) {
          return false;
        }
        const ledger = ledgerByMember.get(memberId);
        return Number(ledger?.assist_units ?? 0) > 0;
      })
      .map((memberId) => {
        const ledger = ledgerByMember.get(memberId) ?? {};
        const leadSoloLifetime = Number(ledger.lead_units ?? 0) + Number(ledger.solo_units ?? 0);
        const assistRecent = Number(ledger.recent_90d_units ?? 0);
        const assistLifetime = Number(ledger.assist_units ?? 0);
        const lastDifficultySeen = isRecord(ledger.metadata) ? String(ledger.metadata.last_difficulty_band ?? "S1") : "S1";
        const difficultyFit =
          difficultyScoreMap[lastDifficultySeen as DifficultyBand] >= difficultyScoreMap[input.difficulty_band]
            ? 1
            : difficultyScoreMap[lastDifficultySeen as DifficultyBand] === difficultyScoreMap[input.difficulty_band] - 1
              ? 0.7
              : 0.4;
        const sufficient = assistRecent + leadSoloLifetime >= 2 && (assistLifetime + leadSoloLifetime >= 4);
        const productivity =
          sufficient
            ? round4(
                leadSoloLifetime * 0.5 +
                  Number(ledger.recent_90d_units ?? 0) * 0.3 +
                  Math.max(0, Number(ledger.ok_count ?? 0) - Number(ledger.rework_count ?? 0)) * 0.2 +
                  difficultyFit,
              )
            : round4(
                assistRecent * 0.5 +
                  assistLifetime * 0.3 +
                  difficultyFit * 0.2,
              );
        const growthBonus = round4(
          Math.min(
            0.08,
            Math.max(0, assistLifetime - leadSoloLifetime) * 0.01,
          ),
        );
        const fairnessBonus = round4(
          Math.min(
            0.05,
            Math.max(0, 2 - leadSoloLifetime) * 0.02,
          ),
        );
        return {
          member_id: memberId,
          member_name: names.get(memberId) ?? memberId,
          productivity_proxy: productivity,
          growth_bonus: growthBonus,
          fairness_bonus: fairnessBonus,
          confidence: sufficient ? "medium" : "low",
          difficulty_fit_score: difficultyFit,
          recommendation_score: round4(productivity + growthBonus + fairnessBonus),
        };
      })
      .sort((left, right) => right.recommendation_score - left.recommendation_score);

    assert(recommendations.length > 0, "NO_ELIGIBLE_CANDIDATES");
    const best = recommendations[0].productivity_proxy;
    const baselineRatio =
      riskBand === "high"
        ? Number(PATH_V31_DEFAULT_RULE_CONSTANTS.LEAD_BASELINE_RATIO_HIGH_RISK)
        : Number(PATH_V31_DEFAULT_RULE_CONSTANTS.LEAD_BASELINE_RATIO_STANDARD);
    const eligible = recommendations.filter(
      (entry) => entry.productivity_proxy >= round4(best * baselineRatio),
    );
    const selected = eligible.sort((left, right) => right.recommendation_score - left.recommendation_score);
    const recommended = selected[0];

    const insertResult = await supabaseAdmin
      .from("lead_assignment_logs")
      .insert({
        org_id: this.orgId,
        date,
        site_id: input.site_id,
        trade_family: input.trade_family,
        difficulty_band: input.difficulty_band,
        risk_band: riskBand,
        candidate_member_ids: candidateIds,
        recommendation_snapshot: selected,
        recommended_member_id: recommended.member_id,
        chosen_member_id: input.chosen_member_id ?? null,
        confidence: recommended.confidence,
        predicted_productivity: recommended.productivity_proxy,
        growth_bonus: recommended.growth_bonus,
        fairness_bonus: recommended.fairness_bonus,
        override_reason_code: input.override_reason_code ?? null,
        metadata: {
          baseline_ratio: baselineRatio,
          cutover_date: PATH_V31_CUTOVER_DATE,
          cold_start: recommended.confidence === "low",
        },
        created_by: actor,
      })
      .select("*")
      .single();

    if (insertResult.error) {
      throw new Error(`Failed to insert lead assignment log: ${insertResult.error.message}`);
    }

    return {
      recommendation: recommended,
      ranking: selected,
      log: insertResult.data,
    };
  }
}
