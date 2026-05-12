import { useCallback, useEffect, useState } from "react";
import { Banknote, Loader2 } from "lucide-react";
import {
    fetchAdminActionableInvoices,
    markMemberInvoicePaid,
    type AdminActionableInvoice,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./AdminInvoiceActionableList.module.css";

/**
 * Admin が「支払い対象」を選んで mark_paid Proposal を発火するためのリスト。
 *
 * 露出する情報は invoice_no / 期間 / 金額 / 状態 だけ。
 * 振込先 / インボイス番号 / 住所 / 発行者名は admin から見えない (Phase 2-1 の
 * profile.view_request を別途使う前提)。
 */
interface AdminInvoiceActionableListProps {
    /** 操作完了後に親へ再フェッチを促す (集計カードと同期させたい) */
    onChanged?: () => void;
}

function formatYen(amount: number): string {
    return `¥${amount.toLocaleString()}`;
}

const SOURCE_LABEL: Record<string, string> = {
    path_reward: "PATH 報酬",
    monthly_distribution: "月次分配",
    manual: "手入力",
};

export function AdminInvoiceActionableList({ onChanged }: AdminInvoiceActionableListProps) {
    const [invoices, setInvoices] = useState<AdminActionableInvoice[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [pendingPay, setPendingPay] = useState<AdminActionableInvoice | null>(null);
    const [acting, setActing] = useState(false);
    const [actError, setActError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        try {
            const { invoices } = await fetchAdminActionableInvoices("issued");
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
                const { invoices } = await fetchAdminActionableInvoices("issued");
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

    async function handleConfirm() {
        if (!pendingPay || acting) return;
        setActing(true);
        setActError(null);
        try {
            await markMemberInvoicePaid(pendingPay.invoice_id);
            setPendingPay(null);
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
                    <h3 className={styles.title}>支払い対象</h3>
                </div>
                <p className={styles.empty}>{loadError}</p>
            </section>
        );
    }

    if (invoices === null) return null;

    return (
        <section className={styles.card} aria-label="支払い対象の請求書">
            <div className={styles.header}>
                <div>
                    <h3 className={styles.title}>支払い対象</h3>
                    <p className={styles.subtitle}>
                        振込が完了したら「支払い済みに記録」を押してください
                    </p>
                </div>
                <Banknote size={20} aria-hidden="true" />
            </div>

            {invoices.length === 0 ? (
                <p className={styles.empty}>未払いの請求書はありません。</p>
            ) : (
                <div className={styles.list}>
                    {invoices.map((invoice) => (
                        <div key={invoice.invoice_id} className={styles.row}>
                            <div className={styles.rowBody}>
                                <span className={styles.rowPrimary}>{invoice.invoice_no}</span>
                                <span className={styles.rowSecondary}>
                                    {SOURCE_LABEL[invoice.source] ?? invoice.source} / {invoice.period_month}
                                </span>
                            </div>
                            <span className={styles.amount}>
                                {formatYen(invoice.amount_total)}
                            </span>
                            <button
                                type="button"
                                className={styles.payButton}
                                onClick={() => setPendingPay(invoice)}
                            >
                                支払い済みに記録
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <p className={styles.privacyNote}>
                ※ 振込先・本人氏名は表示されません。実際の振込先確認は別途
                「プロフィール閲覧申請（本人承認）」を使ってください。
            </p>

            {pendingPay && (
                <div
                    className={styles.confirmOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="invoice-mark-paid-title"
                >
                    <div className={styles.confirmCard}>
                        <h4 id="invoice-mark-paid-title" className={styles.confirmTitle}>
                            支払い済みに記録しますか?
                        </h4>
                        <p className={styles.confirmBody}>
                            {pendingPay.invoice_no} ({formatYen(pendingPay.amount_total)}) を
                            支払い済みとして記録します。振込が実際に完了していることを確認してください。
                            記録すると会計仕訳 (未払金 / 現金) が立てられます。
                        </p>
                        {actError && <p className={styles.error}>{actError}</p>}
                        <div className={styles.confirmActions}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                disabled={acting}
                                onClick={() => {
                                    setPendingPay(null);
                                    setActError(null);
                                }}
                            >
                                キャンセル
                            </button>
                            <button
                                type="button"
                                className={styles.payButton}
                                disabled={acting}
                                onClick={handleConfirm}
                            >
                                {acting && <Loader2 size={14} aria-hidden="true" />}
                                記録する
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
