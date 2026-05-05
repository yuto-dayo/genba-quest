import { Send, Trash2, X } from 'lucide-react';
import type { DraftAssignmentCreate } from '../../lib/dayScheduleBoard';
import styles from './DraftAssignmentFooter.module.css';

interface DraftAssignmentFooterProps {
    drafts: DraftAssignmentCreate[];
    isSubmitting: boolean;
    message: string | null;
    onRemove: (draftId: string) => void;
    onClear: () => void;
    onSubmit: () => void;
}

export function DraftAssignmentFooter({
    drafts,
    isSubmitting,
    message,
    onRemove,
    onClear,
    onSubmit,
}: DraftAssignmentFooterProps) {
    if (drafts.length === 0 && !message) {
        return null;
    }

    return (
        <section className={styles.container}>
            <div className={styles.header}>
                <div>
                    <h3>追加案</h3>
                    <p>{drafts.length > 0 ? `${drafts.length}件を送信前に確認` : message}</p>
                </div>
                <button
                    type="button"
                    className={styles.clearButton}
                    disabled={isSubmitting || drafts.length === 0}
                    onClick={onClear}
                >
                    <Trash2 size={14} />
                    クリア
                </button>
            </div>

            {drafts.length > 0 && (
                <div className={styles.draftList}>
                    {drafts.map((draft) => (
                        <div key={draft.id} className={styles.draftRow}>
                            <div>
                                <strong>{draft.worker_name}</strong>
                                <span>{draft.site_name}</span>
                            </div>
                            <button
                                type="button"
                                className={styles.removeButton}
                                onClick={() => onRemove(draft.id)}
                                aria-label="追加案を外す"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {message && <div className={styles.message}>{message}</div>}

            <button
                type="button"
                className={styles.submitButton}
                disabled={isSubmitting || drafts.length === 0}
                onClick={onSubmit}
            >
                <Send size={16} />
                {isSubmitting ? '送信中...' : '変更案を送る'}
            </button>
        </section>
    );
}
