import { supabaseAdmin } from "../lib/supabaseAdmin";
import { bookLedgerEntry, type DisplayLabelLedgerEntry } from "../lib/ledger-helpers";
import type { ActorRef, Proposal } from "./PolicyEngine";
import type { CreateProposalInput, SubmitResult } from "./ProposalService";
import { PayoutAllocationService, type AllocationLine, type PayoutBalance } from "./PayoutAllocationService";
import {
  buildWithholdingDecisionSnapshotPayload,
  TaxWithholdingDecisionSnapshot,
  WithholdingDecisionSnapshotService,
} from "./WithholdingDecisionSnapshotService";

type ProposalCreator = {
  createAndSubmit(input: CreateProposalInput): Promise<SubmitResult>;
};

type CashReceiptRow = {
  id: string;
  org_id: string;
  received_amount: number | string;
  received_date: string;
  bank_txn_ref: string | null;
};

type PayoutScheduleRow = {
  id: string;
  member_id: string;
  reimbursement_amount: number | string;
  carry_over_amount: number | string;
  reward_amount: number | string;
  withholding_amount: number | string;
  tax_withholding_decision_snapshot?: TaxWithholdingDecisionSnapshot | Record<string, unknown>;
};

type AllocationLineWithSnapshot = AllocationLine & {
  tax_withholding_decision_snapshot?: TaxWithholdingDecisionSnapshot;
};

const SYSTEM_ACTOR: ActorRef = {
  type: "system",
  id: "system",
  name: "System Auto-Scheduler",
};

function toYen(value: unknown): number {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    throw new Error("INVALID_MONEY_AMOUNT");
  }
  return Math.round(amount);
}

function getLines(payload: Record<string, unknown>): AllocationLineWithSnapshot[] {
  const raw = payload.allocation_lines;
  if (!Array.isArray(raw)) {
    throw new Error("PAYOUT_ALLOCATION_LINES_REQUIRED");
  }
  return raw.map((line) => {
    const row = line as Record<string, unknown>;
    const memberId = typeof row.member_id === "string" ? row.member_id : "";
    if (!memberId) {
      throw new Error("PAYOUT_MEMBER_ID_REQUIRED");
    }
    return {
      member_id: memberId,
      allocated: toYen(row.allocated),
      unsettled_after: toYen(row.unsettled_after),
      tax_withholding_decision_snapshot: row.tax_withholding_decision_snapshot as TaxWithholdingDecisionSnapshot | undefined,
    };
  });
}

function hasFrozenSnapshot(value: unknown): value is TaxWithholdingDecisionSnapshot {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).classification_id_used === "string";
}

export class PayoutSchedulingService {
  private readonly withholdingSnapshotService: WithholdingDecisionSnapshotService;

  constructor(
    private readonly orgId: string,
    private readonly proposalCreator?: ProposalCreator,
  ) {
    this.withholdingSnapshotService = new WithholdingDecisionSnapshotService(orgId);
  }

  async onCashReceiptExecuted(receiptId: string): Promise<SubmitResult | null> {
    if (!this.proposalCreator) {
      throw new Error("PAYOUT_PROPOSAL_CREATOR_REQUIRED");
    }

    const receipt = await this.getCashReceipt(receiptId);
    if (!receipt || receipt.org_id !== this.orgId) {
      return null;
    }

    const existing = await this.findExistingScheduleProposal(receipt.id);
    if (existing) {
      return null;
    }

    const balances = await this.listUnsettledReimbursementBalances();
    const allocationLines = PayoutAllocationService.allocateProRata(
      toYen(receipt.received_amount),
      balances,
    );
    if (allocationLines.length === 0) {
      return null;
    }
    const memberSnapshots = await this.withholdingSnapshotService.buildMemberSnapshots(
      allocationLines.map((line) => line.member_id),
      receipt.received_date,
    );
    const snapshotByMember = new Map(memberSnapshots.map((row) => [row.member_id, row.snapshot]));
    const allocationLinesWithSnapshots = allocationLines.map((line) => ({
      ...line,
      tax_withholding_decision_snapshot: snapshotByMember.get(line.member_id),
    }));

    return this.proposalCreator.createAndSubmit({
      type: "payout.scheduled",
      org_id: this.orgId,
      created_by: SYSTEM_ACTOR,
      description: `入金 ${receipt.received_date} の立替配分を作成`,
      idempotency_key: `payout:scheduled:cash_receipt:${receipt.id}`,
      payload: {
        cash_receipt_id: receipt.id,
        received_amount: toYen(receipt.received_amount),
        received_date: receipt.received_date,
        bank_txn_ref: receipt.bank_txn_ref,
        allocation_lines: allocationLinesWithSnapshots,
        rounding_method: "largest_remainder",
        ...buildWithholdingDecisionSnapshotPayload(memberSnapshots),
      },
    });
  }

  async applyScheduledProposal(proposal: Proposal): Promise<void> {
    if (proposal.type !== "payout.scheduled") {
      throw new Error("PAYOUT_SCHEDULED_PROPOSAL_REQUIRED");
    }

    const payload = proposal.payload as Record<string, unknown>;
    const receiptId = typeof payload.cash_receipt_id === "string" ? payload.cash_receipt_id : "";
    if (!receiptId) {
      throw new Error("PAYOUT_CASH_RECEIPT_ID_REQUIRED");
    }

    const lines = getLines(payload);
    if (lines.length === 0) {
      throw new Error("PAYOUT_ALLOCATION_LINES_REQUIRED");
    }

    const rows = lines.map((line) => ({
      org_id: proposal.org_id,
      cash_receipt_id: receiptId,
      scheduled_proposal_id: proposal.id,
      member_id: line.member_id,
      reimbursement_amount: line.allocated,
      carry_over_amount: line.unsettled_after,
      reward_amount: 0,
      withholding_amount: 0,
      status: "scheduled",
      tax_withholding_decision_snapshot:
        line.tax_withholding_decision_snapshot ?? payload.tax_withholding_decision_snapshot,
    }));

    const { error } = await supabaseAdmin
      .from("payout_schedule")
      .upsert(rows, { onConflict: "scheduled_proposal_id,member_id" });

    if (error) {
      throw new Error(`Failed to upsert payout schedule: ${error.message}`);
    }
  }

  async executePayoutProposal(proposal: Proposal, executor: ActorRef): Promise<Proposal> {
    if (proposal.type !== "payout.executed") {
      throw new Error("PAYOUT_EXECUTED_PROPOSAL_REQUIRED");
    }

    const payload = proposal.payload as Record<string, unknown>;
    const scheduleIds = Array.isArray(payload.schedule_ids)
      ? payload.schedule_ids.filter((value): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (scheduleIds.length === 0) {
      throw new Error("PAYOUT_SCHEDULE_IDS_REQUIRED");
    }

    const { data, error } = await supabaseAdmin
      .from("payout_schedule")
      .select("id,member_id,reimbursement_amount,carry_over_amount,reward_amount,withholding_amount,tax_withholding_decision_snapshot")
      .eq("org_id", proposal.org_id)
      .in("id", scheduleIds)
      .eq("status", "scheduled");

    if (error) {
      throw new Error(`Failed to load payout schedule: ${error.message}`);
    }

    const rows = (data ?? []) as PayoutScheduleRow[];
    if (rows.length !== scheduleIds.length) {
      throw new Error("PAYOUT_SCHEDULE_NOT_FOUND_OR_NOT_SCHEDULED");
    }
    const memberSnapshots = await Promise.all(
      rows.map(async (row) => ({
        member_id: row.member_id,
        snapshot: hasFrozenSnapshot(row.tax_withholding_decision_snapshot)
          ? row.tax_withholding_decision_snapshot
          : await this.withholdingSnapshotService.buildSnapshot(row.member_id),
      })),
    );
    const eventPayload = {
      ...proposal.payload,
      payout_schedule_rows: rows.map((row) => ({
        id: row.id,
        member_id: row.member_id,
        reimbursement_amount: toYen(row.reimbursement_amount),
        carry_over_amount: toYen(row.carry_over_amount),
        reward_amount: toYen(row.reward_amount),
        withholding_amount: toYen(row.withholding_amount),
        tax_withholding_decision_snapshot: row.tax_withholding_decision_snapshot ?? null,
      })),
      ...buildWithholdingDecisionSnapshotPayload(memberSnapshots),
    };

    const entries = this.buildPayoutLedgerEntries(rows);
    const ledger = await bookLedgerEntry(
      "payout.executed",
      entries,
      {
        org_id: proposal.org_id,
        proposal_id: proposal.id,
        actor: executor,
        payload: eventPayload,
      },
      supabaseAdmin,
    );

    const { error: updateScheduleError } = await supabaseAdmin
      .from("payout_schedule")
      .update({
        status: "executed",
        executed_proposal_id: proposal.id,
        executed_at: new Date().toISOString(),
        ledger_event_id: ledger.ledger_event_id,
      })
      .eq("org_id", proposal.org_id)
      .in("id", scheduleIds)
      .eq("status", "scheduled");

    if (updateScheduleError) {
      throw new Error(`Failed to mark payout schedule executed: ${updateScheduleError.message}`);
    }

    const { data: updatedProposal, error: proposalError } = await supabaseAdmin
      .from("proposals")
      .update({
        status: "executed",
        executed_at: new Date().toISOString(),
        executed_by: executor,
        result_event_id: ledger.ledger_event_id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", proposal.id)
      .eq("org_id", proposal.org_id)
      .select()
      .single();

    if (proposalError) {
      throw new Error(`Failed to mark payout proposal executed: ${proposalError.message}`);
    }

    return updatedProposal as Proposal;
  }

  private async getCashReceipt(receiptId: string): Promise<CashReceiptRow | null> {
    const { data, error } = await supabaseAdmin
      .from("cash_receipts")
      .select("id,org_id,received_amount,received_date,bank_txn_ref")
      .eq("id", receiptId)
      .eq("org_id", this.orgId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load cash receipt: ${error.message}`);
    }
    return (data ?? null) as CashReceiptRow | null;
  }

  private async findExistingScheduleProposal(receiptId: string): Promise<string | null> {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("id")
      .eq("org_id", this.orgId)
      .eq("type", "payout.scheduled")
      .eq("idempotency_key", `payout:scheduled:cash_receipt:${receiptId}`)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to check payout idempotency: ${error.message}`);
    }
    return typeof data?.id === "string" ? data.id : null;
  }

  private async listUnsettledReimbursementBalances(): Promise<PayoutBalance[]> {
    const { data, error } = await supabaseAdmin
      .from("accounting_transactions")
      .select("claimant_member_id,amount_total")
      .eq("org_id", this.orgId)
      .eq("kind", "expense")
      .eq("paid_by", "member")
      .eq("settlement_type", "unpaid")
      .in("status", ["posted", "approved"])
      .or("reimbursement_status.is.null,reimbursement_status.neq.reimbursed");

    if (error) {
      throw new Error(`Failed to load reimbursement balances: ${error.message}`);
    }

    const balances = new Map<string, number>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const memberId = typeof row.claimant_member_id === "string" ? row.claimant_member_id : "";
      if (!memberId) {
        continue;
      }
      balances.set(memberId, (balances.get(memberId) ?? 0) + toYen(row.amount_total));
    }

    const scheduled = await this.listAlreadyScheduledReimbursements();
    for (const [memberId, amount] of scheduled) {
      balances.set(memberId, Math.max(0, (balances.get(memberId) ?? 0) - amount));
    }

    return Array.from(balances.entries()).map(([member_id, unsettled]) => ({ member_id, unsettled }));
  }

  private async listAlreadyScheduledReimbursements(): Promise<Map<string, number>> {
    const { data, error } = await supabaseAdmin
      .from("payout_schedule")
      .select("member_id,reimbursement_amount")
      .eq("org_id", this.orgId)
      .in("status", ["scheduled", "executed"]);

    if (error) {
      if (error.message?.includes("payout_schedule")) {
        return new Map();
      }
      throw new Error(`Failed to load scheduled reimbursements: ${error.message}`);
    }

    const totals = new Map<string, number>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const memberId = typeof row.member_id === "string" ? row.member_id : "";
      if (!memberId) {
        continue;
      }
      totals.set(memberId, (totals.get(memberId) ?? 0) + toYen(row.reimbursement_amount));
    }
    return totals;
  }

  private buildPayoutLedgerEntries(rows: PayoutScheduleRow[]): DisplayLabelLedgerEntry[] {
    const reimbursementAmount = rows.reduce((sum, row) => sum + toYen(row.reimbursement_amount), 0);
    const carryOverAmount = rows.reduce((sum, row) => sum + toYen(row.carry_over_amount), 0);
    const rewardAmount = rows.reduce((sum, row) => sum + toYen(row.reward_amount), 0);
    const withholdingAmount = rows.reduce((sum, row) => sum + toYen(row.withholding_amount), 0);
    const payoutAmount = reimbursementAmount + carryOverAmount + rewardAmount - withholdingAmount;

    const entries: DisplayLabelLedgerEntry[] = [];
    if (reimbursementAmount > 0) {
      entries.push({ display_label: "立替戻し", debit_amount: reimbursementAmount });
    }
    if (carryOverAmount > 0) {
      entries.push({ display_label: "立替の持越し", debit_amount: carryOverAmount });
    }
    if (rewardAmount > 0) {
      entries.push({ display_label: "報酬の素", debit_amount: rewardAmount });
    }
    if (payoutAmount > 0) {
      entries.push({ display_label: "普通預金", credit_amount: payoutAmount });
    }
    if (withholdingAmount > 0) {
      entries.push({ display_label: "預り金", credit_amount: withholdingAmount });
    }
    return entries;
  }
}
