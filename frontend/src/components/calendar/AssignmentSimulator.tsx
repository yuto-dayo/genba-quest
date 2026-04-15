import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GripVertical, Send, ShieldAlert, Undo2 } from 'lucide-react';
import type { CalendarDay } from '../../types/calendar';
import type { SimulatorPlacement } from '../../types/simulator';
import { useAssignmentSimulatorStore } from '../../hooks/useAssignmentSimulator';
import { commitSimulatorDraft } from '../../lib/api';
import styles from './AssignmentSimulator.module.css';

interface AssignmentSimulatorProps {
    day: CalendarDay;
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

function isDraftPlacement(placement: SimulatorPlacement): boolean {
    return placement.source === 'draft';
}

export function AssignmentSimulator({ day, onCommitted }: AssignmentSimulatorProps) {
    const workers = useAssignmentSimulatorStore((state) => state.workers);
    const slots = useAssignmentSimulatorStore((state) => state.slots);
    const committedAssignments = useAssignmentSimulatorStore(
        (state) => state.committed_assignments
    );
    const draftAssignments = useAssignmentSimulatorStore((state) => state.draft_assignments);
    const draftWarnings = useAssignmentSimulatorStore((state) => state.draft_warnings);
    const attemptWarnings = useAssignmentSimulatorStore((state) => state.attempt_warnings);
    const overrideReason = useAssignmentSimulatorStore((state) => state.override_reason);
    const initialize = useAssignmentSimulatorStore((state) => state.initialize);
    const assignWorkerToSlot = useAssignmentSimulatorStore(
        (state) => state.assignWorkerToSlot
    );
    const removeDraftAssignment = useAssignmentSimulatorStore(
        (state) => state.removeDraftAssignment
    );
    const setOverrideReason = useAssignmentSimulatorStore(
        (state) => state.setOverrideReason
    );
    const clearDraft = useAssignmentSimulatorStore((state) => state.clearDraft);
    const commitDraft = useAssignmentSimulatorStore((state) => state.commitDraft);

    const [draggingWorkerId, setDraggingWorkerId] = useState<string | null>(null);
    const [commitMessage, setCommitMessage] = useState<string | null>(null);
    const [isCommitting, setIsCommitting] = useState(false);

    useEffect(() => {
        initialize(day.date, day.assignments);
    }, [day.date, day.assignments, initialize]);

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

    const allAssignments = useMemo(
        () => [...committedAssignments, ...draftAssignments],
        [committedAssignments, draftAssignments]
    );

    const slotAssignments = useMemo(() => {
        const mapping = new Map<string, SimulatorPlacement[]>();
        allAssignments.forEach((assignment) => {
            const current = mapping.get(assignment.slot_id);
            if (current) {
                current.push(assignment);
                return;
            }
            mapping.set(assignment.slot_id, [assignment]);
        });
        return mapping;
    }, [allAssignments]);

    const workerProjectedDays = useMemo(() => {
        const committedDateSet = new Set(
            committedAssignments.map((assignment) => `${assignment.worker_id}|${assignment.date}`)
        );
        const addedDateSet = new Set<string>();
        const increments = new Map<string, number>();

        draftAssignments.forEach((assignment) => {
            const dateKey = `${assignment.worker_id}|${assignment.date}`;
            if (committedDateSet.has(dateKey) || addedDateSet.has(dateKey)) {
                return;
            }
            addedDateSet.add(dateKey);
            increments.set(
                assignment.worker_id,
                (increments.get(assignment.worker_id) ?? 0) + 1
            );
        });

        const projected = new Map<string, number>();
        workers.forEach((worker) => {
            projected.set(
                worker.user_id,
                worker.assigned_days + (increments.get(worker.user_id) ?? 0)
            );
        });
        return projected;
    }, [committedAssignments, draftAssignments, workers]);

    const hasDraftWarnings = draftWarnings.some((warning) => warning.class === 'WARN');
    const hasDraftBlocks = draftWarnings.some((warning) => warning.class === 'BLOCK');

    const canCommit =
        draftAssignments.length > 0 &&
        !hasDraftBlocks &&
        !isCommitting &&
        (!hasDraftWarnings || overrideReason.trim().length > 0);

    const handleDropToSlot = (slotId: string, transferredWorkerId: string | null) => {
        if (!transferredWorkerId) {
            return;
        }
        assignWorkerToSlot(transferredWorkerId, slotId);
        setCommitMessage(null);
    };

    const handleCommit = async () => {
        if (draftAssignments.length === 0 || isCommitting) return;
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
                    <h3 className={styles.title}>編成シミュレーター</h3>
                    <p className={styles.subtitle}>
                        対象日: {formatDateLabel(day.date)} / 仮配置 {draftAssignments.length}件
                    </p>
                </div>
                <div className={styles.headerActions}>
                    <button
                        type="button"
                        className={styles.clearButton}
                        disabled={isCommitting}
                        onClick={() => {
                            clearDraft();
                            setCommitMessage(null);
                        }}
                    >
                        <Undo2 size={14} />
                        仮配置をリセット
                    </button>
                </div>
            </header>

            <div className={styles.layout}>
                <section className={styles.panel}>
                    <h4 className={styles.panelTitle}>職人リスト</h4>
                    <div className={styles.workerList}>
                        {workers.map((worker) => {
                            const projectedDays =
                                workerProjectedDays.get(worker.user_id) ?? worker.assigned_days;
                            const ratio = Math.min(1, projectedDays / worker.max_days);
                            const isOverLimit = projectedDays > worker.max_days;

                            return (
                                <div
                                    key={worker.user_id}
                                    className={`${styles.workerCard} ${
                                        isOverLimit ? styles.workerOverLimit : ''
                                    }`}
                                    draggable
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData(
                                            'text/plain',
                                            worker.user_id
                                        );
                                        setDraggingWorkerId(worker.user_id);
                                    }}
                                    onDragEnd={() => setDraggingWorkerId(null)}
                                >
                                    <div className={styles.workerHeader}>
                                        <span className={styles.workerName}>{worker.name}</span>
                                        <GripVertical size={14} />
                                    </div>
                                    <div className={styles.workerSkills}>
                                        {worker.skills.map((skill) => (
                                            <span key={skill} className={styles.skillBadge}>
                                                {skill}
                                            </span>
                                        ))}
                                    </div>
                                    <div className={styles.capacityRow}>
                                        <span className={styles.capacityLabel}>
                                            稼働 {projectedDays}/{worker.max_days}
                                        </span>
                                        <div className={styles.capacityTrack}>
                                            <div
                                                className={styles.capacityFill}
                                                style={{
                                                    width: `${ratio * 100}%`,
                                                }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className={styles.panel}>
                    <h4 className={styles.panelTitle}>現場スロット</h4>
                    <div className={styles.slotList}>
                        {slots.map((slot) => {
                            const placements = slotAssignments.get(slot.slot_id) ?? [];
                            const shortage = Math.max(0, slot.required_count - placements.length);
                            const isActiveDropTarget =
                                draggingWorkerId !== null &&
                                !placements.some(
                                    (placement) =>
                                        placement.worker_id === draggingWorkerId
                                );

                            return (
                                <div
                                    key={slot.slot_id}
                                    className={`${styles.slotCard} ${
                                        isActiveDropTarget ? styles.slotDropTarget : ''
                                    }`}
                                    onDragOver={(event) => event.preventDefault()}
                                    onDrop={(event) => {
                                        event.preventDefault();
                                        const workerId =
                                            event.dataTransfer.getData('text/plain') ||
                                            draggingWorkerId;
                                        handleDropToSlot(slot.slot_id, workerId);
                                        setDraggingWorkerId(null);
                                    }}
                                >
                                    <div className={styles.slotHeader}>
                                        <div>
                                            <p className={styles.slotName}>{slot.site_name}</p>
                                            <p className={styles.slotMeta}>
                                                skill: {slot.required_skill} / level:{' '}
                                                {slot.required_level}
                                            </p>
                                        </div>
                                        <span
                                            className={`${styles.coverageBadge} ${
                                                shortage > 0
                                                    ? styles.coverageShortage
                                                    : styles.coverageOk
                                            }`}
                                        >
                                            {placements.length}/{slot.required_count}
                                        </span>
                                    </div>

                                    {shortage > 0 && (
                                        <p className={styles.shortageText}>
                                            不足: {shortage}人
                                        </p>
                                    )}

                                    <div className={styles.placementList}>
                                        {placements.length === 0 ? (
                                            <p className={styles.emptyState}>
                                                職人をここへドラッグ
                                            </p>
                                        ) : (
                                            placements.map((placement) => (
                                                <div
                                                    key={placement.id}
                                                    className={`${styles.placementChip} ${
                                                        isDraftPlacement(placement)
                                                            ? styles.placementDraft
                                                            : styles.placementCommitted
                                                    }`}
                                                >
                                                    <span>
                                                        {workerNameById.get(
                                                            placement.worker_id
                                                        ) ?? placement.worker_id}
                                                    </span>
                                                    {isDraftPlacement(placement) ? (
                                                        <button
                                                            type="button"
                                                            className={
                                                                styles.removePlacementButton
                                                            }
                                                            onClick={() =>
                                                                removeDraftAssignment(
                                                                    placement.id
                                                                )
                                                            }
                                                        >
                                                            取消
                                                        </button>
                                                    ) : (
                                                        <span
                                                            className={
                                                                styles.committedBadge
                                                            }
                                                        >
                                                            確定
                                                        </span>
                                                    )}
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </section>

                <section className={styles.panel}>
                    <h4 className={styles.panelTitle}>警告と確定</h4>

                    <div className={styles.warningList}>
                        {warnings.length === 0 ? (
                            <p className={styles.noWarnings}>
                                警告なし。承認へ送る準備ができています。
                            </p>
                        ) : (
                            warnings.map((warning) => (
                                <div key={warning.id} className={styles.warningItem}>
                                    <div className={styles.warningHead}>
                                        <span
                                            className={`${styles.warningClass} ${
                                                warning.class === 'BLOCK'
                                                    ? styles.warningBlock
                                                    : styles.warningWarn
                                            }`}
                                        >
                                            {warning.class}
                                        </span>
                                        <span className={styles.warningCode}>
                                            {warning.code}
                                        </span>
                                    </div>
                                    <p className={styles.warningMessage}>{warning.message}</p>
                                </div>
                            ))
                        )}
                    </div>

                    {hasDraftWarnings && (
                        <label className={styles.overrideField}>
                            <span className={styles.overrideLabel}>
                                override理由（WARN時必須）
                            </span>
                            <textarea
                                value={overrideReason}
                                onChange={(event) =>
                                    setOverrideReason(event.target.value)
                                }
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
                        {isCommitting ? '送信中...' : '承認へ送る'}
                    </button>
                </section>
            </div>
        </section>
    );
}
