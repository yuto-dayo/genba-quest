import { motion } from "framer-motion";
import { CalendarClock, FileText, Receipt } from "lucide-react";
import {
    type ReceivePartnerSummary,
    type PayPartnerSummary,
    type DonePartnerSummary,
} from "../lib/api";
import { describeRule, formatDateJa } from "../lib/billingRuleFormat";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./PartnerCard.module.css";

export interface PartnerInvoiceInline {
    invoiceNo: string;
    amount: number;
    dueDate: string | null;
    statusLabel: string;
    overdueDays?: number | null;
    isOverdue?: boolean;
}

function formatYenShort(amount: number): string {
    if (amount >= 10_000) {
        const man = Math.round(amount / 10_000);
        return `${man}万`;
    }
    return `¥${amount.toLocaleString()}`;
}

interface ReceivePartnerCardProps {
    partner: ReceivePartnerSummary;
    latestInvoice?: PartnerInvoiceInline | null;
    onClick?: () => void;
}

export function ReceivePartnerCard({ partner, latestInvoice, onClick }: ReceivePartnerCardProps) {
    const amountToneClass =
        partner.status === "awaiting_payment"
            ? styles.amountNeg
            : partner.status === "billed"
                ? styles.amountDue
                : styles.amountNeg;

    return (
        <motion.button
            type="button"
            className={`${styles.card} ${latestInvoice?.isOverdue ? styles.cardOverdue : ""}`}
            onClick={onClick}
            aria-label={`${partner.client_name} の請求書履歴を開く`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.spatialDefault}
            whileTap={{ scale: 0.985 }}
        >
            <div className={styles.head}>
                <span className={styles.name} title={partner.client_name}>{partner.client_name}</span>
                <span className={`${styles.amount} ${amountToneClass}`}>
                    {formatYenShort(partner.amount)}
                </span>
            </div>

            <div className={styles.meta}>
                {partner.rule ? (
                    <span className={styles.rulePill}>
                        <CalendarClock size={12} aria-hidden />
                        {describeRule(partner.rule)}
                    </span>
                ) : (
                    <span className={styles.unset}>締めルール未設定</span>
                )}
                <span className={statusClass(partner)}>{statusLabel(partner)}</span>
            </div>

            <div className={styles.dueRow}>
                {partner.status === "unbilled" ? (
                    <>
                        <span>
                            次の締め: <b>{partner.target_date ? formatDateJa(partner.target_date) : "—"}</b>
                        </span>
                        {partner.next_period?.payment_due_date && (
                            <span>
                                入金予定: <b>{formatDateJa(partner.next_period.payment_due_date)}</b>
                            </span>
                        )}
                    </>
                ) : (
                    <>
                        {partner.billed_at && (
                            <span>
                                請求: <b>{formatDateJa(partner.billed_at)}</b>
                            </span>
                        )}
                        {partner.target_date && (
                            <span>
                                入金予定: <b>{formatDateJa(partner.target_date)}</b>
                            </span>
                        )}
                    </>
                )}
            </div>

            {latestInvoice && <InvoiceInline invoice={latestInvoice} />}
        </motion.button>
    );
}

function InvoiceInline({ invoice }: { invoice: PartnerInvoiceInline }) {
    return (
        <div className={styles.invoiceLine}>
            <span className={styles.invoiceIcon} aria-hidden>
                <FileText size={13} />
            </span>
            <span className={styles.invoiceMain}>
                <span className={styles.invoiceNo}>{invoice.invoiceNo}</span>
                <span className={styles.invoiceDue}>
                    {invoice.dueDate ? `${formatDateJa(invoice.dueDate)} 期限` : "期限未設定"}
                </span>
            </span>
            <span className={`${styles.invoiceStatus} ${invoice.isOverdue ? styles.invoiceStatusOverdue : ""}`}>
                {invoice.statusLabel}
                {invoice.isOverdue && typeof invoice.overdueDays === "number"
                    ? ` ${invoice.overdueDays}日`
                    : ""}
            </span>
        </div>
    );
}

function statusClass(partner: ReceivePartnerSummary): string {
    switch (partner.status) {
        case "unbilled":
            return `${styles.statusBadge} ${styles.statusUnbilled}`;
        case "billed":
            return `${styles.statusBadge} ${styles.statusBilled}`;
        case "awaiting_payment":
            return `${styles.statusBadge} ${styles.statusOverdue}`;
    }
}

function statusLabel(partner: ReceivePartnerSummary): string {
    if (partner.status === "unbilled") {
        const due = partner.target_date ? formatDateJa(partner.target_date) : "";
        return due ? `未請求 ${due}〆` : "未請求";
    }
    if (partner.status === "billed") {
        return "請求済";
    }
    return `入金待ち ${partner.days_overdue ?? 0}日目`;
}

interface PayPartnerCardProps {
    partner: PayPartnerSummary;
}

export function PayPartnerCard({ partner }: PayPartnerCardProps) {
    return (
        <motion.div
            className={`${styles.card} ${styles.staticCard}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.spatialDefault}
        >
            <div className={styles.head}>
                <span className={styles.name}>{partner.vendor_name}</span>
                <span className={`${styles.amount} ${styles.amountNeg}`}>
                    {formatYenShort(partner.amount)}
                </span>
            </div>
            <div className={styles.meta}>
                <span className={styles.txCount}>
                    <Receipt size={12} aria-hidden /> 取引 {partner.transaction_count}件
                </span>
            </div>
            {partner.due_date && (
                <div className={styles.dueRow}>
                    <span>
                        最初の記録: <b>{formatDateJa(partner.due_date)}</b>
                    </span>
                </div>
            )}
        </motion.div>
    );
}

interface DonePartnerCardProps {
    partner: DonePartnerSummary;
    latestInvoice?: PartnerInvoiceInline | null;
    onClick?: () => void;
}

export function DonePartnerCard({ partner, latestInvoice, onClick }: DonePartnerCardProps) {
    const Component = onClick ? motion.button : motion.div;
    return (
        <Component
            {...(onClick ? { type: "button" as const, onClick, "aria-label": `${partner.client_name} の請求書履歴を開く` } : {})}
            className={`${styles.card} ${onClick ? "" : styles.staticCard}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.spatialDefault}
        >
            <div className={styles.head}>
                <span className={styles.name} title={partner.client_name}>{partner.client_name}</span>
                <span className={`${styles.amount} ${styles.amountDone}`}>
                    +{formatYenShort(partner.amount)}
                </span>
            </div>
            <div className={styles.dueRow}>
                <span>
                    入金日: <b>{formatDateJa(partner.paid_at)}</b>
                </span>
            </div>
            {latestInvoice && <InvoiceInline invoice={latestInvoice} />}
        </Component>
    );
}
