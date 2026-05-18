import JSZip from "jszip";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { generateEtaxCsvSjis, type EtaxSubmissionRow } from "../lib/etax-csv-generator";
import { generateLegalRecordMemberPdf } from "../lib/legal-record-pdf-generator";

const LEGAL_RECORD_THRESHOLD = 500_000;

type JsonRecord = Record<string, unknown>;

export interface LegalRecordSubmission {
  id: string;
  org_id: string;
  fiscal_year: number;
  member_id: string;
  payout_total: number;
  reward_total: number;
  correction_total: number;
  withholding_total: number;
  reimbursement_total: number;
  snapshot_trade_name: string | null;
  snapshot_invoice_registration_no: string | null;
  snapshot_address: JsonRecord;
  snapshot_bank: JsonRecord;
  snapshot_withholding_decision: JsonRecord;
  monthly_breakdown: Array<{ month: string; reward_total: number; correction_total: number; withholding_total: number; reimbursement_total: number }>;
  submission_file_path: string | null;
  member_copy_path: string | null;
  submitted_at: string | null;
  generated_at: string;
  updated_at: string;
}

type PayoutRow = {
  member_id: string;
  reimbursement_amount: number | string | null;
  carry_over_amount: number | string | null;
  reward_amount: number | string | null;
  withholding_amount: number | string | null;
  executed_at: string | null;
  tax_withholding_decision_snapshot: JsonRecord | null;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  trade_name: string | null;
  invoice_registration_number: string | null;
  bank_name: string | null;
  branch_name: string | null;
  account_type: string | null;
  account_number: string | null;
  account_holder_kana: string | null;
  postal_code: string | null;
  prefecture: string | null;
  city: string | null;
  address_line1: string | null;
  address_line2: string | null;
};

type ClassificationRow = {
  member_id: string;
  invoice_registration_number: string | null;
  invoice_registration_status: string | null;
  effective_from: string;
};

type CorrectionRow = {
  id: string;
  executed_at: string | null;
  payload: JsonRecord | null;
};

function toYen(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.round(numeric) : 0;
}

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("LEGAL_RECORD_YEAR_INVALID");
  }
}

function yearRange(year: number): { start: string; end: string } {
  assertYear(year);
  return {
    start: `${year}-01-01T00:00:00.000Z`,
    end: `${year + 1}-01-01T00:00:00.000Z`,
  };
}

function monthKey(value: string | null): string {
  return (value ?? new Date().toISOString()).slice(0, 7);
}

function displayName(profile: ProfileRow | undefined, memberId: string): string {
  return profile?.trade_name || profile?.full_name || profile?.username || memberId.slice(0, 8);
}

function addressSnapshot(profile: ProfileRow | undefined): JsonRecord {
  return {
    postal_code: profile?.postal_code ?? null,
    prefecture: profile?.prefecture ?? null,
    city: profile?.city ?? null,
    address_line1: profile?.address_line1 ?? null,
    address_line2: profile?.address_line2 ?? null,
  };
}

function addressText(snapshot: JsonRecord): string {
  return [
    snapshot.postal_code,
    snapshot.prefecture,
    snapshot.city,
    snapshot.address_line1,
    snapshot.address_line2,
  ].filter((value) => typeof value === "string" && value.trim()).join(" ");
}

function bankSnapshot(profile: ProfileRow | undefined): JsonRecord {
  return {
    bank_name: profile?.bank_name ?? null,
    branch_name: profile?.branch_name ?? null,
    account_type: profile?.account_type ?? null,
    account_number: profile?.account_number ?? null,
    account_holder_kana: profile?.account_holder_kana ?? null,
  };
}

function addMonthly(
  monthly: Map<string, { reward_total: number; correction_total: number; withholding_total: number; reimbursement_total: number }>,
  month: string,
  values: Partial<{ reward_total: number; correction_total: number; withholding_total: number; reimbursement_total: number }>,
): void {
  const current = monthly.get(month) ?? {
    reward_total: 0,
    correction_total: 0,
    withholding_total: 0,
    reimbursement_total: 0,
  };
  current.reward_total += values.reward_total ?? 0;
  current.correction_total += values.correction_total ?? 0;
  current.withholding_total += values.withholding_total ?? 0;
  current.reimbursement_total += values.reimbursement_total ?? 0;
  monthly.set(month, current);
}

export class LegalRecordService {
  constructor(private readonly orgId: string) {}

  async compileAnnualPayouts(year: number): Promise<LegalRecordSubmission[]> {
    const { start, end } = yearRange(year);
    const [payouts, corrections] = await Promise.all([
      this.listExecutedPayouts(start, end),
      this.listRewardCorrections(start, end),
    ]);

    const memberTotals = new Map<string, {
      reward_total: number;
      correction_total: number;
      withholding_total: number;
      reimbursement_total: number;
      snapshot_withholding_decision: JsonRecord;
      monthly: Map<string, { reward_total: number; correction_total: number; withholding_total: number; reimbursement_total: number }>;
    }>();

    const ensure = (memberId: string) => {
      const existing = memberTotals.get(memberId);
      if (existing) return existing;
      const created = {
        reward_total: 0,
        correction_total: 0,
        withholding_total: 0,
        reimbursement_total: 0,
        snapshot_withholding_decision: {},
        monthly: new Map<string, { reward_total: number; correction_total: number; withholding_total: number; reimbursement_total: number }>(),
      };
      memberTotals.set(memberId, created);
      return created;
    };

    for (const row of payouts) {
      const total = ensure(row.member_id);
      const reward = toYen(row.reward_amount);
      const reimbursement = toYen(row.reimbursement_amount) + toYen(row.carry_over_amount);
      const withholding = toYen(row.withholding_amount);
      total.reward_total += reward;
      total.reimbursement_total += reimbursement;
      total.withholding_total += withholding;
      if (Object.keys(total.snapshot_withholding_decision).length === 0 && row.tax_withholding_decision_snapshot) {
        total.snapshot_withholding_decision = row.tax_withholding_decision_snapshot;
      }
      addMonthly(total.monthly, monthKey(row.executed_at), {
        reward_total: reward,
        reimbursement_total: reimbursement,
        withholding_total: withholding,
      });
    }

    for (const row of corrections) {
      const payload = row.payload ?? {};
      const memberId = typeof payload.reward_member_id === "string"
        ? payload.reward_member_id
        : typeof payload.target_member_id === "string"
          ? payload.target_member_id
          : null;
      if (!memberId) continue;
      const amount = toYen(payload.delta_amount);
      const total = ensure(memberId);
      total.correction_total += amount;
      addMonthly(total.monthly, monthKey(row.executed_at), { correction_total: amount });
    }

    const eligibleEntries = Array.from(memberTotals.entries())
      .filter(([, total]) => total.reward_total + total.correction_total > LEGAL_RECORD_THRESHOLD);

    if (eligibleEntries.length === 0) {
      return [];
    }

    const memberIds = eligibleEntries.map(([memberId]) => memberId);
    const [profiles, classifications] = await Promise.all([
      this.loadProfiles(memberIds),
      this.loadClassifications(memberIds, `${year}-12-31`),
    ]);

    const rows = eligibleEntries.map(([memberId, total]) => {
      const profile = profiles.get(memberId);
      const classification = classifications.get(memberId);
      const monthly_breakdown = Array.from(total.monthly.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, values]) => ({ month, ...values }));
      const snapshot_address = addressSnapshot(profile);
      return {
        org_id: this.orgId,
        fiscal_year: year,
        member_id: memberId,
        payout_total: total.reward_total + total.correction_total,
        reward_total: total.reward_total,
        correction_total: total.correction_total,
        withholding_total: total.withholding_total,
        reimbursement_total: total.reimbursement_total,
        snapshot_trade_name: displayName(profile, memberId),
        snapshot_invoice_registration_no:
          classification?.invoice_registration_number || profile?.invoice_registration_number || null,
        snapshot_address,
        snapshot_bank: bankSnapshot(profile),
        snapshot_withholding_decision: total.snapshot_withholding_decision,
        monthly_breakdown,
        generated_at: new Date().toISOString(),
      };
    });

    const { data, error } = await supabaseAdmin
      .from("legal_record_submissions")
      .upsert(rows, { onConflict: "org_id,fiscal_year,member_id" })
      .select("*")
      .order("payout_total", { ascending: false });

    if (error) {
      throw new Error(`LEGAL_RECORD_COMPILE_FAILED: ${error.message}`);
    }

    return (data ?? []) as LegalRecordSubmission[];
  }

  async listSubmissions(year: number): Promise<LegalRecordSubmission[]> {
    assertYear(year);
    const { data, error } = await supabaseAdmin
      .from("legal_record_submissions")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("fiscal_year", year)
      .order("payout_total", { ascending: false });

    if (error) {
      throw new Error(`LEGAL_RECORD_LIST_FAILED: ${error.message}`);
    }
    return (data ?? []) as LegalRecordSubmission[];
  }

  async getMemberDetail(year: number, memberId: string): Promise<LegalRecordSubmission | null> {
    assertYear(year);
    const { data, error } = await supabaseAdmin
      .from("legal_record_submissions")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("fiscal_year", year)
      .eq("member_id", memberId)
      .maybeSingle();

    if (error) {
      throw new Error(`LEGAL_RECORD_DETAIL_FAILED: ${error.message}`);
    }
    return (data ?? null) as LegalRecordSubmission | null;
  }

  async generateSubmissionFile(year: number): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const submissions = await this.ensureCompiled(year);
    const org = await this.loadOrgInvoiceSettings();
    const rows: EtaxSubmissionRow[] = submissions.map((submission) => ({
      fiscalYear: year,
      payerAddress: org.issuer_address ?? "",
      payerName: org.issuer_name ?? "",
      payerPhone: org.issuer_contact ?? "",
      recipientAddress: addressText(submission.snapshot_address),
      recipientName: submission.snapshot_trade_name ?? submission.member_id.slice(0, 8),
      paymentAmount: toYen(submission.payout_total),
      withholdingAmount: toYen(submission.withholding_total),
      note: submission.snapshot_invoice_registration_no
        ? `T番号 ${submission.snapshot_invoice_registration_no}`
        : null,
    }));

    return {
      buffer: generateEtaxCsvSjis(rows),
      filename: `legal-records-${year}.csv`,
      count: rows.length,
    };
  }

  async generateMemberCopy(year: number, memberId: string): Promise<{ buffer: Buffer; filename: string }> {
    const submission = await this.getOrCompileMember(year, memberId);
    const org = await this.loadOrgInvoiceSettings();
    const buffer = await generateLegalRecordMemberPdf({
      fiscalYear: year,
      payerName: org.issuer_name ?? "",
      payerAddress: org.issuer_address ?? "",
      recipientName: submission.snapshot_trade_name ?? submission.member_id.slice(0, 8),
      recipientAddress: addressText(submission.snapshot_address),
      invoiceRegistrationNo: submission.snapshot_invoice_registration_no,
      payoutTotal: toYen(submission.payout_total),
      rewardTotal: toYen(submission.reward_total),
      correctionTotal: toYen(submission.correction_total),
      withholdingTotal: toYen(submission.withholding_total),
      generatedAt: new Date().toISOString(),
    });

    return {
      buffer,
      filename: `legal-record-${year}-${memberId}.pdf`,
    };
  }

  async generateMemberCopyZip(year: number): Promise<{ buffer: Buffer; filename: string; count: number }> {
    const submissions = await this.ensureCompiled(year);
    const zip = new JSZip();
    await Promise.all(submissions.map(async (submission) => {
      const pdf = await this.generateMemberCopy(year, submission.member_id);
      zip.file(pdf.filename, pdf.buffer);
    }));
    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    return {
      buffer,
      filename: `legal-record-member-copies-${year}.zip`,
      count: submissions.length,
    };
  }

  async markSubmitted(year: number, memberId: string, submittedAt: string | null): Promise<LegalRecordSubmission> {
    assertYear(year);
    const { data, error } = await supabaseAdmin
      .from("legal_record_submissions")
      .update({ submitted_at: submittedAt ?? new Date().toISOString() })
      .eq("org_id", this.orgId)
      .eq("fiscal_year", year)
      .eq("member_id", memberId)
      .select("*")
      .single();

    if (error) {
      throw new Error(`LEGAL_RECORD_SUBMITTED_UPDATE_FAILED: ${error.message}`);
    }
    return data as LegalRecordSubmission;
  }

  private async ensureCompiled(year: number): Promise<LegalRecordSubmission[]> {
    const existing = await this.listSubmissions(year);
    if (existing.length > 0) {
      return existing;
    }
    return this.compileAnnualPayouts(year);
  }

  private async getOrCompileMember(year: number, memberId: string): Promise<LegalRecordSubmission> {
    const existing = await this.getMemberDetail(year, memberId);
    if (existing) {
      return existing;
    }
    await this.compileAnnualPayouts(year);
    const compiled = await this.getMemberDetail(year, memberId);
    if (!compiled) {
      throw new Error("LEGAL_RECORD_MEMBER_NOT_FOUND");
    }
    return compiled;
  }

  private async listExecutedPayouts(start: string, end: string): Promise<PayoutRow[]> {
    const { data, error } = await supabaseAdmin
      .from("payout_schedule")
      .select("member_id,reimbursement_amount,carry_over_amount,reward_amount,withholding_amount,executed_at,tax_withholding_decision_snapshot")
      .eq("org_id", this.orgId)
      .eq("status", "executed")
      .gte("executed_at", start)
      .lt("executed_at", end);

    if (error) {
      throw new Error(`LEGAL_RECORD_PAYOUT_LOAD_FAILED: ${error.message}`);
    }
    return (data ?? []) as PayoutRow[];
  }

  private async listRewardCorrections(start: string, end: string): Promise<CorrectionRow[]> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id,executed_at,payload")
      .eq("org_id", this.orgId)
      .eq("type", "reward.dispute_correction")
      .eq("status", "executed")
      .gte("executed_at", start)
      .lt("executed_at", end);

    if (error) {
      throw new Error(`LEGAL_RECORD_CORRECTION_LOAD_FAILED: ${error.message}`);
    }
    return (data ?? []) as CorrectionRow[];
  }

  private async loadProfiles(memberIds: string[]): Promise<Map<string, ProfileRow>> {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,full_name,username,trade_name,invoice_registration_number,bank_name,branch_name,account_type,account_number,account_holder_kana,postal_code,prefecture,city,address_line1,address_line2")
      .in("id", memberIds);

    if (error) {
      throw new Error(`LEGAL_RECORD_PROFILE_LOAD_FAILED: ${error.message}`);
    }
    return new Map(((data ?? []) as ProfileRow[]).map((row) => [row.id, row]));
  }

  private async loadClassifications(memberIds: string[], asOf: string): Promise<Map<string, ClassificationRow>> {
    const { data, error } = await supabaseAdmin
      .from("member_tax_classifications")
      .select("member_id,invoice_registration_number,invoice_registration_status,effective_from")
      .eq("org_id", this.orgId)
      .in("member_id", memberIds)
      .lte("effective_from", asOf)
      .or(`effective_until.is.null,effective_until.gt.${asOf}`)
      .order("effective_from", { ascending: false });

    if (error) {
      throw new Error(`LEGAL_RECORD_CLASSIFICATION_LOAD_FAILED: ${error.message}`);
    }
    const result = new Map<string, ClassificationRow>();
    for (const row of (data ?? []) as ClassificationRow[]) {
      if (!result.has(row.member_id)) {
        result.set(row.member_id, row);
      }
    }
    return result;
  }

  private async loadOrgInvoiceSettings(): Promise<{ issuer_name: string | null; issuer_address: string | null; issuer_contact: string | null }> {
    const { data, error } = await supabaseAdmin
      .from("org_invoice_settings")
      .select("issuer_name,issuer_address,issuer_contact")
      .eq("org_id", this.orgId)
      .maybeSingle();

    if (error) {
      throw new Error(`LEGAL_RECORD_ORG_SETTINGS_LOAD_FAILED: ${error.message}`);
    }
    return (data ?? { issuer_name: "", issuer_address: "", issuer_contact: "" }) as {
      issuer_name: string | null;
      issuer_address: string | null;
      issuer_contact: string | null;
    };
  }
}
