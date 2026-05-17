import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, FileText, Loader2, Send, X } from "lucide-react";
import {
    fetchMemberInvoiceDrafts,
    fetchMyMemberInvoices,
    fetchPathRewardConfirmation,
    fetchPathV33MonthlyPreview,
    voidMemberInvoice,
    type MemberInvoice,
    type MemberInvoiceDraft,
    type PathRewardConfirmationSummary,
    type PathV33LevelDraft,
    type PathV33MonthlyPreview,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { track } from "../../lib/telemetry";
import { LevelRevisionSheet } from "../LevelRevisionSheet";
import { MemberInvoiceIssueModal } from "../MemberInvoiceIssueModal";
import styles from "./OwnRewardModal.module.css";

type InvoiceState = "before_close" | "unissued" | "issued" | "paid";

interface OwnRewardModalProps {
    selfMemberId: string;
    selfUserId?: string | null;
    month: string;
    onClose: () => void;
    onInvoiceChanged?: () => Promise<void> | void;
}

interface ModalData {
    summary: PathRewardConfirmationSummary;
    invoices: MemberInvoice[];
    drafts: MemberInvoiceDraft[];
    preview: PathV33MonthlyPreview | null;
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

function formatMonthLabel(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0
        ? `${numericMonth}月分の報酬`
        : `${month}分の報酬`;
}

function formatPaidDate(invoice: MemberInvoice | null): string {
    if (!invoice) return "振込完了";
    const iso = invoice.updated_at || invoice.issued_at;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "振込完了";
    return `${date.getMonth() + 1}/${date.getDate()} 振込完了`;
}

function signedYen(amount: number): string {
    if (amount === 0) return formatYen(0);
    return `${amount > 0 ? "+" : "-"}${formatYen(Math.abs(amount))}`;
}

function pickActiveInvoice(invoices: MemberInvoice[], month: string): MemberInvoice | null {
    const candidates = invoices
        .filter((invoice) => (
            invoice.period_month === month
            && invoice.source === "path_reward"
            && invoice.status !== "void"
        ))
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at));

    return candidates.find((invoice) => invoice.status === "paid")
        ?? candidates.find((invoice) => invoice.status === "issued")
        ?? null;
}

function deriveInvoiceState(
    summary: PathRewardConfirmationSummary,
    invoice: MemberInvoice | null,
): InvoiceState {
    if (invoice?.status === "paid") return "paid";
    if (invoice?.status === "issued") return "issued";
    return summary.status === "確定済み" ? "unissued" : "before_close";
}

function pickIssueDraft(
    drafts: MemberInvoiceDraft[],
    month: string,
    summary: PathRewardConfirmationSummary,
): MemberInvoiceDraft | null {
    const pathDrafts = drafts.filter((draft) => (
        draft.source === "path_reward" && draft.period_month === month
    ));

    return pathDrafts.find((draft) => draft.amount_total === summary.estimated_amount)
        ?? pathDrafts[0]
        ?? null;
}

function pickRevisionDraft(preview: PathV33MonthlyPreview | null): PathV33LevelDraft | null {
    if (!preview) return null;
    return [...preview.drafts]
        .filter((draft) => !draft.locked_at)
        .sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))[0]
        ?? null;
}

export function OwnRewardModal({
    selfMemberId,
    selfUserId,
    month,
    onClose,
    onInvoiceChanged,
}: OwnRewardModalProps) {
    const [data, setData] = useState<ModalData | null>(null);
    const [loading, setLoading] = useState(true);
    const [empty, setEmpty] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [activeIssueDraft, setActiveIssueDraft] = useState<MemberInvoiceDraft | null>(null);
    const [revisionOpen, setRevisionOpen] = useState(false);
    const [pendingVoid, setPendingVoid] = useState<MemberInvoice | null>(null);
    const [voiding, setVoiding] = useState(false);

    const reload = useCallback(async (signal?: AbortSignal) => {
        setLoading(true);
        setError(null);
        setEmpty(false);
        setActionError(null);

        try {
            const [summary, invoiceResponse] = await Promise.all([
                fetchPathRewardConfirmation(month, selfMemberId, { signal }),
                fetchMyMemberInvoices({ signal }),
            ]);

            const [draftResponse, preview] = await Promise.all([
                fetchMemberInvoiceDrafts({ signal }).catch(() => ({ drafts: [] })),
                fetchPathV33MonthlyPreview(selfMemberId, month, { signal }).catch(() => null),
            ]);

            setData({
                summary,
                invoices: invoiceResponse.invoices,
                drafts: draftResponse.drafts,
                preview,
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
            if (!signal?.aborted) {
                setLoading(false);
            }
        }
    }, [month, selfMemberId]);

    useEffect(() => {
        const controller = new AbortController();
        void reload(controller.signal);
        return () => controller.abort();
    }, [reload]);

    const activeInvoice = useMemo(
        () => data ? pickActiveInvoice(data.invoices, month) : null,
        [data, month],
    );
    const invoiceState = data ? deriveInvoiceState(data.summary, activeInvoice) : "before_close";
    const issueDraft = data ? pickIssueDraft(data.drafts, month, data.summary) : null;
    const revisionDraft = data ? pickRevisionDraft(data.preview) : null;

    const refreshAfterInvoiceChange = useCallback(async (message: string) => {
        await reload();
        await onInvoiceChanged?.();
        setNotice(message);
    }, [onInvoiceChanged, reload]);

    async function handleVoidConfirm() {
        if (!pendingVoid || voiding) return;
        setVoiding(true);
        setActionError(null);
        try {
            await voidMemberInvoice(pendingVoid.id, "本人による請求書取消");
            setPendingVoid(null);
            await refreshAfterInvoiceChange("請求書を取り消しました");
        } catch (err) {
            setActionError(getErrorMessage(err));
        } finally {
            setVoiding(false);
        }
    }

    const title = formatMonthLabel(month);

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="own-reward-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="own-reward-modal-title" className={styles.title}>
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
                            データがありません
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
                                <span className={styles.rewardMetricLabel}>あなたの報酬</span>
                                <span className={styles.rewardMetricValue}>
                                    {formatYen(data.summary.estimated_amount)}
                                </span>
                            </div>

                            <section className={styles.section} aria-labelledby="own-reward-breakdown">
                                <h3 id="own-reward-breakdown" className={styles.sectionTitle}>
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

                            <section className={styles.section} aria-labelledby="own-reward-invoice">
                                <h3 id="own-reward-invoice" className={styles.sectionTitle}>
                                    請求書
                                </h3>
                                <InvoiceStateBox state={invoiceState} invoice={activeInvoice} />
                            </section>

                            <section className={styles.section} aria-labelledby="own-reward-path-detail">
                                <h3 id="own-reward-path-detail" className={styles.sectionTitle}>
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

                            {notice && <p className={styles.notice}>{notice}</p>}
                            {actionError && <p className={styles.actionError}>{actionError}</p>}
                        </>
                    )}
                </div>

                {!loading && data && (
                    <footer className={styles.actions}>
                        {invoiceState === "issued" && activeInvoice && (
                            <button
                                type="button"
                                className={styles.dangerButton}
                                onClick={() => setPendingVoid(activeInvoice)}
                            >
                                取消
                            </button>
                        )}
                        <button type="button" className={styles.secondaryButton} onClick={onClose}>
                            閉じる
                        </button>
                        {invoiceState === "before_close" && (
                            <button
                                type="button"
                                className={styles.primaryButton}
                                disabled={!revisionDraft}
                                onClick={() => {
                                    setActionError(null);
                                    setRevisionOpen(true);
                                }}
                            >
                                レベルを修正
                            </button>
                        )}
                        {invoiceState === "unissued" && (
                            <button
                                type="button"
                                className={styles.primaryButton}
                                onClick={() => {
                                    setActionError(null);
                                    if (!selfUserId) {
                                        setActionError("ログイン情報を確認できませんでした");
                                        return;
                                    }
                                    if (!issueDraft) {
                                        setActionError("請求書ドラフトがまだありません");
                                        return;
                                    }
                                    setActiveIssueDraft(issueDraft);
                                }}
                            >
                                請求書を出す
                            </button>
                        )}
                    </footer>
                )}
            </section>

            {activeIssueDraft && selfUserId && (
                <MemberInvoiceIssueModal
                    draft={activeIssueDraft}
                    selfUserId={selfUserId}
                    onClose={() => setActiveIssueDraft(null)}
                    onIssued={() => {
                        setActiveIssueDraft(null);
                        track({ type: "money.invoice.issued", from: "own_reward_modal" });
                        void refreshAfterInvoiceChange("請求書を発行しました");
                    }}
                />
            )}

            {revisionDraft && (
                <LevelRevisionSheet
                    open={revisionOpen}
                    onClose={() => setRevisionOpen(false)}
                    draft={revisionDraft}
                    memberId={selfMemberId}
                    onRevised={() => refreshAfterInvoiceChange("レベル申告を更新しました")}
                />
            )}

            {pendingVoid && (
                <div
                    className={styles.confirmScrim}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="own-reward-void-title"
                    onClick={() => {
                        if (!voiding) setPendingVoid(null);
                    }}
                >
                    <div className={styles.confirmCard} onClick={(event) => event.stopPropagation()}>
                        <h3 id="own-reward-void-title" className={styles.confirmTitle}>
                            請求書を取り消しますか?
                        </h3>
                        <p className={styles.confirmText}>
                            {pendingVoid.invoice_no} を取り消します。必要ならもう一度発行できます。
                        </p>
                        <div className={styles.confirmActions}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={voiding}
                                onClick={() => setPendingVoid(null)}
                            >
                                やめる
                            </button>
                            <button
                                type="button"
                                className={styles.dangerButton}
                                disabled={voiding}
                                onClick={handleVoidConfirm}
                            >
                                {voiding && <Loader2 size={16} aria-hidden="true" />}
                                取消
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function InvoiceStateBox({
    state,
    invoice,
}: {
    state: InvoiceState;
    invoice: MemberInvoice | null;
}) {
    if (state === "paid") {
        return (
            <div className={`${styles.stateBox} ${styles.statePaid}`}>
                <CheckCircle2 size={18} aria-hidden="true" />
                <span>{formatPaidDate(invoice)}</span>
            </div>
        );
    }

    if (state === "issued") {
        return (
            <div className={`${styles.stateBox} ${styles.stateIssued}`}>
                <Send size={18} aria-hidden="true" />
                <span>発行中 — 経理担当が振込を準備しています</span>
            </div>
        );
    }

    if (state === "unissued") {
        return (
            <div className={`${styles.stateBox} ${styles.stateDraft}`}>
                <FileText size={18} aria-hidden="true" />
                <span>未発行 — 下のボタンから請求書を出してください</span>
            </div>
        );
    }

    return (
        <div className={`${styles.stateBox} ${styles.stateDraft}`}>
            <Clock3 size={18} aria-hidden="true" />
            <span>月確定後に発行できます</span>
        </div>
    );
}
