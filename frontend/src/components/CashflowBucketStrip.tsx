/**
 * CashflowBucketStrip (PR #10) — v3.3 mock の 4 cash-flow bar.
 *   未請求 (urgent) — 当月 sale で invoice 未発行 (請求漏れ candidate)
 *   入金待ち (warn) — 未完済 invoice 残高 (期間問わず)
 *   支払予定 (neutral) — 当月 expense
 *   入金済み (good)  — 当月 入金
 *
 * "請求漏れゼロ" MVP outcome に直結する。
 */

import { useEffect, useState } from "react";
import { fetchCashflowSummary, type CashflowSummary } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./CashflowBucketStrip.module.css";

interface Props {
    month: string;
}

type ToneKey = "urgent" | "warn" | "neutral" | "good";

const BARS: Array<{ key: keyof Omit<CashflowSummary, "month">; label: string; tone: ToneKey }> = [
    { key: "unbilled", label: "未請求", tone: "urgent" },
    { key: "awaiting_payment", label: "入金待ち", tone: "warn" },
    { key: "pay_pending", label: "支払予定", tone: "neutral" },
    { key: "done", label: "入金済み", tone: "good" },
];

function formatYenShort(amount: number): string {
    const abs = Math.abs(amount);
    if (abs >= 10_000_000) return `${Math.round(amount / 1_000_000) / 10}千万`;
    if (abs >= 10_000) return `${Math.round(amount / 10_000)}万`;
    return `¥${amount.toLocaleString()}`;
}

export function CashflowBucketStrip({ month }: Props) {
    const [data, setData] = useState<{ key: string; summary: CashflowSummary } | null>(null);
    const [error, setError] = useState<{ key: string; message: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchCashflowSummary(month)
            .then((summary) => {
                if (!cancelled) {
                    setData({ key: month, summary });
                    setError(null);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) setError({ key: month, message: getErrorMessage(err) });
            });
        return () => {
            cancelled = true;
        };
    }, [month]);

    const isCurrent = data?.key === month;
    const isCurrentError = error?.key === month;
    const loading = !isCurrent && !isCurrentError;

    if (isCurrentError && error) {
        return (
            <section className={styles.section} aria-label="キャッシュフロー">
                <div className={styles.header}>
                    <h2 className={styles.title}>お金の流れ</h2>
                </div>
                <div className={styles.errorBox}>
                    取得に失敗: {error.message}
                </div>
            </section>
        );
    }

    if (loading || !data) {
        return (
            <section className={styles.section} aria-label="キャッシュフロー">
                <div className={styles.header}>
                    <h2 className={styles.title}>お金の流れ</h2>
                    <span className={styles.hint}>未請求 / 入金待ち / 支払予定 / 入金済み</span>
                </div>
                <div className={styles.skeleton} />
            </section>
        );
    }

    const s = data.summary;
    const maxAmount = Math.max(s.unbilled, s.awaiting_payment, s.pay_pending, s.done);

    return (
        <section className={styles.section} aria-label="キャッシュフロー">
            <div className={styles.header}>
                <h2 className={styles.title}>お金の流れ</h2>
                <span className={styles.hint}>未請求 / 入金待ち / 支払予定 / 入金済み</span>
            </div>
            <div className={styles.strip}>
                {BARS.map(({ key, label, tone }) => {
                    const amount = s[key];
                    const fillPct = maxAmount === 0
                        ? 0
                        : Math.max(amount > 0 ? 2 : 0, Math.round((amount / maxAmount) * 96));
                    const toneClass =
                        tone === "urgent" ? styles.urgent
                            : tone === "warn" ? styles.warn
                                : tone === "good" ? styles.good
                                    : "";
                    return (
                        <div
                            key={key}
                            className={`${styles.bar} ${toneClass} ${amount === 0 ? styles.empty : ""}`}
                            aria-label={`${label} ${formatYenShort(amount)}`}
                        >
                            <span className={styles.name}>{label}</span>
                            <div className={styles.track}>
                                <div className={styles.fill} style={{ width: `${fillPct}%` }} />
                            </div>
                            <span className={styles.amount}>{formatYenShort(amount)}</span>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
