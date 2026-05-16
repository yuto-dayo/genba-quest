import { useCallback, useEffect, useState } from "react";
import { AlertCircle, ChevronRight, Loader2, X } from "lucide-react";
import { fetchTeamRewardSummary, type TeamRewardSummary } from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { OtherRewardModal } from "./OtherRewardModal";
import { OwnRewardModal } from "./OwnRewardModal";
import styles from "./OtherRewardModal.module.css";

interface TeamSummaryModalProps {
    month: string;
    onClose: () => void;
    selfUserId?: string | null;
    onInvoiceChanged?: () => Promise<void> | void;
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
        ? `${numericMonth}月のチーム報酬`
        : `${month}のチーム報酬`;
}

export function TeamSummaryModal({
    month,
    onClose,
    selfUserId,
    onInvoiceChanged,
}: TeamSummaryModalProps) {
    const [data, setData] = useState<TeamRewardSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            setData(await fetchTeamRewardSummary(month));
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [month]);

    useEffect(() => {
        void reload();
    }, [reload]);

    if (selectedMemberId && selectedMemberId === data?.self_member_id) {
        return (
            <OwnRewardModal
                selfMemberId={selectedMemberId}
                selfUserId={selfUserId}
                month={month}
                onClose={() => setSelectedMemberId(null)}
                onInvoiceChanged={onInvoiceChanged}
            />
        );
    }

    if (selectedMemberId) {
        return (
            <OtherRewardModal
                memberId={selectedMemberId}
                month={month}
                onClose={() => setSelectedMemberId(null)}
            />
        );
    }

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="team-summary-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="team-summary-modal-title" className={styles.title}>
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
                                    onClick={() => setSelectedMemberId(member.member_id)}
                                >
                                    <span>
                                        <span className={styles.memberName}>
                                            {member.member_id === data.self_member_id ? "自分" : member.nickname}
                                        </span>
                                        <span className={styles.memberMeta}>
                                            <span className={styles.memberSub}>{member.level}</span>
                                            <span className={styles.memberSub}>{member.attendance_days}日</span>
                                        </span>
                                    </span>
                                    <span className={styles.memberAmount}>
                                        {formatYen(member.amount)}
                                        <ChevronRight size={18} aria-hidden="true" />
                                    </span>
                                </button>
                            ))}
                            {data.members.length === 0 && (
                                <p className={styles.emptyText}>報酬データがありません</p>
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
