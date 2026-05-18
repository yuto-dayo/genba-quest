import { useId, useState } from "react";
import type { MemberReimbursementBalance } from "../../lib/api";
import styles from "./PayoutModalSections.module.css";

type ReimbursementItem = MemberReimbursementBalance["recent_items"][number];

interface PayoutReimbursementSectionProps {
    balance: MemberReimbursementBalance;
}

const CATEGORY_LABELS: Record<string, string> = {
    material: "材料",
    tool: "工具",
    travel: "交通",
    food: "食事",
    fuel: "ガソリン",
    utility: "光熱費",
    parking: "駐車",
    toll: "高速代",
    other: "その他",
};

const STATUS_LABELS: Record<string, string> = {
    unsubmitted: "これから申請",
    submitted: "申請済み",
    approved: "今月精算予定",
    reimbursed: "精算済み",
};

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value.replace(/-/g, "/");
    return `${date.getMonth() + 1}/${date.getDate()}`;
}

function categoryLabel(category: string): string {
    return CATEGORY_LABELS[category] ?? category;
}

function statusLabel(status: string): string {
    return STATUS_LABELS[status] ?? status;
}

function itemTitle(item: ReimbursementItem): string {
    if (item.recurring_expense) {
        return `[${item.recurring_expense.category}] ${item.recurring_expense.title}`;
    }
    return categoryLabel(item.category);
}

function plannedItems(balance: MemberReimbursementBalance): ReimbursementItem[] {
    return balance.recent_items.filter((item) => item.reimbursement_status !== "reimbursed");
}

export function PayoutReimbursementSection({ balance }: PayoutReimbursementSectionProps) {
    const titleId = useId();
    const [selectedItem, setSelectedItem] = useState<ReimbursementItem | null>(null);
    const items = plannedItems(balance);
    const carryCount = balance.carry_over_amount && balance.carry_over_amount > 0 ? 1 : 0;

    return (
        <section className={styles.section} aria-labelledby={titleId}>
            <h3 id={titleId} className={styles.title}>
                立替の内訳
            </h3>
            <div className={styles.summaryGrid}>
                <div className={styles.summaryBox}>
                    <span className={styles.label}>今月精算予定</span>
                    <strong className={styles.count}>{items.length}件</strong>
                    <span className={styles.meta}>{formatYen(balance.unsettled)}</span>
                </div>
                <div className={styles.summaryBox}>
                    <span className={styles.label}>持越し</span>
                    <strong className={styles.count}>{carryCount}件</strong>
                    <span className={styles.meta}>{formatYen(balance.carry_over_amount ?? 0)}</span>
                </div>
            </div>

            {items.length > 0 ? (
                <div className={styles.panel}>
                    {items.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={styles.expenseRow}
                            onClick={() => setSelectedItem(item)}
                        >
                            <span className={styles.expenseMain}>
                                <span className={`${styles.expenseTitle} ${item.recurring_expense ? styles.recurringTitle : ""}`}>
                                    {itemTitle(item)}
                                </span>
                                <span className={styles.meta}>
                                    {formatDate(item.occurred_on)} ・ {statusLabel(item.reimbursement_status)}
                                </span>
                                {item.recurring_expense && <span className={styles.badge}>定期分</span>}
                            </span>
                            <strong className={styles.amount}>{formatYen(item.amount)}</strong>
                        </button>
                    ))}
                </div>
            ) : (
                <p className={styles.emptyText}>今月精算する立替はありません</p>
            )}

            {selectedItem && (
                <div
                    className={styles.dialogScrim}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="payout-expense-detail-title"
                    onClick={() => setSelectedItem(null)}
                >
                    <div className={styles.dialog} onClick={(event) => event.stopPropagation()}>
                        <div className={styles.dialogHeader}>
                            <h3 id="payout-expense-detail-title" className={styles.dialogTitle}>
                                {itemTitle(selectedItem)}
                            </h3>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={() => setSelectedItem(null)}
                                aria-label="閉じる"
                            >
                                ×
                            </button>
                        </div>
                        <div className={styles.detailPanel}>
                            <div className={styles.summaryRow}>
                                <span className={styles.label}>日付</span>
                                <strong className={styles.value}>{formatDate(selectedItem.occurred_on)}</strong>
                            </div>
                            <div className={styles.summaryRow}>
                                <span className={styles.label}>状態</span>
                                <strong className={styles.value}>{statusLabel(selectedItem.reimbursement_status)}</strong>
                            </div>
                            <div className={styles.summaryRow}>
                                <span className={styles.label}>金額</span>
                                <strong className={styles.value}>{formatYen(selectedItem.amount)}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
