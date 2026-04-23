import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, GripVertical } from 'lucide-react';
import type { CalendarDay } from '../../types/calendar';
import type { SimulatorPlacement, SimulatorWorker } from '../../types/simulator';
import { useAssignmentSimulatorStore } from '../../hooks/useAssignmentSimulator';
import styles from './AssignmentSimulator.module.css';

interface AssignmentSimulatorProps {
    day: CalendarDay;
    onCommitted?: () => Promise<void> | void;
}

type WorkerFilter = 'all' | 'matching' | 'capacity';

interface CandidateInsight {
    worker: SimulatorWorker;
    projectedDays: number;
    hasSkillMatch: boolean;
    hasSameDayAssignment: boolean;
    exceedsCapacity: boolean;
    alreadyInSelectedSlot: boolean;
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

function buildCandidateCaption(candidate: CandidateInsight): string {
    if (candidate.alreadyInSelectedSlot) {
        return 'この slot に配置済み';
    }
    if (candidate.hasSameDayAssignment) {
        return '同日別現場あり';
    }
    if (!candidate.hasSkillMatch) {
        return '必要スキル不一致';
    }
    if (candidate.exceedsCapacity) {
        return '週上限超過見込み';
    }
    return '投入しやすい候補';
}

export function AssignmentSimulator({ day }: AssignmentSimulatorProps) {
    const workers = useAssignmentSimulatorStore((state) => state.workers);
    const slots = useAssignmentSimulatorStore((state) => state.slots);
    const committedAssignments = useAssignmentSimulatorStore(
        (state) => state.committed_assignments
    );
    const draftAssignments = useAssignmentSimulatorStore((state) => state.draft_assignments);
    const draftWarnings = useAssignmentSimulatorStore((state) => state.draft_warnings);
    const attemptWarnings = useAssignmentSimulatorStore((state) => state.attempt_warnings);
    const initialize = useAssignmentSimulatorStore((state) => state.initialize);
    const assignWorkerToSlot = useAssignmentSimulatorStore((state) => state.assignWorkerToSlot);
    const removeDraftAssignment = useAssignmentSimulatorStore(
        (state) => state.removeDraftAssignment
    );

    const [draggingWorkerId, setDraggingWorkerId] = useState<string | null>(null);
    const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
    const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
    const [workerFilter, setWorkerFilter] = useState<WorkerFilter>('all');

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

    const activeSelectedSlotId =
        selectedSlotId && slots.some((slot) => slot.slot_id === selectedSlotId)
            ? selectedSlotId
            : slots[0]?.slot_id ?? null;

    const selectedSlot =
        slots.find((slot) => slot.slot_id === activeSelectedSlotId) ?? slots[0] ?? null;

    const selectedSlotAssignments = selectedSlot
        ? slotAssignments.get(selectedSlot.slot_id) ?? []
        : [];

    const queuedWorker = selectedWorkerId
        ? workers.find((worker) => worker.user_id === selectedWorkerId) ?? null
        : null;

    const filteredWorkers = useMemo(() => {
        return workers.filter((worker) => {
            if (workerFilter === 'capacity') {
                const projectedDays =
                    workerProjectedDays.get(worker.user_id) ?? worker.assigned_days;
                return projectedDays <= worker.max_days;
            }

            if (workerFilter === 'matching' && selectedSlot) {
                return worker.skills.includes(selectedSlot.required_skill);
            }

            return true;
        });
    }, [selectedSlot, workerFilter, workerProjectedDays, workers]);

    const candidateInsights = useMemo(() => {
        if (!selectedSlot) {
            return [];
        }

        const selectedSlotOccupants = slotAssignments.get(selectedSlot.slot_id) ?? [];

        return filteredWorkers
            .map<CandidateInsight>((worker) => {
                const sameDayAssignments = allAssignments.filter(
                    (assignment) =>
                        assignment.worker_id === worker.user_id && assignment.date === day.date
                );
                const hasSameDayAssignment = sameDayAssignments.some(
                    (assignment) => assignment.slot_id !== selectedSlot.slot_id
                );
                const hasSameDayCoverage = sameDayAssignments.length > 0;
                const projectedBase =
                    workerProjectedDays.get(worker.user_id) ?? worker.assigned_days;
                const projectedDays = projectedBase + (hasSameDayCoverage ? 0 : 1);

                return {
                    worker,
                    projectedDays,
                    hasSkillMatch: worker.skills.includes(selectedSlot.required_skill),
                    hasSameDayAssignment,
                    exceedsCapacity: projectedDays > worker.max_days,
                    alreadyInSelectedSlot: selectedSlotOccupants.some(
                        (assignment) => assignment.worker_id === worker.user_id
                    ),
                };
            })
            .sort((a, b) => {
                const score = (candidate: CandidateInsight) =>
                    (candidate.hasSkillMatch ? 2 : 0) +
                    (candidate.hasSameDayAssignment ? -2 : 0) +
                    (candidate.exceedsCapacity ? -1 : 0) +
                    (candidate.alreadyInSelectedSlot ? -3 : 0);
                return score(b) - score(a);
            });
    }, [allAssignments, day.date, filteredWorkers, selectedSlot, slotAssignments, workerProjectedDays]);

    const handleDropToSlot = (slotId: string, transferredWorkerId: string | null) => {
        if (!transferredWorkerId) {
            return;
        }

        assignWorkerToSlot(transferredWorkerId, slotId);
        setSelectedSlotId(slotId);
        setSelectedWorkerId(null);
    };

    return (
        <section className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h3 className={styles.title}>差配コックピット</h3>
                    <p className={styles.subtitle}>
                        対象日: {formatDateLabel(day.date)} / draft {draftAssignments.length}件
                    </p>
                </div>
            </header>

            <div className={styles.layout}>
                <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                        <div>
                            <h4 className={styles.panelTitle}>Quick Action Tray</h4>
                            <p className={styles.panelHint}>
                                人を選んで slot に置く。ドラッグでも、選択してからクリックでもよい。
                            </p>
                        </div>
                    </div>

                    <div className={styles.filterRow}>
                        <button
                            type="button"
                            className={`${styles.filterChip} ${
                                workerFilter === 'all' ? styles.filterChipActive : ''
                            }`}
                            onClick={() => setWorkerFilter('all')}
                        >
                            全員
                        </button>
                        <button
                            type="button"
                            className={`${styles.filterChip} ${
                                workerFilter === 'matching' ? styles.filterChipActive : ''
                            }`}
                            onClick={() => setWorkerFilter('matching')}
                        >
                            適合のみ
                        </button>
                        <button
                            type="button"
                            className={`${styles.filterChip} ${
                                workerFilter === 'capacity' ? styles.filterChipActive : ''
                            }`}
                            onClick={() => setWorkerFilter('capacity')}
                        >
                            余力あり
                        </button>
                    </div>

                    <div className={styles.workerPillGrid}>
                        {filteredWorkers.map((worker) => {
                            const projectedDays =
                                workerProjectedDays.get(worker.user_id) ?? worker.assigned_days;
                            const isSelected = selectedWorkerId === worker.user_id;
                            const isOverLimit = projectedDays > worker.max_days;

                            return (
                                <button
                                    key={worker.user_id}
                                    type="button"
                                    className={`${styles.workerPill} ${
                                        isSelected ? styles.workerPillSelected : ''
                                    } ${isOverLimit ? styles.workerPillOverLimit : ''}`}
                                    draggable
                                    onClick={() =>
                                        setSelectedWorkerId((current) =>
                                            current === worker.user_id ? null : worker.user_id
                                        )
                                    }
                                    onDragStart={(event) => {
                                        event.dataTransfer.setData('text/plain', worker.user_id);
                                        setDraggingWorkerId(worker.user_id);
                                        setSelectedWorkerId(worker.user_id);
                                    }}
                                    onDragEnd={() => setDraggingWorkerId(null)}
                                >
                                    <div className={styles.workerPillTop}>
                                        <span className={styles.workerName}>{worker.name}</span>
                                        <GripVertical size={14} />
                                    </div>
                                    <div className={styles.workerPillMeta}>
                                        <span>{worker.skills.join(' / ')}</span>
                                        <span>
                                            稼働 {projectedDays}/{worker.max_days}
                                        </span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </section>

                <section className={styles.panel}>
                    <div className={styles.panelHeader}>
                        <div>
                            <h4 className={styles.panelTitle}>Slot Canvas</h4>
                            <p className={styles.panelHint}>
                                不足・pending・draft を盤面で見て、問題のある slot から触る。
                            </p>
                        </div>
                    </div>

                    <div className={styles.slotList}>
                        {slots.map((slot) => {
                            const placements = slotAssignments.get(slot.slot_id) ?? [];
                            const shortage = Math.max(0, slot.required_count - placements.length);
                            const isActiveDropTarget =
                                draggingWorkerId !== null &&
                                !placements.some(
                                    (placement) => placement.worker_id === draggingWorkerId
                                );
                            const isSelected = selectedSlot?.slot_id === slot.slot_id;

                            return (
                                <div
                                    key={slot.slot_id}
                                    className={`${styles.slotCard} ${
                                        isActiveDropTarget ? styles.slotDropTarget : ''
                                    } ${isSelected ? styles.slotSelected : ''}`}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => {
                                        setSelectedSlotId(slot.slot_id);
                                        if (selectedWorkerId) {
                                            handleDropToSlot(slot.slot_id, selectedWorkerId);
                                        }
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Enter' || event.key === ' ') {
                                            event.preventDefault();
                                            setSelectedSlotId(slot.slot_id);
                                            if (selectedWorkerId) {
                                                handleDropToSlot(slot.slot_id, selectedWorkerId);
                                            }
                                        }
                                    }}
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
                                                {slot.required_skill} / level {slot.required_level}
                                            </p>
                                        </div>
                                        <span
                                            className={`${styles.coverageBadge} ${
                                                shortage > 0
                                                    ? styles.coverageShortage
                                                    : styles.coverageOk
                                            }`}
                                        >
                                            必要{slot.required_count} / 確定{placements.length}
                                        </span>
                                    </div>

                                    <div className={styles.slotStatusRow}>
                                        <span className={styles.slotStatusText}>
                                            pending {
                                                placements.filter((placement) =>
                                                    isDraftPlacement(placement)
                                                ).length
                                            }
                                        </span>
                                        <span className={styles.slotStatusText}>
                                            conflict {
                                                placements.some((placement) =>
                                                    placement.warning_codes.length > 0
                                                )
                                                    ? 1
                                                    : 0
                                            }
                                        </span>
                                    </div>

                                    {shortage > 0 && (
                                        <p className={styles.shortageText}>不足: {shortage}人</p>
                                    )}

                                    <div className={styles.placementList}>
                                        {placements.length === 0 ? (
                                            <p className={styles.emptyState}>
                                                token を drop するか、候補から追加
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
                                                        {workerNameById.get(placement.worker_id) ??
                                                            placement.worker_id}
                                                    </span>
                                                    {isDraftPlacement(placement) ? (
                                                        <button
                                                            type="button"
                                                            className={styles.removePlacementButton}
                                                            onClick={(event) => {
                                                                event.stopPropagation();
                                                                removeDraftAssignment(placement.id);
                                                            }}
                                                        >
                                                            取消
                                                        </button>
                                                    ) : (
                                                        <span className={styles.committedBadge}>
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
                    <div className={styles.panelHeader}>
                        <div>
                            <h4 className={styles.panelTitle}>確認</h4>
                            <p className={styles.panelHint}>
                                理由・候補・影響をここで見ます。送信は下のトレイです。
                            </p>
                        </div>
                    </div>

                    {selectedSlot ? (
                        <>
                            <div className={styles.inspectorCard}>
                                <span className={styles.inspectorEyebrow}>選択中</span>
                                <strong className={styles.inspectorTitle}>
                                    {selectedSlot.site_name}
                                </strong>
                                <p className={styles.inspectorMeta}>
                                    {selectedSlot.required_skill} / Lv{' '}
                                    {selectedSlot.required_level}
                                </p>
                                <p className={styles.inspectorMeta}>
                                    必要 {selectedSlot.required_count} / 現在{' '}
                                    {selectedSlotAssignments.length}
                                </p>
                                {queuedWorker && (
                                    <div className={styles.queuedWorker}>
                                        <CheckCircle2 size={16} />
                                        <span>
                                            {queuedWorker.name} を選択中。この枠を押すと下書きに追加。
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className={styles.inspectorSection}>
                                <h5 className={styles.inspectorSectionTitle}>候補を見る</h5>
                                <div className={styles.candidateList}>
                                    {candidateInsights.slice(0, 6).map((candidate) => (
                                        <button
                                            key={candidate.worker.user_id}
                                            type="button"
                                            className={`${styles.candidateCard} ${
                                                !candidate.hasSkillMatch ||
                                                candidate.hasSameDayAssignment ||
                                                candidate.exceedsCapacity ||
                                                candidate.alreadyInSelectedSlot
                                                    ? styles.candidateWarn
                                                    : ''
                                            }`}
                                            onClick={() =>
                                                handleDropToSlot(
                                                    selectedSlot.slot_id,
                                                    candidate.worker.user_id
                                                )
                                            }
                                            disabled={candidate.alreadyInSelectedSlot}
                                        >
                                            <strong>{candidate.worker.name}</strong>
                                            <span>{buildCandidateCaption(candidate)}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    ) : (
                        <p className={styles.noWarnings}>slot を選ぶと詳細が出ます。</p>
                    )}

                    <div className={styles.inspectorSection}>
                        <h5 className={styles.inspectorSectionTitle}>Warnings / Impact</h5>
                        <div className={styles.warningList}>
                            {warnings.length === 0 ? (
                                <p className={styles.noWarnings}>
                                    警告なし。Proposal 送信の準備ができています。
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
                    </div>
                </section>
            </div>
        </section>
    );
}
