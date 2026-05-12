import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import {
    fetchOutstandingInvoicesSummary,
    type OutstandingInvoicesSummary,
} from "../lib/api";
import styles from "./OutstandingInvoicesCard.module.css";

function formatYen(amount: number): string {
    return `¥${amount.toLocaleString()}`;
}

const STATUS_LABEL = {
    issued: "未払",
    paid: "支払済",
    void: "無効",
} as const;

/**
 * admin 向け請求書サマリーカード。
 * 個人情報は一切出さず、status × period_month の件数と金額だけ表示する。
 * 「誰の請求書か」を admin 画面で覗けないことが本コンポーネントの核。
 */
export function OutstandingInvoicesCard() {
    const [data, setData] = useState<OutstandingInvoicesSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const summary = await fetchOutstandingInvoicesSummary();
                if (cancelled) return;
                setData(summary);
            } catch (err) {
                if (cancelled) return;
                setError(err instanceof Error ? err.message : "集計の取得に失敗しました");
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    if (error) {
        return (
            <section className={styles.card}>
                <div className={styles.header}>
                    <h3 className={styles.title}>未請求残</h3>
                </div>
                <p className={styles.empty}>{error}</p>
            </section>
        );
    }

    if (!data) {
        return null;
    }

    const { summary, totals } = data;

    return (
        <section className={styles.card} aria-label="未請求残サマリー">
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>未請求残</h3>
                    <p className={styles.subtitle}>
                        メンバー請求書の発行・支払い状況（個人情報は含みません）
                    </p>
                </div>
                <Wallet size={20} aria-hidden="true" />
            </div>

            <div className={styles.metricRow}>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>未払残</span>
                    <span className={styles.metricValue}>{formatYen(totals.issued.amount)}</span>
                    <span className={styles.metricSub}>{totals.issued.count} 件</span>
                </div>
                <div className={styles.metric}>
                    <span className={styles.metricLabel}>支払済</span>
                    <span className={styles.metricValue}>{formatYen(totals.paid.amount)}</span>
                    <span className={styles.metricSub}>{totals.paid.count} 件</span>
                </div>
            </div>

            {summary.length === 0 ? (
                <p className={styles.empty}>まだ発行された請求書はありません。</p>
            ) : (
                <div className={styles.breakdown}>
                    {summary.map((row) => (
                        <div
                            key={`${row.status}:${row.period_month}`}
                            className={styles.breakdownRow}
                        >
                            <span
                                className={`${styles.statusPill} ${
                                    row.status === "paid" ? styles.statusPaid : styles.statusIssued
                                }`}
                            >
                                {STATUS_LABEL[row.status] ?? row.status}
                            </span>
                            <span>{row.period_month}</span>
                            <span>
                                {formatYen(row.total_amount)} ({row.invoice_count} 件)
                            </span>
                        </div>
                    ))}
                </div>
            )}

            <p className={styles.privacyNote}>
                ※ 誰の請求書かは admin からは見えません。
                振込先 / インボイス番号は本人プロフィールに保管され、請求書に固定保存されます。
            </p>
        </section>
    );
}
