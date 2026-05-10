/**
 * Money画面ダッシュボードのバケット一覧 (F-1).
 * 番頭レス可視性 — 開いた瞬間に「未割当 / 要確認 / 確認待ち / 帳簿入り /
 * 高額な工具 / 先行仕入れ・古い」の6つの観点で全状況が一望できる。
 *
 * 文言は docs/MONEY_EXPENSE_FLOW.md §11 の正本に従い、frontend/src/lib/
 * expenseLabels.ts から参照する。エンドポイントは S-5 で追加した
 * GET /api/v1/accounting/expense_buckets。
 */

import { useEffect, useState } from "react";
import { fetchExpenseBuckets, type ExpenseBucketsReport } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import {
    BUCKET_HINT,
    BUCKET_LABEL,
    BUCKET_TONE,
    type BucketKey,
} from "../lib/expenseLabels";
import styles from "./MoneyBucketDashboard.module.css";

interface Props {
    /** "YYYY-MM" 形式. 省略時は当月をサーバーで補完. */
    month?: string;
    /** バケットを開いたときのコールバック (タブ切替などに使用). */
    onSelectBucket?: (key: BucketKey) => void;
    /** 親で取引が更新されたとき再取得するための rev カウンタ. */
    refreshKey?: number;
}

const DISPLAY_ORDER: BucketKey[] = [
    "unassigned",
    "needs_review",
    "awaiting_verify",
    "posted",
    "asset_candidates",
    "advance_stale",
];

const formatYen = (value: number) => `¥${Math.abs(value).toLocaleString()}`;

export function MoneyBucketDashboard({ month, onSelectBucket, refreshKey }: Props) {
    const [report, setReport] = useState<ExpenseBucketsReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setError(null);

        fetchExpenseBuckets(month)
            .then((data) => {
                if (!cancelled) {
                    setReport(data);
                }
            })
            .catch((err: unknown) => {
                if (!cancelled) {
                    setError(getErrorMessage(err));
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [month, refreshKey]);

    if (error) {
        return (
            <section className={styles.section} aria-label="経費の状態">
                <div className={styles.errorBox}>
                    バケットを取得できませんでした: {error}
                </div>
            </section>
        );
    }

    return (
        <section className={styles.section} aria-label="経費の状態">
            <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>状態でわける</h2>
                <span className={styles.sectionHint}>タップで一覧</span>
            </div>
            <div className={styles.grid}>
                {DISPLAY_ORDER.map((key) => {
                    const data = report?.buckets[key];
                    const tone = BUCKET_TONE[key];
                    const count = data?.count ?? 0;
                    const amount = data?.amount ?? 0;
                    const showPulse = !loading && count > 0 && (key === "unassigned" || key === "advance_stale");
                    const staleNote =
                        !loading && key === "unassigned" && report?.oldest_unassigned_age_days != null
                            && report.oldest_unassigned_age_days >= 3
                            ? `⚠ 最古 ${report.oldest_unassigned_age_days}日前`
                            : null;

                    const classes = [
                        styles.bucket,
                        tone === "warn" ? styles.warn : "",
                        tone === "bad" ? styles.bad : "",
                        tone === "good" ? styles.good : "",
                        loading ? styles.skeleton : "",
                        !loading && count === 0 ? styles.empty : "",
                    ]
                        .filter(Boolean)
                        .join(" ");

                    return (
                        <button
                            key={key}
                            type="button"
                            className={classes}
                            onClick={() => onSelectBucket?.(key)}
                            disabled={loading}
                            aria-busy={loading}
                        >
                            {showPulse && <span className={styles.pulse} aria-hidden="true" />}
                            <div className={styles.name}>
                                <span>{BUCKET_LABEL[key]}</span>
                                <span className={styles.count}>{loading ? "—" : count}</span>
                            </div>
                            <div className={styles.amount}>
                                {loading ? "—" : formatYen(amount)}
                            </div>
                            <div className={styles.hint}>
                                {staleNote ? (
                                    <span className={styles.staleAlert}>{staleNote}</span>
                                ) : (
                                    BUCKET_HINT[key]
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
