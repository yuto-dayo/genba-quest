import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, X } from "lucide-react";
import {
    fetchMemberReimbursementsSummary,
    type MemberReimbursementsSummary,
    type TeamMemberReimbursement,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./ExpenseDetailModal.module.css";

interface TeamExpenseSummaryModalProps {
    month: string;
    onClose: () => void;
    onExpenseClicked: (memberId: string) => void;
    readOnly?: boolean;
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatMonthLabel(month: string): string {
    const [, monthPart] = month.split("-");
    const numericMonth = Number(monthPart);
    return Number.isFinite(numericMonth) && numericMonth > 0
        ? `${numericMonth}月のチーム立替`
        : `${month}のチーム立替`;
}

function statusLabel(status: TeamMemberReimbursement["status"]): string {
    switch (status) {
        case "pending":
            return "精算待ち";
        case "in_review":
            return "確認中";
        case "settled":
            return "振込済";
        case "none":
        default:
            return "なし";
    }
}

export function TeamExpenseSummaryModal({
    month,
    onClose,
    onExpenseClicked,
}: TeamExpenseSummaryModalProps) {
    const [data, setData] = useState<MemberReimbursementsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await fetchMemberReimbursementsSummary(month));
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [month]);

    useEffect(() => {
        void reload();
    }, [reload]);

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="team-expense-summary-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="team-expense-summary-modal-title" className={styles.title}>
                        {formatMonthLabel(month)}
                    </h2>
                    <button
                        type="button"
                        className={styles.iconButton}
                        onClick={onClose}
                        aria-label="閉じる"
                    >
                        <X size={20} aria-hidden="true" />
                    </button>
                </header>

                <div className={styles.body}>
                    {loading && (
                        <div className={styles.centerState} role="status">
                            <Loader2 size={20} aria-hidden="true" />
                            読み込み中...
                        </div>
                    )}

                    {!loading && error && (
                        <div className={styles.errorPanel} role="alert">
                            <AlertCircle size={18} aria-hidden="true" />
                            <span>{error}</span>
                            <button type="button" className={styles.inlineButton} onClick={() => reload()}>
                                再読込
                            </button>
                        </div>
                    )}

                    {!loading && data && (
                        <div className={styles.memberList}>
                            {data.members.map((member) => (
                                <button
                                    key={member.member_id}
                                    type="button"
                                    className={styles.memberRow}
                                    onClick={() => onExpenseClicked(member.member_id)}
                                >
                                    <span className={styles.memberMain}>
                                        <span className={styles.memberName}>
                                            {member.member_id === data.self_member_id ? "自分" : member.nickname}
                                        </span>
                                        <span className={styles.memberMeta}>
                                            <span className={styles.memberSub}>未精算 {formatYen(member.unsettled)}</span>
                                            <span className={styles.memberSub}>{statusLabel(member.status)}</span>
                                        </span>
                                    </span>
                                    <span className={styles.memberAmount}>
                                        {formatYen(member.total_advanced)}
                                        <ChevronRight size={18} aria-hidden="true" />
                                    </span>
                                </button>
                            ))}
                            {data.members.length === 0 && (
                                <p className={styles.emptyText}>立替データがありません</p>
                            )}
                        </div>
                    )}
                </div>

                <footer className={styles.actions}>
                    <button type="button" className={styles.secondaryButton} onClick={onClose}>
                        閉じる
                    </button>
                </footer>
            </section>
        </div>
    );
}
