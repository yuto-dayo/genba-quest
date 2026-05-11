/**
 * Money画面ダッシュボードのバケット一覧 (F-1).
 * 番頭レス可視性 — 開いた瞬間に「未割当 / 要確認 / 確認待ち / 帳簿入り /
 * 高額な工具 / 先行仕入れ・古い」の6つの観点で全状況が一望できる。
 *
 * v3.3 mock 準拠の bucket-strip レイアウト: 水平棒グラフで stagger 表示。
 * 文言は docs/MONEY_EXPENSE_FLOW.md §11 の正本に従い、frontend/src/lib/
 * expenseLabels.ts から参照する。エンドポイントは S-5 で追加した
 * GET /api/v1/accounting/expense_buckets。
 */

import { useEffect, useState } from "react";
import { fetchExpenseBuckets, type ExpenseBucketsReport } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import {
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
    // Track which (month, refreshKey) the data corresponds to so we can derive
    // loading from "data is stale relative to current props" instead of
    // calling setLoading() synchronously inside the effect (which trips
    // react-hooks/set-state-in-effect — see CI lint).
    const requestKey = `${month ?? ""}::${refreshKey ?? ""}`;
    const [fetched, setFetched] = useState<{ key: string; data: ExpenseBucketsReport } | null>(null);
    const [error, setError] = useState<{ key: string; message: string } | null>(null);

    useEffect(() => {
        let cancelled = false;
        fetchExpenseBuckets(month)
            .then((data) => {
                if (!cancelled) {
                    setFetched({ key: requestKey, data });
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
    }, [month, refreshKey, requestKey]);

    const isCurrentError = error?.key === requestKey;
    const isCurrentReport = fetched?.key === requestKey;
    const loading = !isCurrentError && !isCurrentReport;
    const report = fetched?.data ?? null;

    if (isCurrentError && error) {
        return (
            <section className={styles.section} aria-label="経費の状態">
                <div className={styles.errorBox}>
                    バケットを取得できませんでした: {error.message}
                </div>
            </section>
        );
    }

    // 棒の長さは「バケット間の相対比」で決める。最大金額を 100% とし、他を比率で。
    const maxAmount = DISPLAY_ORDER.reduce((max, key) => {
        const amt = Math.abs(report?.buckets[key]?.amount ?? 0);
        return amt > max ? amt : max;
    }, 0);

    return (
        <section className={styles.section} aria-label="経費の状態">
            <div className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>状態でわける</h2>
                <span className={styles.sectionHint}>タップで一覧</span>
            </div>
            <div className={styles.strip}>
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
                    const fillPct = loading || maxAmount === 0
                        ? 0
                        : Math.max(2, Math.round((Math.abs(amount) / maxAmount) * 100));

                    const classes = [
                        styles.bar,
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
                            aria-label={`${BUCKET_LABEL[key]} ${count}件 ${formatYen(amount)}`}
                        >
                            {showPulse && <span className={styles.pulse} aria-hidden="true" />}
                            <div className={styles.barLabel}>
                                <span className={styles.name}>{BUCKET_LABEL[key]}</span>
                                {staleNote && <span className={styles.staleAlert}>{staleNote}</span>}
                            </div>
                            <div className={styles.track}>
                                <div className={styles.fill} style={{ width: `${fillPct}%` }} />
                            </div>
                            <div className={styles.valueCol}>
                                <span className={styles.amount}>
                                    {loading ? "—" : formatYen(amount)}
                                </span>
                                <span className={styles.count}>{loading ? "—" : count}</span>
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}
