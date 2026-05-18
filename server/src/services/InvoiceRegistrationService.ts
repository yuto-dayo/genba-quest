import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import {
  calculateTransitionalDeductionRate,
  classifyTransitionalPhase,
  type InvoiceRegistrationStatus,
  type TransitionalPhase,
} from "../lib/transitional-deduction";

type InvoiceRegistrationClient = Pick<SupabaseClient, "from">;

const INVOICE_STATUSES = new Set<InvoiceRegistrationStatus>(["registered", "exempt", "transitional", "unknown"]);
const MONTHLY_DEDUCTIBLE_CLOSE_STATUSES = ["approved", "executed", "posted", "finalized"] as const;

export interface MemberInvoiceStatus {
  status: InvoiceRegistrationStatus;
  registration_number: string | null;
  deduction_rate: number;
  transitional_phase: TransitionalPhase;
}

export interface MonthlyDeductibleAmount {
  month: string;
  gross_subject_amount: number;
  deductible_amount: number;
  effective_deduction_rate: number;
  transitional_phase: TransitionalPhase;
  transitional_rate: number;
  member_count: number;
}

type ClassificationRow = {
  invoice_registration_status?: string | null;
  invoice_registration_number?: string | null;
};

type MonthlyDistributionLineRow = {
  member_id?: string | null;
  total_pay?: number | string | null;
  total_pay_amount?: number | string | null;
  rounded_amount?: number | string | null;
};

type MonthlyDistributionCloseRow = {
  lines?: MonthlyDistributionLineRow[] | null;
  monthly_distribution_lines?: MonthlyDistributionLineRow[] | null;
};

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function assertMonth(value: string): void {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error("INVOICE_DEDUCTIBLE_MONTH_INVALID");
  }
  const [year, month] = value.split("-").map(Number);
  if (!year || !month || month < 1 || month > 12) {
    throw new Error("INVOICE_DEDUCTIBLE_MONTH_INVALID");
  }
}

function monthEndDate(month: string): string {
  assertMonth(month);
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(year, mon, 0).getDate();
  return `${month}-${String(lastDay).padStart(2, "0")}`;
}

function normalizeStatus(value: string | null | undefined): InvoiceRegistrationStatus {
  return value && INVOICE_STATUSES.has(value as InvoiceRegistrationStatus)
    ? value as InvoiceRegistrationStatus
    : "unknown";
}

function toMoneyNumber(value: number | string | null | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundMoney(value: number): number {
  return Math.round(value);
}

function lineAmount(row: MonthlyDistributionLineRow): number {
  return toMoneyNumber(row.total_pay_amount ?? row.total_pay ?? row.rounded_amount);
}

export class InvoiceRegistrationService {
  constructor(
    private readonly client: InvoiceRegistrationClient = supabaseAdmin as unknown as InvoiceRegistrationClient,
  ) {}

  async getMemberInvoiceStatus(input: {
    orgId: string;
    memberId: string;
    asOf?: string | Date | null;
  }): Promise<MemberInvoiceStatus> {
    const asOf = input.asOf instanceof Date
      ? input.asOf.toISOString().slice(0, 10)
      : input.asOf || new Date().toISOString().slice(0, 10);
    if (!isIsoDate(asOf)) {
      throw new Error("MEMBER_INVOICE_STATUS_AS_OF_INVALID");
    }

    const { data, error } = await this.client
      .from("member_tax_classifications")
      .select("invoice_registration_status, invoice_registration_number, effective_from, effective_until")
      .eq("org_id", input.orgId)
      .eq("member_id", input.memberId)
      .lte("effective_from", asOf)
      .or(`effective_until.is.null,effective_until.gt.${asOf}`)
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load member invoice status: ${error.message}`);
    }

    const row = (data || null) as ClassificationRow | null;
    const status = normalizeStatus(row?.invoice_registration_status);

    return {
      status,
      registration_number: row?.invoice_registration_number ?? null,
      deduction_rate: calculateTransitionalDeductionRate(asOf, status),
      transitional_phase: classifyTransitionalPhase(asOf),
    };
  }

  async getMonthlyDeductibleAmount(input: {
    orgId: string;
    month: string;
  }): Promise<MonthlyDeductibleAmount> {
    assertMonth(input.month);
    const asOf = monthEndDate(input.month);

    const { data, error } = await this.client
      .from("monthly_distribution_closes")
      .select(`
        id,
        month,
        status,
        closed_at,
        lines:monthly_distribution_lines(member_id, total_pay, total_pay_amount, rounded_amount)
      `)
      .eq("org_id", input.orgId)
      .eq("month", input.month)
      .in("status", [...MONTHLY_DEDUCTIBLE_CLOSE_STATUSES])
      .order("closed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load monthly distribution for invoice deduction: ${error.message}`);
    }

    const closeRow = (data || null) as MonthlyDistributionCloseRow | null;
    const lines = closeRow?.lines ?? closeRow?.monthly_distribution_lines ?? [];
    const amountByMember = new Map<string, number>();

    for (const line of lines) {
      const memberId = typeof line.member_id === "string" ? line.member_id : null;
      if (!memberId) {
        continue;
      }
      amountByMember.set(memberId, (amountByMember.get(memberId) ?? 0) + lineAmount(line));
    }

    let gross = 0;
    let deductible = 0;
    await Promise.all(
      Array.from(amountByMember.entries()).map(async ([memberId, amount]) => {
        gross += amount;
        const status = await this.getMemberInvoiceStatus({ orgId: input.orgId, memberId, asOf });
        deductible += amount * status.deduction_rate;
      }),
    );

    const transitionalRate = calculateTransitionalDeductionRate(asOf, "exempt");
    const deductibleAmount = roundMoney(deductible);
    const grossAmount = roundMoney(gross);

    return {
      month: input.month,
      gross_subject_amount: grossAmount,
      deductible_amount: deductibleAmount,
      effective_deduction_rate: grossAmount > 0 ? Number((deductibleAmount / grossAmount).toFixed(4)) : 1,
      transitional_phase: classifyTransitionalPhase(asOf),
      transitional_rate: transitionalRate,
      member_count: amountByMember.size,
    };
  }
}

export const invoiceRegistrationService = new InvoiceRegistrationService();
