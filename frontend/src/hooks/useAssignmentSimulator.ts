import { create } from 'zustand';
import type { Assignment } from '../types/calendar';
import type {
    SimulatorCommitResult,
    SimulatorPlacement,
    SimulatorSkillLevel,
    SimulatorSlot,
    SimulatorWarning,
    SimulatorWarningClass,
    SimulatorWarningCode,
    SimulatorWorker,
} from '../types/simulator';

type AssignmentSimulatorState = {
    selected_date: string | null;
    workers: SimulatorWorker[];
    slots: SimulatorSlot[];
    committed_assignments: SimulatorPlacement[];
    draft_assignments: SimulatorPlacement[];
    draft_warnings: SimulatorWarning[];
    attempt_warnings: SimulatorWarning[];
    override_reason: string;
    next_draft_sequence: number;
    initialize: (selectedDate: string, assignments: Assignment[]) => void;
    assignWorkerToSlot: (workerId: string, slotId: string) => void;
    removeDraftAssignment: (draftId: string) => void;
    setOverrideReason: (reason: string) => void;
    clearDraft: () => void;
    commitDraft: (draftIds?: string[]) => SimulatorCommitResult;
};

const BASE_WORKERS: SimulatorWorker[] = [
    {
        user_id: 'user-1',
        name: '佐藤 匠',
        skills: ['helper', 'plaster'],
        assigned_days: 3,
        max_days: 5,
    },
    {
        user_id: 'user-2',
        name: '田中 電',
        skills: ['electrical', 'helper'],
        assigned_days: 2,
        max_days: 5,
    },
    {
        user_id: 'user-3',
        name: '鈴木 管',
        skills: ['pipe', 'helper'],
        assigned_days: 2,
        max_days: 4,
    },
    {
        user_id: 'user-4',
        name: '伊藤 多能',
        skills: ['helper', 'plaster', 'electrical'],
        assigned_days: 1,
        max_days: 5,
    },
    {
        user_id: 'user-5',
        name: '山本 補助',
        skills: ['helper'],
        assigned_days: 1,
        max_days: 4,
    },
];

const FALLBACK_SLOT_PRESETS = [
    {
        site_id: 'site-foundation',
        site_name: '基礎工事エリア',
        required_skill: 'helper',
        required_level: 'bronze' as const,
        required_count: 2,
    },
    {
        site_id: 'site-electrical',
        site_name: '電気配線エリア',
        required_skill: 'electrical',
        required_level: 'silver' as const,
        required_count: 2,
    },
    {
        site_id: 'site-finishing',
        site_name: '仕上げエリア',
        required_skill: 'plaster',
        required_level: 'gold' as const,
        required_count: 1,
    },
];

function toWarningClass(code: SimulatorWarningCode): SimulatorWarningClass {
    if (code === 'slot_full') {
        return 'BLOCK';
    }
    return 'WARN';
}

function toSlug(value: string): string {
    const slug = value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return slug || 'slot';
}

function calculateHash(input: string): number {
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = (hash << 5) - hash + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function pickRequiredSkill(siteId: string, index: number): string {
    const normalized = siteId.toLowerCase();
    if (normalized.includes('electric')) return 'electrical';
    if (normalized.includes('pipe')) return 'pipe';
    if (normalized.includes('finish')) return 'plaster';
    const skillRotation = ['helper', 'plaster', 'electrical', 'pipe'];
    return skillRotation[index % skillRotation.length];
}

function pickRequiredLevel(index: number): SimulatorSkillLevel {
    const levels: SimulatorSkillLevel[] = ['bronze', 'silver', 'gold'];
    return levels[index % levels.length];
}

function buildWorkers(assignments: Assignment[]): SimulatorWorker[] {
    const workerMap = new Map<string, SimulatorWorker>(
        BASE_WORKERS.map((worker) => [worker.user_id, worker])
    );

    assignments.forEach((assignment) => {
        if (!workerMap.has(assignment.user_id)) {
            const hash = calculateHash(assignment.user_id);
            const maxDays = 4 + (hash % 2);
            const assignedDays = 1 + (hash % 2);
            workerMap.set(assignment.user_id, {
                user_id: assignment.user_id,
                name: `職人 ${assignment.user_id.slice(0, 6)}`,
                skills: ['helper'],
                assigned_days: assignedDays,
                max_days: maxDays,
            });
        }
    });

    const assignedWorkerIds = new Set(assignments.map((assignment) => assignment.user_id));

    return Array.from(workerMap.values()).map((worker) => ({
        ...worker,
        assigned_days: assignedWorkerIds.has(worker.user_id)
            ? Math.max(worker.assigned_days, 2)
            : worker.assigned_days,
    }));
}

function buildSlotsAndCommittedAssignments(
    selectedDate: string,
    assignments: Assignment[]
): {
    slots: SimulatorSlot[];
    committedAssignments: SimulatorPlacement[];
} {
    const assignmentsBySite = new Map<
        string,
        { siteName: string; assignments: Assignment[] }
    >();

    assignments.forEach((assignment) => {
        const current = assignmentsBySite.get(assignment.site_id);
        if (current) {
            current.assignments.push(assignment);
            return;
        }
        assignmentsBySite.set(assignment.site_id, {
            siteName: assignment.site_name,
            assignments: [assignment],
        });
    });

    const slots: SimulatorSlot[] = [];
    const slotBySiteId = new Map<string, string>();

    if (assignmentsBySite.size > 0) {
        Array.from(assignmentsBySite.entries()).forEach(([siteId, siteData], index) => {
            const slotId = `slot-${toSlug(siteId)}-${index + 1}`;
            const requiredCount = Math.max(2, siteData.assignments.length + 1);
            slots.push({
                slot_id: slotId,
                site_id: siteId,
                site_name: siteData.siteName,
                date: selectedDate,
                required_skill: pickRequiredSkill(siteId, index),
                required_level: pickRequiredLevel(index),
                required_count: requiredCount,
            });
            slotBySiteId.set(siteId, slotId);
        });
    } else {
        FALLBACK_SLOT_PRESETS.forEach((preset, index) => {
            const slotId = `slot-${toSlug(preset.site_id)}-${index + 1}`;
            slots.push({
                slot_id: slotId,
                site_id: preset.site_id,
                site_name: preset.site_name,
                date: selectedDate,
                required_skill: preset.required_skill,
                required_level: preset.required_level,
                required_count: preset.required_count,
            });
            slotBySiteId.set(preset.site_id, slotId);
        });
    }

    const fallbackSlotId = slots[0]?.slot_id ?? 'slot-fallback-1';
    const committedAssignments = assignments.map((assignment, index) => ({
        id: `committed-${assignment.id}-${index + 1}`,
        source: 'committed' as const,
        worker_id: assignment.user_id,
        slot_id: slotBySiteId.get(assignment.site_id) ?? fallbackSlotId,
        site_id: assignment.site_id,
        site_name: assignment.site_name,
        date: selectedDate,
        warning_codes: [],
    }));

    return { slots, committedAssignments };
}

function buildWarningMessage(
    code: SimulatorWarningCode,
    worker: SimulatorWorker | undefined,
    slot: SimulatorSlot | undefined
): string {
    const workerName = worker?.name ?? '職人';
    const siteName = slot?.site_name ?? '現場';

    switch (code) {
        case 'slot_full':
            return `${siteName} の必要人数を超えるため配置できません。`;
        case 'double_booking':
            return `${workerName} は同日に別現場へ配置済みです（override理由が必要）。`;
        case 'skill_gap':
            return `${workerName} のスキルが ${siteName} の必要スキルに一致していません。`;
        case 'over_limit':
            return `${workerName} の週稼働上限を超える見込みです。`;
        default:
            return '警告が発生しました。';
    }
}

function buildWarning(
    source: 'draft' | 'attempt',
    code: SimulatorWarningCode,
    worker: SimulatorWorker | undefined,
    slot: SimulatorSlot | undefined,
    draftId: string
): SimulatorWarning {
    const workerId = worker?.user_id ?? 'unknown-worker';
    const slotId = slot?.slot_id ?? 'unknown-slot';

    return {
        id: `${source}-${draftId}-${workerId}-${slotId}-${code}`,
        source,
        class: toWarningClass(code),
        code,
        message: buildWarningMessage(code, worker, slot),
        worker_id: workerId,
        slot_id: slotId,
    };
}

function deriveDraftWarnings(
    draftAssignments: SimulatorPlacement[],
    workers: SimulatorWorker[],
    slots: SimulatorSlot[]
): SimulatorWarning[] {
    const warnings: SimulatorWarning[] = [];
    draftAssignments.forEach((assignment) => {
        if (assignment.warning_codes.length === 0) {
            return;
        }
        const worker = workers.find((candidate) => candidate.user_id === assignment.worker_id);
        const slot = slots.find((candidate) => candidate.slot_id === assignment.slot_id);
        assignment.warning_codes.forEach((code) => {
            warnings.push(buildWarning('draft', code, worker, slot, assignment.id));
        });
    });
    return warnings;
}

function isBlockCode(code: SimulatorWarningCode): boolean {
    return code === 'slot_full';
}

function evaluateWarningCodes({
    worker,
    slot,
    selectedDate,
    committedAssignments,
    draftAssignments,
}: {
    worker: SimulatorWorker;
    slot: SimulatorSlot;
    selectedDate: string;
    committedAssignments: SimulatorPlacement[];
    draftAssignments: SimulatorPlacement[];
}): SimulatorWarningCode[] {
    const allAssignments = [...committedAssignments, ...draftAssignments];

    const slotOccupancy = allAssignments.filter(
        (assignment) => assignment.slot_id === slot.slot_id
    ).length;

    const workerAssignmentsOnDate = allAssignments.filter(
        (assignment) =>
            assignment.worker_id === worker.user_id && assignment.date === selectedDate
    ).length;

    const committedDateSet = new Set(
        committedAssignments
            .filter((assignment) => assignment.worker_id === worker.user_id)
            .map((assignment) => assignment.date)
    );

    const draftDateSet = new Set(
        draftAssignments
            .filter((assignment) => assignment.worker_id === worker.user_id)
            .map((assignment) => assignment.date)
    );

    const hasDateBeforeAdding =
        committedDateSet.has(selectedDate) || draftDateSet.has(selectedDate);
    const projectedAssignedDays = worker.assigned_days + (hasDateBeforeAdding ? 0 : 1);

    const warningCodes: SimulatorWarningCode[] = [];

    if (slotOccupancy >= slot.required_count) {
        warningCodes.push('slot_full');
    }
    if (workerAssignmentsOnDate > 0) {
        warningCodes.push('double_booking');
    }
    if (!worker.skills.includes(slot.required_skill)) {
        warningCodes.push('skill_gap');
    }
    if (projectedAssignedDays > worker.max_days) {
        warningCodes.push('over_limit');
    }

    return warningCodes;
}

function countCommittedUniqueDraftDates(
    committedAssignments: SimulatorPlacement[],
    draftAssignments: SimulatorPlacement[]
): Map<string, number> {
    const committedSet = new Set(
        committedAssignments.map((assignment) => `${assignment.worker_id}|${assignment.date}`)
    );
    const alreadyAdded = new Set<string>();
    const increments = new Map<string, number>();

    draftAssignments.forEach((assignment) => {
        const dateKey = `${assignment.worker_id}|${assignment.date}`;
        if (committedSet.has(dateKey) || alreadyAdded.has(dateKey)) {
            return;
        }
        alreadyAdded.add(dateKey);
        increments.set(
            assignment.worker_id,
            (increments.get(assignment.worker_id) ?? 0) + 1
        );
    });

    return increments;
}

export const useAssignmentSimulatorStore = create<AssignmentSimulatorState>((set) => ({
    selected_date: null,
    workers: [],
    slots: [],
    committed_assignments: [],
    draft_assignments: [],
    draft_warnings: [],
    attempt_warnings: [],
    override_reason: '',
    next_draft_sequence: 1,
    initialize: (selectedDate, assignments) => {
        const workers = buildWorkers(assignments);
        const { slots, committedAssignments } = buildSlotsAndCommittedAssignments(
            selectedDate,
            assignments
        );

        set({
            selected_date: selectedDate,
            workers,
            slots,
            committed_assignments: committedAssignments,
            draft_assignments: [],
            draft_warnings: [],
            attempt_warnings: [],
            override_reason: '',
            next_draft_sequence: 1,
        });
    },
    assignWorkerToSlot: (workerId, slotId) =>
        set((state) => {
            if (!state.selected_date) {
                return state;
            }

            const worker = state.workers.find((candidate) => candidate.user_id === workerId);
            const slot = state.slots.find((candidate) => candidate.slot_id === slotId);
            if (!worker || !slot) {
                return state;
            }

            const allAssignments = [
                ...state.committed_assignments,
                ...state.draft_assignments,
            ];

            const alreadyAssigned = allAssignments.some(
                (assignment) =>
                    assignment.worker_id === workerId && assignment.slot_id === slotId
            );

            if (alreadyAssigned) {
                return {
                    ...state,
                    attempt_warnings: [
                        buildWarning(
                            'attempt',
                            'double_booking',
                            worker,
                            slot,
                            `attempt-${state.next_draft_sequence}`
                        ),
                    ],
                };
            }

            const warningCodes = evaluateWarningCodes({
                worker,
                slot,
                selectedDate: state.selected_date,
                committedAssignments: state.committed_assignments,
                draftAssignments: state.draft_assignments,
            });

            const blockedCodes = warningCodes.filter(isBlockCode);
            if (blockedCodes.length > 0) {
                const attemptWarnings = warningCodes.map((code) =>
                    buildWarning(
                        'attempt',
                        code,
                        worker,
                        slot,
                        `attempt-${state.next_draft_sequence}`
                    )
                );
                return {
                    ...state,
                    attempt_warnings: attemptWarnings,
                };
            }

            const nextDraftAssignment: SimulatorPlacement = {
                id: `draft-${state.next_draft_sequence}`,
                source: 'draft',
                worker_id: worker.user_id,
                slot_id: slot.slot_id,
                site_id: slot.site_id,
                site_name: slot.site_name,
                date: state.selected_date,
                warning_codes: warningCodes,
            };

            const nextDraftAssignments = [...state.draft_assignments, nextDraftAssignment];

            return {
                ...state,
                draft_assignments: nextDraftAssignments,
                draft_warnings: deriveDraftWarnings(
                    nextDraftAssignments,
                    state.workers,
                    state.slots
                ),
                attempt_warnings: [],
                next_draft_sequence: state.next_draft_sequence + 1,
            };
        }),
    removeDraftAssignment: (draftId) =>
        set((state) => {
            const nextDraftAssignments = state.draft_assignments.filter(
                (assignment) => assignment.id !== draftId
            );

            return {
                ...state,
                draft_assignments: nextDraftAssignments,
                draft_warnings: deriveDraftWarnings(
                    nextDraftAssignments,
                    state.workers,
                    state.slots
                ),
                attempt_warnings: [],
            };
        }),
    setOverrideReason: (reason) =>
        set((state) => ({
            ...state,
            override_reason: reason,
        })),
    clearDraft: () =>
        set((state) => ({
            ...state,
            draft_assignments: [],
            draft_warnings: [],
            attempt_warnings: [],
            override_reason: '',
        })),
    commitDraft: (draftIds) => {
        let result: SimulatorCommitResult = {
            ok: false,
            total_proposals: 0,
            pending_count: 0,
            auto_approved_count: 0,
            message: '仮配置がありません。',
        };

        set((state) => {
            const targetDraftIdSet = draftIds ? new Set(draftIds) : null;
            const targetDraftAssignments = targetDraftIdSet
                ? state.draft_assignments.filter((assignment) =>
                      targetDraftIdSet.has(assignment.id)
                  )
                : state.draft_assignments;

            if (targetDraftAssignments.length === 0) {
                result = {
                    ok: false,
                    total_proposals: 0,
                    pending_count: 0,
                    auto_approved_count: 0,
                    message: '仮配置がありません。',
                };
                return state;
            }

            const targetWarnings = deriveDraftWarnings(
                targetDraftAssignments,
                state.workers,
                state.slots
            );
            const hasBlock = targetWarnings.some((warning) => warning.class === 'BLOCK');
            if (hasBlock) {
                result = {
                    ok: false,
                    total_proposals: targetDraftAssignments.length,
                    pending_count: 0,
                    auto_approved_count: 0,
                    message: 'BLOCK 警告を解消してから確定してください。',
                };
                return state;
            }

            const hasWarn = targetWarnings.some((warning) => warning.class === 'WARN');
            if (hasWarn && state.override_reason.trim().length === 0) {
                result = {
                    ok: false,
                    total_proposals: targetDraftAssignments.length,
                    pending_count: targetDraftAssignments.length,
                    auto_approved_count: 0,
                    message: 'WARN を含むため override 理由が必要です。',
                };
                return state;
            }

            const totalProposals = targetDraftAssignments.length;
            const autoApprovedCount = targetDraftAssignments.filter(
                (assignment) => assignment.warning_codes.length === 0
            ).length;
            const pendingCount = totalProposals - autoApprovedCount;

            const workerIncrements = countCommittedUniqueDraftDates(
                state.committed_assignments,
                targetDraftAssignments
            );

            const nextWorkers = state.workers.map((worker) => ({
                ...worker,
                assigned_days:
                    worker.assigned_days + (workerIncrements.get(worker.user_id) ?? 0),
            }));

            const nextCommittedAssignments = [
                ...state.committed_assignments,
                ...targetDraftAssignments.map((assignment) => ({
                    ...assignment,
                    source: 'committed' as const,
                    id: `committed-${assignment.id}`,
                    warning_codes: [],
                })),
            ];

            const nextDraftAssignments = targetDraftIdSet
                ? state.draft_assignments.filter(
                      (assignment) => !targetDraftIdSet.has(assignment.id)
                  )
                : [];

            result = {
                ok: true,
                total_proposals: totalProposals,
                pending_count: pendingCount,
                auto_approved_count: autoApprovedCount,
                message:
                    pendingCount > 0
                        ? `${totalProposals}件のProposalを作成しました（${pendingCount}件は承認待ち）。`
                        : `${totalProposals}件のProposalを作成し、自動承認対象として送信しました。`,
            };

            return {
                ...state,
                workers: nextWorkers,
                committed_assignments: nextCommittedAssignments,
                draft_assignments: nextDraftAssignments,
                draft_warnings: deriveDraftWarnings(
                    nextDraftAssignments,
                    state.workers,
                    state.slots
                ),
                attempt_warnings: [],
                override_reason: nextDraftAssignments.length > 0 ? state.override_reason : '',
            };
        });

        return result;
    },
}));
