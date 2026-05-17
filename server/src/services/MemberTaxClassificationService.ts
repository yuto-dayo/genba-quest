import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import type { ActorRef, Proposal } from "./PolicyEngine";

export type MemberContractType = "subcontract" | "employee_like" | "undetermined";
export type TaxWithholdingCategory = "none" | "10.21%" | "custom";
export type ClassificationCheckStatus = "verified" | "review_needed" | "unset";

export type ClassificationCheckResults = {
  q1_substitution: boolean;
  q2_time_freedom: boolean;
  q3_work_autonomy: boolean;
  q4_own_tools: boolean;
  q5_outcome_liability: boolean;
};

export interface MemberTaxClassificationRecord {
  id: string;
  org_id: string;
  member_id: string;
  contract_type: MemberContractType;
  tax_withholding_category: TaxWithholdingCategory;
  custom_withholding_rate: number | null;
  classification_check_status: ClassificationCheckStatus;
  classification_check_results: ClassificationCheckResults;
  classification_notes: string | null;
  effective_from: string;
  effective_until: string | null;
  decided_by: string;
  decided_at: string;
  proposal_id: string | null;
  created_at: string;
}

export interface RecordClassificationPayload {
  orgId: string;
  memberId: string;
  contractType: MemberContractType;
  taxWithholdingCategory: TaxWithholdingCategory;
  customWithholdingRate?: number | null;
  classificationCheckResults: ClassificationCheckResults;
  classificationNotes?: string | null;
  effectiveFrom: string;
  proposalId?: string | null;
}

type MemberTaxClassificationClient = Pick<SupabaseClient, "from">;

const CONTRACT_TYPES = new Set<MemberContractType>(["subcontract", "employee_like", "undetermined"]);
const WITHHOLDING_CATEGORIES = new Set<TaxWithholdingCategory>(["none", "10.21%", "custom"]);
const CHECK_KEYS: Array<keyof ClassificationCheckResults> = [
  "q1_substitution",
  "q2_time_freedom",
  "q3_work_autonomy",
  "q4_own_tools",
  "q5_outcome_liability",
];

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function normalizeNotes(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function checkStatusFromResults(results: ClassificationCheckResults): ClassificationCheckStatus {
  const yesCount = CHECK_KEYS.filter((key) => results[key]).length;
  if (yesCount >= 4) {
    return "verified";
  }
  if (yesCount <= 2) {
    return "review_needed";
  }
  return "review_needed";
}

function toPayloadValue(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function parseCheckResults(value: unknown): ClassificationCheckResults {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("MEMBER_CLASSIFICATION_CHECK_RESULTS_REQUIRED");
  }

  const source = value as Record<string, unknown>;
  return CHECK_KEYS.reduce((acc, key) => {
    if (typeof source[key] !== "boolean") {
      throw new Error("MEMBER_CLASSIFICATION_CHECK_RESULTS_INVALID");
    }
    acc[key] = source[key];
    return acc;
  }, {} as ClassificationCheckResults);
}

export function buildClassificationPayloadFromProposal(proposal: Proposal): RecordClassificationPayload {
  const payload = proposal.payload || {};
  const memberId = toPayloadValue(payload, "member_id");
  const contractType = toPayloadValue(payload, "contract_type") as MemberContractType | null;
  const taxWithholdingCategory = (toPayloadValue(payload, "tax_withholding_category") || "none") as TaxWithholdingCategory;
  const effectiveFrom = toPayloadValue(payload, "effective_from");

  if (!memberId) {
    throw new Error("MEMBER_CLASSIFICATION_MEMBER_REQUIRED");
  }
  if (!contractType || !CONTRACT_TYPES.has(contractType)) {
    throw new Error("MEMBER_CLASSIFICATION_CONTRACT_TYPE_INVALID");
  }
  if (!WITHHOLDING_CATEGORIES.has(taxWithholdingCategory)) {
    throw new Error("MEMBER_CLASSIFICATION_WITHHOLDING_INVALID");
  }
  if (!effectiveFrom || !isIsoDate(effectiveFrom)) {
    throw new Error("MEMBER_CLASSIFICATION_EFFECTIVE_FROM_INVALID");
  }

  const customRate = payload.custom_withholding_rate;
  return {
    orgId: proposal.org_id,
    memberId,
    contractType,
    taxWithholdingCategory,
    customWithholdingRate: typeof customRate === "number" ? customRate : null,
    classificationCheckResults: parseCheckResults(payload.classification_check_results),
    classificationNotes: normalizeNotes(toPayloadValue(payload, "classification_notes")),
    effectiveFrom,
    proposalId: proposal.id,
  };
}

export class MemberTaxClassificationService {
  constructor(
    private readonly client: MemberTaxClassificationClient = supabaseAdmin as unknown as MemberTaxClassificationClient,
  ) {}

  async getActive(input: {
    orgId: string;
    memberId: string;
    asOf?: string | null;
  }): Promise<MemberTaxClassificationRecord | null> {
    const asOf = input.asOf || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(asOf)) {
      throw new Error("MEMBER_CLASSIFICATION_AS_OF_INVALID");
    }

    const { data, error } = await this.client
      .from("member_tax_classifications")
      .select("*")
      .eq("org_id", input.orgId)
      .eq("member_id", input.memberId)
      .lte("effective_from", asOf)
      .or(`effective_until.is.null,effective_until.gt.${asOf}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load member tax classification: ${error.message}`);
    }

    return (data || null) as MemberTaxClassificationRecord | null;
  }

  async getHistory(input: {
    orgId: string;
    memberId: string;
  }): Promise<MemberTaxClassificationRecord[]> {
    const { data, error } = await this.client
      .from("member_tax_classifications")
      .select("*")
      .eq("org_id", input.orgId)
      .eq("member_id", input.memberId)
      .order("effective_from", { ascending: false });

    if (error) {
      throw new Error(`Failed to load member tax classification history: ${error.message}`);
    }

    return (data || []) as MemberTaxClassificationRecord[];
  }

  async recordClassification(
    payload: RecordClassificationPayload,
    actor: ActorRef,
  ): Promise<{ classification: MemberTaxClassificationRecord; alreadyExisted: boolean }> {
    this.validateRecordPayload(payload, actor);

    if (payload.proposalId) {
      const existingByProposal = await this.findByProposalId(payload.orgId, payload.proposalId);
      if (existingByProposal) {
        return { classification: existingByProposal, alreadyExisted: true };
      }
    }

    await this.assertMemberInOrg(payload.orgId, payload.memberId);

    const closeResult = await this.client
      .from("member_tax_classifications")
      .update({ effective_until: payload.effectiveFrom })
      .eq("org_id", payload.orgId)
      .eq("member_id", payload.memberId)
      .is("effective_until", null)
      .lt("effective_from", payload.effectiveFrom);

    if (closeResult.error) {
      throw new Error(`Failed to close active member tax classification: ${closeResult.error.message}`);
    }

    const insertRow = {
      org_id: payload.orgId,
      member_id: payload.memberId,
      contract_type: payload.contractType,
      tax_withholding_category: payload.taxWithholdingCategory,
      custom_withholding_rate: payload.taxWithholdingCategory === "custom" ? payload.customWithholdingRate ?? null : null,
      classification_check_status: checkStatusFromResults(payload.classificationCheckResults),
      classification_check_results: payload.classificationCheckResults,
      classification_notes: normalizeNotes(payload.classificationNotes),
      effective_from: payload.effectiveFrom,
      effective_until: null,
      decided_by: actor.id,
      proposal_id: payload.proposalId ?? null,
    };

    const { data, error } = await this.client
      .from("member_tax_classifications")
      .insert(insertRow)
      .select("*")
      .single();

    if (error) {
      throw new Error(`Failed to record member tax classification: ${error.message}`);
    }

    return { classification: data as MemberTaxClassificationRecord, alreadyExisted: false };
  }

  private validateRecordPayload(payload: RecordClassificationPayload, actor: ActorRef): void {
    if (actor.type !== "human" && actor.type !== "system") {
      throw new Error("MEMBER_CLASSIFICATION_ACTOR_INVALID");
    }
    if (!payload.orgId || !payload.memberId) {
      throw new Error("MEMBER_CLASSIFICATION_MEMBER_REQUIRED");
    }
    if (!CONTRACT_TYPES.has(payload.contractType)) {
      throw new Error("MEMBER_CLASSIFICATION_CONTRACT_TYPE_INVALID");
    }
    if (!WITHHOLDING_CATEGORIES.has(payload.taxWithholdingCategory)) {
      throw new Error("MEMBER_CLASSIFICATION_WITHHOLDING_INVALID");
    }
    if (payload.taxWithholdingCategory === "custom") {
      const rate = payload.customWithholdingRate;
      if (typeof rate !== "number" || rate < 0 || rate > 1) {
        throw new Error("MEMBER_CLASSIFICATION_CUSTOM_RATE_INVALID");
      }
    }
    if (!isIsoDate(payload.effectiveFrom)) {
      throw new Error("MEMBER_CLASSIFICATION_EFFECTIVE_FROM_INVALID");
    }
    parseCheckResults(payload.classificationCheckResults);
  }

  private async findByProposalId(orgId: string, proposalId: string): Promise<MemberTaxClassificationRecord | null> {
    const { data, error } = await this.client
      .from("member_tax_classifications")
      .select("*")
      .eq("org_id", orgId)
      .eq("proposal_id", proposalId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load member tax classification by proposal: ${error.message}`);
    }

    return (data || null) as MemberTaxClassificationRecord | null;
  }

  private async assertMemberInOrg(orgId: string, memberId: string): Promise<void> {
    const { data, error } = await this.client
      .from("org_memberships")
      .select("user_id,status")
      .eq("org_id", orgId)
      .eq("user_id", memberId)
      .eq("status", "active")
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to verify member org boundary: ${error.message}`);
    }
    if (!data) {
      throw new Error("MEMBER_CLASSIFICATION_MEMBER_NOT_IN_ORG");
    }
  }
}

export const memberTaxClassificationService = new MemberTaxClassificationService();

