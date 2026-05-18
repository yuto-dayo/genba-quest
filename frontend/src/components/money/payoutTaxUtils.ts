import type {
    ClassificationCheckStatus,
    MemberContractType,
    MemberInvoiceRegistrationStatus,
    MemberTaxClassification,
    TaxWithholdingCategory,
} from "../../lib/api";

export type PayoutTaxClassification = Pick<
    MemberTaxClassification,
    | "contract_type"
    | "tax_withholding_category"
    | "custom_withholding_rate"
    | "classification_check_status"
    | "classification_check_results"
    | "classification_notes"
    | "invoice_registration_status"
    | "invoice_registration_number"
    | "effective_from"
    | "decided_by"
    | "decided_at"
> | null;

export const UNKNOWN_INVOICE_STATUS: MemberInvoiceRegistrationStatus = "unknown";
export const UNKNOWN_CONTRACT_TYPE: MemberContractType = "undetermined";
export const UNKNOWN_CHECK_STATUS: ClassificationCheckStatus = "unset";
export const UNKNOWN_WITHHOLDING_CATEGORY: TaxWithholdingCategory = "none";

export function asOfDateFromMonth(month: string): string {
    return /^\d{4}-\d{2}$/.test(month) ? `${month}-01` : month;
}

export function getInvoiceStatus(classification: PayoutTaxClassification): MemberInvoiceRegistrationStatus {
    return classification?.invoice_registration_status ?? UNKNOWN_INVOICE_STATUS;
}

export function getContractType(classification: PayoutTaxClassification): MemberContractType {
    return classification?.contract_type ?? UNKNOWN_CONTRACT_TYPE;
}

export function getClassificationCheckStatus(classification: PayoutTaxClassification): ClassificationCheckStatus {
    return classification?.classification_check_status ?? UNKNOWN_CHECK_STATUS;
}

export function getTransitionalDeductionRate(asOf = new Date()): number {
    const time = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
    if (time < Date.UTC(2026, 9, 1)) return 1;
    if (time < Date.UTC(2029, 9, 1)) return 0.8;
    if (time < Date.UTC(2032, 9, 1)) return 0.5;
    return 0;
}

export function getTransitionalDeductionPercent(asOf?: Date): number {
    return Math.round(getTransitionalDeductionRate(asOf) * 100);
}

export function withholdingRate(classification: PayoutTaxClassification): number {
    if (!classification || classification.tax_withholding_category === "none") return 0;
    if (classification.tax_withholding_category === "10.21%") return 0.1021;
    return classification.custom_withholding_rate ?? 0;
}

export function isWithholdingApplicable(classification: PayoutTaxClassification): boolean {
    return withholdingRate(classification) > 0;
}

export function calculateWithholdingAmount(
    rewardAmount: number,
    classification: PayoutTaxClassification,
): number {
    const rate = withholdingRate(classification);
    return rate > 0 ? Math.round(rewardAmount * rate) : 0;
}

export function contractTypeLabel(type: MemberContractType): string {
    if (type === "subcontract") return "外注";
    if (type === "employee_like") return "給与寄り";
    return "未設定";
}

export function withholdingCategoryLabel(category: TaxWithholdingCategory): string {
    if (category === "10.21%") return "10.21%";
    if (category === "custom") return "個別設定";
    return "対象外";
}
