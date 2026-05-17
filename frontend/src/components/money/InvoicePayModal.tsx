import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Clock3, Loader2, ShieldCheck, X } from "lucide-react";
import {
    fetchInvoicePayoutDetail,
    markInvoicePaid,
    markNotificationRead,
    type InvoicePayoutDetail,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { track } from "../../lib/telemetry";
import styles from "./InvoicePayModal.module.css";

interface InvoicePayModalProps {
    invoiceId: string;
    notificationId?: string | null;
    from?: "bell" | "partner_drawer";
    onClose: () => void;
    onCompleted?: () => void;
}

type InlineErrorKind = "expired" | "completed" | "forbidden" | "generic";

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

function formatYen(amount: number): string {
    return `¥${amount.toLocaleString()}`;
}

function formatDateTime(value?: string | null): string {
    if (!value) return "未設定";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "未設定";
    return new Intl.DateTimeFormat("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

function formatRemaining(expiresAt?: string | null): string {
    if (!expiresAt) return "不明";
    const diffMs = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(diffMs) || diffMs <= 0) return "終了";
    const totalMinutes = Math.ceil(diffMs / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `あと ${days}日 ${hours}時間`;
    if (hours > 0) return `あと ${hours}時間 ${minutes}分`;
    return `あと ${minutes}分`;
}

function normalizeAccountType(value?: string | null): string {
    if (!value) return "未設定";
    const labels: Record<string, string> = {
        ordinary: "普通",
        checking: "当座",
        savings: "貯蓄",
    };
    return labels[value] ?? value;
}

function classifyFetchError(message: string): InlineErrorKind {
    if (message.includes("INVOICE_REVIEW_ASSIGNMENT_EXPIRED")) return "expired";
    if (
        message.includes("INVOICE_REVIEW_ASSIGNMENT_COMPLETED")
        || message.includes("MEMBER_INVOICE_NOT_IN_ISSUED_STATE")
    ) {
        return "completed";
    }
    if (
        message.includes("INVOICE_REVIEW_ASSIGNMENT_NOT_FOUND")
        || message.includes("MEMBER_INVOICE_MARK_PAID_OWNER_CANNOT_SELF_APPROVE")
    ) {
        return "forbidden";
    }
    return "generic";
}

function errorMessageFor(kind: InlineErrorKind, rawMessage: string): string {
    if (kind === "expired") return "閲覧期間が終了しました";
    if (kind === "completed") return "他の方が処理済みです";
    if (kind === "forbidden") return "この請求書は閲覧できません";
    return rawMessage;
}

export function InvoicePayModal({
    invoiceId,
    notificationId,
    from = "bell",
    onClose,
    onCompleted,
}: InvoicePayModalProps) {
    const [detail, setDetail] = useState<InvoicePayoutDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [inlineError, setInlineError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const reload = useCallback(async () => {
        try {
            const next = await fetchInvoicePayoutDetail(invoiceId);
            setDetail(next);
            setInlineError(null);
        } catch (err) {
            const message = getErrorMessage(err);
            const kind = classifyFetchError(message);
            setDetail(null);
            setInlineError(errorMessageFor(kind, message));
        } finally {
            setLoading(false);
        }
    }, [invoiceId]);

    useEffect(() => {
        setLoading(true);
        setDetail(null);
        setInlineError(null);
        setActionError(null);
        void reload();
    }, [reload]);

    useEffect(() => {
        const id = window.setInterval(() => {
            void reload();
        }, REFRESH_INTERVAL_MS);
        return () => window.clearInterval(id);
    }, [reload]);

    const remainingLabel = useMemo(
        () => formatRemaining(detail?.expires_at),
        [detail?.expires_at],
    );

    const expiredClientSide = detail
        ? new Date(detail.expires_at).getTime() <= Date.now()
        : false;
    const canSubmit = Boolean(detail) && !expiredClientSide && !submitting;

    async function handleMarkPaid() {
        if (!detail || submitting || expiredClientSide) return;
        setSubmitting(true);
        setActionError(null);
        try {
            await markInvoicePaid(invoiceId, { paid_at: new Date().toISOString() });
            track({ type: "money.invoice.paid", from });
            if (notificationId) {
                await markNotificationRead(notificationId).catch((err) => {
                    console.warn("[InvoicePayModal] failed to mark notification read:", err);
                });
            }
            onCompleted?.();
            onClose();
        } catch (err) {
            const message = getErrorMessage(err);
            const kind = classifyFetchError(message);
            setActionError(errorMessageFor(kind, message));
        } finally {
            setSubmitting(false);
            setConfirmOpen(false);
        }
    }

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="invoice-pay-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>ベル経由の支払い操作</p>
                        <h2 id="invoice-pay-modal-title" className={styles.title}>
                            請求書の支払い
                        </h2>
                    </div>
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

                    {!loading && inlineError && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            <span>{inlineError}</span>
                        </div>
                    )}

                    {!loading && detail && (
                        <>
                            <div className={styles.metric}>
                                <span className={styles.metricLabel}>
                                    {detail.snapshot.real_name || detail.invoice_no}
                                </span>
                                <span className={styles.metricValue}>{formatYen(detail.amount)}</span>
                            </div>

                            <div className={styles.timeBanner}>
                                <Clock3 size={18} aria-hidden="true" />
                                <div>
                                    <span className={styles.timeLabel}>閲覧可能時間</span>
                                    <strong>{expiredClientSide ? "閲覧期間が終了しました" : remainingLabel}</strong>
                                </div>
                            </div>

                            {expiredClientSide && (
                                <div className={styles.errorPanel} role="alert">
                                    <AlertCircle size={18} aria-hidden="true" />
                                    <span>閲覧期間が終了しました</span>
                                </div>
                            )}

                            {actionError && (
                                <div className={styles.errorPanel} role="alert">
                                    <AlertCircle size={18} aria-hidden="true" />
                                    <span>{actionError}</span>
                                </div>
                            )}

                            <section className={styles.section}>
                                <h3 className={styles.sectionTitle}>請求情報</h3>
                                <div className={styles.detailGrid}>
                                    <DetailRow label="請求番号" value={detail.invoice_no} />
                                    <DetailRow label="発行日" value={formatDateTime(detail.issued_at)} />
                                    <DetailRow label="期限" value={formatDateTime(detail.expires_at)} />
                                    <DetailRow label="状態" value="支払い待ち" />
                                </div>
                            </section>

                            <section className={styles.section}>
                                <h3 className={styles.sectionTitle}>振込先</h3>
                                <div className={styles.detailGrid}>
                                    <DetailRow label="銀行" value={detail.snapshot.bank_name || "未設定"} />
                                    <DetailRow label="支店" value={detail.snapshot.branch_name || "未設定"} />
                                    <DetailRow
                                        label="種類"
                                        value={normalizeAccountType(detail.snapshot.account_type)}
                                    />
                                    <DetailRow label="口座番号" value={detail.snapshot.account_number || "未設定"} />
                                    <DetailRow label="名義" value={detail.snapshot.account_holder || "未設定"} />
                                </div>
                            </section>

                            <section className={styles.section}>
                                <h3 className={styles.sectionTitle}>本人確認</h3>
                                <div className={styles.detailGrid}>
                                    <DetailRow label="本名" value={detail.snapshot.real_name || "未設定"} />
                                    <DetailRow label="T番号" value={detail.snapshot.tax_id || "未登録"} />
                                </div>
                            </section>

                            <div className={styles.privacyNote}>
                                <ShieldCheck size={18} aria-hidden="true" />
                                <span>この内容は割当された経理担当だけに時限表示されます。</span>
                            </div>
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
                        閉じる
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={() => setConfirmOpen(true)}
                        disabled={!canSubmit}
                    >
                        {submitting ? <Loader2 size={16} aria-hidden="true" /> : <CheckCircle2 size={16} aria-hidden="true" />}
                        支払い済みにする
                    </button>
                </footer>

                {confirmOpen && (
                    <div
                        className={styles.confirmScrim}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="invoice-pay-confirm-title"
                        onClick={() => {
                            if (!submitting) setConfirmOpen(false);
                        }}
                    >
                        <div
                            className={styles.confirmCard}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <h3 id="invoice-pay-confirm-title" className={styles.confirmTitle}>
                                銀行への振込は完了しましたか？
                            </h3>
                            <p className={styles.confirmBody}>
                                支払い済みにすると、この請求書は処理済みとして記録されます。
                            </p>
                            <div className={styles.confirmActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => setConfirmOpen(false)}
                                    disabled={submitting}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={handleMarkPaid}
                                    disabled={submitting}
                                >
                                    {submitting && <Loader2 size={16} aria-hidden="true" />}
                                    はい、支払い済みにする
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className={styles.detailRow}>
            <span className={styles.detailLabel}>{label}</span>
            <span className={styles.detailValue}>{value}</span>
        </div>
    );
}
