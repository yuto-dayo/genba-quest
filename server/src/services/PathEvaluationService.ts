import { supabaseAdmin } from "../lib/supabaseAdmin";
import { ActorRef } from "./PolicyEngine";

export const BIG_SKILL_KEYS = [
  "cross_work",
  "putty_foundation",
  "planning_preparation",
  "quality_stability",
  "site_trust",
  "education_support",
] as const;

export const BIG_SKILL_STATE_OPTIONS = [
  "unverified",
  "assist_required",
  "conditional",
  "near_independent",
  "stable_independent",
] as const;

export const REWORK_FLAG_OPTIONS = ["none", "minor", "major"] as const;
export const REVIEW_STATUS_OPTIONS = ["confirmed", "review_required", "unverified"] as const;
export const PROFILE_CERTIFICATION_STATUS_OPTIONS = [
  "candidate",
  "verified",
  "review_required",
  "revoked",
] as const;
export const CONFIRMATION_TARGET_TYPE_OPTIONS = ["big_skill", "skill_tag", "level"] as const;
export const PATH_LEVEL_OPTIONS = ["L1", "L2", "L3", "L4"] as const;

export type BigSkillKey = (typeof BIG_SKILL_KEYS)[number];
export type BigSkillState = (typeof BIG_SKILL_STATE_OPTIONS)[number];
export type ReworkFlag = (typeof REWORK_FLAG_OPTIONS)[number];
export type ReviewStatus = (typeof REVIEW_STATUS_OPTIONS)[number];
export type ProfileCertificationStatus = (typeof PROFILE_CERTIFICATION_STATUS_OPTIONS)[number];
export type ConfirmationTargetType = (typeof CONFIRMATION_TARGET_TYPE_OPTIONS)[number];
export type PathLevel = (typeof PATH_LEVEL_OPTIONS)[number];
export type ConfirmationStatus =
  | BigSkillState
  | ReviewStatus
  | ProfileCertificationStatus;

export interface MonthlyEvaluationFormInput {
  month: string;
  member_id: string;
  selected_big_skill_states: Partial<Record<BigSkillKey, BigSkillState>>;
  selected_roles?: string[];
  site_ids?: string[];
  photo_flag?: boolean;
  rework_flag?: ReworkFlag;
  comment?: string;
}

export interface MonthlyEvaluationFormRow extends MonthlyEvaluationFormInput {
  id: string;
  org_id: string;
  selected_roles: string[];
  site_ids: string[];
  photo_flag: boolean;
  rework_flag: ReworkFlag;
  comment: string;
  submitted_at: string;
  updated_at: string;
}

export interface MonthlyEvaluationAiReviewInput {
  month: string;
  member_id: string;
  monthly_summary: string;
  candidate_states: Partial<Record<BigSkillKey, BigSkillState>>;
  candidate_skill_tags?: string[];
  profile_update_candidates?: Array<Record<string, unknown>>;
  promotion_candidate_flag?: boolean;
  reasons?: Array<Record<string, unknown> | string>;
  evidence_summary?: Array<Record<string, unknown> | string>;
  unknown_points?: Array<Record<string, unknown> | string>;
  review_required_flag?: boolean;
}

export interface MonthlyEvaluationAiReviewRow extends MonthlyEvaluationAiReviewInput {
  id: string;
  org_id: string;
  candidate_skill_tags: string[];
  profile_update_candidates: Array<Record<string, unknown>>;
  promotion_candidate_flag: boolean;
  reasons: Array<Record<string, unknown> | string>;
  evidence_summary: Array<Record<string, unknown> | string>;
  unknown_points: Array<Record<string, unknown> | string>;
  review_required_flag: boolean;
  generated_by: ActorRef | null;
  generated_at: string;
  updated_at: string;
}

export interface MonthlyEvaluationConfirmationInput {
  month: string;
  member_id: string;
  target_type: ConfirmationTargetType;
  target_key: string;
  confirmation_status: ConfirmationStatus;
  comment?: string;
}

export interface MonthlyEvaluationConfirmationRow extends MonthlyEvaluationConfirmationInput {
  id: string;
  org_id: string;
  comment: string;
  confirmed_by: ActorRef | null;
  confirmed_at: string;
  updated_at: string;
}

export interface MemberSkillProfileRow {
  id: string;
  org_id: string;
  member_id: string;
  current_level: PathLevel | null;
  current_level_since: string | null;
  cross_work_status: BigSkillState;
  putty_foundation_status: BigSkillState;
  planning_preparation_status: BigSkillState;
  quality_stability_status: BigSkillState;
  site_trust_status: BigSkillState;
  education_support_status: BigSkillState;
  updated_at: string;
}

export interface MemberSkillCertificationRow {
  id: string;
  org_id: string;
  member_id: string;
  skill_key: string;
  category: string;
  status: ProfileCertificationStatus;
  verified_by: ActorRef | null;
  verified_at: string;
  evidence_count: number;
  last_site_id: string | null;
  note: string;
  review_required_flag: boolean;
  updated_at: string;
}

export interface EvaluationFinalizeProposalInput {
  month: string;
  member_id: string;
  confirmed_states: Partial<Record<BigSkillKey, BigSkillState>>;
  work_days?: number;
  A?: number;
  R?: number;
  Q?: number;
  current_level?: PathLevel | null;
  comment?: string;
}

export interface MonthlyEvaluationFinalizationRow {
  id: string;
  org_id: string;
  month: string;
  member_id: string;
  proposal_id: string | null;
  confirmed_big_skill_states: Partial<Record<BigSkillKey, BigSkillState>>;
  work_days: number;
  A: number;
  R: number;
  Q: number;
  current_level: PathLevel | null;
  comment: string;
  finalized_by: ActorRef | null;
  finalized_at: string;
  updated_at: string;
}

export interface SkillCertificationProposalInput {
  member_id: string;
  skill_key: string;
  category: string;
  status?: ProfileCertificationStatus;
  evidence_count?: number;
  last_site_id?: string | null;
  note?: string;
  review_required_flag?: boolean;
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_COMMENT_LENGTH = 280;
const MAX_TARGET_KEY_LENGTH = 120;
const MAX_SKILL_KEY_LENGTH = 120;
const MAX_CATEGORY_LENGTH = 80;
const CONFIRMATION_STATUS_OPTIONS = Array.from(
  new Set([
    ...BIG_SKILL_STATE_OPTIONS,
    ...REVIEW_STATUS_OPTIONS,
    ...PROFILE_CERTIFICATION_STATUS_OPTIONS,
  ]),
);

function assert(condition: unknown, code: string): void {
  if (!condition) {
    throw new Error(code);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureMonth(month: string): string {
  assert(MONTH_PATTERN.test(month), "INVALID_MONTH_FORMAT");
  return month;
}

function ensureUuid(value: string, code: string): string {
  assert(UUID_PATTERN.test(value), code);
  return value;
}

function dedupeStrings(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function normalizeComment(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  assert(trimmed.length <= MAX_COMMENT_LENGTH, "COMMENT_TOO_LONG");
  return trimmed;
}

function normalizeOptionalComment(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }

  return normalizeComment(value);
}

function normalizeBigSkillStates(
  value: unknown,
  code = "INVALID_BIG_SKILL_STATES",
): Partial<Record<BigSkillKey, BigSkillState>> {
  assert(isPlainObject(value), code);

  const result: Partial<Record<BigSkillKey, BigSkillState>> = {};
  const record = value as Record<string, unknown>;
  for (const [key, state] of Object.entries(record)) {
    assert(BIG_SKILL_KEYS.includes(key as BigSkillKey), code);
    assert(BIG_SKILL_STATE_OPTIONS.includes(state as BigSkillState), code);
    result[key as BigSkillKey] = state as BigSkillState;
  }

  return result;
}

function normalizeRecordArray(
  value: unknown,
  code: string,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    assert(isPlainObject(item), code);
    return item;
  });
}

function normalizeMixedArray(
  value: unknown,
  code: string,
): Array<Record<string, unknown> | string> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => {
    assert(typeof item === "string" || isPlainObject(item), code);
    return item as Record<string, unknown> | string;
  });
}

function normalizeNonEmptyTrimmedString(
  value: unknown,
  code: string,
  maxLength?: number,
): string {
  assert(typeof value === "string", code);
  const trimmed = (value as string).trim();
  assert(trimmed.length > 0, code);
  if (typeof maxLength === "number") {
    assert(trimmed.length <= maxLength, code);
  }
  return trimmed;
}

function normalizeOptionalUuid(value: unknown, code: string): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  assert(typeof value === "string", code);
  return ensureUuid(value as string, code);
}

function normalizeOptionalPathLevel(value: unknown): PathLevel | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  assert(PATH_LEVEL_OPTIONS.includes(value as PathLevel), "INVALID_LEVEL");
  return value as PathLevel;
}

function normalizeEvidenceCount(value: unknown): number {
  if (value === undefined || value === null) {
    return 0;
  }

  assert(Number.isInteger(value) && Number(value) >= 0, "INVALID_EVIDENCE_COUNT");
  return Number(value);
}

function normalizeWorkDays(value: unknown): number {
  if (value === undefined || value === null || value === "") {
    return 0;
  }

  assert(Number.isInteger(value) && Number(value) >= 0, "INVALID_WORK_DAYS");
  return Number(value);
}

function normalizeMonthlyRating(
  value: unknown,
  code: "INVALID_A_SCORE" | "INVALID_R_SCORE" | "INVALID_Q_SCORE",
): number {
  if (value === undefined || value === null || value === "") {
    return 1;
  }

  assert(Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 2, code);
  return Number(value);
}

function isMissingFinalizationsReadModel(error: { message?: string | null } | null | undefined): boolean {
  const message = error?.message ?? "";
  return (
    message.includes("monthly_evaluation_finalizations") &&
    message.toLowerCase().includes("schema cache")
  );
}

function coerceNonNegativeInteger(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(parsed));
}

function coerceMonthlyRating(value: unknown, fallback: number): number {
  return Math.min(2, coerceNonNegativeInteger(value, fallback));
}

function coerceTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceFinalizedAt(...candidates: unknown[]): string {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate;
    }
  }

  return new Date(0).toISOString();
}

function coerceMonth(value: unknown, finalizedAt: string): string | null {
  if (typeof value === "string" && MONTH_PATTERN.test(value)) {
    return value;
  }

  const parsed = new Date(finalizedAt);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 7);
  }

  return null;
}

function normalizeFallbackBigSkillStates(
  value: unknown,
): Partial<Record<BigSkillKey, BigSkillState>> {
  if (!isPlainObject(value)) {
    return {};
  }

  const normalized: Partial<Record<BigSkillKey, BigSkillState>> = {};
  for (const [key, state] of Object.entries(value)) {
    if (
      BIG_SKILL_KEYS.includes(key as BigSkillKey) &&
      BIG_SKILL_STATE_OPTIONS.includes(state as BigSkillState)
    ) {
      normalized[key as BigSkillKey] = state as BigSkillState;
    }
  }

  return normalized;
}

export function normalizeMonthlyEvaluationConfirmationInput(
  input: MonthlyEvaluationConfirmationInput,
): MonthlyEvaluationConfirmationInput {
  return {
    month: ensureMonth(input.month),
    member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
    target_type: normalizeNonEmptyTrimmedString(
      input.target_type,
      "INVALID_CONFIRMATION_TARGET_TYPE",
    ) as ConfirmationTargetType,
    target_key: normalizeNonEmptyTrimmedString(
      input.target_key,
      "INVALID_CONFIRMATION_TARGET_KEY",
      MAX_TARGET_KEY_LENGTH,
    ),
    confirmation_status: normalizeNonEmptyTrimmedString(
      input.confirmation_status,
      "INVALID_CONFIRMATION_STATUS",
      MAX_TARGET_KEY_LENGTH,
    ) as ConfirmationStatus,
    comment: normalizeOptionalComment(input.comment),
  };
}

export function normalizeEvaluationFinalizeProposalInput(
  input: EvaluationFinalizeProposalInput,
): EvaluationFinalizeProposalInput {
  const confirmedStates = normalizeBigSkillStates(
    input.confirmed_states,
    "INVALID_CONFIRMED_STATES",
  );
  assert(Object.keys(confirmedStates).length > 0, "CONFIRMED_STATES_REQUIRED");

  return {
    month: ensureMonth(input.month),
    member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
    confirmed_states: confirmedStates,
    work_days: normalizeWorkDays(input.work_days),
    A: normalizeMonthlyRating(input.A, "INVALID_A_SCORE"),
    R: normalizeMonthlyRating(input.R, "INVALID_R_SCORE"),
    Q: normalizeMonthlyRating(input.Q, "INVALID_Q_SCORE"),
    current_level: normalizeOptionalPathLevel(input.current_level),
    comment: normalizeOptionalComment(input.comment),
  };
}

export function normalizeSkillCertificationProposalInput(
  input: SkillCertificationProposalInput,
): SkillCertificationProposalInput {
  const status = input.status ?? "verified";
  assert(
    PROFILE_CERTIFICATION_STATUS_OPTIONS.includes(status),
    "INVALID_CERTIFICATION_STATUS",
  );

  return {
    member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
    skill_key: normalizeNonEmptyTrimmedString(
      input.skill_key,
      "INVALID_SKILL_KEY",
      MAX_SKILL_KEY_LENGTH,
    ),
    category: normalizeNonEmptyTrimmedString(
      input.category,
      "INVALID_SKILL_CATEGORY",
      MAX_CATEGORY_LENGTH,
    ),
    status,
    evidence_count: normalizeEvidenceCount(input.evidence_count),
    last_site_id: normalizeOptionalUuid(input.last_site_id, "INVALID_LAST_SITE_ID"),
    note: normalizeOptionalComment(input.note),
    review_required_flag: Boolean(input.review_required_flag),
  };
}

export function normalizeMonthlyEvaluationFormInput(
  input: MonthlyEvaluationFormInput,
): MonthlyEvaluationFormInput {
  const reworkFlag = input.rework_flag ?? "none";
  assert(REWORK_FLAG_OPTIONS.includes(reworkFlag), "INVALID_REWORK_FLAG");

  const normalized: MonthlyEvaluationFormInput = {
    month: ensureMonth(input.month),
    member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
    selected_big_skill_states: normalizeBigSkillStates(input.selected_big_skill_states),
    selected_roles: dedupeStrings(input.selected_roles),
    site_ids: dedupeStrings(input.site_ids),
    photo_flag: Boolean(input.photo_flag),
    rework_flag: reworkFlag,
    comment: normalizeComment(input.comment),
  };

  return normalized;
}

export function normalizeMonthlyEvaluationAiReviewInput(
  input: MonthlyEvaluationAiReviewInput,
): MonthlyEvaluationAiReviewInput {
  const summary =
    typeof input.monthly_summary === "string" ? input.monthly_summary.trim() : "";
  assert(summary.length > 0, "MONTHLY_SUMMARY_REQUIRED");

  return {
    month: ensureMonth(input.month),
    member_id: ensureUuid(input.member_id, "INVALID_MEMBER_ID"),
    monthly_summary: summary,
    candidate_states: normalizeBigSkillStates(input.candidate_states, "INVALID_CANDIDATE_STATES"),
    candidate_skill_tags: dedupeStrings(input.candidate_skill_tags),
    profile_update_candidates: normalizeRecordArray(
      input.profile_update_candidates,
      "INVALID_PROFILE_UPDATE_CANDIDATES",
    ),
    promotion_candidate_flag: Boolean(input.promotion_candidate_flag),
    reasons: normalizeMixedArray(input.reasons, "INVALID_REASONS"),
    evidence_summary: normalizeMixedArray(input.evidence_summary, "INVALID_EVIDENCE_SUMMARY"),
    unknown_points: normalizeMixedArray(input.unknown_points, "INVALID_UNKNOWN_POINTS"),
    review_required_flag: Boolean(input.review_required_flag),
  };
}

export class PathEvaluationService {
  constructor(private readonly orgId: string) {}

  private mapExecutedFinalizeProposalToRow(
    proposal: {
      id: string;
      payload: Record<string, unknown> | null;
      executed_by: ActorRef | null;
      executed_at: string | null;
      updated_at?: string | null;
      created_at?: string | null;
    },
  ): MonthlyEvaluationFinalizationRow | null {
    if (!isPlainObject(proposal.payload)) {
      return null;
    }

    const payload = proposal.payload;
    const memberId =
      typeof payload.member_id === "string" && UUID_PATTERN.test(payload.member_id)
        ? payload.member_id
        : null;
    if (!memberId) {
      return null;
    }

    const finalizedAt = coerceFinalizedAt(
      proposal.executed_at,
      proposal.updated_at,
      proposal.created_at,
    );
    const month = coerceMonth(payload.month, finalizedAt);
    if (!month) {
      return null;
    }

    return {
      id: proposal.id,
      org_id: this.orgId,
      month,
      member_id: memberId,
      proposal_id: proposal.id,
      confirmed_big_skill_states: normalizeFallbackBigSkillStates(
        payload.confirmed_big_skill_states ?? payload.big_skill_states ?? payload.states,
      ),
      work_days: coerceNonNegativeInteger(payload.work_days ?? payload.workDays, 0),
      A: coerceMonthlyRating(payload.A ?? payload.a_score ?? payload.a, 1),
      R: coerceMonthlyRating(payload.R ?? payload.r_score ?? payload.r, 1),
      Q: coerceMonthlyRating(payload.Q ?? payload.q_score ?? payload.q, 1),
      current_level: PATH_LEVEL_OPTIONS.includes(payload.current_level as PathLevel)
        ? (payload.current_level as PathLevel)
        : null,
      comment: coerceTrimmedString(payload.comment ?? payload.reason_summary),
      finalized_by: proposal.executed_by ?? null,
      finalized_at: finalizedAt,
      updated_at: finalizedAt,
    };
  }

  private async listFinalizationsFromExecutedProposals(params?: {
    month?: string;
    member_id?: string;
    limit?: number;
  }): Promise<MonthlyEvaluationFinalizationRow[]> {
    const fallbackFetchLimit =
      typeof params?.limit === "number" ? Math.max(params.limit * 4, 50) : 200;

    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id, payload, executed_by, executed_at, updated_at, created_at")
      .eq("org_id", this.orgId)
      .eq("type", "evaluation.finalize")
      .eq("status", "executed")
      .order("executed_at", { ascending: false })
      .limit(fallbackFetchLimit);

    if (error) {
      throw new Error(
        `Failed to fetch monthly evaluation finalizations via proposal fallback: ${error.message}`,
      );
    }

    const latestByMemberMonth = new Map<string, MonthlyEvaluationFinalizationRow>();

    for (const proposal of (data ?? []) as Array<{
      id: string;
      payload: Record<string, unknown> | null;
      executed_by: ActorRef | null;
      executed_at: string | null;
      updated_at?: string | null;
      created_at?: string | null;
    }>) {
      const mapped = this.mapExecutedFinalizeProposalToRow(proposal);
      if (!mapped) {
        continue;
      }
      if (params?.month && mapped.month !== params.month) {
        continue;
      }
      if (params?.member_id && mapped.member_id !== params.member_id) {
        continue;
      }

      const dedupeKey = `${mapped.month}:${mapped.member_id}`;
      if (!latestByMemberMonth.has(dedupeKey)) {
        latestByMemberMonth.set(dedupeKey, mapped);
      }
    }

    const result = Array.from(latestByMemberMonth.values());
    return typeof params?.limit === "number" ? result.slice(0, params.limit) : result;
  }

  async upsertMonthlyForm(
    input: MonthlyEvaluationFormInput,
  ): Promise<MonthlyEvaluationFormRow> {
    const normalized = normalizeMonthlyEvaluationFormInput(input);

    const { data, error } = await supabaseAdmin
      .from("monthly_evaluation_forms")
      .upsert(
        {
          org_id: this.orgId,
          month: normalized.month,
          member_id: normalized.member_id,
          selected_big_skill_states: normalized.selected_big_skill_states,
          selected_roles: normalized.selected_roles,
          site_ids: normalized.site_ids,
          photo_flag: normalized.photo_flag,
          rework_flag: normalized.rework_flag,
          comment: normalized.comment,
          submitted_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,month,member_id" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save monthly evaluation form: ${error.message}`);
    }

    return data as MonthlyEvaluationFormRow;
  }

  async listMonthlyForms(params?: {
    month?: string;
    member_id?: string;
    limit?: number;
  }): Promise<MonthlyEvaluationFormRow[]> {
    let query = supabaseAdmin
      .from("monthly_evaluation_forms")
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
      throw new Error(`Failed to fetch monthly evaluation forms: ${error.message}`);
    }

    return (data ?? []) as MonthlyEvaluationFormRow[];
  }

  async upsertAiReview(
    input: MonthlyEvaluationAiReviewInput,
    generatedBy: ActorRef,
  ): Promise<MonthlyEvaluationAiReviewRow> {
    const normalized = normalizeMonthlyEvaluationAiReviewInput(input);

    const { data, error } = await supabaseAdmin
      .from("monthly_evaluation_ai_reviews")
      .upsert(
        {
          org_id: this.orgId,
          month: normalized.month,
          member_id: normalized.member_id,
          monthly_summary: normalized.monthly_summary,
          candidate_states: normalized.candidate_states,
          candidate_skill_tags: normalized.candidate_skill_tags,
          profile_update_candidates: normalized.profile_update_candidates,
          promotion_candidate_flag: normalized.promotion_candidate_flag,
          reasons: normalized.reasons,
          evidence_summary: normalized.evidence_summary,
          unknown_points: normalized.unknown_points,
          review_required_flag: normalized.review_required_flag,
          generated_by: generatedBy,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "org_id,month,member_id" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save monthly evaluation ai review: ${error.message}`);
    }

    return data as MonthlyEvaluationAiReviewRow;
  }

  async listAiReviews(params?: {
    month?: string;
    member_id?: string;
    review_required_flag?: boolean;
    limit?: number;
  }): Promise<MonthlyEvaluationAiReviewRow[]> {
    let query = supabaseAdmin
      .from("monthly_evaluation_ai_reviews")
      .select("*")
      .eq("org_id", this.orgId)
      .order("generated_at", { ascending: false });

    if (params?.month) {
      query = query.eq("month", ensureMonth(params.month));
    }
    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (typeof params?.review_required_flag === "boolean") {
      query = query.eq("review_required_flag", params.review_required_flag);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch monthly evaluation ai reviews: ${error.message}`);
    }

    return (data ?? []) as MonthlyEvaluationAiReviewRow[];
  }

  async upsertConfirmation(
    input: MonthlyEvaluationConfirmationInput,
    confirmedBy: ActorRef,
  ): Promise<MonthlyEvaluationConfirmationRow> {
    const normalized = normalizeMonthlyEvaluationConfirmationInput(input);
    assert(
      CONFIRMATION_TARGET_TYPE_OPTIONS.includes(normalized.target_type),
      "INVALID_CONFIRMATION_TARGET_TYPE",
    );
    assert(
      CONFIRMATION_STATUS_OPTIONS.includes(normalized.confirmation_status),
      "INVALID_CONFIRMATION_STATUS",
    );

    const now = new Date().toISOString();
    const { data, error } = await supabaseAdmin
      .from("monthly_evaluation_confirmations")
      .upsert(
        {
          org_id: this.orgId,
          month: normalized.month,
          member_id: normalized.member_id,
          target_type: normalized.target_type,
          target_key: normalized.target_key,
          confirmation_status: normalized.confirmation_status,
          comment: normalized.comment,
          confirmed_by: confirmedBy,
          confirmed_at: now,
          updated_at: now,
        },
        { onConflict: "org_id,month,member_id,target_type,target_key" },
      )
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to save monthly evaluation confirmation: ${error.message}`);
    }

    return data as MonthlyEvaluationConfirmationRow;
  }

  async listConfirmations(params?: {
    month?: string;
    member_id?: string;
    target_type?: ConfirmationTargetType;
    limit?: number;
  }): Promise<MonthlyEvaluationConfirmationRow[]> {
    let query = supabaseAdmin
      .from("monthly_evaluation_confirmations")
      .select("*")
      .eq("org_id", this.orgId)
      .order("confirmed_at", { ascending: false });

    if (params?.month) {
      query = query.eq("month", ensureMonth(params.month));
    }
    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (params?.target_type) {
      assert(
        CONFIRMATION_TARGET_TYPE_OPTIONS.includes(params.target_type),
        "INVALID_CONFIRMATION_TARGET_TYPE",
      );
      query = query.eq("target_type", params.target_type);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch monthly evaluation confirmations: ${error.message}`);
    }

    return (data ?? []) as MonthlyEvaluationConfirmationRow[];
  }

  async listSkillProfiles(params?: {
    member_id?: string;
    current_level?: PathLevel;
    limit?: number;
  }): Promise<MemberSkillProfileRow[]> {
    let query = supabaseAdmin
      .from("member_skill_profiles")
      .select("*")
      .eq("org_id", this.orgId)
      .order("updated_at", { ascending: false });

    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (params?.current_level) {
      assert(PATH_LEVEL_OPTIONS.includes(params.current_level), "INVALID_LEVEL");
      query = query.eq("current_level", params.current_level);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch member skill profiles: ${error.message}`);
    }

    return (data ?? []) as MemberSkillProfileRow[];
  }

  async listFinalizations(params?: {
    month?: string;
    member_id?: string;
    limit?: number;
  }): Promise<MonthlyEvaluationFinalizationRow[]> {
    const month = params?.month ? ensureMonth(params.month) : undefined;
    const memberId = params?.member_id
      ? ensureUuid(params.member_id, "INVALID_MEMBER_ID")
      : undefined;

    let query = supabaseAdmin
      .from("monthly_evaluation_finalizations")
      .select("*")
      .eq("org_id", this.orgId)
      .order("finalized_at", { ascending: false });

    if (month) {
      query = query.eq("month", month);
    }
    if (memberId) {
      query = query.eq("member_id", memberId);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingFinalizationsReadModel(error)) {
        console.warn(
          "[PATH_EVAL] monthly_evaluation_finalizations unavailable in schema cache; falling back to executed proposals",
        );
        return this.listFinalizationsFromExecutedProposals({
          month,
          member_id: memberId,
          limit: params?.limit,
        });
      }

      throw new Error(`Failed to fetch monthly evaluation finalizations: ${error.message}`);
    }

    return (data ?? []) as MonthlyEvaluationFinalizationRow[];
  }

  async listSkillCertifications(params?: {
    member_id?: string;
    skill_key?: string;
    status?: ProfileCertificationStatus;
    review_required_flag?: boolean;
    limit?: number;
  }): Promise<MemberSkillCertificationRow[]> {
    let query = supabaseAdmin
      .from("member_skill_certifications")
      .select("*")
      .eq("org_id", this.orgId)
      .order("verified_at", { ascending: false });

    if (params?.member_id) {
      query = query.eq("member_id", ensureUuid(params.member_id, "INVALID_MEMBER_ID"));
    }
    if (params?.skill_key) {
      query = query.eq(
        "skill_key",
        normalizeNonEmptyTrimmedString(params.skill_key, "INVALID_SKILL_KEY", MAX_SKILL_KEY_LENGTH),
      );
    }
    if (params?.status) {
      assert(
        PROFILE_CERTIFICATION_STATUS_OPTIONS.includes(params.status),
        "INVALID_CERTIFICATION_STATUS",
      );
      query = query.eq("status", params.status);
    }
    if (typeof params?.review_required_flag === "boolean") {
      query = query.eq("review_required_flag", params.review_required_flag);
    }
    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch member skill certifications: ${error.message}`);
    }

    return (data ?? []) as MemberSkillCertificationRow[];
  }

  buildFinalizeProposalPayload(
    input: EvaluationFinalizeProposalInput,
  ): Record<string, unknown> {
    const normalized = normalizeEvaluationFinalizeProposalInput(input);

    return {
      month: normalized.month,
      member_id: normalized.member_id,
      confirmed_big_skill_states: normalized.confirmed_states,
      work_days: normalized.work_days,
      A: normalized.A,
      R: normalized.R,
      Q: normalized.Q,
      current_level: normalized.current_level,
      comment: normalized.comment,
    };
  }

  buildSkillCertificationProposalPayload(
    input: SkillCertificationProposalInput,
  ): Record<string, unknown> {
    const normalized = normalizeSkillCertificationProposalInput(input);

    return {
      member_id: normalized.member_id,
      skill_key: normalized.skill_key,
      category: normalized.category,
      status: normalized.status,
      evidence_count: normalized.evidence_count,
      last_site_id: normalized.last_site_id,
      note: normalized.note,
      review_required_flag: normalized.review_required_flag,
    };
  }
}
