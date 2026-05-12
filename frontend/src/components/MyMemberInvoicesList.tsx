import { useCallback, useEffect, useState } from "react";
import { Loader2, Receipt } from "lucide-react";
import {
    fetchMyMemberInvoices,
    voidMemberInvoice,
    type MemberInvoice,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./MyMemberInvoicesList.module.css";

/**
 * 本人が発行した請求書の一覧。issued は本人が取り消し可能。
 * paid / void は閲覧のみ。
 */
interface MyMemberInvoicesListProps {
    onChanged?: () => void;
}

function formatYen(amount: number): string {
    return `¥${amount.toLocaleString()}`;
}

const STATUS_LABEL = {
    issued: "未払",
    paid: "支払済",
    void: "取消済",
} as const;

const SOURCE_LABEL = {
    path_reward: "PATH 報酬",
    monthly_distribution: "月次分配",
    manual: "手入力",
} as const;

export function MyMemberInvoicesList({ onChanged }: MyMemberInvoicesListProps) {
    const [invoices, setInvoices] = useState<MemberInvoice[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pendingVoid, setPendingVoid] = useState<MemberInvoice | null>(null);
    const [reason, setReason] = useState("");
    const [acting, setActing] = useState(false);
    const [actError, setActError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const { invoices } = await fetchMyMemberInvoices();
            setInvoices(invoices);
            setLoadError(null);
        } catch (err) {
            setLoadError(getErrorMessage(err));
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const { invoices } = await fetchMyMemberInvoices();
                if (!cancelled) {
                    setInvoices(invoices);
                    setLoadError(null);
                }
            } catch (err) {
                if (!cancelled) setLoadError(getErrorMessage(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    async function handleVoidConfirm() {
        if (!pendingVoid || acting) return;
        const trimmed = reason.trim();
        if (trimmed.length < 2) {
            setActError("理由を 2 文字以上で入力してください");
            return;
        }
        setActing(true);
        setActError(null);
        try {
            await voidMemberInvoice(pendingVoid.id, trimmed);
            setPendingVoid(null);
            setReason("");
            await reload();
            onChanged?.();
        } catch (err) {
            setActError(getErrorMessage(err));
        } finally {
            setActing(false);
        }
    }

    if (loadError) {
        return (
            <section className={styles.card}>
                <div className={styles.header}>
                    <h3 className={styles.title}>あなたの請求書</h3>
                </div>
                <p className={styles.empty}>{loadError}</p>
            </section>
        );
    }

    if (invoices === null) return null;

    return (
        <section className={styles.card} aria-label="自分が発行した請求書">
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>あなたの請求書</h3>
                    <p className={styles.subtitle}>
                        発行・支払い状況の履歴。間違えた請求書は取り消せます。
                    </p>
                </div>
                <Receipt size={20} aria-hidden="true" />
            </div>

            {invoices.length === 0 ? (
                <p className={styles.empty}>まだ発行した請求書はありません。</p>
            ) : (
                <div className={styles.list}>
                    {invoices.map((invoice) => {
                        const statusClass =
                            invoice.status === "paid"
                                ? styles.statusPaid
                                : invoice.status === "void"
                                    ? styles.statusVoid
                                    : styles.statusIssued;
                        return (
                            <div key={invoice.id} className={styles.row}>
                                <div className={styles.rowBody}>
                                    <span className={styles.rowPrimary}>
                                        {invoice.invoice_no}
                                    </span>
                                    <span className={styles.rowSecondary}>
                                        <span className={`${styles.statusPill} ${statusClass}`}>
                                            {STATUS_LABEL[invoice.status]}
                                        </span>{" "}
                                        / {SOURCE_LABEL[invoice.source]} /{" "}
                                        {invoice.period_month}
                                    </span>
                                </div>
                                <span className={styles.amount}>
                                    {formatYen(invoice.amount_total)}
                                </span>
                                {invoice.status === "issued" ? (
                                    <button
                                        type="button"
                                        className={styles.voidButton}
                                        onClick={() => {
                                            setPendingVoid(invoice);
                                            setReason("");
                                            setActError(null);
                                        }}
                                    >
                                        取り消す
                                    </button>
                                ) : (
                                    <span />
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {pendingVoid && (
                <div
                    className={styles.confirmOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="invoice-void-title"
                >
                    <div className={styles.confirmCard}>
                        <h4 id="invoice-void-title" className={styles.confirmTitle}>
                            請求書を取り消しますか?
                        </h4>
                        <p className={styles.subtitle}>
                            {pendingVoid.invoice_no} ({formatYen(pendingVoid.amount_total)}) を
                            取り消します。会計上は逆仕訳 (未払金 / 外注費) で打ち消されます。
                        </p>
                        <div className={styles.field}>
                            <label htmlFor="void-reason" className={styles.label}>
                                取り消し理由
                            </label>
                            <textarea
                                id="void-reason"
                                className={styles.textarea}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="例: 金額が間違っていたため再発行する"
                                maxLength={500}
                                disabled={acting}
                            />
                        </div>
                        {actError && <p className={styles.error}>{actError}</p>}
                        <div className={styles.confirmActions}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={acting}
                                onClick={() => {
                                    setPendingVoid(null);
                                    setReason("");
                                    setActError(null);
                                }}
                            >
                                キャンセル
                            </button>
                            <button
                                type="button"
                                className={styles.dangerButton}
                                disabled={acting || reason.trim().length < 2}
                                onClick={handleVoidConfirm}
                            >
                                {acting && <Loader2 size={14} aria-hidden="true" />}
                                取り消す
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
