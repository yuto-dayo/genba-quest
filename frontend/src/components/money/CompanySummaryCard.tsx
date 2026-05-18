import type { MonthlyDeductibleAmount } from "../../lib/api";
import { nextTransitionalRateChange } from "../../lib/transitional-deduction";
import styles from "./CompanySummaryCard.module.css";

interface CompanySummaryCardProps {
    profit: number;
    sales: number;
    expenses: number;
    completedCogs: number;
    overhead: number;
    workInProgress: number;
    depreciationExpense?: number;
    sparkline: number[];
    overdueCount: number;
    pendingCount: number;
    monthlyDeductible?: MonthlyDeductibleAmount | null;
    onOverdueTap: () => void;
    onPendingTap: () => void;
}

const formatYen = (amount: number) =>
    new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);

const formatPercent = (rate: number) => `${Math.round(rate * 100)}%`;
const formatDate = (isoDate: string) => isoDate.replace(/-/g, "/");

function buildPoints(values: number[]) {
    const safeValues = values.length > 1 ? values : [0, values[0] ?? 0];
    const min = Math.min(...safeValues);
    const max = Math.max(...safeValues);
    const range = max - min || 1;
    return safeValues
        .map((value, index) => {
            const x = (index / Math.max(safeValues.length - 1, 1)) * 100;
            const y = 36 - ((value - min) / range) * 28;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
}

export function CompanySummaryCard({
    profit,
    sales,
    expenses,
    completedCogs,
    overhead,
    workInProgress,
    depreciationExpense = 0,
    sparkline,
    overdueCount,
    pendingCount,
    monthlyDeductible,
    onOverdueTap,
    onPendingTap,
}: CompanySummaryCardProps) {
    const isNegative = profit < 0;
    const nextRateChange = monthlyDeductible
        ? nextTransitionalRateChange(`${monthlyDeductible.month}-01`)
        : null;

    return (
        <article className={styles.card} aria-label="会社の月次サマリー">
            <div className={styles.topRow}>
                <div>
                    <span className={styles.label}>利益</span>
                    <strong className={`${styles.profit} ${isNegative ? styles.negative : ""}`}>
                        {formatYen(profit)}
                    </strong>
                </div>
                <div className={styles.sparkline} aria-hidden="true">
                    <svg viewBox="0 0 100 40" focusable="false">
                        <polyline points={buildPoints(sparkline)} />
                    </svg>
                </div>
            </div>

            <div className={styles.metrics}>
                <span>
                    <small>売上</small>
                    <b>{formatYen(sales)}</b>
                </span>
                <span>
                    <small>完成工事原価</small>
                    <b>{formatYen(completedCogs)}</b>
                </span>
                <span>
                    <small>一般経費</small>
                    <b>{formatYen(overhead)}</b>
                </span>
                <span>
                    <small>経費合計</small>
                    <b>{formatYen(expenses)}</b>
                </span>
            </div>

            <div className={styles.balanceRow}>
                <span>
                    <small>未成工事支出金</small>
                    <b>{formatYen(workInProgress)}</b>
                </span>
                <span>
                    <small>今月の減価償却費</small>
                    <b>{formatYen(depreciationExpense)}</b>
                </span>
            </div>

            {monthlyDeductible && (
                <div className={styles.deductionNote}>
                    <span>
                        <small>仕入税額控除可能額</small>
                        <b>
                            {formatYen(monthlyDeductible.deductible_amount)}
                            <em>経過措置 {formatPercent(monthlyDeductible.transitional_rate)}</em>
                        </b>
                    </span>
                    {nextRateChange && (
                        <p>
                            {formatDate(nextRateChange.date)} から控除率が {formatPercent(nextRateChange.fromRate)} →{" "}
                            {formatPercent(nextRateChange.toRate)} に変わります
                        </p>
                    )}
                </div>
            )}

            {(overdueCount > 0 || pendingCount > 0) && (
                <div className={styles.alerts} aria-label="注意が必要な項目">
                    {overdueCount > 0 && (
                        <button type="button" className={styles.alertChip} onClick={onOverdueTap}>
                            遅延 {overdueCount}
                        </button>
                    )}
                    {pendingCount > 0 && (
                        <button type="button" className={styles.alertChip} onClick={onPendingTap}>
                            未請求 {pendingCount}
                        </button>
                    )}
                </div>
            )}
        </article>
    );
}
