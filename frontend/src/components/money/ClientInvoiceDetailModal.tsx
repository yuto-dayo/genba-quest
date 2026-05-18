import { X } from "lucide-react";
import type { ClientInvoiceWithReceipts } from "../../lib/api";
import { InvoiceStatusBadge, type ClientInvoiceStatus } from "./InvoiceStatusBadge";
import styles from "./ClientInvoiceDetailModal.module.css";

interface ClientInvoiceDetailModalProps {
    invoice: ClientInvoiceWithReceipts;
    status: ClientInvoiceStatus;
    onClose: () => void;
    onIssue?: () => void;
    onRecordReceipt: () => void;
}

const VARIANCE_LABELS: Record<string, string> = {
    fee_deduction: "振込手数料",
    overpayment: "値引き",
    withholding_tax: "源泉徴収",
    partial_payment: "一部入金",
    unknown: "その他",
    tax_correction: "税額調整",
};

const STATUS_LABELS: Record<ClientInvoiceStatus, string> = {
    awaiting_payment: "入金待ち",
    issued: "発行済",
    unissued: "未発行",
    paid: "入金済",
};

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

function varianceAmount(invoice: ClientInvoiceWithReceipts): number {
    const receipt = invoice.cash_receipts[0];
    if (!receipt) return 0;
    return Math.abs(invoiceAmount(invoice) - Number(receipt.received_amount || 0));
}

function actionLabel(status: ClientInvoiceStatus): string {
    if (status === "unissued") return "発行";
    if (status === "paid") return "詳細";
    return "入金を確認";
}

export function ClientInvoiceDetailModal({
    invoice,
    status,
    onClose,
    onIssue,
    onRecordReceipt,
}: ClientInvoiceDetailModalProps) {
    const amount = invoiceAmount(invoice);
    const receipt = invoice.cash_receipts[0] ?? null;
    const variance = varianceAmount(invoice);

    function handlePrimaryAction() {
        if (status === "unissued") {
            onIssue?.();
            return;
        }
        if (status === "issued" || status === "awaiting_payment") {
            onRecordReceipt();
        }
    }

    return (
        <div className={styles.scrim} onClick={onClose}>
            <dialog
                open
                className={styles.dialog}
                aria-labelledby="client-invoice-detail-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>請求書詳細</p>
                        <h2 id="client-invoice-detail-title" className={styles.title}>
                            {clientName(invoice)}
                        </h2>
                    </div>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    <div className={styles.summary}>
                        <div>
                            <span className={styles.invoiceNo}>{invoice.invoice_no}</span>
                            <InvoiceStatusBadge status={status} />
                        </div>
                        <strong>{formatYen(amount)}</strong>
                    </div>

                    <dl className={styles.detailGrid}>
                        <div>
                            <dt>状態</dt>
                            <dd>{STATUS_LABELS[status]}</dd>
                        </div>
                        <div>
                            <dt>発行日</dt>
                            <dd>{formatDate(invoice.issue_date)}</dd>
                        </div>
                        <div>
                            <dt>入金期限</dt>
                            <dd>{formatDate(invoice.due_date)}</dd>
                        </div>
                        <div>
                            <dt>現場</dt>
                            <dd>{invoice.source_transaction?.site?.name ?? "未設定"}</dd>
                        </div>
                    </dl>

                    {receipt && (
                        <section className={styles.receiptPanel}>
                            <h3>入金記録</h3>
                            <dl className={styles.detailGrid}>
                                <div>
                                    <dt>入金日</dt>
                                    <dd>{formatDate(receipt.received_date)}</dd>
                                </div>
                                <div>
                                    <dt>実入金額</dt>
                                    <dd>{formatYen(Number(receipt.received_amount || 0))}</dd>
                                </div>
                                <div>
                                    <dt>差額内訳</dt>
                                    <dd>
                                        {variance > 0
                                            ? `${VARIANCE_LABELS[receipt.variance_reason] ?? "差額"} ${formatYen(variance)}`
                                            : "差額なし"}
                                    </dd>
                                </div>
                                <div>
                                    <dt>銀行明細</dt>
                                    <dd>{receipt.bank_txn_ref || "未入力"}</dd>
                                </div>
                            </dl>
                        </section>
                    )}
                </div>

                <footer className={styles.actions}>
                    <button type="button" className={styles.secondaryButton} onClick={onClose}>
                        閉じる
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handlePrimaryAction}
                        disabled={status === "paid" || (status === "unissued" && !onIssue)}
                    >
                        {actionLabel(status)}
                    </button>
                </footer>
            </dialog>
        </div>
    );
}
