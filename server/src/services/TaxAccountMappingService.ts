import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseAdmin";

export type TaxAccountCategory = "income" | "expense" | "asset" | "liability" | "equity";

export interface TaxAccountMapping {
    id: string;
    org_id: string;
    display_label: string;
    tax_account_code: string;
    tax_account_name: string;
    category: TaxAccountCategory;
    applicable_proposal_types: string[];
    effective_from: string;
    effective_until: string | null;
    created_by: string;
    created_at: string;
}

export interface ReplaceTaxAccountMappingInput {
    mappingId: string;
    taxAccountCode: string;
    taxAccountName: string;
    category: TaxAccountCategory;
    applicableProposalTypes: string[];
    effectiveFrom: string;
    actorUserId: string;
    membershipId: string;
}

function asDateOnly(asOf: Date): string {
    if (Number.isNaN(asOf.getTime())) {
        throw new Error("INVALID_AS_OF_DATE");
    }
    return asOf.toISOString().slice(0, 10);
}

function getClient(tx?: SupabaseClient): SupabaseClient {
    return tx ?? supabaseAdmin;
}

export class TaxAccountMappingService {
    constructor(private orgId: string, private tx?: SupabaseClient) {}

    async getMapping(
        displayLabel: string,
        asOf: Date = new Date(),
        tx?: SupabaseClient,
    ): Promise<TaxAccountMapping> {
        const label = displayLabel.trim();
        if (!label) {
            throw new Error("DISPLAY_LABEL_REQUIRED");
        }

        const asOfDate = asDateOnly(asOf);
        const client = getClient(tx ?? this.tx);
        const { data, error } = await client
            .from("tax_account_mappings")
            .select("*")
            .eq("org_id", this.orgId)
            .eq("display_label", label)
            .lte("effective_from", asOfDate)
            .or(`effective_until.is.null,effective_until.gt.${asOfDate}`)
            .order("effective_from", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to fetch tax account mapping: ${error.message}`);
        }

        if (!data) {
            throw new Error(`No active mapping for "${label}" at ${asOf.toISOString()}`);
        }

        return data as TaxAccountMapping;
    }

    async getReverseMapping(
        taxAccountCode: string,
        asOf: Date = new Date(),
        tx?: SupabaseClient,
    ): Promise<string | null> {
        const code = taxAccountCode.trim();
        if (!code) {
            throw new Error("TAX_ACCOUNT_CODE_REQUIRED");
        }

        const asOfDate = asDateOnly(asOf);
        const client = getClient(tx ?? this.tx);
        const { data, error } = await client
            .from("tax_account_mappings")
            .select("display_label")
            .eq("org_id", this.orgId)
            .eq("tax_account_code", code)
            .lte("effective_from", asOfDate)
            .or(`effective_until.is.null,effective_until.gt.${asOfDate}`)
            .order("display_label", { ascending: true })
            .order("effective_from", { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw new Error(`Failed to reverse tax account mapping: ${error.message}`);
        }

        return typeof data?.display_label === "string" ? data.display_label : null;
    }

    async listMappings(asOf: Date = new Date(), tx?: SupabaseClient): Promise<TaxAccountMapping[]> {
        const asOfDate = asDateOnly(asOf);
        const client = getClient(tx ?? this.tx);
        const { data, error } = await client
            .from("tax_account_mappings")
            .select("*")
            .eq("org_id", this.orgId)
            .lte("effective_from", asOfDate)
            .or(`effective_until.is.null,effective_until.gt.${asOfDate}`)
            .order("display_label", { ascending: true })
            .order("effective_from", { ascending: false });

        if (error) {
            throw new Error(`Failed to list tax account mappings: ${error.message}`);
        }

        return (data ?? []) as TaxAccountMapping[];
    }

    async listHistory(displayLabel?: string, tx?: SupabaseClient): Promise<TaxAccountMapping[]> {
        const client = getClient(tx ?? this.tx);
        let query = client
            .from("tax_account_mappings")
            .select("*")
            .eq("org_id", this.orgId)
            .order("display_label", { ascending: true })
            .order("effective_from", { ascending: false });

        const label = displayLabel?.trim();
        if (label) {
            query = query.eq("display_label", label);
        }

        const { data, error } = await query;
        if (error) {
            throw new Error(`Failed to list tax account mapping history: ${error.message}`);
        }

        return (data ?? []) as TaxAccountMapping[];
    }

    async replaceMapping(input: ReplaceTaxAccountMappingInput, tx?: SupabaseClient): Promise<TaxAccountMapping> {
        const client = getClient(tx ?? this.tx);
        const { data, error } = await client
            .rpc("rpc_replace_tax_account_mapping", {
                p_org_id: this.orgId,
                p_mapping_id: input.mappingId,
                p_actor_user_id: input.actorUserId,
                p_membership_id: input.membershipId,
                p_tax_account_code: input.taxAccountCode,
                p_tax_account_name: input.taxAccountName,
                p_category: input.category,
                p_applicable_proposal_types: input.applicableProposalTypes,
                p_effective_from: input.effectiveFrom,
            })
            .single();

        if (error) {
            throw new Error(error.message);
        }

        return data as TaxAccountMapping;
    }
}
