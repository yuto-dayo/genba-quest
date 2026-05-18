import { X, AlertCircle, Loader2 } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import {
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import type { ClientCreditMetrics, ClientCreditSummary } from "../../lib/api";
import styles from "./ClientCreditDetailModal.module.css";

interface ClientCreditDetailModalProps {
    client: ClientCreditSummary;
    metrics: ClientCreditMetrics | null;
    loading?: boolean;
    error?: string | null;
    onClose: () => void;
}

function formatYen(amount: number): string {
    return `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount)}`;
}

function formatDate(value?: string | null): string {
    return value ? value.replace(/-/g, "/") : "未設定";
}

function formatDso(days: number | null): string {
    return days === null ? "算出外" : `${days.toFixed(days % 1 === 0 ? 0 : 1)}日`;
}

function tierLabel(tier: ClientCreditSummary["credit_tier"]): string {
    switch (tier) {
        case "blocked":
            return "取引停止推奨";
        case "warning":
            return "警戒";
        case "caution":
            return "注意";
        case "healthy":
            return "良好";
    }
}

function yenTick(value: number): string {
    if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
    if (value >= 10_000) return `${Math.round(value / 10_000)}万`;
    return `${value}`;
}

export function ClientCreditDetailModal({
    client,
    metrics,
    loading,
    error,
    onClose,
}: ClientCreditDetailModalProps) {
    const reduceMotion = useReducedMotion();
    const current = metrics ?? client;
    const trends = metrics?.monthly_trends ?? [];

    return (
        <div className={styles.layer} role="presentation">
            <button type="button" className={styles.scrim} aria-label="閉じる" onClick={onClose} />
            <motion.aside
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="client-credit-detail-title"
                initial={reduceMotion ? false : { opacity: 0, y: 16, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: 16, scale: 0.98 }}
                transition={reduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.2, 0, 0, 1] }}
            >
                <header className={styles.header}>
                    <div className={styles.titleBlock}>
                        <span className={`${styles.tierPill} ${styles[current.credit_tier]}`}>
                            {tierLabel(current.credit_tier)}
                        </span>
                        <h2 id="client-credit-detail-title" className={styles.title} title={client.client_name}>
                            {client.client_name}
                        </h2>
                    </div>
                    <button type="button" className={styles.iconButton} aria-label="閉じる" onClick={onClose}>
                        <X size={18} aria-hidden />
                    </button>
                </header>

                {loading && (
                    <div className={styles.state} role="status">
                        <Loader2 size={18} className={styles.spinIcon} aria-hidden />
                        与信詳細を読み込み中
                    </div>
                )}

                {error && (
                    <div className={styles.error} role="alert">
                        <AlertCircle size={18} aria-hidden />
                        与信詳細の取得に失敗: {error}
                    </div>
                )}

                <div className={styles.summaryGrid}>
                    <div>
                        <span>売掛残</span>
                        <b>{formatYen(current.accounts_receivable_balance)}</b>
                    </div>
                    <div>
                        <span>DSO</span>
                        <b>{formatDso(current.dso_days)}</b>
                    </div>
                    <div>
                        <span>延滞</span>
                        <b>{current.overdue_count}件</b>
                    </div>
                </div>

                <section className={styles.chartSection}>
                    <div className={styles.sectionHead}>
                        <h3>DSO 月別推移</h3>
                        <span>6ヶ月</span>
                    </div>
                    <div className={styles.chartBox}>
                        {trends.length === 0 ? (
                            <p className={styles.empty}>推移データなし</p>
                        ) : (
                            <ResponsiveContainer width="100%" height={120}>
                                <LineChart data={trends} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                                    <XAxis dataKey="month" hide />
                                    <YAxis hide domain={["auto", "auto"]} />
                                    <Tooltip formatter={(value) => `${Number(value).toFixed(1)}日`} labelFormatter={(label) => `${label}`} />
                                    <Line
                                        type="monotone"
                                        dataKey="dso_days"
                                        stroke="var(--money-status-overdue)"
                                        strokeWidth={2}
                                        dot={false}
                                        connectNulls
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>

                <section className={styles.chartSection}>
                    <div className={styles.sectionHead}>
                        <h3>売掛残推移</h3>
                        <span>6ヶ月</span>
                    </div>
                    <div className={styles.chartBox}>
                        {trends.length === 0 ? (
                            <p className={styles.empty}>推移データなし</p>
                        ) : (
                            <ResponsiveContainer width="100%" height={120}>
                                <LineChart data={trends} margin={{ top: 8, right: 8, bottom: 8, left: 0 }}>
                                    <XAxis dataKey="month" hide />
                                    <YAxis hide tickFormatter={yenTick} />
                                    <Tooltip formatter={(value) => formatYen(Number(value))} labelFormatter={(label) => `${label}`} />
                                    <Line
                                        type="monotone"
                                        dataKey="accounts_receivable_balance"
                                        stroke="var(--md-sys-color-primary)"
                                        strokeWidth={2}
                                        dot={false}
                                    />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </section>

                <section className={styles.listSection}>
                    <div className={styles.sectionHead}>
                        <h3>延滞履歴</h3>
                        <span>{metrics?.overdue_history.length ?? 0}件</span>
                    </div>
                    <div className={styles.rows}>
                        {metrics?.overdue_history.length ? (
                            metrics.overdue_history.map((invoice) => (
                                <div key={invoice.invoice_id} className={styles.row}>
                                    <span>
                                        <b>{invoice.invoice_no}</b>
                                        <small>期限 {formatDate(invoice.due_date)} / {invoice.overdue_days}日超過</small>
                                    </span>
                                    <strong>{formatYen(invoice.outstanding_amount)}</strong>
                                </div>
                            ))
                        ) : (
                            <p className={styles.empty}>延滞履歴なし</p>
                        )}
                    </div>
                </section>

                <section className={styles.listSection}>
                    <div className={styles.sectionHead}>
                        <h3>直近の請求書・入金</h3>
                        <span>明細</span>
                    </div>
                    <div className={styles.twoColumn}>
                        <div className={styles.rows}>
                            {(metrics?.recent_invoices ?? []).slice(0, 4).map((invoice) => (
                                <div key={invoice.invoice_id} className={styles.row}>
                                    <span>
                                        <b>{invoice.invoice_no}</b>
                                        <small>発行 {formatDate(invoice.issue_date)}</small>
                                    </span>
                                    <strong>{formatYen(invoice.outstanding_amount)}</strong>
                                </div>
                            ))}
                            {metrics && metrics.recent_invoices.length === 0 && (
                                <p className={styles.empty}>請求書なし</p>
                            )}
                        </div>
                        <div className={styles.rows}>
                            {(metrics?.recent_cash_receipts ?? []).slice(0, 4).map((receipt) => (
                                <div key={receipt.receipt_id} className={styles.row}>
                                    <span>
                                        <b>{formatDate(receipt.received_date)}</b>
                                        <small>{receipt.status}</small>
                                    </span>
                                    <strong>{formatYen(receipt.received_amount)}</strong>
                                </div>
                            ))}
                            {metrics && metrics.recent_cash_receipts.length === 0 && (
                                <p className={styles.empty}>入金なし</p>
                            )}
                        </div>
                    </div>
                </section>
            </motion.aside>
        </div>
    );
}
