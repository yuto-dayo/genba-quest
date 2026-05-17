import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, RotateCcw, X } from "lucide-react";
import {
    expirePathV33MonthObjections,
    fetchNotifications,
    fetchPathModuleMonthCloseSummary,
    fetchPathV33OpenObjections,
    fetchSiteCostTransferPreview,
    fetchTeamRewardSummary,
    finalizePathV33Month,
    lockPathV33MonthDrafts,
    markNotificationRead,
    type PathV33Objection,
    type SiteCostTransferPreviewRow,
    type TeamRewardSummary,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { track } from "../../lib/telemetry";
import styles from "./MonthCloseModal.module.css";

type StepKey = "lock" | "expire" | "finalize";
type StepStatus = "idle" | "running" | "success" | "error";

interface StepState {
    key: StepKey;
    label: string;
    status: StepStatus;
    error: string | null;
}

interface MonthCloseModalProps {
    month: string;
    onClose: () => void;
    onCompleted?: () => Promise<void> | void;
}

interface MonthCloseData {
    rewardSummary: TeamRewardSummary;
    openObjections: PathV33Objection[];
    transferPreview: SiteCostTransferPreviewRow[];
    alreadyFinalized: boolean;
}

const STEP_LABELS: Record<StepKey, string> = {
    lock: "レベル記録をロック",
    expire: "期限切れの異議を整理",
    finalize: "報酬額を確定",
};

function createInitialSteps(): StepState[] {
    return (Object.keys(STEP_LABELS) as StepKey[]).map((key) => ({
        key,
        label: STEP_LABELS[key],
        status: "idle",
        error: null,
    }));
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}

function formatMonthPart(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0
        ? `${numericMonth}月分`
        : `${month}分`;
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function sumReward(summary: TeamRewardSummary): number {
    return summary.members.reduce((total, member) => total + member.amount, 0);
}

function statusIcon(status: StepStatus) {
    if (status === "running") {
        return <Loader2 size={16} aria-hidden="true" />;
    }
    if (status === "success") {
        return <CheckCircle2 size={16} aria-hidden="true" />;
    }
    if (status === "error") {
        return <AlertCircle size={16} aria-hidden="true" />;
    }
    return <span aria-hidden="true">•</span>;
}

export function MonthCloseModal({ month, onClose, onCompleted }: MonthCloseModalProps) {
    const [openedAt] = useState(() => Date.now());
    const [data, setData] = useState<MonthCloseData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [steps, setSteps] = useState<StepState[]>(() => createInitialSteps());
    const [success, setSuccess] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const monthLabel = formatMonthPart(month);

    const reload = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        setSuccess(false);
        setSteps(createInitialSteps());

        try {
            const [rewardSummary, openObjections, moduleSummary, transferPreview] = await Promise.all([
                fetchTeamRewardSummary(month),
                fetchPathV33OpenObjections(),
                fetchPathModuleMonthCloseSummary(month).catch(() => null),
                fetchSiteCostTransferPreview(month),
            ]);
            if (signal?.aborted) return;

            const monthObjections = openObjections.filter((objection) => objection.target_month === month);
            const canonicalFixed = moduleSummary?.eligible_closes?.some((close) => close.status === "fixed") ?? false;
            setData({
                rewardSummary,
                openObjections: monthObjections,
                transferPreview: transferPreview.transfers,
                alreadyFinalized: rewardSummary.is_finalized || canonicalFixed,
            });
        } catch (err) {
            if (isAbortError(err)) return;
            setError(getErrorMessage(err));
            setData(null);
        } finally {
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    }, [month]);

    useEffect(() => {
        const controller = new AbortController();
        void reload(controller.signal);
        return () => controller.abort();
    }, [reload]);

    const summary = useMemo(() => {
        if (!data) {
            return { memberCount: 0, totalReward: 0, objectionCount: 0, transferTotal: 0 };
        }
        return {
            memberCount: data.rewardSummary.members.length,
            totalReward: sumReward(data.rewardSummary),
            objectionCount: data.openObjections.length,
            transferTotal: data.transferPreview.reduce((total, row) => total + row.accumulated_amount, 0),
        };
    }, [data]);

    const hasBlockingObjections = summary.objectionCount > 0;
    const hasStepError = steps.some((step) => step.status === "error");
    const canSubmit = Boolean(data && !data.alreadyFinalized && !hasBlockingObjections && !submitting && !loading);

    const setStepStatus = useCallback((key: StepKey, status: StepStatus, errorMessage: string | null = null) => {
        setSteps((current) =>
            current.map((step) =>
                step.key === key
                    ? { ...step, status, error: errorMessage }
                    : step,
            ),
        );
    }, []);

    const markMonthCloseNotificationsRead = useCallback(async () => {
        const notifications = await fetchNotifications({ unread_only: true, limit: 50 });
        const targets = notifications.filter((notification) => (
            notification.type === "month_close_reminder"
            && !notification.read
            && notification.data?.month === month
        ));
        await Promise.all(targets.map((notification) => markNotificationRead(notification.id)));
    }, [month]);

    const runStep = useCallback(async (key: StepKey) => {
        setStepStatus(key, "running");
        try {
            if (key === "lock") {
                await lockPathV33MonthDrafts(month);
            } else if (key === "expire") {
                await expirePathV33MonthObjections(month);
            } else {
                await finalizePathV33Month(month);
            }
            setStepStatus(key, "success");
        } catch (err) {
            const message = getErrorMessage(err);
            setStepStatus(key, "error", message);
            throw err;
        }
    }, [month, setStepStatus]);

    const handleConfirm = useCallback(async () => {
        if (!canSubmit) return;
        setSubmitting(true);
        setError(null);

        try {
            const currentSteps = steps;
            for (const key of ["lock", "expire", "finalize"] as StepKey[]) {
                const step = currentSteps.find((item) => item.key === key);
                if (step?.status === "success") continue;
                await runStep(key);
            }
            await markMonthCloseNotificationsRead();
            track({
                type: "money.month_close.completed",
                duration_ms: Date.now() - openedAt,
                members_count: summary.memberCount,
            });
            setSuccess(true);
            await onCompleted?.();
            window.dispatchEvent(new CustomEvent("month-close-completed"));
            window.dispatchEvent(new CustomEvent("site-level-draft-updated"));
            window.setTimeout(onClose, 900);
        } catch {
            // Individual step error is already shown in the step list.
        } finally {
            setSubmitting(false);
        }
    }, [canSubmit, markMonthCloseNotificationsRead, onClose, onCompleted, openedAt, runStep, steps, summary.memberCount]);

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="month-close-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="month-close-modal-title" className={styles.title}>
                        {monthLabel}を確定します
                    </h2>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    {loading && (
                        <div className={styles.centerState} role="status">
                            <Loader2 size={18} aria-hidden="true" />
                            月確定の状態を確認中...
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
                            <p className={styles.noticeText}>
                                確定すると、全員の報酬額が固定され、請求書を発行できるようになります。確定後の修正には別途異議申立が必要です。
                            </p>

                            <div className={styles.summaryGrid}>
                                <div className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>対象メンバー</span>
                                    <strong className={styles.summaryValue}>{summary.memberCount}人</strong>
                                </div>
                                <div className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>総報酬額</span>
                                    <strong className={styles.summaryValue}>{formatYen(summary.totalReward)}</strong>
                                </div>
                                <div className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>異議申立</span>
                                    <strong className={styles.summaryValue}>{summary.objectionCount}件</strong>
                                </div>
                                <div className={styles.summaryCard}>
                                    <span className={styles.summaryLabel}>振替予定</span>
                                    <strong className={styles.summaryValue}>{formatYen(summary.transferTotal)}</strong>
                                </div>
                            </div>

                            {data.transferPreview.length > 0 && (
                                <section className={styles.section} aria-labelledby="site-cost-transfer-title">
                                    <h3 id="site-cost-transfer-title" className={styles.sectionTitle}>
                                        完成現場の振替仕訳
                                    </h3>
                                    <div className={styles.transferList}>
                                        {data.transferPreview.map((row) => (
                                            <div key={row.site_id} className={styles.transferRow}>
                                                <span className={styles.transferSite}>{row.site_name}</span>
                                                <span className={styles.transferEntry}>
                                                    Dr 完成工事原価 / Cr 未成工事支出金
                                                </span>
                                                <strong className={styles.transferAmount}>
                                                    {formatYen(row.accumulated_amount)}
                                                </strong>
                                                <span className={styles.transferStatus}>
                                                    {row.transfer_status === "transferred" ? "転記済" : "未転記"}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {data.alreadyFinalized && (
                                <div className={styles.successPanel} role="status">
                                    <CheckCircle2 size={18} aria-hidden="true" />
                                    すでに確定済みです
                                </div>
                            )}

                            {hasBlockingObjections && (
                                <div className={styles.blockedPanel} role="status">
                                    <AlertCircle size={18} aria-hidden="true" />
                                    {summary.objectionCount}件の異議が決着していません
                                </div>
                            )}

                            {!data.alreadyFinalized && (
                                <section className={styles.section} aria-labelledby="month-close-steps-title">
                                    <h3 id="month-close-steps-title" className={styles.sectionTitle}>
                                        確定の流れ
                                    </h3>
                                    <div className={styles.stepList}>
                                        {steps.map((step) => (
                                            <div key={step.key} className={styles.stepRow}>
                                                <span className={styles.stepIcon}>{statusIcon(step.status)}</span>
                                                <span className={styles.stepText}>
                                                    <span className={styles.stepLabel}>{step.label}</span>
                                                    {step.error && (
                                                        <span className={styles.stepError}>
                                                            {step.key === "lock" && "ロック失敗: "}
                                                            {step.key === "expire" && "異議処理失敗: "}
                                                            {step.key === "finalize" && "確定失敗: "}
                                                            {step.error}
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            {hasStepError && (
                                <div className={styles.statusPanel} role="status">
                                    <RotateCcw size={18} aria-hidden="true" />
                                    もう一度押すと失敗した段階から再開します
                                </div>
                            )}

                            {success && (
                                <div className={styles.successPanel} role="status">
                                    <CheckCircle2 size={18} aria-hidden="true" />
                                    月確定が完了しました
                                </div>
                            )}
                        </>
                    )}
                </div>

                <footer className={styles.actions}>
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={onClose}
                        disabled={submitting}
                    >
                        戻る
                    </button>
                    {data?.alreadyFinalized ? null : (
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => void handleConfirm()}
                            disabled={!canSubmit}
                        >
                            {submitting ? "確定中..." : `${monthLabel}を確定`}
                        </button>
                    )}
                </footer>
            </section>
        </div>
    );
}
