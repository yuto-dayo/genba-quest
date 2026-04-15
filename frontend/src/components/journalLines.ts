export interface JournalLine {
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    taxRate?: number;
    taxType?: string;
}

export type ExpenseCategory = "material" | "tool" | "travel" | "food" | "fuel" | "utility" | "other";

const EXPENSE_ACCOUNT_MAP: Record<ExpenseCategory, { accountCode: string; accountName: string }> = {
    material: { accountCode: "5100", accountName: "材料費" },
    tool: { accountCode: "5200", accountName: "工具備品費" },
    travel: { accountCode: "5300", accountName: "交通費" },
    food: { accountCode: "5400", accountName: "会議費" },
    fuel: { accountCode: "5900", accountName: "燃料費" },
    utility: { accountCode: "5900", accountName: "光熱費" },
    other: { accountCode: "5900", accountName: "その他経費" },
};

function resolveTaxRate(taxCategory: string): number {
    if (taxCategory === "08_REDUCED") {
        return 0.08;
    }
    if (taxCategory === "00_EXEMPT" || taxCategory === "00_TAXFREE") {
        return 0;
    }
    return 0.1;
}

function resolveTaxType(taxCategory: string): string {
    if (taxCategory === "00_EXEMPT") {
        return "exempt";
    }
    if (taxCategory === "00_TAXFREE") {
        return "taxfree";
    }
    return "taxable";
}

export function normalizeNetSubtotal(
    subtotal: number,
    taxAmount: number,
    total: number
): number {
    const tolerance = 1;
    const safeSubtotal = Number.isFinite(subtotal) ? subtotal : 0;
    const safeTaxAmount = Number.isFinite(taxAmount) ? taxAmount : 0;
    const safeTotal = Number.isFinite(total) ? total : 0;

    if (safeTotal <= 0) {
        return Math.max(safeSubtotal, 0);
    }

    if (safeTaxAmount <= 0) {
        if (safeSubtotal > 0 && safeSubtotal <= safeTotal + tolerance) {
            return safeSubtotal;
        }
        return safeTotal;
    }

    const derivedNet = Math.max(safeTotal - safeTaxAmount, 0);

    if (safeSubtotal <= 0) {
        return derivedNet;
    }

    const subtotalLooksLikeTotal = Math.abs(safeSubtotal - safeTotal) <= tolerance;
    const subtotalPlusTaxExceedsTotal = safeSubtotal + safeTaxAmount > safeTotal + tolerance;
    const subtotalExceedsTotal = safeSubtotal > safeTotal + tolerance;

    if (subtotalLooksLikeTotal || subtotalPlusTaxExceedsTotal || subtotalExceedsTotal) {
        return derivedNet;
    }

    return safeSubtotal;
}

export function generateExpenseJournalLines(
    subtotal: number,
    taxAmount: number,
    total: number,
    taxCategory: string = "10_STANDARD",
    category: ExpenseCategory = "other"
): JournalLine[] {
    if (total <= 0) return [];

    const taxRate = resolveTaxRate(taxCategory);
    const expenseAmount = normalizeNetSubtotal(subtotal, taxAmount, total);
    const lines: JournalLine[] = [];
    const expenseAccount = EXPENSE_ACCOUNT_MAP[category] || EXPENSE_ACCOUNT_MAP.other;

    lines.push({
        accountCode: expenseAccount.accountCode,
        accountName: expenseAccount.accountName,
        debit: expenseAmount,
        credit: 0,
        taxRate,
        taxType: resolveTaxType(taxCategory),
    });

    if (taxAmount > 0) {
        lines.push({
            accountCode: "1500",
            accountName: "仮払消費税",
            debit: taxAmount,
            credit: 0,
        });
    }

    lines.push({
        accountCode: "1100",
        accountName: "現金",
        debit: 0,
        credit: total,
    });

    return lines;
}

export function generateSalesJournalLines(
    subtotal: number,
    taxAmount: number,
    total: number,
    taxCategory: string = "10_STANDARD"
): JournalLine[] {
    if (total <= 0) return [];

    const taxRate = resolveTaxRate(taxCategory);
    const salesAmount = subtotal > 0 ? subtotal : taxAmount > 0 ? total - taxAmount : total;
    const lines: JournalLine[] = [];

    lines.push({
        accountCode: "1200",
        accountName: "売掛金",
        debit: total,
        credit: 0,
    });

    lines.push({
        accountCode: "4100",
        accountName: "売上高",
        debit: 0,
        credit: salesAmount,
        taxRate,
        taxType: resolveTaxType(taxCategory),
    });

    if (taxAmount > 0) {
        lines.push({
            accountCode: "2500",
            accountName: "仮受消費税",
            debit: 0,
            credit: taxAmount,
        });
    }

    return lines;
}
