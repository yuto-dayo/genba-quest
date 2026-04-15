import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_ORG_ID = "00000000-0000-0000-0000-000000000001";

const DEMO_CLIENT_NAMES = [
    "ABC建設株式会社",
    "山田工務店",
    "東京ハウジング",
];

const DEMO_CLIENT_EMAILS = [
    "tanaka@abc-kensetsu.co.jp",
    "yamada@yamada-komu.co.jp",
    "suzuki@tokyo-housing.co.jp",
];

const DEMO_SITE_NAMES = [
    "渋谷タワー新築工事",
    "新宿オフィスリノベ",
    "品川マンション改修",
    "目黒戸建て内装",
    "池袋商業施設",
];

type ClientRow = {
    id: string;
    name: string | null;
    email: string | null;
};

type SiteRow = {
    id: string;
    name: string | null;
    client_id: string | null;
};

type ProposalRow = {
    id: string;
    type: string;
    description: string | null;
    payload: Record<string, unknown> | null;
    result_event_id: string | null;
};

type FocusItemRow = {
    id: string;
    site_id: string | null;
    site_name_snapshot: string | null;
};

type DocumentRow = {
    id: string;
    site_id: string | null;
    client_id: string | null;
};

type AccountingTransactionRow = {
    id: string;
    site_id: string | null;
    client_id: string | null;
};

type CleanupTargets = {
    clients: ClientRow[];
    sites: SiteRow[];
    proposals: ProposalRow[];
    focusItems: FocusItemRow[];
    documents: DocumentRow[];
    accountingTransactions: AccountingTransactionRow[];
    ledgerEventIds: string[];
};

function createSupabaseAdmin(): SupabaseClient {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
        throw new Error("SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY の両方が必要です。");
    }

    return createClient(supabaseUrl, serviceRoleKey);
}

function chunk<T>(items: T[], size = 100): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
        chunks.push(items.slice(index, index + size));
    }
    return chunks;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return Array.from(new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0)));
}

function asString(value: unknown): string | null {
    return typeof value === "string" && value.length > 0 ? value : null;
}

function matchesDemoText(value: string | null | undefined): boolean {
    if (!value) {
        return false;
    }

    return value.startsWith("シード") || DEMO_SITE_NAMES.some((name) => value.includes(name));
}

async function deleteByIds(
    supabase: SupabaseClient,
    table: string,
    column: string,
    ids: string[]
): Promise<number> {
    let deleted = 0;

    for (const batch of chunk(ids)) {
        const { error } = await supabase
            .from(table)
            .delete()
            .in(column, batch);

        if (error) {
            throw new Error(`${table} の削除に失敗しました: ${error.message}`);
        }

        deleted += batch.length;
    }

    return deleted;
}

async function collectClients(supabase: SupabaseClient): Promise<ClientRow[]> {
    const { data, error } = await supabase
        .from("clients")
        .select("id, name, email");

    if (error) {
        throw new Error(`clients の取得に失敗しました: ${error.message}`);
    }

    return ((data || []) as ClientRow[]).filter((client) =>
        DEMO_CLIENT_NAMES.includes(client.name || "") ||
        DEMO_CLIENT_EMAILS.includes(client.email || "")
    );
}

async function collectSites(supabase: SupabaseClient): Promise<SiteRow[]> {
    const { data, error } = await supabase
        .from("sites")
        .select("id, name, client_id");

    if (error) {
        throw new Error(`sites の取得に失敗しました: ${error.message}`);
    }

    return ((data || []) as SiteRow[]).filter((site) => DEMO_SITE_NAMES.includes(site.name || ""));
}

async function collectProposals(supabase: SupabaseClient, siteIds: Set<string>): Promise<ProposalRow[]> {
    const { data, error } = await supabase
        .from("proposals")
        .select("id, type, description, payload, result_event_id")
        .eq("org_id", DEFAULT_ORG_ID)
        .limit(5000);

    if (error) {
        throw new Error(`proposals の取得に失敗しました: ${error.message}`);
    }

    return ((data || []) as ProposalRow[]).filter((proposal) => {
        const payload = proposal.payload || {};
        const payloadSiteId = asString(payload.site_id);
        const payloadSiteName = asString(payload.site_name) || asString(payload.name);
        const payloadDescription = asString(payload.description);
        const payloadNote = asString(payload.note);

        return (
            (payloadSiteId !== null && siteIds.has(payloadSiteId)) ||
            matchesDemoText(proposal.description) ||
            matchesDemoText(payloadSiteName) ||
            matchesDemoText(payloadDescription) ||
            matchesDemoText(payloadNote)
        );
    });
}

async function collectFocusItems(supabase: SupabaseClient, siteIds: Set<string>): Promise<FocusItemRow[]> {
    const { data, error } = await supabase
        .from("focus_items")
        .select("id, site_id, site_name_snapshot");

    if (error) {
        if (error.message.includes("relation") && error.message.includes("focus_items")) {
            return [];
        }
        throw new Error(`focus_items の取得に失敗しました: ${error.message}`);
    }

    return ((data || []) as FocusItemRow[]).filter((item) =>
        (item.site_id !== null && siteIds.has(item.site_id)) ||
        DEMO_SITE_NAMES.includes(item.site_name_snapshot || "")
    );
}

async function collectDocuments(supabase: SupabaseClient, siteIds: Set<string>): Promise<DocumentRow[]> {
    const { data, error } = await supabase
        .from("documents")
        .select("id, site_id, client_id");

    if (error) {
        throw new Error(`documents の取得に失敗しました: ${error.message}`);
    }

    return ((data || []) as DocumentRow[]).filter((document) =>
        document.site_id !== null && siteIds.has(document.site_id)
    );
}

async function collectAccountingTransactions(
    supabase: SupabaseClient,
    siteIds: Set<string>
): Promise<AccountingTransactionRow[]> {
    const { data, error } = await supabase
        .from("accounting_transactions")
        .select("id, site_id, client_id");

    if (error) {
        throw new Error(`accounting_transactions の取得に失敗しました: ${error.message}`);
    }

    return ((data || []) as AccountingTransactionRow[]).filter((transaction) =>
        transaction.site_id !== null && siteIds.has(transaction.site_id)
    );
}

async function collectLedgerEventIds(
    supabase: SupabaseClient,
    proposalIds: string[],
    resultEventIds: string[]
): Promise<string[]> {
    const ids = new Set<string>(resultEventIds);

    for (const batch of chunk(proposalIds)) {
        const { data, error } = await supabase
            .from("ledger_events")
            .select("id")
            .in("proposal_id", batch);

        if (error) {
            throw new Error(`ledger_events の取得に失敗しました: ${error.message}`);
        }

        for (const row of data || []) {
            const eventId = asString((row as { id?: unknown }).id);
            if (eventId) {
                ids.add(eventId);
            }
        }
    }

    return Array.from(ids);
}

async function collectClientIdsStillInUse(
    supabase: SupabaseClient,
    clientIds: string[]
): Promise<Set<string>> {
    const inUse = new Set<string>();

    for (const batch of chunk(clientIds)) {
        const [sitesResponse, documentsResponse, transactionsResponse] = await Promise.all([
            supabase.from("sites").select("client_id").in("client_id", batch),
            supabase.from("documents").select("client_id").in("client_id", batch),
            supabase.from("accounting_transactions").select("client_id").in("client_id", batch),
        ]);

        for (const response of [sitesResponse, documentsResponse, transactionsResponse]) {
            if (response.error) {
                throw new Error(`client 参照の確認に失敗しました: ${response.error.message}`);
            }

            for (const row of response.data || []) {
                const clientId = asString((row as { client_id?: unknown }).client_id);
                if (clientId) {
                    inUse.add(clientId);
                }
            }
        }
    }

    return inUse;
}

async function collectTargets(supabase: SupabaseClient): Promise<CleanupTargets> {
    const [clients, sites] = await Promise.all([
        collectClients(supabase),
        collectSites(supabase),
    ]);

    const siteIdSet = new Set(uniqueStrings(sites.map((site) => site.id)));
    const [proposals, focusItems, documents, accountingTransactions] = await Promise.all([
        collectProposals(supabase, siteIdSet),
        collectFocusItems(supabase, siteIdSet),
        collectDocuments(supabase, siteIdSet),
        collectAccountingTransactions(supabase, siteIdSet),
    ]);

    const proposalIds = uniqueStrings(proposals.map((proposal) => proposal.id));
    const resultEventIds = uniqueStrings(proposals.map((proposal) => proposal.result_event_id));
    const ledgerEventIds = await collectLedgerEventIds(supabase, proposalIds, resultEventIds);

    return {
        clients,
        sites,
        proposals,
        focusItems,
        documents,
        accountingTransactions,
        ledgerEventIds,
    };
}

function printSummary(targets: CleanupTargets): void {
    const siteNames = Array.from(new Set(targets.sites.map((site) => site.name).filter(Boolean)));
    const clientNames = Array.from(new Set(targets.clients.map((client) => client.name).filter(Boolean)));

    console.log("🧹 Demo cleanup target summary");
    console.log(`- clients: ${targets.clients.length}`);
    console.log(`- sites: ${targets.sites.length}`);
    console.log(`- proposals: ${targets.proposals.length}`);
    console.log(`- ledger_events: ${targets.ledgerEventIds.length}`);
    console.log(`- focus_items: ${targets.focusItems.length}`);
    console.log(`- documents: ${targets.documents.length}`);
    console.log(`- accounting_transactions: ${targets.accountingTransactions.length}`);

    if (clientNames.length > 0) {
        console.log(`- client names: ${clientNames.join(", ")}`);
    }

    if (siteNames.length > 0) {
        console.log(`- site names: ${siteNames.join(", ")}`);
    }
}

async function clearProfileSiteLinks(supabase: SupabaseClient, siteIds: string[]): Promise<void> {
    for (const batch of chunk(siteIds)) {
        const { error } = await supabase
            .from("profiles")
            .update({ current_site_id: null })
            .in("current_site_id", batch);

        if (error) {
            throw new Error(`profiles.current_site_id の解除に失敗しました: ${error.message}`);
        }
    }
}

async function cleanupDemoData(supabase: SupabaseClient, targets: CleanupTargets): Promise<void> {
    const siteIds = uniqueStrings(targets.sites.map((site) => site.id));
    const proposalIds = uniqueStrings(targets.proposals.map((proposal) => proposal.id));
    const focusItemIds = uniqueStrings(targets.focusItems.map((item) => item.id));
    const documentIds = uniqueStrings(targets.documents.map((document) => document.id));
    const transactionIds = uniqueStrings(targets.accountingTransactions.map((transaction) => transaction.id));
    const clientIds = uniqueStrings(targets.clients.map((client) => client.id));

    if (siteIds.length > 0) {
        await clearProfileSiteLinks(supabase, siteIds);
    }

    if (focusItemIds.length > 0) {
        console.log(`Deleting focus_items: ${focusItemIds.length}`);
        await deleteByIds(supabase, "focus_items", "id", focusItemIds);
    }

    if (transactionIds.length > 0) {
        console.log(`Deleting accounting_journal_entries: ${transactionIds.length}`);
        await deleteByIds(supabase, "accounting_journal_entries", "transaction_id", transactionIds);
        console.log(`Deleting accounting_transactions: ${transactionIds.length}`);
        await deleteByIds(supabase, "accounting_transactions", "id", transactionIds);
    }

    if (documentIds.length > 0) {
        console.log(`Deleting documents: ${documentIds.length}`);
        await deleteByIds(supabase, "documents", "id", documentIds);
    }

    if (targets.ledgerEventIds.length > 0) {
        console.log(`Deleting ledger_events: ${targets.ledgerEventIds.length}`);
        await deleteByIds(supabase, "ledger_events", "id", targets.ledgerEventIds);
    }

    if (proposalIds.length > 0) {
        console.log(`Deleting proposals: ${proposalIds.length}`);
        await deleteByIds(supabase, "proposals", "id", proposalIds);
    }

    if (siteIds.length > 0) {
        console.log(`Deleting sites: ${siteIds.length}`);
        await deleteByIds(supabase, "sites", "id", siteIds);
    }

    if (clientIds.length > 0) {
        const inUseClientIds = await collectClientIdsStillInUse(supabase, clientIds);
        const deletableClientIds = clientIds.filter((clientId) => !inUseClientIds.has(clientId));

        if (inUseClientIds.size > 0) {
            console.warn(`Skipping clients still referenced by remaining data: ${inUseClientIds.size}`);
        }

        if (deletableClientIds.length > 0) {
            console.log(`Deleting clients: ${deletableClientIds.length}`);
            await deleteByIds(supabase, "clients", "id", deletableClientIds);
        }
    }
}

async function main(): Promise<void> {
    const apply = process.argv.includes("--apply");
    const supabase = createSupabaseAdmin();
    const before = await collectTargets(supabase);

    printSummary(before);

    if (!apply) {
        console.log("\nDry run only. 実際に削除する場合は `--apply` を付けて再実行してください。");
        return;
    }

    await cleanupDemoData(supabase, before);

    const after = await collectTargets(supabase);
    console.log("\n✅ Cleanup complete");
    printSummary(after);
}

main().catch((error) => {
    console.error("❌ demo cleanup failed");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
