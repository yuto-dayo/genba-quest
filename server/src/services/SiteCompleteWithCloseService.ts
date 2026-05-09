import { createHash } from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { ActorRef, Proposal } from "./PolicyEngine";
import { ProposalService } from "./ProposalService";
import {
  CompleteSiteResult,
  ReverseSiteCompletionResult,
  SiteCompletionService,
  SiteRecord,
} from "./SiteCompletionService";
import { PathV31Service } from "./PathV31Service";

type DifficultyBand = "S1" | "S2" | "S3";
type ShareMode = "auto_points" | "fixed_template";
type OutcomeStatus = "ok" | "rework" | "unknown";
type SiteDayLogRoleType = "assist" | "lead" | "solo" | "support";
type ProposalStatus = "draft" | "pending" | "approved" | "rejected" | "executed";
type AttemptPhase =
  | "started"
  | "site_revenue_updated"
  | "site_completed"
  | "close_submitted"
  | "completed"
  | "failed"
  | "reversed"
  | "recovery_required";

export interface SiteCloseDraftInput {
  recognized_revenue: number;
  included_day_log_ids: string[];
  site_day_log_drafts?: SiteDayLogDraftInput[];
  material_cost: number;
  external_cost: number;
  direct_cost: number;
  overhead_allocated: number;
  known_rework_cost: number;
  approved_adjustments: number;
  difficulty_band: DifficultyBand;
  share_mode: ShareMode;
  fixed_template_key?: string | null;
  fixed_template_reason_code?: string | null;
  fixed_template_members?: Array<{
    member_id: string;
    share_ratio: number;
    role_type?: "assist" | "lead" | "solo" | "support";
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

export interface SiteDayLogDraftInput {
  date: string;
  member_id: string;
  role_type: SiteDayLogRoleType;
  credited_unit: number;
  trade_families?: unknown[];
  memo?: string;
}

export interface CompleteSiteWithCloseRequest extends SiteCloseDraftInput {
  client_request_id: string;
  effective_completed_at?: string;
  expected_site_updated_at?: string;
}

export interface SiteCloseProposalSummary {
  id: string;
  status: ProposalStatus;
  required_approvals: number;
  created_at: string;
  executed_at?: string | null;
}

export interface CompleteSiteWithCloseResult {
  site_id: string;
  site_completion_event_id: string | null;
  revenue_basis_id: string | null;
  income_proposal_id: string | null;
  idempotent: boolean;
  site: SiteRecord;
  close_proposal: SiteCloseProposalSummary;
  close_auto_approved: boolean;
  close_auto_executed: boolean;
  close_summary: Record<string, unknown>;
}

export interface CompleteSiteWithCloseHttpResponse {
  statusCode: number;
  body: CompleteSiteWithCloseResult | Record<string, unknown>;
}

interface AttemptRecord {
  id: string;
  org_id: string;
  site_id: string;
  client_request_id: string;
  payload_hash: string;
  phase: AttemptPhase;
  outcome?: "succeeded" | "failed" | "recovery_required" | null;
  prior_site_revenue?: number | null;
  site_completion_event_id?: string | null;
  revenue_basis_id?: string | null;
  income_proposal_id?: string | null;
  close_proposal_id?: string | null;
  reversal_event_id?: string | null;
  response_status?: number | null;
  response_json?: Record<string, unknown> | null;
  recovery_state?: Record<string, unknown> | null;
  last_error_code?: string | null;
  last_error_message?: string | null;
}

interface SiteRow extends SiteRecord {
  name?: string | null;
  revenue?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  expected_completion_at?: string | null;
  completed_at: string | null;
  assigned_users?: string[] | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_CLOSE_PROPOSAL_STATUSES = ["draft", "pending", "approved"] as const;
const COMPLETE_WITH_CLOSE_ERROR_STATUS_MAP: Record<string, number> = {
  CLIENT_REQUEST_ID_REQUIRED: 400,
  INVALID_RECOGNIZED_REVENUE: 400,
  INVALID_COMPLETE_WITH_CLOSE_REQUEST: 400,
  COMPLETE_WITH_CLOSE_REQUEST_SITE_MISMATCH: 400,
  INVALID_EXPECTED_SITE_UPDATED_AT: 400,
  INVALID_EFFECTIVE_COMPLETED_AT: 400,
  INVALID_SITE_ID: 400,
  DAY_LOGS_REQUIRED: 400,
  DAY_LOGS_NOT_FOUND: 404,
  DAY_LOG_SITE_MISMATCH: 409,
  SITE_DAY_LOGS_CONFLICT: 409,
  SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS: 409,
  SITE_COMPLETE_WITH_CLOSE_PAYLOAD_CONFLICT: 409,
  SITE_EXPECTED_VERSION_CONFLICT: 409,
  SITE_NOT_FOUND: 404,
  SITE_REVENUE_REQUIRED_FOR_AUTO_INCOME: 409,
  SITE_COMPLETION_ALREADY_ACTIVE: 409,
  SITE_COMPLETE_WITH_CLOSE_RECOVERY_REQUIRED: 500,
  SITE_COMPLETE_WITH_CLOSE_SUBMIT_FAILED: 500,
};
const KNOWN_SUBMIT_FAILURE_CODES = new Set([
  "SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS",
  "DAY_LOGS_REQUIRED",
  "DAY_LOGS_NOT_FOUND",
  "DAY_LOG_SITE_MISMATCH",
  "SITE_CLOSE_REOPEN_REQUIRED",
  "INVALID_FIXED_TEMPLATE_KEY",
  "INVALID_FIXED_TEMPLATE_RATIO_TOTAL",
  "FIXED_TEMPLATE_MEMBERS_REQUIRED",
  "FIXED_TEMPLATE_MEMBER_COUNT_MISMATCH",
  "INVALID_MONEY_VALUE",
  "INVALID_SITE_ID",
  "INVALID_REWORK_UNITS",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeMoney(value: unknown, errorCode: string): number {
  const numeric = parseNumeric(value);
  if (numeric === null) {
    throw new Error(errorCode);
  }
  return Math.round(numeric);
}

function normalizeOptionalTimestamp(value: unknown, errorCode: string): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(errorCode);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(errorCode);
  }
  return parsed.toISOString();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function getErrorCode(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string" && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return "SITE_COMPLETE_WITH_CLOSE_SUBMIT_FAILED";
}

function normalizeIncludedDayLogIds(value: unknown): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error("DAY_LOGS_REQUIRED");
  }
  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => UUID_PATTERN.test(entry));
  return Array.from(new Set(normalized));
}

function normalizeRoleType(value: unknown): SiteDayLogRoleType {
  return value === "lead" || value === "solo" || value === "assist" || value === "support"
    ? value
    : "support";
}

function normalizeDateOnly(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10);
}

function normalizeSiteDayLogDrafts(value: unknown): SiteDayLogDraftInput[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error("INVALID_COMPLETE_WITH_CLOSE_REQUEST");
  }

  const drafts = value
    .map((entry): SiteDayLogDraftInput | null => {
      if (!isRecord(entry)) {
        return null;
      }
      const date = normalizeDateOnly(entry.date);
      const memberId = typeof entry.member_id === "string" ? entry.member_id.trim() : "";
      if (!date || !UUID_PATTERN.test(memberId)) {
        return null;
      }
      const creditedUnit = parseNumeric(entry.credited_unit);
      return {
        date,
        member_id: memberId,
        role_type: normalizeRoleType(entry.role_type),
        credited_unit: creditedUnit !== null && creditedUnit > 0 ? creditedUnit : 1,
        trade_families: Array.isArray(entry.trade_families) ? entry.trade_families : [],
        memo: typeof entry.memo === "string" ? entry.memo : "",
      };
    })
    .filter((entry): entry is SiteDayLogDraftInput => entry !== null);

  return drafts.length > 0 ? drafts : undefined;
}

function buildCloseSummary(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    site_id: payload.site_id ?? null,
    included_day_log_ids: Array.isArray(payload.included_day_log_ids) ? payload.included_day_log_ids : [],
    recognized_revenue: payload.recognized_revenue ?? 0,
    distributable_profit: payload.distributable_profit ?? 0,
    difficulty_band: payload.difficulty_band ?? null,
    share_mode: payload.share_mode ?? null,
    closed_at: payload.closed_at ?? null,
    calculation_snapshot: payload.calculation_snapshot ?? {},
  };
}

export class SiteCompleteWithCloseService {
  private readonly proposalService: ProposalService;
  private readonly siteCompletionService: SiteCompletionService;
  private readonly pathV31Service: PathV31Service;

  constructor(private readonly orgId: string) {
    this.proposalService = new ProposalService(orgId);
    this.siteCompletionService = new SiteCompletionService(orgId);
    this.pathV31Service = new PathV31Service(orgId);
  }

  async execute(
    siteId: string,
    rawInput: Record<string, unknown>,
    actor: ActorRef,
    membershipId?: string | null,
  ): Promise<CompleteSiteWithCloseHttpResponse> {
    const normalizedSiteId = this.ensureUuid(siteId, "INVALID_SITE_ID");
    const input = this.normalizeInput(normalizedSiteId, rawInput);
    const payloadHash = createHash("sha256")
      .update(
        stableStringify({
          site_id: normalizedSiteId,
          ...input,
        }),
      )
      .digest("hex");
    const closeProposalIdempotencyKey = this.buildCloseProposalIdempotencyKey(
      normalizedSiteId,
      input.client_request_id,
    );

    const attemptResult = await this.getOrCreateAttempt({
      siteId: normalizedSiteId,
      clientRequestId: input.client_request_id,
      payloadHash,
    });
    if (attemptResult.response) {
      return attemptResult.response;
    }

    let attempt = attemptResult.attempt;
    const existingProposal = await this.findProposalByIdempotencyKey(closeProposalIdempotencyKey);
    if (existingProposal) {
      const existingSite = await this.fetchSite(normalizedSiteId);
      return this.finalizeAttemptWithProposal(attempt, existingSite, existingProposal, true);
    }

    let site: SiteRow;
    try {
      site = await this.fetchSite(normalizedSiteId);
      this.assertExpectedSiteVersion(site, input.expected_site_updated_at);
      await this.assertNoCompetingCloseProposal(normalizedSiteId);
      if (input.included_day_log_ids.length === 0) {
        input.included_day_log_ids = await this.supplementDayLogsForClose(site, input, actor);
      }
      if (input.included_day_log_ids.length === 0) {
        throw new Error("DAY_LOGS_REQUIRED");
      }
      const eligibleDayLogIds = await this.fetchEligibleDayLogIds(normalizedSiteId);
      this.assertIncludedDayLogsStillEligible(input.included_day_log_ids, eligibleDayLogIds);
    } catch (validationError) {
      const errorCode = getErrorCode(validationError);
      if (errorCode === "SITE_DAY_LOGS_CONFLICT") {
        const eligibleDayLogIds = await this.fetchEligibleDayLogIds(normalizedSiteId).catch(() => []);
        return this.recordAttemptResponse(
          attempt.id,
          409,
          {
            error: "SITE_DAY_LOGS_CONFLICT",
            blocking_reason: "eligible_day_logs_changed",
            eligible_day_log_ids: eligibleDayLogIds,
          },
          "failed",
          "failed",
          {
            last_error_code: errorCode,
            last_error_message: errorCode,
          },
        );
      }

      const statusCode = COMPLETE_WITH_CLOSE_ERROR_STATUS_MAP[errorCode] ?? 500;
      return this.recordAttemptResponse(
        attempt.id,
        statusCode,
        {
          error:
            errorCode in COMPLETE_WITH_CLOSE_ERROR_STATUS_MAP
              ? errorCode
              : "SITE_COMPLETE_WITH_CLOSE_SUBMIT_FAILED",
        },
        "failed",
        "failed",
        {
          last_error_code: errorCode,
          last_error_message: errorCode,
        },
      );
    }

    if (attempt.phase === "started" && attempt.prior_site_revenue == null) {
      attempt = await this.updateAttempt(attempt.id, {
        prior_site_revenue: parseNumeric(site.revenue) ?? 0,
      });
    }

    if (attempt.phase === "started") {
      await this.updateSiteRevenue(normalizedSiteId, input.recognized_revenue);
      attempt = await this.updateAttempt(attempt.id, {
        phase: "site_revenue_updated",
      });
    }

    let completionResult: CompleteSiteResult;
    if (attempt.phase === "site_completed" && attempt.site_completion_event_id) {
      completionResult = await this.loadCompletionResultFromAttempt(normalizedSiteId, attempt);
    } else {
      completionResult = await this.siteCompletionService.completeSite({
        siteId: normalizedSiteId,
        actorUserId: actor.id,
        membershipId: membershipId ?? null,
        effectiveCompletedAt: input.effective_completed_at,
      });
      attempt = await this.updateAttempt(attempt.id, {
        phase: "site_completed",
        site_completion_event_id: completionResult.site_completion_event_id,
        revenue_basis_id: completionResult.revenue_basis_id,
        income_proposal_id: completionResult.income_proposal_id,
      });
    }

    try {
      const payload = await this.pathV31Service.buildSiteCloseProposalPayload(
        {
          site_id: normalizedSiteId,
          included_day_log_ids: input.included_day_log_ids,
          recognized_revenue: input.recognized_revenue,
          material_cost: input.material_cost,
          external_cost: input.external_cost,
          direct_cost: input.direct_cost,
          overhead_allocated: input.overhead_allocated,
          known_rework_cost: input.known_rework_cost,
          approved_adjustments: input.approved_adjustments,
          difficulty_band: input.difficulty_band,
          share_mode: input.share_mode,
          fixed_template_key: input.fixed_template_key ?? null,
          fixed_template_reason_code: input.fixed_template_reason_code ?? null,
          fixed_template_members: input.fixed_template_members,
          outcome_snapshots: input.outcome_snapshots,
          closed_at: input.closed_at,
        },
        actor,
      );

      payload.origin_request_id = input.client_request_id;
      payload.recognized_revenue_locked = true;

      const submitResult = await this.proposalService.createAndSubmit({
        type: "site.close.finalize",
        description: `PATH site close ${normalizedSiteId.slice(0, 8)}`,
        payload,
        created_by: actor,
        org_id: this.orgId,
        site_id: normalizedSiteId,
        idempotency_key: closeProposalIdempotencyKey,
      });

      attempt = await this.updateAttempt(attempt.id, {
        phase: submitResult.proposal.status === "executed" ? "completed" : "close_submitted",
        close_proposal_id: submitResult.proposal.id,
      });

      const response = this.buildSuccessResponse(
        completionResult,
        this.decorateSiteWithClosePhase(
          completionResult.site,
          submitResult.autoExecuted ? "completed_close_executed" : "completed_close_pending",
        ),
        submitResult.proposal,
        submitResult.autoApproved,
        submitResult.autoExecuted,
      );

      return this.recordAttemptResponse(attempt.id, 200, response, "completed", "succeeded");
    } catch (submitError) {
      const recoveredProposal = await this.findProposalByIdempotencyKey(closeProposalIdempotencyKey).catch(
        () => null,
      );
      if (recoveredProposal) {
        const currentSite = await this.fetchSite(normalizedSiteId);
        return this.finalizeAttemptWithProposal(attempt, currentSite, recoveredProposal, true);
      }

      const compensationResult = await this.compensateFailedSubmission(
        normalizedSiteId,
        attempt,
        actor.id,
        membershipId ?? null,
      );
      if (!compensationResult.ok) {
        return this.recordAttemptResponse(
          attempt.id,
          500,
          {
            error: "SITE_COMPLETE_WITH_CLOSE_RECOVERY_REQUIRED",
          },
          "recovery_required",
          "recovery_required",
          {
            recovery_state: {
              stage: "close_submit",
              submit_error: getErrorCode(submitError),
              compensation_error: compensationResult.errorCode ?? "UNKNOWN_ERROR",
            },
            last_error_code: "SITE_COMPLETE_WITH_CLOSE_RECOVERY_REQUIRED",
            last_error_message: compensationResult.errorCode ?? "UNKNOWN_ERROR",
          },
        );
      }

      const errorCode = getErrorCode(submitError);
      const statusCode = COMPLETE_WITH_CLOSE_ERROR_STATUS_MAP[errorCode] ?? 500;
      return this.recordAttemptResponse(
        attempt.id,
        statusCode,
        {
          error:
            KNOWN_SUBMIT_FAILURE_CODES.has(errorCode) || COMPLETE_WITH_CLOSE_ERROR_STATUS_MAP[errorCode]
              ? errorCode
              : "SITE_COMPLETE_WITH_CLOSE_SUBMIT_FAILED",
        },
        "reversed",
        "failed",
        {
          reversal_event_id: compensationResult.reversalEventId ?? null,
          last_error_code: errorCode,
          last_error_message: errorCode,
        },
      );
    }
  }

  private normalizeInput(siteId: string, rawInput: Record<string, unknown>): CompleteSiteWithCloseRequest {
    const requestSiteId =
      typeof rawInput.site_id === "string" && rawInput.site_id.trim().length > 0 ? rawInput.site_id.trim() : siteId;
    if (requestSiteId !== siteId) {
      throw new Error("COMPLETE_WITH_CLOSE_REQUEST_SITE_MISMATCH");
    }

    const clientRequestId =
      typeof rawInput.client_request_id === "string" ? rawInput.client_request_id.trim() : "";
    if (!clientRequestId) {
      throw new Error("CLIENT_REQUEST_ID_REQUIRED");
    }

    return {
      client_request_id: clientRequestId,
      effective_completed_at: normalizeOptionalTimestamp(
        rawInput.effective_completed_at,
        "INVALID_EFFECTIVE_COMPLETED_AT",
      ),
      expected_site_updated_at: normalizeOptionalTimestamp(
        rawInput.expected_site_updated_at,
        "INVALID_EXPECTED_SITE_UPDATED_AT",
      ),
      recognized_revenue: normalizeMoney(rawInput.recognized_revenue, "INVALID_RECOGNIZED_REVENUE"),
      included_day_log_ids: normalizeIncludedDayLogIds(rawInput.included_day_log_ids),
      site_day_log_drafts: normalizeSiteDayLogDrafts(rawInput.site_day_log_drafts),
      material_cost: normalizeMoney(rawInput.material_cost ?? 0, "INVALID_MONEY_VALUE"),
      external_cost: normalizeMoney(rawInput.external_cost ?? 0, "INVALID_MONEY_VALUE"),
      direct_cost: normalizeMoney(rawInput.direct_cost ?? 0, "INVALID_MONEY_VALUE"),
      overhead_allocated: normalizeMoney(rawInput.overhead_allocated ?? 0, "INVALID_MONEY_VALUE"),
      known_rework_cost: normalizeMoney(rawInput.known_rework_cost ?? 0, "INVALID_MONEY_VALUE"),
      approved_adjustments: normalizeMoney(rawInput.approved_adjustments ?? 0, "INVALID_MONEY_VALUE"),
      difficulty_band:
        rawInput.difficulty_band === "S2" || rawInput.difficulty_band === "S3" ? rawInput.difficulty_band : "S1",
      share_mode: rawInput.share_mode === "fixed_template" ? "fixed_template" : "auto_points",
      fixed_template_key:
        typeof rawInput.fixed_template_key === "string" && rawInput.fixed_template_key.trim().length > 0
          ? rawInput.fixed_template_key.trim()
          : null,
      fixed_template_reason_code:
        typeof rawInput.fixed_template_reason_code === "string" &&
        rawInput.fixed_template_reason_code.trim().length > 0
          ? rawInput.fixed_template_reason_code.trim()
          : null,
      fixed_template_members: Array.isArray(rawInput.fixed_template_members)
        ? (rawInput.fixed_template_members as CompleteSiteWithCloseRequest["fixed_template_members"])
        : undefined,
      outcome_snapshots: Array.isArray(rawInput.outcome_snapshots)
        ? (rawInput.outcome_snapshots as CompleteSiteWithCloseRequest["outcome_snapshots"])
        : undefined,
      closed_at: normalizeOptionalTimestamp(rawInput.closed_at, "INVALID_COMPLETE_WITH_CLOSE_REQUEST") ?? null,
    };
  }

  private buildCloseProposalIdempotencyKey(siteId: string, clientRequestId: string): string {
    return `site.close.finalize:${this.orgId}:${siteId}:${clientRequestId}`;
  }

  private ensureUuid(value: string, errorCode: string): string {
    if (!UUID_PATTERN.test(value)) {
      throw new Error(errorCode);
    }
    return value;
  }

  private async getOrCreateAttempt(input: {
    siteId: string;
    clientRequestId: string;
    payloadHash: string;
  }): Promise<{ attempt: AttemptRecord; response?: CompleteSiteWithCloseHttpResponse }> {
    const existing = await this.fetchAttempt(input.clientRequestId);
    if (existing) {
      if (existing.payload_hash !== input.payloadHash) {
        return {
          attempt: existing,
          response: {
            statusCode: 409,
            body: { error: "SITE_COMPLETE_WITH_CLOSE_PAYLOAD_CONFLICT" },
          },
        };
      }

      if (existing.response_status && existing.response_json) {
        return {
          attempt: existing,
          response: {
            statusCode: existing.response_status,
            body: existing.response_json,
          },
        };
      }

      return { attempt: existing };
    }

    const insertPayload = {
      org_id: this.orgId,
      site_id: input.siteId,
      client_request_id: input.clientRequestId,
      payload_hash: input.payloadHash,
      phase: "started",
      recovery_state: {},
    };

    const { data, error } = await supabaseAdmin
      .from("site_complete_with_close_attempts")
      .insert(insertPayload)
      .select("*")
      .single();

    if (error) {
      if (String(error.message ?? "").includes("duplicate key")) {
        const raced = await this.fetchAttempt(input.clientRequestId);
        if (raced) {
          if (raced.payload_hash !== input.payloadHash) {
            return {
              attempt: raced,
              response: {
                statusCode: 409,
                body: { error: "SITE_COMPLETE_WITH_CLOSE_PAYLOAD_CONFLICT" },
              },
            };
          }
          if (raced.response_status && raced.response_json) {
            return {
              attempt: raced,
              response: {
                statusCode: raced.response_status,
                body: raced.response_json,
              },
            };
          }
          return { attempt: raced };
        }
      }
      throw new Error(`Failed to create complete-with-close attempt: ${error.message}`);
    }

    return { attempt: data as AttemptRecord };
  }

  private async fetchAttempt(clientRequestId: string): Promise<AttemptRecord | null> {
    const { data, error } = await supabaseAdmin
      .from("site_complete_with_close_attempts")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("client_request_id", clientRequestId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch complete-with-close attempt: ${error.message}`);
    }

    return (data as AttemptRecord | null) ?? null;
  }

  private async updateAttempt(attemptId: string, patch: Record<string, unknown>): Promise<AttemptRecord> {
    const { data, error } = await supabaseAdmin
      .from("site_complete_with_close_attempts")
      .update({
        ...patch,
        updated_at: new Date().toISOString(),
      })
      .eq("id", attemptId)
      .eq("org_id", this.orgId)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to update complete-with-close attempt: ${error.message}`);
    }

    return data as AttemptRecord;
  }

  private async recordAttemptResponse(
    attemptId: string,
    statusCode: number,
    body: CompleteSiteWithCloseResult | Record<string, unknown>,
    phase: AttemptPhase,
    outcome: "succeeded" | "failed" | "recovery_required",
    extraPatch: Record<string, unknown> = {},
  ): Promise<CompleteSiteWithCloseHttpResponse> {
    await this.updateAttempt(attemptId, {
      phase,
      outcome,
      response_status: statusCode,
      response_json: body as Record<string, unknown>,
      ...extraPatch,
    });

    return {
      statusCode,
      body,
    };
  }

  private async fetchSite(siteId: string): Promise<SiteRow> {
    const { data, error } = await supabaseAdmin
      .from("sites")
      .select("*")
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

    return data as SiteRow;
  }

  private assertExpectedSiteVersion(site: SiteRow, expectedUpdatedAt?: string): void {
    if (!expectedUpdatedAt) {
      return;
    }

    if (site.updated_at && site.updated_at !== expectedUpdatedAt) {
      throw new Error("SITE_EXPECTED_VERSION_CONFLICT");
    }
  }

  private async assertNoCompetingCloseProposal(siteId: string): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("site_id", siteId)
      .eq("type", "site.close.finalize")
      .in("status", [...ACTIVE_CLOSE_PROPOSAL_STATUSES])
      .limit(1);

    if (error) {
      throw new Error(`Failed to fetch active site close proposals: ${error.message}`);
    }

    if (Array.isArray(data) && data.length > 0) {
      throw new Error("SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS");
    }
  }

  private async fetchEligibleDayLogIds(siteId: string): Promise<string[]> {
    const { data, error } = await supabaseAdmin
      .from("site_day_logs")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("site_id", siteId)
      .is("locked_by_site_close_id", null);

    if (error) {
      throw new Error(`Failed to fetch eligible day logs: ${error.message}`);
    }

    return (data ?? [])
      .map((row) => String(row.id ?? ""))
      .filter((value) => UUID_PATTERN.test(value));
  }

  private assertIncludedDayLogsStillEligible(requestedIds: string[], eligibleIds: string[]): void {
    const eligibleSet = new Set(eligibleIds);
    const allEligible = requestedIds.every((id) => eligibleSet.has(id));
    if (!allEligible) {
      throw new Error("SITE_DAY_LOGS_CONFLICT");
    }
  }

  private async supplementDayLogsForClose(
    site: SiteRow,
    input: CompleteSiteWithCloseRequest,
    actor: ActorRef,
  ): Promise<string[]> {
    const existingEligibleIds = await this.fetchEligibleDayLogIds(site.id);
    if (existingEligibleIds.length > 0) {
      return existingEligibleIds;
    }

    const drafts =
      input.site_day_log_drafts && input.site_day_log_drafts.length > 0
        ? input.site_day_log_drafts
        : await this.buildDayLogDraftsFromAssignments(site, input);

    const insertedIds: string[] = [];
    for (const draft of drafts) {
      const id = await this.upsertSupplementedDayLog(site.id, draft, actor);
      if (id) {
        insertedIds.push(id);
      }
    }

    return Array.from(new Set(insertedIds));
  }

  private async buildDayLogDraftsFromAssignments(
    site: SiteRow,
    input: CompleteSiteWithCloseRequest,
  ): Promise<SiteDayLogDraftInput[]> {
    const proposalDrafts = await this.fetchAssignmentProposalDayLogDrafts(site.id);
    if (proposalDrafts.length > 0) {
      return proposalDrafts;
    }

    const fallbackDate =
      normalizeDateOnly(input.effective_completed_at) ||
      normalizeDateOnly(site.completed_at) ||
      normalizeDateOnly(site.expected_completion_at) ||
      normalizeDateOnly(site.started_at) ||
      new Date().toISOString().slice(0, 10);
    const assignedUsers = Array.isArray(site.assigned_users)
      ? site.assigned_users.filter((value): value is string => UUID_PATTERN.test(String(value)))
      : [];

    return assignedUsers.map((memberId) => ({
      date: fallbackDate,
      member_id: memberId,
      role_type: "support",
      credited_unit: 1,
      trade_families: [],
      memo: "site_close_assignment_supplement",
    }));
  }

  private async fetchAssignmentProposalDayLogDrafts(siteId: string): Promise<SiteDayLogDraftInput[]> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id,payload,executed_at,created_at")
      .eq("org_id", this.orgId)
      .eq("type", "assignment.create")
      .in("status", ["approved", "executed"])
      .order("created_at", { ascending: true })
      .limit(500);

    if (error) {
      throw new Error(`Failed to fetch assignment proposals for day log supplement: ${error.message}`);
    }

    const drafts = new Map<string, SiteDayLogDraftInput>();
    ((data ?? []) as Array<Record<string, unknown>>).forEach((proposal) => {
      const payload = isRecord(proposal.payload) ? proposal.payload : {};
      const payloadSiteId =
        this.getPayloadString(payload, ["site_id", "siteId", "target_site_id"]) ||
        this.getPayloadString(proposal, ["site_id"]);
      if (payloadSiteId !== siteId) {
        return;
      }

      const date =
        normalizeDateOnly(payload.date) ||
        normalizeDateOnly(payload.due_date) ||
        normalizeDateOnly(payload.start_date) ||
        normalizeDateOnly(payload.recorded_date) ||
        normalizeDateOnly(proposal.executed_at) ||
        normalizeDateOnly(proposal.created_at);
      if (!date) {
        return;
      }

      this.extractWorkerIdsFromPayload(payload).forEach((memberId) => {
        const key = `${date}:${memberId}`;
        if (!drafts.has(key)) {
          drafts.set(key, {
            date,
            member_id: memberId,
            role_type: "support",
            credited_unit: 1,
            trade_families: [],
            memo: "site_close_assignment_supplement",
          });
        }
      });
    });

    return Array.from(drafts.values());
  }

  private getPayloadString(payload: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
      const value = payload[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private extractWorkerIdsFromPayload(payload: Record<string, unknown>): string[] {
    const directKeys = ["worker_id", "workerId", "user_id", "userId", "assignee_id", "member_id"];
    const arrayKeys = ["worker_ids", "workerIds", "user_ids", "userIds", "assignee_ids", "member_ids"];
    const collected: string[] = [];

    directKeys.forEach((key) => {
      const value = payload[key];
      if (typeof value === "string" && UUID_PATTERN.test(value)) {
        collected.push(value);
      }
    });

    arrayKeys.forEach((key) => {
      const value = payload[key];
      if (Array.isArray(value)) {
        value.forEach((id) => {
          if (typeof id === "string" && UUID_PATTERN.test(id)) {
            collected.push(id);
          }
        });
      }
    });

    const assignments = payload.assignments;
    if (Array.isArray(assignments)) {
      assignments.forEach((assignment) => {
        if (!isRecord(assignment)) {
          return;
        }
        const id = this.getPayloadString(assignment, ["worker_id", "workerId", "user_id", "userId", "assignee_id"]);
        if (id && UUID_PATTERN.test(id)) {
          collected.push(id);
        }
      });
    }

    return Array.from(new Set(collected));
  }

  private async upsertSupplementedDayLog(
    siteId: string,
    draft: SiteDayLogDraftInput,
    actor: ActorRef,
  ): Promise<string | null> {
    const payload = {
      org_id: this.orgId,
      date: draft.date,
      site_id: siteId,
      member_id: draft.member_id,
      trade_families: draft.trade_families ?? [],
      role_type: draft.role_type,
      credited_unit: draft.credited_unit,
      memo: draft.memo || `site_close_assignment_supplement:${actor.type}`,
    };

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("site_day_logs")
      .select("id,locked_by_site_close_id")
      .eq("org_id", this.orgId)
      .eq("date", draft.date)
      .eq("site_id", siteId)
      .eq("member_id", draft.member_id)
      .maybeSingle();

    if (existingError) {
      throw new Error(`Failed to fetch existing supplemented day log: ${existingError.message}`);
    }

    if (existing) {
      if ((existing as Record<string, unknown>).locked_by_site_close_id) {
        return null;
      }

      const { data, error } = await supabaseAdmin
        .from("site_day_logs")
        .update({
          trade_families: payload.trade_families,
          role_type: payload.role_type,
          credited_unit: payload.credited_unit,
          memo: payload.memo,
        })
        .eq("org_id", this.orgId)
        .eq("id", String((existing as Record<string, unknown>).id ?? ""))
        .select("id")
        .single();

      if (error) {
        throw new Error(`Failed to update supplemented day log: ${error.message}`);
      }

      return String((data as Record<string, unknown>).id ?? "");
    }

    const { data, error } = await supabaseAdmin.from("site_day_logs").insert(payload).select("id").single();
    if (error) {
      throw new Error(`Failed to insert supplemented day log: ${error.message}`);
    }

    return String((data as Record<string, unknown>).id ?? "");
  }

  private async updateSiteRevenue(siteId: string, revenue: number): Promise<void> {
    const { error } = await supabaseAdmin
      .from("sites")
      .update({
        revenue,
      })
      .eq("org_id", this.orgId)
      .eq("id", siteId)
      .is("deleted_at", null);

    if (error) {
      throw new Error(`Failed to update site revenue: ${error.message}`);
    }
  }

  private async rollbackSiteRevenue(siteId: string, priorRevenue?: number | null): Promise<void> {
    const { error } = await supabaseAdmin
      .from("sites")
      .update({
        revenue: priorRevenue ?? 0,
      })
      .eq("org_id", this.orgId)
      .eq("id", siteId)
      .is("deleted_at", null);

    if (error) {
      throw new Error(`Failed to rollback site revenue: ${error.message}`);
    }
  }

  private async loadCompletionResultFromAttempt(
    siteId: string,
    attempt: AttemptRecord,
  ): Promise<CompleteSiteResult> {
    const site = await this.fetchSite(siteId);
    return {
      site_id: siteId,
      site_completion_event_id: attempt.site_completion_event_id ?? null,
      revenue_basis_id: attempt.revenue_basis_id ?? null,
      income_proposal_id: attempt.income_proposal_id ?? null,
      idempotent: true,
      site,
    };
  }

  private async compensateFailedSubmission(
    siteId: string,
    attempt: AttemptRecord,
    actorUserId: string,
    membershipId?: string | null,
  ): Promise<{ ok: true; reversalEventId?: string | null } | { ok: false; errorCode?: string }> {
    try {
      let reversalResult: ReverseSiteCompletionResult | null = null;
      if (attempt.phase === "site_completed" || attempt.phase === "close_submitted" || attempt.site_completion_event_id) {
        reversalResult = await this.siteCompletionService.reverseSiteCompletion({
          siteId,
          actorUserId,
          membershipId: membershipId ?? null,
          reason: "complete_with_close_compensation",
        });
      }

      await this.rollbackSiteRevenue(siteId, attempt.prior_site_revenue ?? 0);

      await this.updateAttempt(attempt.id, {
        phase: "reversed",
        reversal_event_id: reversalResult?.reversal_event_id ?? null,
      });

      return {
        ok: true,
        reversalEventId: reversalResult?.reversal_event_id ?? null,
      };
    } catch (error) {
      return {
        ok: false,
        errorCode: getErrorCode(error),
      };
    }
  }

  private async findProposalByIdempotencyKey(idempotencyKey: string): Promise<Proposal | null> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch proposal by idempotency key: ${error.message}`);
    }

    return (data as Proposal | null) ?? null;
  }

  private buildSuccessResponse(
    completionResult: CompleteSiteResult,
    site: SiteRecord,
    proposal: Proposal,
    autoApproved: boolean,
    autoExecuted: boolean,
  ): CompleteSiteWithCloseResult {
    return {
      site_id: completionResult.site_id,
      site_completion_event_id: completionResult.site_completion_event_id,
      revenue_basis_id: completionResult.revenue_basis_id,
      income_proposal_id: completionResult.income_proposal_id,
      idempotent: completionResult.idempotent,
      site,
      close_proposal: {
        id: proposal.id,
        status: proposal.status,
        required_approvals: proposal.required_approvals,
        created_at: proposal.created_at,
        executed_at: proposal.executed_at ?? null,
      },
      close_auto_approved: autoApproved,
      close_auto_executed: autoExecuted,
      close_summary: buildCloseSummary(proposal.payload),
    };
  }

  private decorateSiteWithClosePhase(
    site: SiteRecord,
    closePhase:
      | "completed_close_pending"
      | "completed_close_executed"
      | "completed_unclosed"
      | "completed_close_rejected",
  ): SiteRecord {
    return {
      ...site,
      close_phase: closePhase,
    };
  }

  private async finalizeAttemptWithProposal(
    attempt: AttemptRecord,
    site: SiteRow,
    proposal: Proposal,
    replayedFromExistingProposal: boolean,
  ): Promise<CompleteSiteWithCloseHttpResponse> {
    const closeExecuted = proposal.status === "executed";
    const response = this.buildSuccessResponse(
      {
        site_id: site.id,
        site_completion_event_id: attempt.site_completion_event_id ?? null,
        revenue_basis_id: attempt.revenue_basis_id ?? null,
        income_proposal_id: attempt.income_proposal_id ?? null,
        idempotent: replayedFromExistingProposal,
        site,
      },
      this.decorateSiteWithClosePhase(
        site,
        closeExecuted ? "completed_close_executed" : "completed_close_pending",
      ),
      proposal,
      proposal.status === "approved" || proposal.status === "executed",
      closeExecuted,
    );

    return this.recordAttemptResponse(
      attempt.id,
      200,
      response,
      closeExecuted ? "completed" : "close_submitted",
      "succeeded",
      {
        close_proposal_id: proposal.id,
      },
    );
  }
}
