import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../lib/supabaseClient";
import { bookLedgerEntry } from "../lib/ledger-helpers";
import type { ActorRef } from "./PolicyEngine";

export type DepreciableAssetClassification =
    | "expense_immediate"
    | "three_year_special"
    | "small_amount_special"
    | "standard_depreciation";

export type DepreciationCategory = "工具" | "車両" | "PC" | "機械" | "その他";
export type DepreciationMethod = "straight_line" | "declining_balance";

export interface DepreciableAssetRecord {
    id: string;
    org_id: string;
    member_id: string | null;
    category: DepreciationCategory | string;
    title: string;
    acquisition_amount: number | string;
    acquisition_date: string;
    classification: DepreciableAssetClassification;
    useful_life_years: number | null;
    depreciation_method: DepreciationMethod | null;
    residual_value: number | string | null;
    is_active: boolean;
    source_transaction_id: string | null;
    proposal_id: string | null;
    created_at: string;
    updated_at?: string;
}

export interface DepreciationScheduleRecord {
    id: string;
    asset_id: string;
    scheduled_month: string;
    amount: number | string;
    status: "pending" | "posted" | "cancelled";
    posted_at: string | null;
    ledger_event_id: string | null;
    created_at?: string;
}

export interface SpecialDepreciationUsage {
    org_id: string;
    fiscal_year: number;
    asset_count: number;
    used_amount: number;
    remaining_amount: number;
    annual_limit_amount: number;
}

export interface RegisterAssetInput {
    orgId: string;
    actor: ActorRef;
    memberId?: string | null;
    category: DepreciationCategory | string;
    title: string;
    acquisitionAmount: number;
    acquisitionDate: string;
    usefulLifeYears?: number | null;
    depreciationMethod?: DepreciationMethod | null;
    residualValue?: number | null;
    sourceTransactionId?: string | null;
    proposalId?: string | null;
    requestedClassification?: DepreciableAssetClassification | null;
}

export interface RegisterAssetResult {
    asset: DepreciableAssetRecord;
    schedules: DepreciationScheduleRecord[];
    classification: DepreciableAssetClassification;
    fiscal_year: number;
    special_limit: {
        annual_limit_amount: number;
        used_before: number;
        remaining_before: number;
        remaining_after: number;
    };
    warnings: string[];
}

const SPECIAL_LIMIT_AMOUNT = 3_000_000;
const IMMEDIATE_EXPENSE_THRESHOLD = 100_000;
const THREE_YEAR_THRESHOLD = 200_000;
const SMALL_SPECIAL_THRESHOLD = 300_000;
const THREE_YEAR_MONTHS = 36;

const DEFAULT_USEFUL_LIFE_YEARS: Record<string, number> = {
    車両: 6,
    PC: 4,
    工具: 5,
    機械: 8,
    その他: 5,
};

function assertPositiveAmount(amount: number, code: string): number {
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(code);
    }
    return Math.round(amount);
}

function assertDateOnly(value: string, code: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error(code);
    }
    return value;
}

function monthFromDate(value: string): string {
    return value.slice(0, 7);
}

function addMonths(month: string, offset: number): string {
    const [year, monthNumber] = month.split("-").map(Number);
    const date = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function splitAmountAcrossMonths(totalAmount: number, months: number): number[] {
    const total = assertPositiveAmount(totalAmount, "DEPRECIATION_AMOUNT_INVALID");
    if (!Number.isInteger(months) || months <= 0) {
        throw new Error("DEPRECIATION_MONTH_COUNT_INVALID");
    }
    const base = Math.round(total / months);
    const amounts = Array.from({ length: months }, () => base);
    const diff = total - amounts.reduce((sum, amount) => sum + amount, 0);
    amounts[amounts.length - 1] += diff;
    return amounts.filter((amount) => amount > 0);
}

export class DepreciationService {
    constructor(private tx: SupabaseClient = supabaseAdmin) {}

    classifyAsset(amount: number, usedSpecialAmount: number): DepreciableAssetClassification {
        const normalizedAmount = assertPositiveAmount(amount, "DEPRECIATION_AMOUNT_INVALID");
        const used = Math.max(0, Math.round(usedSpecialAmount || 0));

        if (normalizedAmount < IMMEDIATE_EXPENSE_THRESHOLD) {
            return "expense_immediate";
        }
        if (normalizedAmount < THREE_YEAR_THRESHOLD) {
            return "three_year_special";
        }
        if (normalizedAmount < SMALL_SPECIAL_THRESHOLD) {
            return used + normalizedAmount <= SPECIAL_LIMIT_AMOUNT
                ? "small_amount_special"
                : "standard_depreciation";
        }
        return "standard_depreciation";
    }

    defaultUsefulLifeYears(category: string): number {
        return DEFAULT_USEFUL_LIFE_YEARS[category] ?? DEFAULT_USEFUL_LIFE_YEARS.その他;
    }

    generateSchedule(input: {
        acquisitionAmount: number;
        acquisitionDate: string;
        classification: DepreciableAssetClassification;
        usefulLifeYears?: number | null;
        residualValue?: number | null;
    }): Array<{ scheduled_month: string; amount: number }> {
        const acquisitionDate = assertDateOnly(input.acquisitionDate, "DEPRECIATION_ACQUISITION_DATE_INVALID");
        const acquisitionAmount = assertPositiveAmount(input.acquisitionAmount, "DEPRECIATION_AMOUNT_INVALID");
        const residualValue = Math.max(0, Math.round(input.residualValue || 0));
        const depreciableAmount = Math.max(0, acquisitionAmount - residualValue);
        const startMonth = monthFromDate(acquisitionDate);

        if (input.classification === "expense_immediate") {
            return [];
        }

        if (input.classification === "small_amount_special") {
            return [{ scheduled_month: startMonth, amount: acquisitionAmount }];
        }

        const months = input.classification === "three_year_special"
            ? THREE_YEAR_MONTHS
            : (input.usefulLifeYears || 0) * 12;
        const amounts = splitAmountAcrossMonths(depreciableAmount, months);
        return amounts.map((amount, index) => ({
            scheduled_month: addMonths(startMonth, index),
            amount,
        }));
    }

    async getSpecialUsage(orgId: string, fiscalYear: number): Promise<SpecialDepreciationUsage> {
        const { data, error } = await this.tx
            .from("v_special_depreciation_usage")
            .select("*")
            .eq("org_id", orgId)
            .eq("fiscal_year", fiscalYear)
            .maybeSingle();

        if (error) {
            throw new Error(`DEPRECIATION_USAGE_FETCH_FAILED: ${error.message}`);
        }

        if (!data) {
            return {
                org_id: orgId,
                fiscal_year: fiscalYear,
                asset_count: 0,
                used_amount: 0,
                remaining_amount: SPECIAL_LIMIT_AMOUNT,
                annual_limit_amount: SPECIAL_LIMIT_AMOUNT,
            };
        }

        const row = data as Record<string, unknown>;
        return {
            org_id: orgId,
            fiscal_year: Number(row.fiscal_year),
            asset_count: Number(row.asset_count || 0),
            used_amount: Number(row.used_amount || 0),
            remaining_amount: Number(row.remaining_amount || 0),
            annual_limit_amount: Number(row.annual_limit_amount || SPECIAL_LIMIT_AMOUNT),
        };
    }

    async listAssets(orgId: string): Promise<Array<DepreciableAssetRecord & { schedule_count?: number }>> {
        const { data, error } = await this.tx
            .from("depreciable_assets")
            .select("*, depreciation_schedule(id,status,amount)")
            .eq("org_id", orgId)
            .eq("is_active", true)
            .order("acquisition_date", { ascending: false })
            .order("created_at", { ascending: false });

        if (error) {
            throw new Error(`DEPRECIATION_ASSET_LIST_FAILED: ${error.message}`);
        }

        return (data ?? []).map((row) => {
            const record = row as DepreciableAssetRecord & { depreciation_schedule?: unknown[] };
            return {
                ...record,
                schedule_count: Array.isArray(record.depreciation_schedule)
                    ? record.depreciation_schedule.length
                    : 0,
            };
        });
    }

    async registerAsset(input: RegisterAssetInput): Promise<RegisterAssetResult> {
        const acquisitionAmount = assertPositiveAmount(input.acquisitionAmount, "DEPRECIATION_AMOUNT_INVALID");
        const acquisitionDate = assertDateOnly(input.acquisitionDate, "DEPRECIATION_ACQUISITION_DATE_INVALID");
        const fiscalYear = Number(acquisitionDate.slice(0, 4));
        const usage = await this.getSpecialUsage(input.orgId, fiscalYear);
        const classification = this.classifyAsset(acquisitionAmount, usage.used_amount);
        const warnings: string[] = [];

        if (
            input.requestedClassification === "small_amount_special" &&
            classification === "standard_depreciation" &&
            acquisitionAmount >= THREE_YEAR_THRESHOLD &&
            acquisitionAmount < SMALL_SPECIAL_THRESHOLD
        ) {
            warnings.push("SPECIAL_LIMIT_EXCEEDED_FALLBACK_STANDARD");
        }

        const usefulLifeYears = classification === "standard_depreciation"
            ? input.usefulLifeYears || this.defaultUsefulLifeYears(input.category)
            : classification === "three_year_special"
                ? 3
                : input.usefulLifeYears ?? null;
        const depreciationMethod = classification === "standard_depreciation"
            ? input.depreciationMethod || "straight_line"
            : classification === "three_year_special"
                ? "straight_line"
                : null;
        const residualValue = input.residualValue ?? 0;

        const { data: asset, error: assetError } = await this.tx
            .from("depreciable_assets")
            .insert({
                org_id: input.orgId,
                member_id: input.memberId || null,
                category: input.category,
                title: input.title.trim(),
                acquisition_amount: acquisitionAmount,
                acquisition_date: acquisitionDate,
                classification,
                useful_life_years: usefulLifeYears,
                depreciation_method: depreciationMethod,
                residual_value: residualValue,
                source_transaction_id: input.sourceTransactionId || null,
                proposal_id: input.proposalId || null,
            })
            .select("*")
            .single();

        if (assetError || !asset) {
            throw new Error(`DEPRECIATION_ASSET_CREATE_FAILED: ${assetError?.message ?? "no asset returned"}`);
        }

        const assetRecord = asset as DepreciableAssetRecord;
        const scheduleRows = this.generateSchedule({
            acquisitionAmount,
            acquisitionDate,
            classification,
            usefulLifeYears,
            residualValue,
        }).map((schedule) => ({
            asset_id: assetRecord.id,
            scheduled_month: schedule.scheduled_month,
            amount: schedule.amount,
        }));

        let schedules: DepreciationScheduleRecord[] = [];
        if (scheduleRows.length > 0) {
            const { data: insertedSchedules, error: scheduleError } = await this.tx
                .from("depreciation_schedule")
                .insert(scheduleRows)
                .select("*")
                .order("scheduled_month", { ascending: true });

            if (scheduleError) {
                throw new Error(`DEPRECIATION_SCHEDULE_CREATE_FAILED: ${scheduleError.message}`);
            }

            schedules = (insertedSchedules ?? []) as DepreciationScheduleRecord[];
        }

        if (input.sourceTransactionId) {
            await this.tx
                .from("accounting_transactions")
                .update({ depreciable_asset_id: assetRecord.id })
                .eq("id", input.sourceTransactionId)
                .eq("org_id", input.orgId);
        }

        const remainingAfter = classification === "small_amount_special"
            ? Math.max(0, usage.remaining_amount - acquisitionAmount)
            : usage.remaining_amount;

        return {
            asset: assetRecord,
            schedules,
            classification,
            fiscal_year: fiscalYear,
            special_limit: {
                annual_limit_amount: usage.annual_limit_amount,
                used_before: usage.used_amount,
                remaining_before: usage.remaining_amount,
                remaining_after: remainingAfter,
            },
            warnings,
        };
    }

    async bookMonthlyDepreciation(month: string, actor?: ActorRef): Promise<{ month: string; posted_count: number }> {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
            throw new Error("DEPRECIATION_MONTH_INVALID");
        }

        const { data, error } = await this.tx
            .from("depreciation_schedule")
            .select("*, asset:depreciable_assets(*)")
            .eq("scheduled_month", month)
            .eq("status", "pending")
            .order("scheduled_month", { ascending: true });

        if (error) {
            throw new Error(`DEPRECIATION_SCHEDULE_FETCH_FAILED: ${error.message}`);
        }

        let postedCount = 0;
        for (const row of (data ?? []) as Array<DepreciationScheduleRecord & { asset?: DepreciableAssetRecord }>) {
            const asset = row.asset;
            if (!asset || !asset.is_active) {
                continue;
            }
            const amount = Number(row.amount);
            const result = await bookLedgerEntry(
                "depreciation.monthly",
                [
                    { display_label: "減価償却費", debit_amount: amount },
                    { display_label: "減価償却累計額", credit_amount: amount },
                ],
                {
                    org_id: asset.org_id,
                    proposal_id: asset.proposal_id,
                    actor: actor || { type: "system", id: "depreciation-cron", name: "Depreciation Cron" },
                },
                this.tx,
            );

            const { error: updateError } = await this.tx
                .from("depreciation_schedule")
                .update({
                    status: "posted",
                    posted_at: new Date().toISOString(),
                    ledger_event_id: result.ledger_event_id,
                })
                .eq("id", row.id)
                .eq("status", "pending");

            if (updateError) {
                throw new Error(`DEPRECIATION_SCHEDULE_POST_FAILED: ${updateError.message}`);
            }

            postedCount += 1;
        }

        return { month, posted_count: postedCount };
    }
}

export const depreciationService = new DepreciationService();
