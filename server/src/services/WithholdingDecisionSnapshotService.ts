import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import {
  ClassificationCheckResults,
  MemberContractType,
  MemberTaxClassificationRecord,
  TaxWithholdingCategory,
} from "./MemberTaxClassificationService";
import type { InvoiceRegistrationStatus } from "../lib/transitional-deduction";

type WithholdingSnapshotClient = Pick<SupabaseClient, "from">;

export interface TaxWithholdingDecisionSnapshot {
  decided_at: string;
  decided_by: string;
  classification_id_used: string;
  contract_type: MemberContractType;
  tax_withholding_category: TaxWithholdingCategory;
  custom_withholding_rate?: number;
  classification_check_results: ClassificationCheckResults;
  invoice_registration_status: InvoiceRegistrationStatus;
  invoice_registration_number?: string;
  reasoning: string;
}

export interface MemberWithholdingDecisionSnapshot {
  member_id: string;
  snapshot: TaxWithholdingDecisionSnapshot;
}

export type WithholdingDecisionSnapshotBundle =
  | TaxWithholdingDecisionSnapshot
  | {
      scope: "multi_member";
      member_snapshots: MemberWithholdingDecisionSnapshot[];
    };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const CHECK_KEYS: Array<keyof ClassificationCheckResults> = [
  "q1_substitution",
  "q2_time_freedom",
  "q3_work_autonomy",
  "q4_own_tools",
  "q5_outcome_liability",
];

function assertDate(value: string): string {
  if (!DATE_PATTERN.test(value) || Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())) {
    throw new Error("WITHHOLDING_SNAPSHOT_AS_OF_INVALID");
  }
  return value;
}

export function normalizeSnapshotAsOf(value: string | null | undefined): string {
  if (typeof value === "string" && MONTH_PATTERN.test(value)) {
    const [year, month] = value.split("-").map(Number);
    return `${value}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "string" && DATE_PATTERN.test(value)) {
    return assertDate(value);
  }
  return new Date().toISOString().slice(0, 10);
}

export function generateWithholdingDecisionReasoning(snapshot: TaxWithholdingDecisionSnapshot): string {
  const yesCount = CHECK_KEYS.filter((key) => snapshot.classification_check_results[key]).length;
  const status = snapshot.invoice_registration_status === "registered"
    ? `適格請求書登録あり (${snapshot.invoice_registration_number ?? "番号未設定"})`
    : `${snapshot.invoice_registration_status}`;
  const withholdingState = snapshot.tax_withholding_category === "none"
    ? "源泉徴収対象外 (所基通204関連、限定列挙非該当)"
    : `源泉徴収対象 (${snapshot.tax_withholding_category})`;

  return `5項目チェック [${yesCount}YES/5]、${snapshot.contract_type} 判定、${status}、よって ${withholdingState}`;
}

export function buildWithholdingDecisionSnapshotPayload(
  memberSnapshots: MemberWithholdingDecisionSnapshot[],
): {
  tax_withholding_decision_snapshot: WithholdingDecisionSnapshotBundle;
  tax_withholding_decision_snapshots: MemberWithholdingDecisionSnapshot[];
} {
  if (memberSnapshots.length === 0) {
    throw new Error("WITHHOLDING_SNAPSHOT_REQUIRED");
  }

  return {
    tax_withholding_decision_snapshot:
      memberSnapshots.length === 1
        ? memberSnapshots[0].snapshot
        : { scope: "multi_member", member_snapshots: memberSnapshots },
    tax_withholding_decision_snapshots: memberSnapshots,
  };
}

function normalizeCheckResults(value: unknown): ClassificationCheckResults {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  return CHECK_KEYS.reduce((acc, key) => {
    acc[key] = source[key] === true;
    return acc;
  }, {} as ClassificationCheckResults);
}

export class WithholdingDecisionSnapshotService {
  constructor(
    private readonly orgId: string,
    private readonly client: WithholdingSnapshotClient = supabaseAdmin as unknown as WithholdingSnapshotClient,
  ) {}

  async buildSnapshot(memberId: string, asOf?: string | null): Promise<TaxWithholdingDecisionSnapshot> {
    const activeAt = normalizeSnapshotAsOf(asOf);
    const { data, error } = await this.client
      .from("member_tax_classifications")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("member_id", memberId)
      .lte("effective_from", activeAt)
      .or(`effective_until.is.null,effective_until.gt.${activeAt}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`WITHHOLDING_SNAPSHOT_CLASSIFICATION_LOAD_FAILED: ${error.message}`);
    }
    if (!data) {
      throw new Error("WITHHOLDING_SNAPSHOT_CLASSIFICATION_NOT_FOUND");
    }

    return this.buildFromClassification(data as MemberTaxClassificationRecord);
  }

  async buildMemberSnapshots(
    memberIds: string[],
    asOf?: string | null,
  ): Promise<MemberWithholdingDecisionSnapshot[]> {
    const uniqueMemberIds = Array.from(new Set(memberIds.filter(Boolean)));
    return Promise.all(
      uniqueMemberIds.map(async (memberId) => ({
        member_id: memberId,
        snapshot: await this.buildSnapshot(memberId, asOf),
      })),
    );
  }

  private buildFromClassification(record: MemberTaxClassificationRecord): TaxWithholdingDecisionSnapshot {
    const snapshot: TaxWithholdingDecisionSnapshot = {
      decided_at: record.decided_at,
      decided_by: record.decided_by,
      classification_id_used: record.id,
      contract_type: record.contract_type,
      tax_withholding_category: record.tax_withholding_category,
      classification_check_results: normalizeCheckResults(record.classification_check_results),
      invoice_registration_status: record.invoice_registration_status,
      reasoning: "",
    };

    if (record.tax_withholding_category === "custom" && typeof record.custom_withholding_rate === "number") {
      snapshot.custom_withholding_rate = record.custom_withholding_rate;
    }
    if (record.invoice_registration_number) {
      snapshot.invoice_registration_number = record.invoice_registration_number;
    }

    snapshot.reasoning = generateWithholdingDecisionReasoning(snapshot);
    return snapshot;
  }
}
