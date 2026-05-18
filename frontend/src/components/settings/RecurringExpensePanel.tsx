import { useEffect, useMemo, useState } from "react";
import { CalendarClock, Edit3, Loader2, Plus, StopCircle } from "lucide-react";
import {
    createRecurringExpenseProposal,
    endRecurringExpenseProposal,
    fetchRecurringExpenses,
    updateRecurringExpenseProposal,
    type Member,
    type RecurringExpenseDraft,
    type RecurringExpenseRecord,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import { RecurringExpenseEditModal } from "./RecurringExpenseEditModal";
import styles from "./RecurringExpensePanel.module.css";

function formatYen(value: number | string) {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(Number(value) || 0);
}

function currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function monthsLeft(until: string | null): string {
    if (!until) return "継続";
    const [year, month] = until.split("-").map(Number);
    const [currentYear, currentMonthPart] = currentMonth().split("-").map(Number);
    const diff = (year - currentYear) * 12 + (month - currentMonthPart);
    if (!Number.isFinite(diff)) return until;
    if (diff < 0) return "終了済";
    if (diff === 0) return "今月まで";
    return `あと${diff + 1}か月`;
}

function memberName(members: Member[], userId: string): string {
    const member = members.find((candidate) => candidate.id === userId || candidate.user_id === userId);
    return member?.display_name || member?.full_name || member?.username || "メンバー";
}

interface RecurringExpensePanelProps {
    members: Member[];
    currentUserId: string | null;
    isAdmin: boolean;
}

export function RecurringExpensePanel({ members, currentUserId, isAdmin }: RecurringExpensePanelProps) {
    const [records, setRecords] = useState<RecurringExpenseRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [editing, setEditing] = useState<RecurringExpenseRecord | null>(null);
    const [modalOpen, setModalOpen] = useState(false);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await fetchRecurringExpenses({ includeEnded: true });
            setRecords(data.recurring_expenses);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const activeRecords = useMemo(
        () => records.filter((record) => record.status === "active"),
        [records],
    );
    const monthlyTotal = activeRecords.reduce((sum, record) => sum + Number(record.monthly_amount || 0), 0);

    const openCreate = () => {
        setEditing(null);
        setMessage(null);
        setError(null);
        setModalOpen(true);
    };

    const submit = async (draft: RecurringExpenseDraft) => {
        if (!currentUserId) return;
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            if (editing) {
                await updateRecurringExpenseProposal(editing.id, draft);
            } else {
                await createRecurringExpenseProposal({
                    ...draft,
                    member_user_id: draft.member_user_id || currentUserId,
                });
            }
            setModalOpen(false);
            setEditing(null);
            setMessage("承認依頼を作成しました。承認後に一覧へ反映されます。");
            await load();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const endRecord = async (record: RecurringExpenseRecord) => {
        if (!window.confirm(`${record.title} を今月で終了しますか？`)) {
            return;
        }
        setSaving(true);
        setError(null);
        setMessage(null);
        try {
            await endRecurringExpenseProposal(record.id, currentMonth());
            setMessage("終了の承認依頼を作成しました。");
            await load();
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={styles.panel}>
            <header className={styles.header}>
                <div>
                    <p className={styles.eyebrow}>Recurring</p>
                    <h3>定期立替</h3>
                    <p>車・携帯・保険など毎月の立替をまとめておきます。</p>
                </div>
                <button type="button" className={styles.primaryAction} onClick={openCreate} disabled={!currentUserId}>
                    <Plus size={16} />
                    追加
                </button>
            </header>

            <div className={styles.summary}>
                <span>登録 {activeRecords.length}</span>
                <strong>{formatYen(monthlyTotal)}</strong>
                <span>月額合計</span>
            </div>

            {error && <p className={styles.error}>{error}</p>}
            {message && <p className={styles.success}>{message}</p>}

            {loading ? (
                <div className={styles.centerState}>
                    <Loader2 size={16} className={styles.spinner} />
                    確認中...
                </div>
            ) : activeRecords.length === 0 ? (
                <div className={styles.centerState}>登録なし</div>
            ) : (
                <div className={styles.list}>
                    {activeRecords.map((record) => (
                        <section className={styles.row} key={record.id}>
                            <div className={styles.rowMain}>
                                <span className={styles.category}>[{record.category}]</span>
                                <strong>{record.title}</strong>
                                {isAdmin && <small>{memberName(members, record.member_id)}</small>}
                            </div>
                            <div className={styles.rowMeta}>
                                <strong className={styles.amount}>{formatYen(record.monthly_amount)}</strong>
                                <span>
                                    <CalendarClock size={14} />
                                    {record.effective_from} - {record.effective_until || "継続"}
                                </span>
                                <span>{monthsLeft(record.effective_until)}</span>
                            </div>
                            <div className={styles.rowActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryAction}
                                    onClick={() => {
                                        setEditing(record);
                                        setModalOpen(true);
                                    }}
                                >
                                    <Edit3 size={14} />
                                    編集
                                </button>
                                <button
                                    type="button"
                                    className={styles.dangerAction}
                                    onClick={() => void endRecord(record)}
                                    disabled={saving}
                                >
                                    <StopCircle size={14} />
                                    終了
                                </button>
                            </div>
                        </section>
                    ))}
                </div>
            )}

            {modalOpen && currentUserId && (
                <RecurringExpenseEditModal
                    record={editing}
                    members={members}
                    currentUserId={currentUserId}
                    isAdmin={isAdmin}
                    saving={saving}
                    error={error}
                    onClose={() => {
                        setModalOpen(false);
                        setEditing(null);
                    }}
                    onSubmit={(draft) => void submit(draft)}
                />
            )}
        </div>
    );
}
