import { useEffect, useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import {
    type Member,
    type RecurringExpenseCategory,
    type RecurringExpenseDraft,
    type RecurringExpenseRecord,
} from "../../lib/api";
import styles from "./RecurringExpensePanel.module.css";

const CATEGORIES: RecurringExpenseCategory[] = [
    "車両ローン",
    "携帯代",
    "月極駐車",
    "工具リース",
    "事務所家賃",
    "保険",
    "その他",
];

function currentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function toDraft(record: RecurringExpenseRecord | null, fallbackUserId: string): RecurringExpenseDraft {
    return {
        member_user_id: record?.member_id ?? fallbackUserId,
        category: record?.category ?? "車両ローン",
        title: record?.title ?? "",
        monthly_amount: Number(record?.monthly_amount ?? 0),
        effective_from: record ? currentMonth() : currentMonth(),
        effective_until: record?.effective_until ?? "",
        expense_scope: record?.expense_scope ?? "overhead",
    };
}

interface RecurringExpenseEditModalProps {
    record: RecurringExpenseRecord | null;
    members: Member[];
    currentUserId: string;
    isAdmin: boolean;
    saving: boolean;
    error: string | null;
    onClose: () => void;
    onSubmit: (draft: RecurringExpenseDraft) => void;
}

export function RecurringExpenseEditModal({
    record,
    members,
    currentUserId,
    isAdmin,
    saving,
    error,
    onClose,
    onSubmit,
}: RecurringExpenseEditModalProps) {
    const [draft, setDraft] = useState<RecurringExpenseDraft>(() => toDraft(record, currentUserId));

    useEffect(() => {
        setDraft(toDraft(record, currentUserId));
    }, [currentUserId, record]);

    const canSubmit = draft.title.trim().length > 0
        && draft.monthly_amount > 0
        && /^\d{4}-(0[1-9]|1[0-2])$/.test(draft.effective_from)
        && (!draft.effective_until || /^\d{4}-(0[1-9]|1[0-2])$/.test(draft.effective_until));

    return (
        <div className={styles.scrim} onClick={onClose}>
            <section
                className={styles.modal}
                role="dialog"
                aria-modal="true"
                aria-labelledby="recurring-expense-modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.modalHeader}>
                    <h3 id="recurring-expense-modal-title">
                        {record ? "定期立替を編集" : "定期立替を登録"}
                    </h3>
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="閉じる">
                        <X size={20} />
                    </button>
                </header>

                <div className={styles.formGrid}>
                    {isAdmin && (
                        <label>
                            <span>メンバー</span>
                            <select
                                value={draft.member_user_id}
                                onChange={(event) => setDraft((prev) => ({ ...prev, member_user_id: event.target.value }))}
                            >
                                {members.map((member) => (
                                    <option key={member.id} value={member.id}>
                                        {member.display_name || member.full_name || member.username || member.id}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    <label>
                        <span>カテゴリ</span>
                        <select
                            value={draft.category}
                            onChange={(event) =>
                                setDraft((prev) => ({
                                    ...prev,
                                    category: event.target.value as RecurringExpenseCategory,
                                }))
                            }
                        >
                            {CATEGORIES.map((category) => (
                                <option key={category} value={category}>
                                    {category}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label>
                        <span>タイトル</span>
                        <input
                            value={draft.title}
                            onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                            placeholder="軽トラ #品川500"
                        />
                    </label>

                    <label>
                        <span>月額</span>
                        <input
                            type="number"
                            min="1"
                            inputMode="numeric"
                            value={draft.monthly_amount || ""}
                            onChange={(event) =>
                                setDraft((prev) => ({ ...prev, monthly_amount: Number(event.target.value) || 0 }))
                            }
                        />
                    </label>

                    <label>
                        <span>開始月</span>
                        <input
                            type="month"
                            value={draft.effective_from}
                            onChange={(event) => setDraft((prev) => ({ ...prev, effective_from: event.target.value }))}
                        />
                    </label>

                    <label>
                        <span>終了月</span>
                        <input
                            type="month"
                            value={draft.effective_until ?? ""}
                            onChange={(event) =>
                                setDraft((prev) => ({ ...prev, effective_until: event.target.value || null }))
                            }
                        />
                    </label>
                </div>

                {error && <p className={styles.error}>{error}</p>}

                <footer className={styles.modalActions}>
                    <button type="button" className={styles.secondaryAction} onClick={onClose}>
                        取消
                    </button>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        disabled={!canSubmit || saving}
                        onClick={() => onSubmit({ ...draft, title: draft.title.trim() })}
                    >
                        {saving ? <Loader2 size={16} className={styles.spinner} /> : <Save size={16} />}
                        申請
                    </button>
                </footer>
            </section>
        </div>
    );
}
