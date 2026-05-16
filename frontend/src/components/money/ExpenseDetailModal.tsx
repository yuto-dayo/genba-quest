import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import {
    fetchMemberReimbursementBalance,
    type MemberReimbursementBalance,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { ExpenseModal } from "../ExpenseModal";
import styles from "./ExpenseDetailModal.module.css";

interface ExpenseDetailModalProps {
    memberId: string;
    month: string;
    selfMemberId: string | null;
    onClose: () => void;
    onExpenseAdded?: () => Promise<void> | void;
}

type ReimbursementStatus = "unsubmitted" | "submitted" | "approved" | "reimbursed";

const STATUS_LABELS: Record<ReimbursementStatus, string> = {
    unsubmitted: "申請待ち",
    submitted: "申請済",
    approved: "承認済",
    reimbursed: "振込済",
};

const STATUS_TONE: Record<ReimbursementStatus, "pending" | "draft" | "completed"> = {
    unsubmitted: "pending",
    submitted: "draft",
    approved: "completed",
    reimbursed: "completed",
};

const CATEGORY_LABELS: Record<string, string> = {
    material: "材料",
    tool: "工具",
    travel: "交通",
    food: "食事",
    fuel: "ガソリン",
    utility: "光熱費",
    parking: "駐車",
    toll: "高速代",
    other: "その他",
};

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

function formatMonthLabel(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0
        ? `${numericMonth}月の立替`
        : `${month}の立替`;
}

function formatDate(dateString: string): string {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString.replace(/-/g, "/");
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function statusLabel(status: string): string {
    return STATUS_LABELS[status as ReimbursementStatus] ?? status;
}

function statusTone(status: string): "pending" | "draft" | "completed" {
    return STATUS_TONE[status as ReimbursementStatus] ?? "draft";
}

function categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category;
}

function statusClass(tone: "pending" | "draft" | "completed"): string {
    if (tone === "pending") return styles.statusPending;
    if (tone === "completed") return styles.statusCompleted;
    return styles.statusDraft;
}

export function ExpenseDetailModal({
    memberId,
    month,
    selfMemberId,
    onClose,
    onExpenseAdded,
}: ExpenseDetailModalProps) {
    const [data, setData] = useState<MemberReimbursementBalance | null>(null);
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [expenseOpen, setExpenseOpen] = useState(false);
    const isSelf = Boolean(selfMemberId && selfMemberId === memberId);

    const reload = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        setEmpty(false);

        const requestSignal = signal ?? new AbortController().signal;
        try {
            setData(await fetchMemberReimbursementBalance(memberId, month, { signal: requestSignal }));
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

    async function handleExpenseSuccess() {
        setExpenseOpen(false);
        await reload();
        await onExpenseAdded?.();
        setNotice("経費を追加しました");
    }

    const hasAmount = Boolean(data && data.total_advanced > 0);

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="expense-detail-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="expense-detail-modal-title" className={styles.title}>
                        {formatMonthLabel(month)}
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
                            <div className={styles.metric}>
                                <span className={styles.metricLabel}>合計立替</span>
                                <span className={styles.metricValue}>{formatYen(data.total_advanced)}</span>
                            </div>

                            {hasAmount ? (
                                <>
                                    <div className={styles.summaryGrid}>
                                        <div className={styles.summaryItem}>
                                            <span className={styles.summaryLabel}>未精算</span>
                                            <strong className={styles.summaryValue}>{formatYen(data.unsettled)}</strong>
                                        </div>
                                        <div className={styles.summaryItem}>
                                            <span className={styles.summaryLabel}>精算済</span>
                                            <strong className={styles.summaryValue}>{formatYen(data.settled)}</strong>
                                        </div>
                                    </div>

                                    <section className={styles.section} aria-labelledby="expense-status-breakdown">
                                        <h3 id="expense-status-breakdown" className={styles.sectionTitle}>
                                            状態別
                                        </h3>
                                        <div className={styles.breakdown}>
                                            {Object.entries(STATUS_LABELS).map(([status, label]) => (
                                                <div key={status} className={styles.row}>
                                                    <span className={styles.rowLabel}>{label}</span>
                                                    <strong className={styles.rowValue}>
                                                        {formatYen(data.by_status[status as ReimbursementStatus])}
                                                    </strong>
                                                </div>
                                            ))}
                                        </div>
                                    </section>

                                    <section className={styles.section} aria-labelledby="recent-expenses">
                                        <h3 id="recent-expenses" className={styles.sectionTitle}>
                                            直近の経費
                                        </h3>
                                        {data.recent_items.length > 0 ? (
                                            <div className={styles.recentList}>
                                                {data.recent_items.slice(0, 5).map((item) => {
                                                    const tone = statusTone(item.reimbursement_status);
                                                    return (
                                                        <div key={item.id} className={styles.recentItem}>
                                                            <span className={styles.recentMain}>
                                                                <span className={styles.itemTitle}>
                                                                    {categoryLabel(item.category)}
                                                                </span>
                                                                <span className={styles.itemMeta}>
                                                                    {formatDate(item.occurred_on)}
                                                                </span>
                                                                <span className={`${styles.statusChip} ${statusClass(tone)}`}>
                                                                    {statusLabel(item.reimbursement_status)}
                                                                </span>
                                                            </span>
                                                            <strong className={styles.itemAmount}>
                                                                {formatYen(item.amount)}
                                                            </strong>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <p className={styles.emptyText}>直近の経費はありません</p>
                                        )}
                                    </section>
                                </>
                            ) : (
                                <p className={styles.emptyText}>立替はありません</p>
                            )}

                            {notice && <p className={styles.notice}>{notice}</p>}
                        </>
                    )}
                </div>

                {!loading && data && (
                    <footer className={styles.actions}>
                        <button type="button" className={styles.secondaryButton} onClick={onClose}>
                            閉じる
                        </button>
                        {isSelf && (
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={() => setExpenseOpen(true)}
                            >
                                <Plus size={16} aria-hidden="true" />
                                経費を追加
                            </button>
                        )}
                    </footer>
                )}
            </section>

            {isSelf && (
                <ExpenseModal
                    open={expenseOpen}
                    onClose={() => setExpenseOpen(false)}
                    onSuccess={handleExpenseSuccess}
                />
            )}
        </div>
    );
}
