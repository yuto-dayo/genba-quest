import { useMemo } from "react";
import { CheckCircle, AlertTriangle } from "lucide-react";
import type { JournalLine } from "./journalLines";
import styles from "./JournalPreview.module.css";

interface JournalPreviewProps {
    lines: JournalLine[];
    title?: string;
}

export function JournalPreview({ lines, title = "仕訳プレビュー" }: JournalPreviewProps) {
    const { totalDebit, totalCredit, isBalanced } = useMemo(() => {
        const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
        const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
        return {
            totalDebit,
            totalCredit,
            isBalanced: Math.abs(totalDebit - totalCredit) < 1,
        };
    }, [lines]);

    if (lines.length === 0) {
        return null;
    }

    return (
        <div className={styles.journalPreview}>
            <div className={styles.header}>
                <span className={styles.title}>{title}</span>
                <span className={`${styles.status} ${isBalanced ? styles.balanced : styles.unbalanced}`}>
                    {isBalanced ? (
                        <>
                            <CheckCircle size={14} />
                            貸借一致
                        </>
                    ) : (
                        <>
                            <AlertTriangle size={14} />
                            貸借不一致
                        </>
                    )}
                </span>
            </div>
            <table className={styles.table}>
                <thead>
                    <tr>
                        <th className={styles.accountCol}>勘定科目</th>
                        <th className={styles.amountCol}>借方</th>
                        <th className={styles.amountCol}>貸方</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map((line, i) => (
                        <tr key={i} className={styles.row}>
                            <td className={styles.accountCell}>
                                <span className={styles.accountCode}>{line.accountCode}</span>
                                <span className={styles.accountName}>{line.accountName}</span>
                                {line.taxRate && (
                                    <span className={styles.taxBadge}>
                                        {(line.taxRate * 100).toFixed(0)}%
                                    </span>
                                )}
                            </td>
                            <td className={`${styles.amountCell} ${line.debit > 0 ? styles.hasAmount : ""}`}>
                                {line.debit > 0 ? `¥${line.debit.toLocaleString()}` : ""}
                            </td>
                            <td className={`${styles.amountCell} ${line.credit > 0 ? styles.hasAmount : ""}`}>
                                {line.credit > 0 ? `¥${line.credit.toLocaleString()}` : ""}
                            </td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className={styles.totalRow}>
                        <td className={styles.totalLabel}>合計</td>
                        <td className={styles.totalAmount}>¥{totalDebit.toLocaleString()}</td>
                        <td className={styles.totalAmount}>¥{totalCredit.toLocaleString()}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}
