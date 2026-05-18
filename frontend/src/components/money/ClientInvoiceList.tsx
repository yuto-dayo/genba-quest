import { useMemo, useState } from "react";
import { AlertCircle, ChevronRight, FileText, Loader2 } from "lucide-react";
import type { ClientInvoiceWithReceipts } from "../../lib/api";
import { CashReceiptRecordModal } from "./CashReceiptRecordModal";
import { ClientInvoiceDetailModal } from "./ClientInvoiceDetailModal";
import { InvoiceStatusBadge, type ClientInvoiceStatus } from "./InvoiceStatusBadge";
import styles from "./ClientInvoiceList.module.css";

interface ClientInvoiceListProps {
    invoices: ClientInvoiceWithReceipts[];
    loading?: boolean;
    error?: string | null;
    onRefresh?: () => void;
    onIssueInvoice?: () => void;
}

interface SectionConfig {
    status: ClientInvoiceStatus;
    title: string;
    tone?: "danger";
}

const SECTIONS: SectionConfig[] = [
    { status: "awaiting_payment", title: "入金待ち", tone: "danger" },
    { status: "issued", title: "発行済" },
    { status: "unissued", title: "未発行" },
    { status: "paid", title: "入金済" },
];

function formatYen(amount: number): string {
    return `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount)}`;
}

function formatDate(value?: string | null): string {
    return value ? value.replace(/-/g, "/") : "未設定";
}

function invoiceAmount(invoice: ClientInvoiceWithReceipts): number {
    return Number(invoice.source_summary?.amount_total ?? invoice.source_transaction?.amount_total ?? 0);
}

function clientName(invoice: ClientInvoiceWithReceipts): string {
    return invoice.source_summary?.client_name
        ?? invoice.source_transaction?.client?.name
        ?? invoice.billing_name
        ?? "取引先未設定";
}

function clientId(invoice: ClientInvoiceWithReceipts): string | null {
    return invoice.source_summary?.client_id ?? invoice.source_transaction?.client?.id ?? null;
}

function isInvoicePaid(invoice: ClientInvoiceWithReceipts): boolean {
    return invoice.status === "paid" || invoice.cash_receipts.length > 0;
}

function getInvoiceStatus(invoice: ClientInvoiceWithReceipts): ClientInvoiceStatus {
    if (isInvoicePaid(invoice)) return "paid";
    if (invoice.status === "draft" || invoice.invoice_bucket === "draft" || invoice.pdf_render_status === "pending") {
        return "unissued";
    }
    if (invoice.is_overdue || (typeof invoice.days_until_due === "number" && invoice.days_until_due < 0)) {
        return "awaiting_payment";
    }
    return "issued";
}

function sortInvoices(a: ClientInvoiceWithReceipts, b: ClientInvoiceWithReceipts): number {
    const dueCompare = (a.due_date || "").localeCompare(b.due_date || "");
    if (dueCompare !== 0) return dueCompare;
    return (b.issue_date || b.created_at || "").localeCompare(a.issue_date || a.created_at || "");
}

export function ClientInvoiceList({
    invoices,
    loading,
    error,
    onRefresh,
    onIssueInvoice,
}: ClientInvoiceListProps) {
    const [detailInvoice, setDetailInvoice] = useState<ClientInvoiceWithReceipts | null>(null);
    const [receiptInvoice, setReceiptInvoice] = useState<ClientInvoiceWithReceipts | null>(null);

    const grouped = useMemo(() => {
        const map = new Map<ClientInvoiceStatus, ClientInvoiceWithReceipts[]>();
        for (const section of SECTIONS) {
            map.set(section.status, []);
        }
        for (const invoice of invoices) {
            map.get(getInvoiceStatus(invoice))?.push(invoice);
        }
        for (const [status, list] of map.entries()) {
            const sorted = [...list].sort(sortInvoices);
            map.set(status, sorted);
        }
        return map;
    }, [invoices]);

    const candidateInvoices = useMemo(() => {
        if (!receiptInvoice) return [];
        const receiptClientId = clientId(receiptInvoice);
        return invoices.filter((invoice) =>
            clientId(invoice) === receiptClientId
            && getInvoiceStatus(invoice) !== "paid"
        );
    }, [invoices, receiptInvoice]);

    if (loading) {
        return (
            <div className={styles.statePanel} role="status">
                <Loader2 size={18} className={styles.spinIcon} aria-hidden="true" />
                請求書を読み込み中
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorPanel} role="alert">
                <AlertCircle size={18} aria-hidden="true" />
                請求書の取得に失敗: {error}
            </div>
        );
    }

    return (
        <>
            <div className={styles.listRoot}>
                {SECTIONS.map((section) => {
                    const sectionInvoices = grouped.get(section.status) ?? [];
                    const total = sectionInvoices.reduce((sum, invoice) => sum + invoiceAmount(invoice), 0);
                    return (
                        <section key={section.status} className={styles.section}>
                            <div className={styles.sectionHead}>
                                <div>
                                    <h3 className={`${styles.sectionTitle} ${section.tone === "danger" ? styles.danger : ""}`}>
                                        {section.title}
                                    </h3>
                                    <p>
                                        {sectionInvoices.length}件 / {formatYen(total)}
                                    </p>
                                </div>
                            </div>

                            {sectionInvoices.length === 0 ? (
                                <div className={styles.empty}>該当する請求書はありません</div>
                            ) : (
                                <div className={styles.invoiceRows}>
                                    {sectionInvoices.map((invoice) => (
                                        <button
                                            key={invoice.id}
                                            type="button"
                                            className={`${styles.invoiceRow} ${section.status === "awaiting_payment" ? styles.overdueRow : ""}`}
                                            onClick={() => setDetailInvoice(invoice)}
                                        >
                                            <span className={styles.leadingIcon} aria-hidden="true">
                                                <FileText size={16} />
                                            </span>
                                            <span className={styles.invoiceMain}>
                                                <span className={styles.invoiceTitle}>{clientName(invoice)}</span>
                                                <span className={styles.invoiceMeta}>
                                                    {invoice.invoice_no} / 期限 {formatDate(invoice.due_date)}
                                                </span>
                                            </span>
                                            <span className={styles.invoiceSide}>
                                                <span className={styles.invoiceAmount}>{formatYen(invoiceAmount(invoice))}</span>
                                                <InvoiceStatusBadge status={section.status} />
                                            </span>
                                            <ChevronRight size={18} className={styles.chevron} aria-hidden="true" />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>

            {detailInvoice && (
                <ClientInvoiceDetailModal
                    invoice={detailInvoice}
                    status={getInvoiceStatus(detailInvoice)}
                    onClose={() => setDetailInvoice(null)}
                    onIssue={onIssueInvoice}
                    onRecordReceipt={() => {
                        setReceiptInvoice(detailInvoice);
                        setDetailInvoice(null);
                    }}
                />
            )}

            {receiptInvoice && (
                <CashReceiptRecordModal
                    invoice={receiptInvoice}
                    candidateInvoices={candidateInvoices}
                    onClose={() => setReceiptInvoice(null)}
                    onSubmitted={() => {
                        onRefresh?.();
                    }}
                />
            )}
        </>
    );
}
