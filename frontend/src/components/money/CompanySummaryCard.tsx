import styles from "./CompanySummaryCard.module.css";

interface CompanySummaryCardProps {
    profit: number;
    sales: number;
    expenses: number;
    sparkline: number[];
    overdueCount: number;
    pendingCount: number;
    onOverdueTap: () => void;
    onPendingTap: () => void;
}

const formatYen = (amount: number) =>
    new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);

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
    sparkline,
    overdueCount,
    pendingCount,
    onOverdueTap,
    onPendingTap,
}: CompanySummaryCardProps) {
    const isNegative = profit < 0;

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
                    <small>経費</small>
                    <b>{formatYen(expenses)}</b>
                </span>
            </div>

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
