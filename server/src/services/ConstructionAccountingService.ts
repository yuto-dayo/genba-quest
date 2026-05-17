import { supabaseAdmin } from "../lib/supabaseAdmin";
import type { ActorRef } from "./PolicyEngine";

const WIP_ACCOUNT_CODE = "1230";
const COMPLETED_COGS_ACCOUNT_CODE = "5420";

type SupabaseClientLike = typeof supabaseAdmin;

export interface SiteCostTransferRecord {
  id: string;
  org_id: string;
  site_id: string;
  transferred_at: string;
  accumulated_amount: number | string;
  from_account_code: string;
  to_account_code: string;
  proposal_id: string;
  ledger_event_id: string;
  ledger_transaction_id?: string | null;
  accounting_journal_entry_id?: string | null;
}

export interface SiteCostTransferPreviewRow {
  site_id: string;
  site_name: string;
  completed_at: string | null;
  accumulated_amount: number;
  from_account_code: typeof WIP_ACCOUNT_CODE;
  to_account_code: typeof COMPLETED_COGS_ACCOUNT_CODE;
  transfer_status: "pending" | "transferred";
  transferred_at: string | null;
  proposal_id: string | null;
}

function toMoneyNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

export class ConstructionAccountingService {
  constructor(private readonly orgId: string) {}

  async getSiteAccumulatedCost(siteId: string, tx: SupabaseClientLike = supabaseAdmin): Promise<number> {
    if (!isUuid(siteId)) {
      throw new Error("INVALID_SITE_ID");
    }

    const { data, error } = await tx
      .from("accounting_transactions")
      .select("amount_total")
      .eq("org_id", this.orgId)
      .eq("site_id", siteId)
      .eq("status", "posted")
      .eq("kind", "expense");

    if (error) {
      throw new Error(`Failed to fetch site accumulated cost: ${error.message}`);
    }

    return (data ?? []).reduce(
      (sum: number, row: { amount_total?: unknown }) => sum + toMoneyNumber(row.amount_total),
      0,
    );
  }

  async transferOnSiteClose(
    siteId: string,
    actor: ActorRef,
    tx: SupabaseClientLike = supabaseAdmin,
    options: { proposalId?: string | null } = {},
  ): Promise<SiteCostTransferRecord | null> {
    const accumulatedAmount = await this.getSiteAccumulatedCost(siteId, tx);
    if (accumulatedAmount <= 0) {
      return null;
    }

    const existing = await this.findTransferBySite(siteId, tx);
    if (existing) {
      return existing;
    }

    const proposalId = options.proposalId;
    if (!isUuid(proposalId)) {
      throw new Error("SITE_COST_TRANSFER_PROPOSAL_ID_REQUIRED");
    }

    const description = `完成工事原価振替: ${siteId}`;
    const { data: event, error: eventError } = await tx
      .from("ledger_events")
      .insert({
        org_id: this.orgId,
        event_type: "expense_recorded",
        proposal_id: proposalId,
        actor,
        payload: {
          kind: "site_cost_transfer",
          site_id: siteId,
          amount_total: accumulatedAmount,
          from_account_code: WIP_ACCOUNT_CODE,
          to_account_code: COMPLETED_COGS_ACCOUNT_CODE,
        },
      })
      .select("id")
      .single();

    if (eventError) {
      throw new Error(`Failed to create site cost transfer event: ${eventError.message}`);
    }

    const { data: transaction, error: transactionError } = await tx
      .from("ledger_transactions")
      .insert({
        org_id: this.orgId,
        event_id: event.id,
        transaction_date: new Date().toISOString().slice(0, 10),
        description,
        currency: "JPY",
      })
      .select("id")
      .single();

    if (transactionError) {
      throw new Error(`Failed to create site cost transfer transaction: ${transactionError.message}`);
    }

    const { error: entriesError } = await tx.from("ledger_entries").insert([
      {
        transaction_id: transaction.id,
        account_code: COMPLETED_COGS_ACCOUNT_CODE,
        debit_amount: accumulatedAmount,
        credit_amount: 0,
        memo: description,
        line_number: 1,
      },
      {
        transaction_id: transaction.id,
        account_code: WIP_ACCOUNT_CODE,
        debit_amount: 0,
        credit_amount: accumulatedAmount,
        memo: description,
        line_number: 2,
      },
    ]);

    if (entriesError) {
      throw new Error(`Failed to create site cost transfer entries: ${entriesError.message}`);
    }

    const { data: transfer, error: transferError } = await tx
      .from("site_cost_transfers")
      .insert({
        org_id: this.orgId,
        site_id: siteId,
        accumulated_amount: accumulatedAmount,
        from_account_code: WIP_ACCOUNT_CODE,
        to_account_code: COMPLETED_COGS_ACCOUNT_CODE,
        proposal_id: proposalId,
        ledger_event_id: event.id,
        ledger_transaction_id: transaction.id,
        notes: "site.close.finalize fallback",
      })
      .select("*")
      .single();

    if (transferError) {
      throw new Error(`Failed to record site cost transfer: ${transferError.message}`);
    }

    return transfer as SiteCostTransferRecord;
  }

  async listMonthlyTransferPreview(month: string): Promise<SiteCostTransferPreviewRow[]> {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error("INVALID_MONTH");
    }

    const [year, monthPart] = month.split("-").map(Number);
    const startDate = `${month}-01`;
    const lastDay = new Date(year, monthPart, 0).getDate();
    const endDate = `${month}-${String(lastDay).padStart(2, "0")}`;

    const { data: sites, error: sitesError } = await supabaseAdmin
      .from("sites")
      .select("id, name, status, completed_at")
      .eq("org_id", this.orgId)
      .in("status", ["completed", "closed"])
      .gte("completed_at", startDate)
      .lte("completed_at", endDate)
      .is("deleted_at", null)
      .order("completed_at", { ascending: true });

    if (sitesError) {
      throw new Error(`Failed to list completed sites: ${sitesError.message}`);
    }

    const siteRows = (sites ?? []) as Array<{
      id: string;
      name?: string | null;
      completed_at?: string | null;
    }>;
    if (siteRows.length === 0) {
      return [];
    }

    const siteIds = siteRows.map((site) => site.id);
    const { data: transfers, error: transfersError } = await supabaseAdmin
      .from("site_cost_transfers")
      .select("site_id, transferred_at, accumulated_amount, proposal_id")
      .eq("org_id", this.orgId)
      .in("site_id", siteIds);

    if (transfersError) {
      throw new Error(`Failed to list site cost transfers: ${transfersError.message}`);
    }

    const transferBySite = new Map(
      ((transfers ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.site_id), row]),
    );

    const rows = await Promise.all(
      siteRows.map(async (site) => {
        const transfer = transferBySite.get(site.id);
        const accumulatedAmount = transfer
          ? toMoneyNumber(transfer.accumulated_amount)
          : await this.getSiteAccumulatedCost(site.id);

        return {
          site_id: site.id,
          site_name: site.name || "現場",
          completed_at: site.completed_at ?? null,
          accumulated_amount: accumulatedAmount,
          from_account_code: WIP_ACCOUNT_CODE as typeof WIP_ACCOUNT_CODE,
          to_account_code: COMPLETED_COGS_ACCOUNT_CODE as typeof COMPLETED_COGS_ACCOUNT_CODE,
          transfer_status: transfer ? "transferred" as const : "pending" as const,
          transferred_at: typeof transfer?.transferred_at === "string" ? transfer.transferred_at : null,
          proposal_id: typeof transfer?.proposal_id === "string" ? transfer.proposal_id : null,
        };
      }),
    );

    return rows.filter((row) => row.accumulated_amount > 0);
  }

  private async findTransferBySite(
    siteId: string,
    tx: SupabaseClientLike,
  ): Promise<SiteCostTransferRecord | null> {
    const { data, error } = await tx
      .from("site_cost_transfers")
      .select("*")
      .eq("org_id", this.orgId)
      .eq("site_id", siteId)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to fetch site cost transfer: ${error.message}`);
    }

    return data ? data as SiteCostTransferRecord : null;
  }
}
