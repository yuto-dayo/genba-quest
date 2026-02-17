export interface JournalLine {
    accountCode: string;
    accountName: string;
    debit: number;
    credit: number;
    taxRate?: number;
    taxType?: string;
}

export function generateExpenseJournalLines(
    subtotal: number,
    taxAmount: number,
    total: number,
    taxCategory: string = "10_STANDARD"
): JournalLine[] {
    if (total <= 0) return [];

    const taxRate = taxCategory === "08_REDUCED" ? 0.08 : 0.1;
    const expenseAmount = subtotal > 0 ? subtotal : taxAmount > 0 ? total - taxAmount : total;
    const lines: JournalLine[] = [];

    lines.push({
        accountCode: "5100",
        accountName: "経費",
        debit: expenseAmount,
        credit: 0,
        taxRate,
        taxType: "taxable",
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

    const taxRate = taxCategory === "08_REDUCED" ? 0.08 : 0.1;
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
        taxType: "taxable",
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
