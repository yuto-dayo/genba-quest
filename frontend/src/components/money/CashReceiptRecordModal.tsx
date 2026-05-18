import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Plus, X } from "lucide-react";
import {
    submitCashReceiptProposal,
    type CashReceiptVarianceReason,
    type ClientInvoiceWithReceipts,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./CashReceiptRecordModal.module.css";

interface CashReceiptRecordModalProps {
    invoice: ClientInvoiceWithReceipts;
    candidateInvoices: ClientInvoiceWithReceipts[];
    onClose: () => void;
    onSubmitted?: () => void;
}

interface AllocationDraft {
    key: string;
    invoiceTransactionId: string;
    invoiceId: string;
    amount: number;
}

const VARIANCE_REASONS: Array<{
    value: CashReceiptVarianceReason;
    label: string;
}> = [
    { value: "fee_deduction", label: "振込手数料" },
    { value: "overpayment", label: "値引き" },
    { value: "withholding_tax", label: "源泉徴収" },
    { value: "partial_payment", label: "一部入金" },
    { value: "unknown", label: "その他" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function formatYen(amount: number): string {
    return `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount)}`;
}

function formatInputAmount(amount: number): string {
    if (!amount) return "";
    return new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount);
}

function parseMoneyInput(value: string): number {
    const normalized = value.replace(/[^\d]/g, "");
    if (!normalized) return 0;
    return Number(normalized);
}

function invoiceAmount(invoice: ClientInvoiceWithReceipts): number {
    return Number(invoice.source_summary?.amount_total ?? invoice.source_transaction?.amount_total ?? 0);
}

function invoiceClientId(invoice: ClientInvoiceWithReceipts): string {
    return invoice.source_summary?.client_id ?? invoice.source_transaction?.client?.id ?? "";
}

function invoiceClientName(invoice: ClientInvoiceWithReceipts): string {
    return invoice.source_summary?.client_name
        ?? invoice.source_transaction?.client?.name
        ?? invoice.billing_name
        ?? "取引先未設定";
}

function invoiceTransactionId(invoice: ClientInvoiceWithReceipts): string {
    return invoice.source_transaction?.id ?? invoice.source_transaction_id ?? invoice.transaction_id;
}

function makeAllocation(invoice: ClientInvoiceWithReceipts, receivedAmount: number): AllocationDraft {
    return {
        key: `${invoice.id}-${invoiceTransactionId(invoice)}`,
        invoiceId: invoice.id,
        invoiceTransactionId: invoiceTransactionId(invoice),
        amount: Math.min(invoiceAmount(invoice), receivedAmount),
    };
}

export function CashReceiptRecordModal({
    invoice,
    candidateInvoices,
    onClose,
    onSubmitted,
}: CashReceiptRecordModalProps) {
    const baseAmount = invoiceAmount(invoice);
    const clientId = invoiceClientId(invoice);
    const clientName = invoiceClientName(invoice);
    const [receivedAmount, setReceivedAmount] = useState(baseAmount);
    const [receivedDate, setReceivedDate] = useState(todayIso());
    const [varianceReason, setVarianceReason] = useState<CashReceiptVarianceReason>("fee_deduction");
    const [varianceMemo, setVarianceMemo] = useState("");
    const [bankTxnRef, setBankTxnRef] = useState("");
    const [allocations, setAllocations] = useState<AllocationDraft[]>(() => [
        makeAllocation(invoice, baseAmount),
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        setReceivedAmount(baseAmount);
        setReceivedDate(todayIso());
        setVarianceReason("fee_deduction");
        setVarianceMemo("");
        setBankTxnRef("");
        setAllocations([makeAllocation(invoice, baseAmount)]);
        setSubmitError(null);
    }, [baseAmount, invoice]);

    const selectedInvoiceIds = useMemo(
        () => new Set(allocations.map((allocation) => allocation.invoiceId)),
        [allocations],
    );

    const addableInvoices = candidateInvoices.filter((candidate) =>
        !selectedInvoiceIds.has(candidate.id)
        && invoiceClientId(candidate) === clientId
        && invoiceTransactionId(candidate)
    );

    const allocationTotal = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
    const varianceAmount = Math.abs(baseAmount - receivedAmount);
    const allocationsExceeded = allocationTotal > receivedAmount;
    const hasClient = Boolean(clientId);
    const canSubmit = hasClient
        && receivedAmount > 0
        && Boolean(receivedDate)
        && !allocationsExceeded
        && !submitting;

    function updateReceivedAmount(value: string) {
        const nextAmount = parseMoneyInput(value);
        setReceivedAmount(nextAmount);
        setAllocations((current) => {
            if (current.length !== 1 || current[0]?.invoiceId !== invoice.id) return current;
            return [{ ...current[0], amount: Math.min(baseAmount, nextAmount) }];
        });
    }

    function updateAllocationAmount(key: string, value: string) {
        const nextAmount = parseMoneyInput(value);
        setAllocations((current) =>
            current.map((allocation) =>
                allocation.key === key ? { ...allocation, amount: nextAmount } : allocation
            )
        );
    }

    function addInvoice() {
        const nextInvoice = addableInvoices[0];
        if (!nextInvoice) return;
        setAllocations((current) => [...current, makeAllocation(nextInvoice, 0)]);
    }

    function removeAllocation(key: string) {
        setAllocations((current) =>
            current.length === 1 ? current : current.filter((allocation) => allocation.key !== key)
        );
    }

    async function handleSubmit() {
        if (!canSubmit) return;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await submitCashReceiptProposal({
                client_id: clientId,
                received_date: receivedDate,
                received_amount: receivedAmount,
                allocations: allocations
                    .filter((allocation) => allocation.amount > 0)
                    .map((allocation) => ({
                        invoice_transaction_id: allocation.invoiceTransactionId,
                        allocated_amount: allocation.amount,
                    })),
                variance_reason: varianceReason,
                variance_memo: varianceMemo.trim() || null,
                notes: varianceMemo.trim() || null,
                bank_txn_ref: bankTxnRef.trim() || null,
            });
            onSubmitted?.();
            onClose();
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <div className={styles.scrim} onClick={onClose}>
            <dialog
                open
                className={styles.dialog}
                aria-labelledby="cash-receipt-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>入金確認</p>
                        <h2 id="cash-receipt-title" className={styles.title}>
                            {clientName}からの入金確認
                        </h2>
                    </div>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    <div className={styles.amountPanel}>
                        <div className={styles.amountRow}>
                            <span>請求額</span>
                            <strong>{formatYen(baseAmount)}</strong>
                        </div>
                        <label className={styles.amountInputRow}>
                            <span>実際の振込額</span>
                            <span className={styles.moneyInputWrap}>
                                <span aria-hidden="true">¥</span>
                                <input
                                    value={formatInputAmount(receivedAmount)}
                                    onChange={(event) => updateReceivedAmount(event.target.value)}
                                    inputMode="numeric"
                                    aria-label="実際の振込額"
                                />
                            </span>
                        </label>
                        <div className={styles.varianceRow}>
                            <span>差額</span>
                            <strong>{formatYen(varianceAmount)}</strong>
                        </div>
                    </div>

                    <fieldset className={styles.reasonGroup}>
                        <legend>差額の理由</legend>
                        {VARIANCE_REASONS.map((reason) => (
                            <label key={reason.value} className={styles.radioRow}>
                                <input
                                    type="radio"
                                    name="variance_reason"
                                    value={reason.value}
                                    checked={varianceReason === reason.value}
                                    onChange={() => setVarianceReason(reason.value)}
                                />
                                <span>{reason.label}</span>
                            </label>
                        ))}
                    </fieldset>

                    <label className={styles.field}>
                        <span>メモ</span>
                        <textarea
                            value={varianceMemo}
                            onChange={(event) => setVarianceMemo(event.target.value)}
                            placeholder="任意"
                            rows={3}
                        />
                    </label>

                    <div className={styles.fieldGrid}>
                        <label className={styles.field}>
                            <span>入金日</span>
                            <input
                                type="date"
                                value={receivedDate}
                                onChange={(event) => setReceivedDate(event.target.value)}
                            />
                        </label>
                        <label className={styles.field}>
                            <span>銀行明細</span>
                            <input
                                value={bankTxnRef}
                                onChange={(event) => setBankTxnRef(event.target.value)}
                                placeholder="任意"
                            />
                        </label>
                    </div>

                    <section className={styles.allocations} aria-labelledby="allocation-title">
                        <div className={styles.allocationHead}>
                            <div>
                                <h3 id="allocation-title">請求書への配賦</h3>
                                <p>
                                    合計 {formatYen(allocationTotal)} / 実入金 {formatYen(receivedAmount)}
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.addButton}
                                onClick={addInvoice}
                                disabled={addableInvoices.length === 0}
                            >
                                <Plus size={16} aria-hidden="true" />
                                別の請求書を追加
                            </button>
                        </div>

                        <div className={styles.allocationList}>
                            {allocations.map((allocation) => {
                                const allocationInvoice = candidateInvoices.find((candidate) =>
                                    candidate.id === allocation.invoiceId
                                ) ?? invoice;
                                return (
                                    <div key={allocation.key} className={styles.allocationRow}>
                                        <div className={styles.allocationMeta}>
                                            <span>{allocationInvoice.invoice_no}</span>
                                            <small>{formatYen(invoiceAmount(allocationInvoice))}</small>
                                        </div>
                                        <label className={styles.allocationInput}>
                                            <span className={styles.srOnly}>配賦額</span>
                                            <span aria-hidden="true">¥</span>
                                            <input
                                                aria-label="配賦額"
                                                value={formatInputAmount(allocation.amount)}
                                                inputMode="numeric"
                                                onChange={(event) =>
                                                    updateAllocationAmount(allocation.key, event.target.value)
                                                }
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className={styles.removeButton}
                                            onClick={() => removeAllocation(allocation.key)}
                                            disabled={allocations.length === 1}
                                            aria-label={`${allocationInvoice.invoice_no}の配賦を外す`}
                                        >
                                            <X size={16} aria-hidden="true" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    {allocationsExceeded && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            配賦合計は実入金額以下にしてください
                        </div>
                    )}
                    {!hasClient && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            取引先が未設定の請求書は入金確認できません
                        </div>
                    )}
                    {submitError && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            {submitError}
                        </div>
                    )}
                </div>

                <footer className={styles.actions}>
                    <button type="button" className={styles.secondaryButton} onClick={onClose}>
                        取消
                    </button>
                    <button
                        type="button"
                        className={styles.primaryButton}
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                    >
                        {submitting && <Loader2 size={16} aria-hidden="true" />}
                        確認
                    </button>
                </footer>
            </dialog>
        </div>
    );
}
