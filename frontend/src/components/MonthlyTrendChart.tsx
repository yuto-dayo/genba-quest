/**
 * 月次推移グラフ (PR #8) — 黒字可視化 MVP。
 * 直近 N ヶ月の利益を縦棒で表示し、選択中月をハイライト。
 * 棒タップで親の selectedMonth を切り替える。
 *
 * データソース: GET /api/v1/accounting/pl/trend
 */

import { useEffect, useState } from "react";
import { fetchPLTrend, type PLTrendMonth } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./MonthlyTrendChart.module.css";

interface Props {
    /** "YYYY-MM" 形式 — 範囲末尾 (= 現在の selectedMonth). */
    endMonth: string;
    /** デフォルト 6 ヶ月. 最大 24. */
    months?: number;
    /** 月切替コールバック. */
    onSelectMonth?: (month: string) => void;
}

const MAX_BAR_RATIO = 0.96; // 各半分の高さに対する棒の最大占有率

function formatMonthLabel(monthKey: string): string {
    const [, m] = monthKey.split("-");
    return `${Number(m)}月`;
}

function formatYenShort(amount: number): string {
    const abs = Math.abs(amount);
    if (abs >= 10_000_000) return `${Math.round(amount / 1_000_000) / 10}千万`;
    if (abs >= 10_000) return `${Math.round(amount / 10_000)}万`;
    return `¥${amount.toLocaleString()}`;
}

export function MonthlyTrendChart({ endMonth, months = 6, onSelectMonth }: Props) {
    const requestKey = `${endMonth}::${months}`;
    const [data, setData] = useState<{ key: string; months: PLTrendMonth[] } | null>(null);
    const [error, setError] = useState<{ key: string; message: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchPLTrend({ end: endMonth, months })
            .then((report) => {
                if (!cancelled) {
                    setData({ key: requestKey, months: report.months });
                    setError(null);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setError({ key: requestKey, message: getErrorMessage(err) });
                }
            });
        return () => {
            cancelled = true;
        };
    }, [endMonth, months, requestKey]);

    const isCurrentData = data?.key === requestKey;
    const isCurrentError = error?.key === requestKey;
    const loading = !isCurrentData && !isCurrentError;
    const trend = isCurrentData ? data!.months : null;

    if (isCurrentError && error) {
        return (
            <section className={styles.card} aria-label="月次推移">
                <div className={styles.header}>
                    <h2 className={styles.title}>月次推移</h2>
                </div>
                <div className={styles.errorBox}>
                    月次推移の取得に失敗: {error.message}
                </div>
            </section>
        );
    }

    if (loading || !trend) {
        return (
            <section className={styles.card} aria-label="月次推移">
                <div className={styles.header}>
                    <h2 className={styles.title}>月次推移</h2>
                    <span className={styles.hint}>直近 {months} ヶ月</span>
                </div>
                <div className={styles.skeleton} />
            </section>
        );
    }

    const maxAbsProfit = trend.reduce((max, m) => Math.max(max, Math.abs(m.profit)), 0);
    const hasAnyData = maxAbsProfit > 0 || trend.some((m) => m.sales !== 0 || m.expenses !== 0);

    return (
        <section className={styles.card} aria-label="月次推移">
            <div className={styles.header}>
                <h2 className={styles.title}>月次推移 (利益)</h2>
                <span className={styles.hint}>タップで月切替</span>
            </div>

            {!hasAnyData ? (
                <div className={styles.emptyState}>
                    直近 {months} ヶ月の取引がまだありません
                </div>
            ) : (
                <>
                    <div className={styles.chart}>
                        {maxAbsProfit > 0 && (
                            <>
                                <span className={`${styles.scaleHint} ${styles.scaleHintTop}`}>
                                    +{formatYenShort(maxAbsProfit)}
                                </span>
                                <span className={`${styles.scaleHint} ${styles.scaleHintBottom}`}>
                                    -{formatYenShort(maxAbsProfit)}
                                </span>
                            </>
                        )}
                        <span className={styles.zeroLine} aria-hidden />
                        {trend.map((m) => {
                            const isSelected = m.month === endMonth;
                            const isPositive = m.profit >= 0;
                            const ratio = maxAbsProfit > 0
                                ? Math.abs(m.profit) / maxAbsProfit
                                : 0;
                            // 0 でも視認できるように最小 2% を確保
                            const heightPct = m.profit === 0 ? 0 : Math.max(2, ratio * 100 * MAX_BAR_RATIO);
                            const colClasses = [
                                styles.col,
                                isSelected ? styles.colSelected : "",
                            ].filter(Boolean).join(" ");
                            const barClasses = [
                                styles.bar,
                                isPositive ? styles.barPos : styles.barNeg,
                            ].join(" ");

                            return (
                                <button
                                    key={m.month}
                                    type="button"
                                    className={colClasses}
                                    onClick={() => onSelectMonth?.(m.month)}
                                    aria-label={`${formatMonthLabel(m.month)} 利益 ${m.profit >= 0 ? "+" : ""}${formatYenShort(m.profit)}`}
                                    aria-current={isSelected ? "true" : undefined}
                                >
                                    <div className={styles.posHalf}>
                                        {isPositive && (
                                            <div className={barClasses} style={{ height: `${heightPct}%` }} />
                                        )}
                                    </div>
                                    <div className={styles.negHalf}>
                                        {!isPositive && m.profit < 0 && (
                                            <div className={barClasses} style={{ height: `${heightPct}%` }} />
                                        )}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                    <div className={styles.labelRow}>
                        {trend.map((m) => (
                            <span
                                key={m.month}
                                className={`${styles.label} ${m.month === endMonth ? styles.labelSelected : ""}`}
                            >
                                {formatMonthLabel(m.month)}
                            </span>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}
