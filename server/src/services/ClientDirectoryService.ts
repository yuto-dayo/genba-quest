import { supabaseAdmin } from "../lib/supabaseClient";
import { resolveOrgId } from "../lib/org";

export type ClientDirectoryStatus = "active" | "deleted" | "all";

export interface ClientDirectoryRow {
    id: string;
    org_id: string;
    name: string;
    department: string | null;
    contact_person: string | null;
    email: string | null;
    phone: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
    address: string | null;
    billing_name: string | null;
    billing_postal_code: string | null;
    billing_prefecture: string | null;
    billing_city: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_address: string | null;
    payment_terms: string | null;
    invoice_notes_default: string | null;
    created_at: string;
    updated_at: string | null;
    deleted_at: string | null;
    deleted_by: string | null;
    deletion_reason: string | null;
}

const CLIENT_SELECT = "*";

export async function listClientsForOrg(orgId: string, status: ClientDirectoryStatus = "active"): Promise<ClientDirectoryRow[]> {
    let query = supabaseAdmin
        .from("clients")
        .select(CLIENT_SELECT)
        .eq("org_id", resolveOrgId(orgId))
        .order("name");

    if (status === "active") {
        query = query.is("deleted_at", null);
    } else if (status === "deleted") {
        query = query.not("deleted_at", "is", null);
    }

    const { data, error } = await query;

    if (error) {
        throw error;
    }

    return (data || []) as ClientDirectoryRow[];
}

export async function findClientForOrg(clientId: string, orgId: string): Promise<ClientDirectoryRow | null> {
    const { data, error } = await supabaseAdmin
        .from("clients")
        .select(CLIENT_SELECT)
        .eq("id", clientId)
        .eq("org_id", resolveOrgId(orgId))
        .maybeSingle();

    if (error) {
        throw error;
    }

    return (data as ClientDirectoryRow | null) || null;
}

export async function assertActiveClientForOrg(clientId: string, orgId: string): Promise<ClientDirectoryRow> {
    const client = await findClientForOrg(clientId, orgId);

    if (!client || client.deleted_at) {
        throw new Error("CLIENT_UNAVAILABLE");
    }

    return client;
}

export async function assertRestorableClientForOrg(clientId: string, orgId: string): Promise<ClientDirectoryRow> {
    const client = await findClientForOrg(clientId, orgId);

    if (!client || !client.deleted_at) {
        throw new Error("CLIENT_NOT_RESTORABLE");
    }

    return client;
}
