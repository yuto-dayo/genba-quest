import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, ShieldCheck, X } from "lucide-react";
import {
    fetchPathRewardConfirmation,
    fetchPathV33MonthlyPreview,
    fetchPathV33TeamFeed,
    submitPathV33Objection,
    type PathRewardConfirmationSummary,
    type PathV33MonthlyPreview,
    type PathV33TeamFeedTimelineEntry,
    type PathV33Tier,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { ObjectionSubmitSheet } from "../ObjectionSubmitSheet";
import styles from "./OtherPayoutModal.module.css";

interface OtherPayoutModalProps {
    memberId: string;
    month: string;
    onClose: () => void;
}

interface TrendPoint {
    month: string;
    amount: number;
}

interface ModalData {
    summary: PathRewardConfirmationSummary;
    preview: PathV33MonthlyPreview | null;
    trend: TrendPoint[];
    objectionTarget: PathV33TeamFeedTimelineEntry | null;
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function signedYen(amount: number): string {
    if (amount === 0) return formatYen(0);
    return `${amount > 0 ? "+" : "-"}${formatYen(Math.abs(amount))}`;
}

function formatMonthLabel(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0
        ? `${numericMonth}月分の報酬`
        : `${month}分の報酬`;
}

function formatShortMonth(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0 ? `${numericMonth}月` : month;
}

function getRecentMonths(endMonth: string, count: number): string[] {
    const [year, month] = endMonth.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return [endMonth];
    const cursor = new Date(Date.UTC(year, month - 1, 1));
    return Array.from({ length: count }, (_, index) => {
        const date = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - (count - 1 - index), 1));
        return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    });
}

function isClientObjectionWindow(month: string, now = new Date()): boolean {
    const [year, monthPart] = month.split("-").map(Number);
    if (!Number.isFinite(year) || !Number.isFinite(monthPart)) return false;
    const lastDay = new Date(Date.UTC(year, monthPart, 0)).getUTCDate();
    const monthIndex = monthPart - 1;
    const start = Date.UTC(year, monthIndex, lastDay + 3, -9);
    const endExclusive = Date.UTC(year, monthIndex, lastDay + 8, -9);
    const nowTime = now.getTime();
    return nowTime >= start && nowTime < endExclusive;
}

function pickObjectionTarget(
    memberId: string,
    memberName: string,
    timeline: PathV33TeamFeedTimelineEntry[],
    preview: PathV33MonthlyPreview | null,
): PathV33TeamFeedTimelineEntry | null {
    const fromFeed = timeline
        .filter((entry) => entry.member_id === memberId)
        .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0];
    if (fromFeed) return fromFeed;

    const fromPreview = preview?.drafts
        .filter((draft) => !draft.locked_at)
        .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0]
        ?? preview?.drafts.sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0]
        ?? null;
    if (!fromPreview) return null;

    return {
        draft_id: fromPreview.id,
        member_id: memberId,
        member_name: memberName,
        site_id: fromPreview.site_id,
        site_name: "対象現場",
        tier: fromPreview.tier,
        work_days: fromPreview.work_days,
        self_comment: fromPreview.self_comment,
        submitted_at: fromPreview.submitted_at,
    };
}

async function loadTrend(month: string, memberId: string, current: PathRewardConfirmationSummary, signal: AbortSignal) {
    const months = getRecentMonths(month, 3);
    const summaries = await Promise.all(
        months.map(async (targetMonth) => {
            if (targetMonth === month) return current;
            try {
                return await fetchPathRewardConfirmation(targetMonth, memberId, { signal });
            } catch {
                return null;
            }
        }),
    );

    return summaries
        .filter((summary): summary is PathRewardConfirmationSummary => Boolean(summary))
        .map((summary) => ({
            month: summary.month,
            amount: summary.estimated_amount,
        }));
}

export function OtherPayoutModal({ memberId, month, onClose }: OtherPayoutModalProps) {
    const [data, setData] = useState<ModalData | null>(null);
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [objectionOpen, setObjectionOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const reload = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        setEmpty(false);
        setActionError(null);

        const requestSignal = signal ?? new AbortController().signal;
        try {
            const summary = await fetchPathRewardConfirmation(month, memberId, { signal: requestSignal });
            const [preview, feed, trend] = await Promise.all([
                fetchPathV33MonthlyPreview(memberId, month, { signal: requestSignal }).catch(() => null),
                fetchPathV33TeamFeed(month).catch(() => null),
                loadTrend(month, memberId, summary, requestSignal).catch(() => []),
            ]);

            setData({
                summary,
                preview,
                trend,
                objectionTarget: pickObjectionTarget(
                    memberId,
                    summary.member_name,
                    feed?.timeline ?? [],
                    preview,
                ),
            });
        } catch (err) {
            if (isAbortError(err)) return;
            const message = getErrorMessage(err);
            if (message.includes("404") || message.includes("not found")) {
                setEmpty(true);
                setData(null);
            } else {
                setError(message);
            }
        } finally {
            if (!requestSignal.aborted) {
                setLoading(false);
            }
        }
    }, [memberId, month]);

    useEffect(() => {
        const controller = new AbortController();
        void reload(controller.signal);
        return () => controller.abort();
    }, [reload]);

    const isObjectionWindow = data
        ? data.summary.is_objection_window ?? isClientObjectionWindow(month)
        : false;
    const maxTrendAmount = useMemo(
        () => Math.max(...(data?.trend.map((point) => point.amount) ?? [0]), 1),
        [data],
    );

    async function handleSubmitObjection(input: { proposed_tier: PathV33Tier; reason: string }) {
        if (!data?.objectionTarget || submitting) return;
        setSubmitting(true);
        setSubmitError(null);
        setActionError(null);
        try {
            await submitPathV33Objection({
                target_draft_id: data.objectionTarget.draft_id,
                proposed_tier: input.proposed_tier,
                reason: input.reason,
                evidence: {
                    source: "money_other_reward_modal",
                    month,
                    member_id: memberId,
                },
            });
            setObjectionOpen(false);
            setNotice("異議を提出しました");
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    const title = data
        ? `${data.summary.member_name}さんの報酬`
        : formatMonthLabel(month);

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="other-reward-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="other-reward-modal-title" className={styles.title}>
                        {title}
                    </h2>
                    <button
                        type="button"
                        className={styles.iconButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    {loading && (
                        <div className={styles.centerState} role="status">
                            <Loader2 size={20} aria-hidden="true" />
                            読み込み中...
                        </div>
                    )}

                    {!loading && empty && (
                        <div className={styles.centerState}>
                            <AlertCircle size={20} aria-hidden="true" />
                            メンバーが見つかりません
                        </div>
                    )}

                    {!loading && error && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            <span>{error}</span>
                            <button type="button" className={styles.inlineButton} onClick={() => reload()}>
                                再読込
                            </button>
                        </div>
                    )}

                    {!loading && data && (
                        <>
                            <div className={styles.rewardMetric}>
                                <span className={styles.rewardMetricLabel}>
                                    {formatMonthLabel(month)}
                                </span>
                                <span className={styles.rewardMetricValue}>
                                    {formatYen(data.summary.estimated_amount)}
                                </span>
                            </div>

                            <p className={styles.privacyNote}>
                                <ShieldCheck size={18} aria-hidden="true" />
                                請求書の状態は本人だけに表示されます
                            </p>

                            <section className={styles.section} aria-labelledby="other-reward-breakdown">
                                <h3 id="other-reward-breakdown" className={styles.sectionTitle}>
                                    計算根拠
                                </h3>
                                <div className={styles.breakdown}>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>レベル</span>
                                        <span className={styles.rowValue}>
                                            {data.preview?.current.level ?? "-"}
                                        </span>
                                    </div>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>出勤日数</span>
                                        <span className={styles.rowValue}>
                                            {data.preview ? `${data.preview.current.total_work_days}日` : "-"}
                                        </span>
                                    </div>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>基本給</span>
                                        <span className={styles.rowValue}>
                                            {formatYen(data.summary.base_amount)}
                                        </span>
                                    </div>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>加算</span>
                                        <span className={styles.rowValue}>
                                            {signedYen(data.summary.estimated_amount - data.summary.base_amount)}
                                        </span>
                                    </div>
                                </div>
                            </section>

                            <section className={styles.section} aria-labelledby="other-reward-path-detail">
                                <h3 id="other-reward-path-detail" className={styles.sectionTitle}>
                                    PATH計算
                                </h3>
                                <div className={styles.breakdown}>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>結果分</span>
                                        <span className={styles.rowValue}>
                                            {formatYen(data.summary.result_amount)}
                                        </span>
                                    </div>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>補正</span>
                                        <span className={styles.rowValue}>
                                            {signedYen(data.summary.correction_amount)}
                                        </span>
                                    </div>
                                    <div className={styles.row}>
                                        <span className={styles.rowLabel}>状態</span>
                                        <span className={styles.rowValue}>{data.summary.status}</span>
                                    </div>
                                </div>
                                {data.summary.top_reasons.length > 0 && (
                                    <ul className={styles.reasonList}>
                                        {data.summary.top_reasons.slice(0, 3).map((reason) => (
                                            <li key={reason.key} className={styles.reasonItem}>
                                                <span>{reason.label}</span>
                                                <strong>{reason.summary}</strong>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                                {data.summary.site_breakdown.length > 0 && (
                                    <div className={styles.siteList}>
                                        {data.summary.site_breakdown.slice(0, 4).map((site) => (
                                            <div key={site.site_id} className={styles.siteRow}>
                                                <span>{site.site_name}</span>
                                                <strong>{formatYen(site.amount)}</strong>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </section>

                            <section className={styles.section} aria-labelledby="other-reward-trend">
                                <h3 id="other-reward-trend" className={styles.sectionTitle}>
                                    過去3ヶ月推移
                                </h3>
                                {data.trend.length > 0 ? (
                                    <div className={styles.trendList}>
                                        {data.trend.map((point) => (
                                            <div key={point.month} className={styles.trendRow}>
                                                <span className={styles.trendLabel}>{formatShortMonth(point.month)}</span>
                                                <span className={styles.trendTrack} aria-hidden="true">
                                                    <span
                                                        className={styles.trendBar}
                                                        style={{ width: `${Math.max((point.amount / maxTrendAmount) * 100, 4)}%` }}
                                                    />
                                                </span>
                                                <strong className={styles.trendValue}>{formatYen(point.amount)}</strong>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <p className={styles.emptyText}>推移はまだありません</p>
                                )}
                            </section>

                            {notice && <p className={styles.notice}>{notice}</p>}
                            {actionError && <p className={styles.actionError}>{actionError}</p>}
                        </>
                    )}
                </div>

                {!loading && data && (
                    <footer className={styles.actions}>
                        <button type="button" className={styles.secondaryButton} onClick={onClose}>
                            閉じる
                        </button>
                        {isObjectionWindow && (
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={() => {
                                    setNotice(null);
                                    setSubmitError(null);
                                    if (!data.objectionTarget) {
                                        setActionError("異議対象の申告がありません");
                                        return;
                                    }
                                    setObjectionOpen(true);
                                }}
                            >
                                異議を申し立てる
                            </button>
                        )}
                    </footer>
                )}
            </section>

            <ObjectionSubmitSheet
                open={objectionOpen}
                target={data?.objectionTarget ?? null}
                submitting={submitting}
                error={submitError}
                onClose={() => setObjectionOpen(false)}
                onSubmit={handleSubmitObjection}
            />
        </div>
    );
}
