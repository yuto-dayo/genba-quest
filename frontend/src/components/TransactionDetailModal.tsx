import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    AlertTriangle,
    CalendarDays,
    Download,
    FileText,
    Loader2,
    Receipt,
    TrendingUp,
    Undo2,
    X,
} from "lucide-react";
import {
    downloadInvoicePdf,
    fetchInvoices,
    voidTransaction,
    type AccountingInvoiceListItem,
    type AccountingTransaction,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { InvoiceCorrectionModal } from "./InvoiceCorrectionModal";
import { ExpenseHistoryTimeline } from "./ExpenseHistoryTimeline";
import styles from "./TransactionDetailModal.module.css";

interface TransactionDetailModalProps {
    transaction: AccountingTransaction;
    onClose: () => void;
    onVoided: () => void | Promise<void>;
    onUpdated: () => void | Promise<void>;
    onStartCorrection: (transaction: AccountingTransaction) => void;
}

const kindMeta = {
    expense: { label: "経費", icon: <Receipt size={16} />, tone: "expense" },
    sale: { label: "売上", icon: <TrendingUp size={16} />, tone: "sale" },
    invoice: { label: "請求済み売上", icon: <FileText size={16} />, tone: "invoice" },
} as const;

const statusMeta = {
    draft: { label: "下書き", tone: "neutral" },
    pending_review: { label: "承認待ち", tone: "warning" },
    approved: { label: "承認済み", tone: "success" },
    posted: { label: "記帳済み", tone: "success" },
    rejected: { label: "差し戻し", tone: "danger" },
    voided: { label: "取消済み", tone: "danger" },
} as const;

const taxCategoryLabels: Record<string, string> = {
    "10_STANDARD": "課税 10%",
    "08_REDUCED": "軽減 8%",
    "00_EXEMPT": "非課税",
    "00_TAXFREE": "不課税",
};

const expenseCategoryLabels: Record<string, string> = {
    material: "材料費",
    tool: "工具・備品",
    travel: "交通費",
    food: "食費・会議費",
    fuel: "燃料費",
    utility: "光熱費",
    other: "その他",
};

function formatDate(value?: string | null): string {
    if (!value) return "未設定";
    return value.replace(/-/g, "/");
}

function formatCurrency(value?: number | null): string {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "未設定";
    }

    return `¥${Math.abs(value).toLocaleString()}`;
}

function formatSignedCurrency(transaction: AccountingTransaction): string {
    if (typeof transaction.amount_total !== "number" || !Number.isFinite(transaction.amount_total)) {
        return "未設定";
    }

    const isReversalAmount = transaction.amount_total < 0;
    const sign = transaction.kind === "expense"
        ? isReversalAmount ? "+" : "-"
        : isReversalAmount ? "-" : "+";
    return `${sign}¥${Math.abs(transaction.amount_total).toLocaleString()}`;
}

function getSourceDocumentMessage(sourceDocument: AccountingTransaction["source_document"]): string {
    if (!sourceDocument?.original_filename) {
        return "アップロード証憑はありません";
    }

    if (sourceDocument.drive_file_url) {
        return "Google Drive 上の元ファイルを確認できます";
    }

    return "ファイル名は記録済みです。元ファイルリンクはありません";
}

export function TransactionDetailModal({
    transaction,
    onClose,
    onVoided,
    onUpdated,
    onStartCorrection,
}: TransactionDetailModalProps) {
    const [relatedInvoices, setRelatedInvoices] = useState<AccountingInvoiceListItem[]>([]);
    const [loadingInvoices, setLoadingInvoices] = useState(true);
    const [loadingError, setLoadingError] = useState<string | null>(null);
    const [voidReason, setVoidReason] = useState("");
    const [submittingVoid, setSubmittingVoid] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);
    const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<string | null>(null);
    const [correctionTarget, setCorrectionTarget] = useState<AccountingInvoiceListItem | null>(null);
    const [correctionMode, setCorrectionMode] = useState<"document_only" | "supplement">("document_only");

    useEffect(() => {
        let cancelled = false;

        const loadRelatedInvoices = async () => {
            try {
                setLoadingInvoices(true);
                setLoadingError(null);
                const invoices = await fetchInvoices({
                    limit: 12,
                    source_transaction_id: transaction.id,
                });
                if (!cancelled) {
                    setRelatedInvoices(invoices);
                }
            } catch (error: unknown) {
                if (!cancelled) {
                    setLoadingError(getErrorMessage(error));
                }
            } finally {
                if (!cancelled) {
                    setLoadingInvoices(false);
                }
            }
        };

        void loadRelatedInvoices();

        return () => {
            cancelled = true;
        };
    }, [transaction.id]);

    const activeKindMeta = kindMeta[transaction.kind];
    const hasLinkedInvoices = relatedInvoices.length > 0 || transaction.kind === "invoice";
    const isReversalTransaction = Boolean(transaction.voids_transaction_id);
    const activeStatusMeta = isReversalTransaction
        ? { label: "逆仕訳", tone: "danger" as const }
        : statusMeta[transaction.status] || statusMeta.draft;
    const canStartCorrection = !isReversalTransaction
        && transaction.status !== "voided"
        && (transaction.kind === "expense" || transaction.kind === "sale");
    const canVoid = !isReversalTransaction
        && (transaction.status === "posted" || transaction.status === "approved")
        && !hasLinkedInvoices;
    const summaryTitle = transaction.vendor_name || transaction.client?.name || transaction.site?.name || "取引詳細";

    const lineItems = useMemo(() => {
        if (!Array.isArray(transaction.items)) {
            return [];
        }

        return transaction.items.filter((item) => item.item_name || item.amount);
    }, [transaction.items]);

    const refreshRelatedInvoices = async () => {
        try {
            setLoadingInvoices(true);
            setLoadingError(null);
            const invoices = await fetchInvoices({
                limit: 12,
                source_transaction_id: transaction.id,
            });
            setRelatedInvoices(invoices);
        } catch (error: unknown) {
            setLoadingError(getErrorMessage(error));
        } finally {
            setLoadingInvoices(false);
        }
    };

    const handleInvoiceDownload = async (invoice: AccountingInvoiceListItem) => {
        try {
            setDownloadingInvoiceId(invoice.id);
            setActionError(null);
            const { blob, filename } = await downloadInvoicePdf(invoice.id);
            const objectUrl = window.URL.createObjectURL(blob);
            const anchor = document.createElement("a");
            anchor.href = objectUrl;
            anchor.download = filename;
            document.body.append(anchor);
            anchor.click();
            anchor.remove();
            window.URL.revokeObjectURL(objectUrl);
        } catch (error: unknown) {
            setActionError(getErrorMessage(error, "関連請求書のPDF取得に失敗しました"));
        } finally {
            setDownloadingInvoiceId(null);
        }
    };

    const handleVoid = async () => {
        if (!voidReason.trim()) {
            setActionError("取消理由を入力してください");
            return;
        }

        try {
            setSubmittingVoid(true);
            setActionError(null);
            await voidTransaction(transaction.id, voidReason.trim());
            await onVoided();
            onClose();
        } catch (error: unknown) {
            setActionError(getErrorMessage(error, "取引の取消に失敗しました"));
        } finally {
            setSubmittingVoid(false);
        }
    };

    const sourceDocument = transaction.source_document;
    const totalLabel = isReversalTransaction
        ? "逆仕訳額"
        : transaction.status === "voided" ? "取消済み金額" : "合計";
    const totalValue = transaction.status === "voided" || isReversalTransaction
        ? formatSignedCurrency(transaction)
        : formatCurrency(transaction.amount_total);
    const sourceDocumentMessage = getSourceDocumentMessage(sourceDocument);

    return (
        <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="transaction-detail-title"
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.22, ease: "easeOut" }}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div className={styles.headerCopy}>
                        <div className={styles.badgeRow}>
                            <span className={`${styles.kindBadge} ${styles[activeKindMeta.tone]}`}>
                                {activeKindMeta.icon}
                                {activeKindMeta.label}
                            </span>
                            <span className={`${styles.statusBadge} ${styles[activeStatusMeta.tone]}`}>
                                {activeStatusMeta.label}
                            </span>
                        </div>
                        <h2 id="transaction-detail-title" className={styles.title}>{summaryTitle}</h2>
                        <p className={styles.subtitle}>
                            {transaction.description || "詳細説明はまだありません"}
                        </p>
                    </div>
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="詳細を閉じる">
                        <X size={18} />
                    </button>
                </header>

                <div className={styles.summaryGrid}>
                    <article className={styles.summaryCard}>
                        <span className={styles.summaryLabel}>{totalLabel}</span>
                        <strong className={styles.summaryValue}>{totalValue}</strong>
                    </article>
                    <article className={styles.summaryCard}>
                        <span className={styles.summaryLabel}>取引日</span>
                        <strong className={styles.summaryValue}>{formatDate(transaction.recorded_date)}</strong>
                    </article>
                    <article className={styles.summaryCard}>
                        <span className={styles.summaryLabel}>税額</span>
                        <strong className={styles.summaryValue}>{formatCurrency(transaction.tax_amount)}</strong>
                    </article>
                </div>

                {(actionError || loadingError) && (
                    <div className={styles.inlineError}>
                        <AlertTriangle size={16} />
                        <span>{actionError || loadingError}</span>
                    </div>
                )}

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>基本情報</h3>
                    </div>
                    <div className={styles.detailGrid}>
                        <div>
                            <span className={styles.detailLabel}>取引先 / 現場</span>
                            <span className={styles.detailValue}>
                                {transaction.vendor_name || transaction.client?.name || transaction.site?.name || "未設定"}
                            </span>
                        </div>
                        <div>
                            <span className={styles.detailLabel}>作成日時</span>
                            <span className={styles.detailValue}>{formatDate(transaction.created_at?.slice(0, 10))}</span>
                        </div>
                        <div>
                            <span className={styles.detailLabel}>小計</span>
                            <span className={styles.detailValue}>{formatCurrency(transaction.amount_subtotal)}</span>
                        </div>
                        <div>
                            <span className={styles.detailLabel}>税区分</span>
                            <span className={styles.detailValue}>{taxCategoryLabels[transaction.tax_category || ""] || "未設定"}</span>
                        </div>
                        {transaction.kind === "expense" && (
                            <div>
                                <span className={styles.detailLabel}>経費カテゴリ</span>
                                <span className={styles.detailValue}>{expenseCategoryLabels[transaction.category || ""] || "未設定"}</span>
                            </div>
                        )}
                        <div>
                            <span className={styles.detailLabel}>入力元</span>
                            <span className={styles.detailValue}>
                                {sourceDocument?.original_filename || "手入力中心"}
                            </span>
                        </div>
                    </div>
                </section>

                {lineItems.length > 0 && (
                    <section className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <h3 className={styles.sectionTitle}>明細</h3>
                        </div>
                        <div className={styles.lineItemList}>
                            {lineItems.map((item, index) => (
                                <article key={`${item.item_name}-${index}`} className={styles.lineItem}>
                                    <div>
                                        <strong>{item.item_name || `項目 ${index + 1}`}</strong>
                                        <p>
                                            {(item.quantity ?? "-")} {item.unit_name || ""}
                                            {item.unit_price != null ? ` × ${formatCurrency(item.unit_price)}` : ""}
                                        </p>
                                    </div>
                                    <span>{formatCurrency(item.amount)}</span>
                                </article>
                            ))}
                        </div>
                    </section>
                )}

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>証憑と帳票</h3>
                    </div>

                    <div className={styles.documentCard}>
                        <div className={styles.documentCopy}>
                            <span className={styles.detailLabel}>添付証憑</span>
                            <strong>{sourceDocument?.original_filename || "証憑なし"}</strong>
                            <p>{sourceDocumentMessage}</p>
                        </div>
                        {sourceDocument?.drive_file_url && (
                            <a
                                className={styles.linkButton}
                                href={sourceDocument.drive_file_url}
                                target="_blank"
                                rel="noreferrer"
                            >
                                元ファイルを開く
                            </a>
                        )}
                    </div>

                    <div className={styles.invoiceBlock}>
                        <div className={styles.invoiceHeader}>
                            <span className={styles.detailLabel}>関連請求書</span>
                            {loadingInvoices && <Loader2 size={16} className={styles.spinning} />}
                        </div>
                        {loadingInvoices ? (
                            <p className={styles.mutedText}>関連請求書を確認中...</p>
                        ) : relatedInvoices.length === 0 ? (
                            <p className={styles.mutedText}>関連請求書はまだありません。</p>
                        ) : (
                            <div className={styles.invoiceList}>
                                {relatedInvoices.map((invoice) => (
                                    <article key={invoice.id} className={styles.invoiceItem}>
                                        <div>
                                            <strong>{invoice.invoice_no}</strong>
                                            <p>
                                                {formatDate(invoice.issue_date)} / {invoice.billing_name || "請求先未設定"}
                                            </p>
                                        </div>
                                        <div className={styles.invoiceActions}>
                                            <button
                                                type="button"
                                                className={styles.ghostButton}
                                                onClick={() => void handleInvoiceDownload(invoice)}
                                                disabled={downloadingInvoiceId === invoice.id}
                                            >
                                                <Download size={16} />
                                                <span>{downloadingInvoiceId === invoice.id ? "取得中..." : "PDF"}</span>
                                            </button>
                                            {invoice.document_type !== "invoice_supplement" && (
                                                <>
                                                    <button
                                                        type="button"
                                                        className={styles.secondaryButton}
                                                        onClick={() => {
                                                            setCorrectionTarget(invoice);
                                                            setCorrectionMode("document_only");
                                                        }}
                                                    >
                                                        <FileText size={16} />
                                                        <span>表示内容を修正</span>
                                                    </button>
                                                    {invoice.document_type === "standard_invoice" ? (
                                                        <button
                                                            type="button"
                                                            className={styles.secondaryButton}
                                                            onClick={() => {
                                                                setCorrectionTarget(invoice);
                                                                setCorrectionMode("supplement");
                                                            }}
                                                        >
                                                            <CalendarDays size={16} />
                                                            <span>不足項目を追記</span>
                                                        </button>
                                                    ) : null}
                                                </>
                                            )}
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>
                </section>

                {transaction.kind === "expense" && (
                    <ExpenseHistoryTimeline expenseId={transaction.id} />
                )}

                <section className={styles.section}>
                    <div className={styles.sectionHeader}>
                        <h3 className={styles.sectionTitle}>訂正アクション</h3>
                    </div>

                    {transaction.status === "voided" ? (
                        <div className={styles.noticeCard}>
                            <AlertTriangle size={16} />
                            <div>
                                <strong>この取引はすでに取消済みです</strong>
                                <p>{transaction.void_reason || "取消理由はまだ記録されていません。"}</p>
                            </div>
                        </div>
                    ) : isReversalTransaction ? (
                        <div className={styles.noticeCard}>
                            <AlertTriangle size={16} />
                            <div>
                                <strong>取消で作られた逆仕訳は再度取消できません</strong>
                                <p>必要な修正は元データを見直して、新しい正しい取引として登録します。</p>
                            </div>
                        </div>
                    ) : hasLinkedInvoices ? (
                        <div className={styles.actionPanel}>
                            <div className={styles.noticeCard}>
                                <AlertTriangle size={16} />
                                <div>
                                    <strong>請求書つき取引は、まず帳票側の誤りを確定します</strong>
                                    <p>宛先や備考の修正は「表示内容を修正」、不足していた情報の追加は「不足項目を追記」を使います。金額や数量の誤りは帳票整理後に取引取消へ進めます。</p>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className={styles.actionPanel}>
                            <div className={styles.noticeCard}>
                                <CalendarDays size={16} />
                                <div>
                                    <strong>確定済みの値は直接上書きしません</strong>
                                    <p>取消理由を残して逆仕訳を起こし、必要なら同内容をコピーして再入力します。</p>
                                </div>
                            </div>
                            <label className={styles.reasonField}>
                                <span>取消理由</span>
                                <textarea
                                    value={voidReason}
                                    onChange={(event) => setVoidReason(event.target.value)}
                                    placeholder="例: 請求先を取り違えたため再入力"
                                    rows={3}
                                />
                            </label>
                            <div className={styles.actionRow}>
                                {canStartCorrection && (
                                    <button
                                        type="button"
                                        className={styles.secondaryButton}
                                        onClick={() => onStartCorrection(transaction)}
                                    >
                                        <FileText size={16} />
                                        <span>内容をコピーして再入力</span>
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className={styles.primaryDangerButton}
                                    onClick={() => void handleVoid()}
                                    disabled={!canVoid || submittingVoid}
                                >
                                    {submittingVoid ? <Loader2 size={16} className={styles.spinning} /> : <Undo2 size={16} />}
                                    <span>{submittingVoid ? "取消中..." : "取消して訂正へ進む"}</span>
                                </button>
                            </div>
                        </div>
                    )}
                </section>

                {correctionTarget && (
                    <InvoiceCorrectionModal
                        key={`${correctionTarget.id}-${correctionMode}`}
                        invoice={correctionTarget}
                        sourceTransaction={transaction}
                        mode={correctionMode}
                        onClose={() => setCorrectionTarget(null)}
                        onSuccess={async () => {
                            await refreshRelatedInvoices();
                            await onUpdated();
                        }}
                    />
                )}
            </motion.div>
        </motion.div>
    );
}
