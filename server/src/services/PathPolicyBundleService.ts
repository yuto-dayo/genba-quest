import crypto from "crypto";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { ActorRef } from "./PolicyEngine";

export const PATH_POLICY_BUNDLE_KEY = "path_core_v22";
export const PATH_POLICY_VERSION = "2.2.0";
export const PATH_POLICY_REVISION = 1;

export const PATH_TRADE_FAMILIES = [
  "wall_finish",
  "floor_finish",
  "substrate_preparation",
  "decorative_sheet_or_film",
  "common_site_operations",
] as const;

export const PATH_SKILL_STATUS_OPTIONS = [
  "unverified",
  "assist_required",
  "conditional",
  "near_independent",
  "stable_independent",
] as const;

export const PATH_CONFIDENCE_CLASS_OPTIONS = ["low", "medium", "high"] as const;
export const PATH_FRESHNESS_STATUS_OPTIONS = ["current", "stale_review_required"] as const;
export const PATH_RESTRICTION_LEVEL_OPTIONS = [
  "none",
  "observe_only",
  "support_required",
  "blocked",
] as const;
export const PATH_OPPORTUNITY_STATUS_TYPES = [
  "not_observed",
  "opportunity_not_granted",
  "recheck_required",
  "observed",
] as const;

export type PathTradeFamily = (typeof PATH_TRADE_FAMILIES)[number];
export type PathSkillStatus = (typeof PATH_SKILL_STATUS_OPTIONS)[number];

export interface PathPolicyBundle {
  id: string;
  org_id: string;
  bundle_key: string;
  version: string;
  revision: number;
  effective_from: string;
  status: "draft" | "active" | "retired";
  fingerprint: string;
  policy_constants: Record<string, unknown>;
  authority_matrix: Record<string, unknown>;
  risk_rules: Record<string, unknown>;
  auto_approval_rules: Record<string, unknown>;
  published_proposal_id: string | null;
  created_by: ActorRef | null;
  created_at: string;
  updated_at: string;
}

export interface PublishPathPolicyBundleInput {
  effective_from: string;
  version?: string;
  revision?: number;
  policy_constants?: Record<string, unknown>;
  authority_matrix?: Record<string, unknown>;
  risk_rules?: Record<string, unknown>;
  auto_approval_rules?: Record<string, unknown>;
}

function normalizeMonthToDate(monthOrDate: string): string {
  if (/^\d{4}-\d{2}$/.test(monthOrDate)) {
    return `${monthOrDate}-01`;
  }
  return monthOrDate;
}

export function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return `{${entries
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableJsonStringify(nested)}`)
    .join(",")}}`;
}

export function hashStableRecord(value: unknown): string {
  return crypto.createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

export function buildDefaultPathPolicyConstants(): Record<string, unknown> {
  return {
    LEVEL_COEFFICIENTS: {
      L1: 0.85,
      L2: 1.0,
      L3: 1.15,
      L4: 1.3,
      L5: 1.45,
    },
    MONTHLY_COEFFICIENT_RULES: [
      { min: 0, max: 1, coefficient: 0.9 },
      { min: 2, max: 4, coefficient: 1.0 },
      { min: 5, max: 6, coefficient: 1.1 },
    ],
    BASE_POOL_RATE: 0.85,
    VARIABLE_POOL_RATE: 0.15,
    DIFFICULTY_COEFFICIENTS: {
      S1: 1.0,
      S2: 1.15,
      S3: 1.3,
    },
    FAMILY_COEFFICIENTS: Object.fromEntries(PATH_TRADE_FAMILIES.map((family) => [family, 1.0])),
    ROLE_COEFFICIENTS: {
      lead: 1.0,
      support: 0.75,
      teaching: 0.9,
    },
    QUALITY_GATE_COEFFICIENTS: {
      pass: 1.0,
      minor_fix: 0.95,
      major_fix: 0.8,
    },
    BIG_SKILL_STATE_OPTIONS: PATH_SKILL_STATUS_OPTIONS,
    PROFILE_CERTIFICATION_STATUS_OPTIONS: PATH_SKILL_STATUS_OPTIONS,
    EVIDENCE_CLASS_TYPES: [
      "human_confirmation",
      "performance_evidence",
      "quality_evidence",
      "record_evidence",
      "repeatability_evidence",
      "ai_annotation",
    ],
    OPPORTUNITY_STATUS_TYPES: PATH_OPPORTUNITY_STATUS_TYPES,
  };
}

export function buildDefaultAuthorityMatrix(): Record<string, unknown> {
  return {
    low_risk_skill_reviewer: ["leader", "manager", "admin"],
    high_risk_skill_reviewer: ["manager", "admin"],
    level_reviewer: ["manager", "admin"],
    trainer_authority: ["leader", "manager", "admin"],
  };
}

export function buildDefaultRiskRules(): Record<string, unknown> {
  return {
    high_risk_skill_statuses: ["stable_independent"],
    high_risk_trade_families: ["decorative_sheet_or_film"],
    manual_required_decisions: [
      "evaluation.finalize",
      "reward.calculate",
      "reward.adjust",
      "reward.pool.adjust",
      "path.level.update",
      "skill.achieve:stable_independent",
      "policy.update",
    ],
    close_period_immutability: {
      deny_direct_rewrite: true,
      require_next_period_adjustment: true,
    },
  };
}

export function buildDefaultAutoApprovalRules(): Record<string, unknown> {
  return {
    AUTO_APPROVAL_RULES: {
      low_risk_annotations: false,
      monthly_form_submission: false,
    },
    AUTO_APPROVAL_DISALLOW_CONDITIONS: [
      "stable_independent",
      "high_risk_trade_family",
      "closed_period_adjustment",
      "authority_change",
      "level_change",
    ],
  };
}

export function buildDefaultPathPolicyBundle(orgId: string): PathPolicyBundle {
  const policy_constants = buildDefaultPathPolicyConstants();
  const authority_matrix = buildDefaultAuthorityMatrix();
  const risk_rules = buildDefaultRiskRules();
  const auto_approval_rules = buildDefaultAutoApprovalRules();
  const fingerprint = hashStableRecord({
    bundle_key: PATH_POLICY_BUNDLE_KEY,
    version: PATH_POLICY_VERSION,
    revision: PATH_POLICY_REVISION,
    policy_constants,
    authority_matrix,
    risk_rules,
    auto_approval_rules,
  });

  return {
    id: `fallback:${fingerprint}`,
    org_id: orgId,
    bundle_key: PATH_POLICY_BUNDLE_KEY,
    version: PATH_POLICY_VERSION,
    revision: PATH_POLICY_REVISION,
    effective_from: "2026-04-01",
    status: "active",
    fingerprint,
    policy_constants,
    authority_matrix,
    risk_rules,
    auto_approval_rules,
    published_proposal_id: null,
    created_by: {
      type: "system",
      id: "path-policy-fallback",
      name: "PATH Policy Fallback",
    },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  };
}

export class PathPolicyBundleService {
  constructor(private readonly orgId: string) {}

  async listBundles(params?: { activeOnly?: boolean; limit?: number }): Promise<PathPolicyBundle[]> {
    let query = supabaseAdmin
      .from("policy_bundle_versions")
      .select("*")
      .eq("org_id", this.orgId)
      .order("effective_from", { ascending: false })
      .order("revision", { ascending: false });

    if (params?.activeOnly) {
      query = query.eq("status", "active");
    }

    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch policy bundles: ${error.message}`);
    }

    return (data ?? []) as PathPolicyBundle[];
  }

  async resolveActiveBundle(effectiveMonth?: string): Promise<PathPolicyBundle> {
    const effectiveFrom = effectiveMonth ? normalizeMonthToDate(effectiveMonth) : undefined;

    let query = supabaseAdmin
      .from("policy_bundle_versions")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("bundle_key", PATH_POLICY_BUNDLE_KEY)
      .eq("status", "active")
      .order("effective_from", { ascending: false })
      .order("revision", { ascending: false })
      .limit(1);

    if (effectiveFrom) {
      query = query.lte("effective_from", effectiveFrom);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to resolve active PATH policy bundle: ${error.message}`);
    }

    const row = Array.isArray(data) ? data[0] : null;
    return (row as PathPolicyBundle | null) ?? buildDefaultPathPolicyBundle(this.orgId);
  }

  buildPublishPayload(
    input: PublishPathPolicyBundleInput,
    actor: ActorRef,
  ): Record<string, unknown> {
    const policy_constants = input.policy_constants ?? buildDefaultPathPolicyConstants();
    const authority_matrix = input.authority_matrix ?? buildDefaultAuthorityMatrix();
    const risk_rules = input.risk_rules ?? buildDefaultRiskRules();
    const auto_approval_rules = input.auto_approval_rules ?? buildDefaultAutoApprovalRules();
    const version = input.version ?? PATH_POLICY_VERSION;
    const revision = input.revision ?? PATH_POLICY_REVISION;
    const effective_from = normalizeMonthToDate(input.effective_from);
    const fingerprint = hashStableRecord({
      bundle_key: PATH_POLICY_BUNDLE_KEY,
      version,
      revision,
      policy_constants,
      authority_matrix,
      risk_rules,
      auto_approval_rules,
    });

    return {
      module: "path",
      bundle_key: PATH_POLICY_BUNDLE_KEY,
      version,
      revision,
      effective_from,
      fingerprint,
      policy_constants,
      authority_matrix,
      risk_rules,
      auto_approval_rules,
      published_by: actor,
    };
  }
}
