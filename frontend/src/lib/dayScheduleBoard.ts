import type { CalendarDay } from '../types/calendar';
import type { Member, Site } from './api';

export interface DraftAssignmentCreate {
    id: string;
    date: string;
    site_id: string;
    site_name: string;
    worker_id: string;
    worker_name: string;
    line_item_id?: string | null;
    work_label?: string | null;
}

export interface WorkerSummary {
    id: string;
    name: string;
    draft_id?: string;
    work_label?: string | null;
}

export interface DayScheduleSiteBoard {
    site_id: string;
    site_name: string;
    is_completed: boolean;
    required_worker_count: number | null;
    confirmed_workers: WorkerSummary[];
    draft_workers: WorkerSummary[];
    confirmed_count: number;
    draft_count: number;
    projected_count: number;
    shortage_count: number | null;
}

export interface DayScheduleBoardModel {
    date: string;
    sites: DayScheduleSiteBoard[];
    shortage_site_count: number;
    assigned_worker_ids_for_date: string[];
    unavailable_worker_ids_for_date: string[];
    pending_leave_worker_ids_for_date: string[];
    warning_worker_ids_for_date: string[];
    worker_status_by_id: Record<string, { severity: 'blocked' | 'warning'; label: string }>;
}

interface BuildDayScheduleBoardInput {
    day: CalendarDay;
    sites: Site[];
    members: Member[];
    drafts: DraftAssignmentCreate[];
}

function getMemberName(member: Member | undefined, fallbackId: string): string {
    return member?.full_name || member?.display_name || member?.username || fallbackId;
}

function uniquePush(target: string[], value: string) {
    if (!target.includes(value)) {
        target.push(value);
    }
}

export function buildDayScheduleBoard({
    day,
    sites,
    members,
    drafts,
}: BuildDayScheduleBoardInput): DayScheduleBoardModel {
    const siteById = new Map(sites.map((site) => [site.id, site]));
    const memberById = new Map(members.map((member) => [member.id, member]));
    const assignmentsBySite = new Map<string, typeof day.assignments>();

    day.assignments.forEach((assignment) => {
        if (!assignment.site_id || assignment.site_id === 'unassigned') {
            return;
        }
        if (assignment.status === 'tentative') {
            return;
        }
        const current = assignmentsBySite.get(assignment.site_id) ?? [];
        current.push(assignment);
        assignmentsBySite.set(assignment.site_id, current);
    });

    const assignedWorkerIdsForDate: string[] = [];
    const unavailableWorkerIdsForDate: string[] = [];
    const pendingLeaveWorkerIdsForDate: string[] = [];
    const warningWorkerIdsForDate: string[] = [];
    const workerStatusById: DayScheduleBoardModel['worker_status_by_id'] = {};
    day.personal_schedules.forEach((schedule) => {
        if (schedule.blocks_assignment) {
            uniquePush(unavailableWorkerIdsForDate, schedule.user_id);
            const blockedLabel = schedule.type === 'sick_leave' ? '病欠' : '休み';
            if (
                !workerStatusById[schedule.user_id] ||
                (workerStatusById[schedule.user_id].label !== '病欠' && blockedLabel === '病欠')
            ) {
                workerStatusById[schedule.user_id] = {
                    severity: 'blocked',
                    label: blockedLabel,
                };
            }
            return;
        }

        uniquePush(warningWorkerIdsForDate, schedule.user_id);
        if (!workerStatusById[schedule.user_id]) {
            workerStatusById[schedule.user_id] = {
                severity: 'warning',
                label: '予定あり',
            };
        }
    });

    const rows = Array.from(assignmentsBySite.entries()).map(([siteId, assignments]) => {
        const site = siteById.get(siteId);
        const siteName = site?.name || assignments[0]?.site_name || '現場未設定';
        const isCompleted =
            site?.status === 'completed' || assignments.some((assignment) => assignment.status === 'completed');
        const confirmedWorkerIds: string[] = [];

        site?.assigned_users?.forEach((workerId) => {
            uniquePush(confirmedWorkerIds, workerId);
            uniquePush(assignedWorkerIdsForDate, workerId);
        });

        if (!site) {
            assignments.forEach((assignment) => {
                if (
                    assignment.source === 'proposal' &&
                    assignment.proposal_type === 'assignment.create' &&
                    assignment.user_id !== 'site'
                ) {
                    uniquePush(confirmedWorkerIds, assignment.user_id);
                    uniquePush(assignedWorkerIdsForDate, assignment.user_id);
                }
            });
        }

        const siteDrafts = isCompleted
            ? []
            : drafts.filter((draft) => draft.date === day.date && draft.site_id === siteId);
        siteDrafts.forEach((draft) => uniquePush(assignedWorkerIdsForDate, draft.worker_id));

        const requiredWorkerCount = site?.required_worker_count ?? null;
        const projectedCount = confirmedWorkerIds.length + siteDrafts.length;
        const shortageCount =
            isCompleted || requiredWorkerCount === null
                ? null
                : Math.max(0, requiredWorkerCount - projectedCount);

        return {
            site_id: siteId,
            site_name: siteName,
            is_completed: isCompleted,
            required_worker_count: requiredWorkerCount,
            confirmed_workers: confirmedWorkerIds.map((workerId) => ({
                id: workerId,
                name: getMemberName(memberById.get(workerId), workerId),
            })),
            draft_workers: siteDrafts.map((draft) => ({
                id: draft.worker_id,
                name: draft.worker_name,
                draft_id: draft.id,
                work_label: draft.work_label ?? null,
            })),
            confirmed_count: confirmedWorkerIds.length,
            draft_count: siteDrafts.length,
            projected_count: projectedCount,
            shortage_count: shortageCount,
        };
    });

    rows.sort((a, b) => {
        const aShortage = a.shortage_count ?? -1;
        const bShortage = b.shortage_count ?? -1;
        if (aShortage !== bShortage) {
            return bShortage - aShortage;
        }
        return a.site_name.localeCompare(b.site_name);
    });

    return {
        date: day.date,
        sites: rows,
        shortage_site_count: rows.filter((site) => (site.shortage_count ?? 0) > 0).length,
        assigned_worker_ids_for_date: assignedWorkerIdsForDate,
        unavailable_worker_ids_for_date: unavailableWorkerIdsForDate,
        pending_leave_worker_ids_for_date: pendingLeaveWorkerIdsForDate,
        warning_worker_ids_for_date: warningWorkerIdsForDate,
        worker_status_by_id: workerStatusById,
    };
}

export function countMonthlyShortageDays(
    days: CalendarDay[],
    sites: Site[],
    drafts: DraftAssignmentCreate[] = []
): number {
    return days.filter((day) => {
        if (!day.isCurrentMonth) {
            return false;
        }
        return buildDayScheduleBoard({ day, sites, members: [], drafts }).shortage_site_count > 0;
    }).length;
}
