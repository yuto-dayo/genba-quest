import { useEffect, useState } from "react";
import {
    AlertTriangle,
    ChevronDown,
    ChevronUp,
    Clock3,
    Download,
    FileText,
    RefreshCw,
} from "lucide-react";
import {
    downloadInvoicePdf,
    fetchInvoices,
    type AccountingInvoiceListItem,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./InvoiceListPanel.module.css";

interface InvoiceListPanelProps {
    refreshKey?: number;
    onCreateInvoice: () => void;
}

const documentTypeMeta = {
    standard_invoice: { label: "通常請求書", tone: "neutral" },
    qualified_invoice: { label: "適格請求書", tone: "accent" },
    invoice_supplement: { label: "追完通知", tone: "warning" },
} as const;

const pdfStatusMeta = {
    pending: { label: "PDF生成待ち", tone: "pending" },
    generated: { label: "PDFあり", tone: "ready" },
    failed: { label: "PDF再生成が必要", tone: "failed" },
    locked: { label: "PDF固定", tone: "locked" },
} as const;

const formatDate = (value?: string | null) => {
    if (!value) return "未設定";
    return value.replace(/-/g, "/");
};

const formatCurrency = (value?: number | null) => {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return "金額未連携";
    }

    return `¥${Math.abs(value).toLocaleString()}`;
};

export function InvoiceListPanel({ refreshKey = 0, onCreateInvoice }: InvoiceListPanelProps) {
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);
    const [downloadingId, setDownloadingId] = useState<string | null>(null);
    const [invoices, setInvoices] = useState<AccountingInvoiceListItem[]>([]);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let cancelled = false;

        const loadInvoices = async () => {
            try {
                setLoading(true);
                setError(null);
                const nextInvoices = await fetchInvoices({ limit: 24 });
                if (!cancelled) {
                    setInvoices(nextInvoices);
                }
            } catch (err: unknown) {
                if (!cancelled) {
                    setError(getErrorMessage(err));
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void loadInvoices();

        return () => {
            cancelled = true;
        };
    }, [refreshKey]);

    const handleDownload = async (invoice: AccountingInvoiceListItem) => {
        try {
            setDownloadingId(invoice.id);
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
        } catch (err: unknown) {
            setActionError(getErrorMessage(err, "PDFダウンロードに失敗しました"));
        } finally {
            setDownloadingId(null);
        }
    };

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const attentionCount = invoices.filter((invoice) => {
        const pdfStatus = invoice.pdf_render_status || "pending";
        return pdfStatus === "pending" || pdfStatus === "failed";
    }).length;
    const issuedThisMonthCount = invoices.filter((invoice) => invoice.issue_date?.startsWith(currentMonth)).length;
    const visibleInvoices = expanded ? invoices : invoices.slice(0, 3);
    const hiddenCount = Math.max(invoices.length - visibleInvoices.length, 0);

    return (
        <section className={styles.section}>
            <div className={styles.header}>
                <div className={styles.headerCopy}>
                    <p className={styles.eyebrow}>Invoice Desk</p>
                    <div className={styles.titleRow}>
                        <h2 className={styles.title}>請求書</h2>
                        <span className={styles.countBadge}>{invoices.length}件</span>
                    </div>
                    <p className={styles.description}>
                        主導線は取引登録のままにしつつ、発行後の確認だけをこの棚にまとめます
                    </p>
                </div>
                <button className={styles.createButton} onClick={onCreateInvoice}>
                    <FileText size={16} />
                    <span>請求書作成</span>
                </button>
            </div>

            <div className={styles.summaryGrid}>
                <article className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>発行済み</span>
                    <strong className={styles.summaryValue}>{invoices.length}件</strong>
                    <p className={styles.summaryNote}>履歴全体</p>
                </article>
                <article className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>要確認</span>
                    <strong className={styles.summaryValue}>{attentionCount}件</strong>
                    <p className={styles.summaryNote}>PDF待ち / 再生成</p>
                </article>
                <article className={styles.summaryCard}>
                    <span className={styles.summaryLabel}>今月発行</span>
                    <strong className={styles.summaryValue}>{issuedThisMonthCount}件</strong>
                    <p className={styles.summaryNote}>直近の稼働量</p>
                </article>
            </div>

            <div className={styles.usageNote}>
                <div className={styles.usageIcon}>
                    <Clock3 size={16} />
                </div>
                <div>
                    <strong>発行後の確認棚</strong>
                    <p>新規作成は登録導線から。ここでは番号、請求先、PDF状態の最終確認に絞ります。</p>
                </div>
            </div>

            {actionError && (
                <div className={styles.inlineError}>
                    <AlertTriangle size={16} />
                    <span>{actionError}</span>
                </div>
            )}

            {loading ? (
                <div className={styles.loadingState}>
                    <RefreshCw size={18} className={styles.spinning} />
                    <span>請求書一覧を読み込み中...</span>
                </div>
            ) : error ? (
                <div className={styles.errorState}>
                    <AlertTriangle size={18} />
                    <div>
                        <strong>請求書一覧を取得できませんでした</strong>
                        <p>{error}</p>
                    </div>
                </div>
            ) : invoices.length === 0 ? (
                <div className={styles.emptyState}>
                    <FileText size={28} />
                    <div>
                        <strong>請求書はまだありません</strong>
                        <p>売上から発行すると、ここに履歴が溜まります。</p>
                    </div>
                    <button className={styles.emptyAction} onClick={onCreateInvoice}>
                        最初の請求書を作る
                    </button>
                </div>
            ) : (
                <>
                    <div className={styles.previewHeader}>
                        <div>
                            <h3 className={styles.previewTitle}>最近の請求書</h3>
                            <p className={styles.previewDescription}>
                                {expanded ? "履歴をまとめて表示中" : "初期表示は最新3件だけに絞っています"}
                            </p>
                        </div>
                        {invoices.length > 3 && (
                            <button
                                className={styles.toggleButton}
                                onClick={() => setExpanded((prev) => !prev)}
                                aria-expanded={expanded}
                            >
                                <span>{expanded ? "折りたたむ" : `一覧を開く (${invoices.length}件)`}</span>
                                {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </button>
                        )}
                    </div>

                    <div className={styles.list}>
                        {visibleInvoices.map((invoice) => {
                            const documentType = invoice.document_type || "standard_invoice";
                            const documentMeta = documentTypeMeta[documentType];
                            const pdfStatus = invoice.pdf_render_status || "pending";
                            const pdfMeta = pdfStatusMeta[pdfStatus];
                            const sourceTransaction = invoice.source_transaction;
                            const sourceSummary = invoice.source_summary;
                            const projectLabel =
                                sourceSummary?.site_names?.[0]
                                || sourceTransaction?.site?.name
                                || sourceTransaction?.client?.name
                                || sourceTransaction?.description
                                || "元売上未連携";

                            return (
                                <article key={invoice.id} className={styles.item}>
                                    <div className={styles.itemTop}>
                                        <div className={styles.identity}>
                                            <strong>{invoice.invoice_no}</strong>
                                            <span className={`${styles.typeChip} ${styles[documentMeta.tone]}`}>
                                                {documentMeta.label}
                                            </span>
                                        </div>
                                        <span className={styles.issueDate}>{formatDate(invoice.issue_date)}</span>
                                    </div>

                                    <div className={styles.metaGrid}>
                                        <div>
                                            <span className={styles.metaLabel}>請求先</span>
                                            <span className={styles.metaValue}>{invoice.billing_name || "未設定"}</span>
                                        </div>
                                        <div>
                                            <span className={styles.metaLabel}>金額</span>
                                            <span className={styles.metaValue}>
                                                {formatCurrency(sourceSummary?.amount_total ?? sourceTransaction?.amount_total)}
                                            </span>
                                        </div>
                                        <div>
                                            <span className={styles.metaLabel}>対象現場</span>
                                            <span className={styles.metaValue}>
                                                {sourceSummary?.site_count && sourceSummary.site_count > 1
                                                    ? `${projectLabel} ほか${sourceSummary.site_count - 1}件`
                                                    : projectLabel}
                                            </span>
                                        </div>
                                        <div>
                                            <span className={styles.metaLabel}>支払期限</span>
                                            <span className={styles.metaValue}>{formatDate(invoice.due_date)}</span>
                                        </div>
                                    </div>

                                    <div className={styles.footer}>
                                        <span className={`${styles.statusChip} ${styles[pdfMeta.tone]}`}>
                                            {pdfMeta.label}
                                        </span>
                                        <button
                                            className={styles.downloadButton}
                                            onClick={() => void handleDownload(invoice)}
                                            disabled={downloadingId === invoice.id}
                                        >
                                            <Download size={16} />
                                            <span>{downloadingId === invoice.id ? "取得中..." : "PDF"}</span>
                                        </button>
                                    </div>
                                </article>
                            );
                        })}
                    </div>

                    {!expanded && hiddenCount > 0 && (
                        <p className={styles.listFootnote}>
                            残り{hiddenCount}件は一覧を開くと確認できます。
                        </p>
                    )}
                </>
            )}
        </section>
    );
}
