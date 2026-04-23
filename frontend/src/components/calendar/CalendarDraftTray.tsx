import { useMemo, useState } from 'react';
import { AlertTriangle, Send, ShieldAlert, Undo2 } from 'lucide-react';
import { useAssignmentSimulatorStore } from '../../hooks/useAssignmentSimulator';
import { commitSimulatorDraft } from '../../lib/api';
import styles from './CalendarDraftTray.module.css';

interface CalendarDraftTrayProps {
    onCommitted?: () => Promise<void> | void;
}

function formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
        return dateStr;
    }

    return date.toLocaleDateString('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
    });
}

export function CalendarDraftTray({ onCommitted }: CalendarDraftTrayProps) {
    const workers = useAssignmentSimulatorStore((state) => state.workers);
    const draftAssignments = useAssignmentSimulatorStore((state) => state.draft_assignments);
    const draftWarnings = useAssignmentSimulatorStore((state) => state.draft_warnings);
    const attemptWarnings = useAssignmentSimulatorStore((state) => state.attempt_warnings);
    const overrideReason = useAssignmentSimulatorStore((state) => state.override_reason);
    const removeDraftAssignment = useAssignmentSimulatorStore(
        (state) => state.removeDraftAssignment
    );
    const setOverrideReason = useAssignmentSimulatorStore((state) => state.setOverrideReason);
    const clearDraft = useAssignmentSimulatorStore((state) => state.clearDraft);
    const commitDraft = useAssignmentSimulatorStore((state) => state.commitDraft);

    const [commitMessage, setCommitMessage] = useState<string | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);

    const warnings = useMemo(
        () => [...attemptWarnings, ...draftWarnings],
        [attemptWarnings, draftWarnings]
    );

    const workerNameById = useMemo(() => {
        const mapping = new Map<string, string>();
        workers.forEach((worker) => {
            mapping.set(worker.user_id, worker.name);
        });
        return mapping;
    }, [workers]);

    const hasDraftWarnings = draftWarnings.some((warning) => warning.class === 'WARN');
    const hasDraftBlocks = draftWarnings.some((warning) => warning.class === 'BLOCK');
    const canCommit =
        draftAssignments.length > 0 &&
        !hasDraftBlocks &&
        !isCommitting &&
        (!hasDraftWarnings || overrideReason.trim().length > 0);

    const handleCommit = async () => {
        if (!canCommit) {
            return;
        }

        setIsCommitting(true);
        setCommitMessage(null);

        try {
            const draftSnapshot = [...draftAssignments];
            const placements = draftSnapshot.map((assignment) => ({
                worker_id: assignment.worker_id,
                slot_id: assignment.slot_id,
                site_id: assignment.site_id,
                site_name: assignment.site_name,
                date: assignment.date,
                warning_codes: assignment.warning_codes,
            }));
            const apiResult = await commitSimulatorDraft(
                placements,
                overrideReason.trim() || undefined
            );

            const successfulDraftIds = apiResult.results
                .filter((result) => result.success)
                .map((result) => draftSnapshot[result.placement_index]?.id)
                .filter((draftId): draftId is string => Boolean(draftId));

            if (successfulDraftIds.length > 0) {
                commitDraft(successfulDraftIds);
                if (onCommitted) {
                    await onCommitted();
                }
            }

            setCommitMessage(apiResult.message);
        } catch {
            setCommitMessage('Proposalの送信中にエラーが発生しました。');
        } finally {
            setIsCommitting(false);
        }
    };

    return (
        <section className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h3 className={styles.title}>Draft Tray</h3>
                    <p className={styles.subtitle}>
                        盤面で積んだ差分をここで確認して、最後に Proposal に送る。
                    </p>
                </div>

                <button
                    type="button"
                    className={styles.clearButton}
                    disabled={isCommitting || draftAssignments.length === 0}
                    onClick={() => {
                        clearDraft();
                        setCommitMessage(null);
                    }}
                >
                    <Undo2 size={14} />
                    下書きをリセット
                </button>
            </header>

            <div className={styles.summaryRow}>
                <span className={styles.summaryChip}>draft {draftAssignments.length}件</span>
                <span className={styles.summaryChip}>warning {warnings.length}件</span>
            </div>

            {draftAssignments.length === 0 ? (
                <div className={styles.emptyState}>
                    まだ下書きはありません。slot に token を置くとここに溜まります。
                </div>
            ) : (
                <div className={styles.draftList}>
                    {draftAssignments.map((assignment) => (
                        <div key={assignment.id} className={styles.draftRow}>
                            <div>
                                <strong>
                                    {workerNameById.get(assignment.worker_id) ?? assignment.worker_id}
                                </strong>
                                <p>
                                    {assignment.site_name} / {formatDateLabel(assignment.date)}
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.removeButton}
                                onClick={() => removeDraftAssignment(assignment.id)}
                            >
                                取消
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className={styles.warningBlock}>
                <h4 className={styles.sectionTitle}>Warnings / Impact</h4>
                {warnings.length === 0 ? (
                    <p className={styles.emptyCopy}>
                        警告なし。Proposal 送信の準備ができています。
                    </p>
                ) : (
                    <div className={styles.warningList}>
                        {warnings.map((warning) => (
                            <div key={warning.id} className={styles.warningItem}>
                                <div className={styles.warningHead}>
                                    <span
                                        className={`${styles.warningClass} ${
                                            warning.class === 'BLOCK'
                                                ? styles.warningBlockBadge
                                                : styles.warningWarnBadge
                                        }`}
                                    >
                                        {warning.class}
                                    </span>
                                    <span className={styles.warningCode}>{warning.code}</span>
                                </div>
                                <p className={styles.warningMessage}>{warning.message}</p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {hasDraftWarnings && (
                <label className={styles.overrideField}>
                    <span className={styles.overrideLabel}>理由メモ（WARN 時必須）</span>
                    <textarea
                        value={overrideReason}
                        onChange={(event) => setOverrideReason(event.target.value)}
                        className={styles.overrideTextarea}
                        placeholder="例: 育成目的で配置。現場責任者と調整済み。"
                    />
                </label>
            )}

            {commitMessage && (
                <div
                    className={`${styles.commitMessage} ${
                        commitMessage.includes('作成')
                            ? styles.commitSuccess
                            : styles.commitError
                    }`}
                >
                    {commitMessage}
                </div>
            )}

            <button
                type="button"
                className={styles.commitButton}
                onClick={handleCommit}
                disabled={!canCommit}
            >
                {hasDraftBlocks ? (
                    <ShieldAlert size={16} />
                ) : hasDraftWarnings ? (
                    <AlertTriangle size={16} />
                ) : (
                    <Send size={16} />
                )}
                {isCommitting ? '送信中...' : 'Proposal を送信'}
            </button>
        </section>
    );
}
