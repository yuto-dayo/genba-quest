import { supabaseAdmin } from "../lib/supabaseAdmin";
import type { ActorRef, Proposal } from "./PolicyEngine";

export const CASH_RECEIPT_VARIANCE_REASONS = [
  "partial_payment",
  "overpayment",
  "fee_deduction",
  "withholding_tax",
  "tax_correction",
  "unknown",
] as const;

export type CashReceiptVarianceReason = typeof CASH_RECEIPT_VARIANCE_REASONS[number];

export interface CashReceiptAllocationPayload {
  invoice_transaction_id: string;
  allocated_amount: number;
}

export interface CashReceiptRecordPayload {
  bank_txn_ref?: string | null;
  client_id: string;
  received_date: string;
  received_amount: number;
  allocations: CashReceiptAllocationPayload[];
  variance_reason: CashReceiptVarianceReason;
  variance_memo?: string | null;
  notes?: string | null;
}

export interface CashReceiptLedgerEntryDraft {
  display_label: string;
  debit_amount?: number;
  credit_amount?: number;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function sumAllocations(allocations: CashReceiptAllocationPayload[]): number {
  return roundMoney(allocations.reduce((sum, allocation) => sum + allocation.allocated_amount, 0));
}

export function buildCashReceiptLedgerEntries(
  payload: CashReceiptRecordPayload,
): CashReceiptLedgerEntryDraft[] {
  const allocatedTotal = sumAllocations(payload.allocations);
  const variance = roundMoney(payload.received_amount - allocatedTotal);

  const entries: CashReceiptLedgerEntryDraft[] = [
    { display_label: "普通預金", debit_amount: allocatedTotal },
    ...payload.allocations.map((allocation) => ({
      display_label: "売掛金",
      credit_amount: allocation.allocated_amount,
    })),
  ];

  if (variance > 0 && payload.variance_reason !== "partial_payment") {
    const labelByReason: Record<Exclude<CashReceiptVarianceReason, "partial_payment">, string> = {
      fee_deduction: "支払手数料",
      withholding_tax: "仮払源泉所得税",
      overpayment: "売上値引",
      tax_correction: "売上値引",
      unknown: "雑損",
    };
    const displayLabel = labelByReason[payload.variance_reason];
    entries.push(
      { display_label: displayLabel, debit_amount: variance },
      { display_label: "売掛金", credit_amount: variance },
    );
  }

  return entries;
}

export function assertCashReceiptPayload(payload: CashReceiptRecordPayload): void {
  if (!payload.client_id) {
    throw new Error("CLIENT_ID_REQUIRED");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(payload.received_date)) {
    throw new Error("RECEIVED_DATE_INVALID");
  }
  if (!Number.isFinite(payload.received_amount) || payload.received_amount <= 0) {
    throw new Error("RECEIVED_AMOUNT_MUST_BE_POSITIVE");
  }
  if (!CASH_RECEIPT_VARIANCE_REASONS.includes(payload.variance_reason)) {
    throw new Error("VARIANCE_REASON_INVALID");
  }
  if (!Array.isArray(payload.allocations) || payload.allocations.length === 0) {
    throw new Error("ALLOCATIONS_REQUIRED");
  }

  for (const allocation of payload.allocations) {
    if (!allocation.invoice_transaction_id) {
      throw new Error("INVOICE_TRANSACTION_ID_REQUIRED");
    }
    if (!Number.isFinite(allocation.allocated_amount) || allocation.allocated_amount <= 0) {
      throw new Error("ALLOCATION_AMOUNT_MUST_BE_POSITIVE");
    }
  }

  if (sumAllocations(payload.allocations) > payload.received_amount) {
    throw new Error("ALLOCATIONS_EXCEED_RECEIVED_AMOUNT");
  }
}

export class CashReceiptService {
  constructor(private readonly orgId: string) {}

  async executeCashReceiptRecord(proposal: Proposal, executor: ActorRef): Promise<Proposal> {
    if (proposal.type !== "cash_receipt.record") {
      throw new Error("CASH_RECEIPT_PROPOSAL_TYPE_REQUIRED");
    }
    assertCashReceiptPayload(proposal.payload as unknown as CashReceiptRecordPayload);

    const { data, error } = await supabaseAdmin.rpc("rpc_execute_cash_receipt_record", {
      p_org_id: this.orgId,
      p_proposal_id: proposal.id,
      p_executor: executor,
    });

    if (error) {
      throw new Error(error.message || "Failed to execute cash receipt proposal");
    }

    return data as Proposal;
  }
}
