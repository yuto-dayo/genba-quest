import type { SupabaseClient } from "@supabase/supabase-js";
import type { ActorRef } from "../services/PolicyEngine";
import { TaxAccountMappingService } from "../services/TaxAccountMappingService";

export interface DisplayLabelLedgerEntry {
    display_label: string;
    debit_amount?: number;
    credit_amount?: number;
}

export interface BookLedgerEntryContext {
    org_id: string;
    proposal_id?: string | null;
    actor: ActorRef;
    payload?: Record<string, unknown>;
}

function toCents(amount: number | undefined): number {
    if (amount === undefined || amount === null) {
        return 0;
    }
    if (!Number.isFinite(amount)) {
        throw new Error("LEDGER_AMOUNT_INVALID");
    }
    return Math.round(amount * 100);
}

function toMoney(cents: number): number {
    return Number((cents / 100).toFixed(2));
}

function assertLineShape(entry: DisplayLabelLedgerEntry): void {
    const debit = toCents(entry.debit_amount);
    const credit = toCents(entry.credit_amount);
    if ((debit > 0 && credit > 0) || (debit <= 0 && credit <= 0)) {
        throw new Error(`Ledger line must have exactly one positive side for "${entry.display_label}"`);
    }
}

export async function bookLedgerEntry(
    eventType: string,
    entries: DisplayLabelLedgerEntry[],
    context: BookLedgerEntryContext,
    tx: SupabaseClient,
): Promise<{ ledger_event_id: string }> {
    const normalizedEventType = eventType.trim();
    if (!normalizedEventType) {
        throw new Error("EVENT_TYPE_REQUIRED");
    }

    if (entries.length === 0) {
        throw new Error("LEDGER_ENTRIES_REQUIRED");
    }

    entries.forEach(assertLineShape);

    const service = new TaxAccountMappingService(context.org_id, tx);
    const mappings = await Promise.all(
        entries.map((entry) => service.getMapping(entry.display_label)),
    );

    mappings.forEach((mapping) => {
        if (!mapping.applicable_proposal_types.includes(normalizedEventType)) {
            throw new Error(`Mapping "${mapping.display_label}" not applicable to event "${normalizedEventType}"`);
        }
    });

    const debitTotal = entries.reduce((sum, entry) => sum + toCents(entry.debit_amount), 0);
    const creditTotal = entries.reduce((sum, entry) => sum + toCents(entry.credit_amount), 0);
    if (debitTotal !== creditTotal) {
        throw new Error(`Ledger imbalance: debit ${toMoney(debitTotal)} != credit ${toMoney(creditTotal)}`);
    }

    const { data: event, error: eventError } = await tx
        .from("ledger_events")
        .insert({
            org_id: context.org_id,
            event_type: normalizedEventType,
            proposal_id: context.proposal_id,
            payload: context.payload ?? { entries_count: entries.length },
            actor: context.actor,
        })
        .select("id,created_at")
        .single();

    if (eventError || !event) {
        throw new Error(`Failed to create ledger event: ${eventError?.message ?? "no event returned"}`);
    }

    const eventRecord = event as { id: string; created_at?: string };
    const { data: transaction, error: transactionError } = await tx
        .from("ledger_transactions")
        .insert({
            org_id: context.org_id,
            event_id: eventRecord.id,
            transaction_date: (eventRecord.created_at ?? new Date().toISOString()).slice(0, 10),
            description: normalizedEventType,
            currency: "JPY",
        })
        .select("id")
        .single();

    if (transactionError || !transaction) {
        throw new Error(`Failed to create ledger transaction: ${transactionError?.message ?? "no transaction returned"}`);
    }

    const transactionRecord = transaction as { id: string };
    const ledgerEntries = entries.map((entry, index) => ({
        transaction_id: transactionRecord.id,
        account_code: mappings[index].tax_account_code,
        debit_amount: toMoney(toCents(entry.debit_amount)),
        credit_amount: toMoney(toCents(entry.credit_amount)),
        display_label_snapshot: entry.display_label,
        memo: entry.display_label,
        line_number: index + 1,
    }));

    const { error: entriesError } = await tx
        .from("ledger_entries")
        .insert(ledgerEntries);

    if (entriesError) {
        throw new Error(`Failed to create ledger entries: ${entriesError.message}`);
    }

    return { ledger_event_id: eventRecord.id };
}
