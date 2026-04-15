import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type AccountingTransactionRow = {
    id: string;
    status: string;
    amount_total: number | null;
    description: string | null;
    voids_transaction_id: string | null;
    voided_at: string | null;
    voided_by: string | null;
    void_reason: string | null;
    created_at: string;
};

type LinearChain = {
    root: AccountingTransactionRow;
    firstReversal: AccountingTransactionRow;
    descendants: AccountingTransactionRow[];
};

function createSupabaseAdmin(): SupabaseClient {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY の両方が必要です。");
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false },
    });
}

function parseArgs(argv: string[]): { apply: boolean } {
    return {
        apply: argv.includes("--apply"),
    };
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

async function fetchTransactions(supabase: SupabaseClient): Promise<AccountingTransactionRow[]> {
    const { data, error } = await supabase
        .from("accounting_transactions")
        .select("id, status, amount_total, description, voids_transaction_id, voided_at, voided_by, void_reason, created_at")
        .order("created_at", { ascending: true });

    if (error) {
        throw new Error(`accounting_transactions の取得に失敗しました: ${error.message}`);
    }

    return (data || []) as AccountingTransactionRow[];
}

function findLinearInvalidVoidChains(rows: AccountingTransactionRow[]): {
    chains: LinearChain[];
    skippedRoots: Array<{ rootId: string; reason: string; childIds: string[] }>;
} {
    const byId = new Map(rows.map((row) => [row.id, row]));
    const children = new Map<string, AccountingTransactionRow[]>();

    for (const row of rows) {
        if (!row.voids_transaction_id) {
            continue;
        }

        const arr = children.get(row.voids_transaction_id) || [];
        arr.push(row);
        children.set(row.voids_transaction_id, arr);
    }

    const chains: LinearChain[] = [];
    const skippedRoots: Array<{ rootId: string; reason: string; childIds: string[] }> = [];

    for (const row of rows) {
        if (row.voids_transaction_id !== null) {
            continue;
        }

        const firstChildren = children.get(row.id) || [];
        if (firstChildren.length === 0) {
            continue;
        }

        if (firstChildren.length > 1) {
            skippedRoots.push({
                rootId: row.id,
                reason: "root has multiple direct reversals",
                childIds: firstChildren.map((child) => child.id),
            });
            continue;
        }

        const firstReversal = firstChildren[0];
        const descendants: AccountingTransactionRow[] = [];
        let current = firstReversal;
        let valid = true;

        while (true) {
            const nextChildren = children.get(current.id) || [];
            if (nextChildren.length === 0) {
                break;
            }

            if (nextChildren.length > 1) {
                skippedRoots.push({
                    rootId: row.id,
                    reason: "chain branches after first reversal",
                    childIds: nextChildren.map((child) => child.id),
                });
                valid = false;
                break;
            }

            current = nextChildren[0];
            descendants.push(current);
        }

        if (!valid || descendants.length === 0) {
            continue;
        }

        if (!byId.has(firstReversal.id)) {
            continue;
        }

        chains.push({
            root: row,
            firstReversal,
            descendants,
        });
    }

    return { chains, skippedRoots };
}

async function ensureNoLinkedInvoices(supabase: SupabaseClient, transactionIds: string[]): Promise<void> {
    if (transactionIds.length === 0) {
        return;
    }

    const invoiceChecks = await Promise.all([
        supabase.from("accounting_invoices").select("id, transaction_id, source_transaction_id").or(
            `transaction_id.in.(${transactionIds.join(",")}),source_transaction_id.in.(${transactionIds.join(",")})`
        ),
        supabase.from("accounting_invoice_sources").select("id, source_transaction_id").in("source_transaction_id", transactionIds),
    ]);

    const [invoiceResult, invoiceSourceResult] = invoiceChecks;

    if (invoiceResult.error) {
        throw new Error(`accounting_invoices の検証に失敗しました: ${invoiceResult.error.message}`);
    }

    if (invoiceSourceResult.error && invoiceSourceResult.error.code !== "PGRST116") {
        throw new Error(`accounting_invoice_sources の検証に失敗しました: ${invoiceSourceResult.error.message}`);
    }

    const invoiceRows = invoiceResult.data || [];
    const invoiceSourceRows = invoiceSourceResult.data || [];
    if (invoiceRows.length > 0 || invoiceSourceRows.length > 0) {
        throw new Error("cleanup 対象に請求書関連データが紐づいているため停止しました");
    }
}

async function deleteJournalEntriesForTransactions(supabase: SupabaseClient, transactionIds: string[]): Promise<void> {
    if (transactionIds.length === 0) {
        return;
    }

    const { error } = await supabase
        .from("accounting_journal_entries")
        .delete()
        .in("transaction_id", transactionIds);

    if (error) {
        throw new Error(`accounting_journal_entries の削除に失敗しました: ${error.message}`);
    }
}

async function deleteTransactions(supabase: SupabaseClient, transactionIds: string[]): Promise<void> {
    if (transactionIds.length === 0) {
        return;
    }

    const { error } = await supabase
        .from("accounting_transactions")
        .delete()
        .in("id", transactionIds);

    if (error) {
        throw new Error(`accounting_transactions の削除に失敗しました: ${error.message}`);
    }
}

async function restoreFirstReversal(supabase: SupabaseClient, transactionId: string): Promise<void> {
    const { error } = await supabase
        .from("accounting_transactions")
        .update({
            status: "posted",
            voided_at: null,
            voided_by: null,
            void_reason: null,
        })
        .eq("id", transactionId);

    if (error) {
        throw new Error(`最初の逆仕訳の復元に失敗しました: ${error.message}`);
    }
}

function printPlan(chains: LinearChain[], skippedRoots: Array<{ rootId: string; reason: string; childIds: string[] }>): void {
    console.log("=== Invalid void chain cleanup plan ===");

    if (chains.length === 0) {
        console.log("対象チェーンはありません。");
    }

    for (const chain of chains) {
        console.log(JSON.stringify({
            rootId: chain.root.id,
            keepVoidOnRoot: chain.root.id,
            restoreFirstReversalToPosted: chain.firstReversal.id,
            deleteDescendants: chain.descendants.map((row) => row.id),
        }, null, 2));
    }

    if (skippedRoots.length > 0) {
        console.log("=== Skipped roots ===");
        console.log(JSON.stringify(skippedRoots, null, 2));
    }
}

async function main(): Promise<void> {
    const { apply } = parseArgs(process.argv.slice(2));
    const supabase = createSupabaseAdmin();
    const rows = await fetchTransactions(supabase);
    const { chains, skippedRoots } = findLinearInvalidVoidChains(rows);

    printPlan(chains, skippedRoots);

    if (!apply) {
        console.log("dry-run only. apply する場合は --apply を付けてください。");
        return;
    }

    if (skippedRoots.length > 0) {
        throw new Error("自動修復できない分岐チェーンがあるため停止しました。");
    }

    for (const chain of chains) {
        const deleteIds = chain.descendants.map((row) => row.id);
        await ensureNoLinkedInvoices(supabase, [chain.firstReversal.id, ...deleteIds]);
        await restoreFirstReversal(supabase, chain.firstReversal.id);
        await deleteJournalEntriesForTransactions(supabase, deleteIds);
        await deleteTransactions(supabase, deleteIds);
    }

    console.log(`cleanup completed: ${chains.length} chain(s) fixed`);
}

main().catch((error) => {
    console.error("cleanup-invalid-void-chains failed");
    console.error(error);
    process.exit(1);
});
