import { useId } from "react";
import styles from "./PayoutBreakdownSection.module.css";

export interface PayoutBreakdownSectionProps {
    rewardAmount: number;
    reimbursementSettled: number;
    reimbursementCarryOver: number;
    withholdingAmount?: number;
    isWithholdingApplicable?: boolean;
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

export function PayoutBreakdownSection({
    rewardAmount,
    reimbursementSettled,
    reimbursementCarryOver,
    withholdingAmount = 0,
    isWithholdingApplicable = false,
}: PayoutBreakdownSectionProps) {
    const titleId = useId();
    const withholdingDeduction = isWithholdingApplicable ? withholdingAmount : 0;
    const payoutTotal = rewardAmount + reimbursementSettled - withholdingDeduction;

    return (
        <section className={styles.section} aria-labelledby={titleId}>
            <h3 id={titleId} className={styles.title}>
                内訳
            </h3>
            <div className={styles.tableWrap}>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th scope="col">税務区分</th>
                            <th scope="col">分類</th>
                            <th scope="col" className={styles.amount}>金額</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>売上</td>
                            <td>報酬</td>
                            <td className={styles.amount}>{formatYen(rewardAmount)}</td>
                        </tr>
                        <tr>
                            <td>控除</td>
                            <td>源泉徴収</td>
                            <td className={styles.amount}>
                                {isWithholdingApplicable ? formatYen(-withholdingAmount) : (
                                    <span className={styles.statusText}>対象外</span>
                                )}
                            </td>
                        </tr>
                        <tr>
                            <td>立替精算</td>
                            <td>立替戻し</td>
                            <td className={styles.amount}>{formatYen(reimbursementSettled)}</td>
                        </tr>
                        {reimbursementCarryOver > 0 && (
                            <tr>
                                <td>立替精算</td>
                                <td>立替持越し</td>
                                <td className={styles.amount}>{formatYen(reimbursementCarryOver)}</td>
                            </tr>
                        )}
                    </tbody>
                    <tfoot>
                        <tr>
                            <th scope="row" colSpan={2} className={styles.totalLabel}>
                                振込予定額
                            </th>
                            <td className={styles.totalAmount}>{formatYen(payoutTotal)}</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </section>
    );
}
