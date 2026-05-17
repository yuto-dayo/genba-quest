import { X } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import type { AccountingInvoiceListItem } from "../../lib/api";
import styles from "./PartnerDetailDrawer.module.css";

interface PartnerDetailDrawerProps {
    open: boolean;
    partnerName: string;
    invoices: AccountingInvoiceListItem[];
    onClose: () => void;
    onRecordPayment?: (invoice: AccountingInvoiceListItem) => void;
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatDate(value?: string | null): string {
    if (!value) return "未設定";
    return value.replace(/-/g, "/");
}

function invoiceAmount(invoice: AccountingInvoiceListItem): number {
    return Number(invoice.source_summary?.amount_total ?? invoice.source_transaction?.amount_total ?? 0);
}

function invoiceStatusLabel(invoice: AccountingInvoiceListItem): string {
    if (invoice.status === "draft" || invoice.invoice_bucket === "draft") return "下書き";
    if (invoice.is_overdue || invoice.invoice_bucket === "overdue") return "期限超過";
    if (invoice.invoice_bucket === "this_week") return "今週入金予定";
    return "入金待ち";
}

export function PartnerDetailDrawer({
    open,
    partnerName,
    invoices,
    onClose,
    onRecordPayment,
}: PartnerDetailDrawerProps) {
    const reduceMotion = useReducedMotion();

    if (!open) return null;

    const sortedInvoices = [...invoices].sort((a, b) => (
        (b.issue_date || b.created_at || "").localeCompare(a.issue_date || a.created_at || "")
    ));

    return (
        <div className={styles.layer} role="presentation">
            <button type="button" className={styles.scrim} aria-label="閉じる" onClick={onClose} />
            <motion.aside
                className={styles.drawer}
                role="dialog"
                aria-modal="true"
                aria-labelledby="partner-detail-title"
                initial={reduceMotion ? false : { x: "100%" }}
                animate={{ x: 0 }}
                exit={reduceMotion ? undefined : { x: "100%" }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.22, ease: [0.2, 0, 0, 1] }}
            >
                <header className={styles.header}>
                    <div className={styles.titleBlock}>
                        <span className={styles.kicker}>取引先・請求書</span>
                        <h2 id="partner-detail-title" className={styles.title} title={partnerName}>
                            {partnerName}
                        </h2>
                    </div>
                    <button type="button" className={styles.iconButton} aria-label="閉じる" onClick={onClose}>
                        <X size={18} aria-hidden />
                    </button>
                </header>

                <div className={styles.timeline} aria-label="請求書履歴">
                    {sortedInvoices.length === 0 ? (
                        <p className={styles.empty}>該当する請求書はありません</p>
                    ) : (
                        sortedInvoices.map((invoice) => (
                            <article key={invoice.id} className={styles.timelineItem}>
                                <div className={styles.marker} aria-hidden />
                                <div className={styles.itemBody}>
                                    <div className={styles.itemHead}>
                                        <span className={styles.invoiceNo}>{invoice.invoice_no}</span>
                                        <span className={styles.amount}>{formatYen(invoiceAmount(invoice))}</span>
                                    </div>
                                    <div className={styles.meta}>
                                        <span>発行 {formatDate(invoice.issue_date)}</span>
                                        <span>期限 {formatDate(invoice.due_date)}</span>
                                        <span className={styles.status}>{invoiceStatusLabel(invoice)}</span>
                                    </div>
                                    <div className={styles.actions}>
                                        <button
                                            type="button"
                                            className={styles.actionButton}
                                            onClick={() => onRecordPayment?.(invoice)}
                                        >
                                            入金を記録
                                        </button>
                                        <button type="button" className={styles.pdfButton}>
                                            PDF
                                        </button>
                                    </div>
                                </div>
                            </article>
                        ))
                    )}
                </div>

                <footer className={styles.footer}>
                    <span className={styles.contact}>連絡先は Communication で確認</span>
                    <button type="button" className={styles.closeButton} onClick={onClose}>
                        閉じる
                    </button>
                </footer>
            </motion.aside>
        </div>
    );
}
