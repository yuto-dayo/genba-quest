import { useState, useMemo, useCallback, useEffect } from 'react';
import type {
    CalendarDay,
    CalendarPersonalSchedule,
    CalendarPersonalScheduleVisibility,
    Assignment,
    AssignmentStatus,
    Shift,
} from '../types/calendar';
import {
    fetchClients,
    fetchPersonalSchedules,
    fetchSites,
    fetchProposals,
    type Client,
    type PersonalSchedule,
    type PersonalScheduleType,
    type PersonalScheduleVisibility,
    type ProposalRecord,
    type ProposalStatus,
    type ProposalType,
    type Site,
} from '../lib/api';
import {
    getStableClientColorToken,
    resolveClientColorOption,
} from '../lib/clientColors';
import { normalizeDateList, normalizeSiteScheduleMode, normalizeWeekdays } from '../lib/siteSchedule';

const MAX_SCHEDULE_PROPOSALS = 200;
const CALENDAR_PROPOSAL_TYPES = ['assignment.create', 'assignment.update'] as const;
const LEAVE_PROPOSAL_STATUSES: ProposalStatus[] = ['pending', 'approved'];
const CALENDAR_PROPOSAL_STATUSES: ProposalStatus[] = ['approved', 'executed'];
const ASSIGNMENT_PROPOSAL_TYPES = new Set<ProposalType>([
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
]);

const PERSONAL_SCHEDULE_TYPE_LABELS: Record<PersonalScheduleType, string> = {
    event: '予定',
    task: 'タスク',
    vacation: '休み',
    sick_leave: '病欠',
    business_trip: '出張',
    training: '研修',
};

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function toDateKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
    ).padStart(2, '0')}`;
}

function toDateKeyFromUnknown(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }

        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
            return trimmed;
        }

        const parsed = new Date(trimmed);
        if (!Number.isNaN(parsed.getTime())) {
            return toDateKey(parsed);
        }
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return toDateKey(value);
    }

    return null;
}

function toTimeLabel(value: unknown): string | undefined {
    const normalized = normalizeString(value);
    if (!normalized) {
        return undefined;
    }

    const hhmm = normalized.match(/(\d{2}:\d{2})/);
    return hhmm?.[1];
}

function isHexColor(value: unknown): value is string {
    return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value.trim());
}

function getClientColorOption(
    client: Pick<Client, 'id' | 'name' | 'calendar_color_token' | 'calendar_color'> | null | undefined
) {
    if (client?.calendar_color_token) {
        return resolveClientColorOption(client.calendar_color_token);
    }

    if (isHexColor(client?.calendar_color)) {
        return {
            token: getStableClientColorToken(client?.id || client?.name),
            label: '取引先色',
            bar: client.calendar_color.toUpperCase(),
            soft: client.calendar_color.toUpperCase(),
            text: '#FFFFFF',
        };
    }

    return resolveClientColorOption(getStableClientColorToken(client?.id || client?.name));
}

function getSiteClientColorOption(site: Site | undefined) {
    if (!site) {
        return null;
    }
    return getClientColorOption({
        id: site.client?.id || site.client_id || site.id,
        name: site.client?.name || site.name,
        calendar_color_token: site.client?.calendar_color_token,
        calendar_color: site.client?.calendar_color,
    });
}

function normalizePersonalScheduleType(value: unknown): PersonalScheduleType {
    const normalized = normalizeString(value)?.toLowerCase();
    switch (normalized) {
        case 'event':
        case 'task':
        case 'vacation':
        case 'sick_leave':
        case 'business_trip':
        case 'training':
            return normalized;
        case 'leave':
        case 'holiday':
            return 'vacation';
        case 'sick':
        case 'sickleave':
            return 'sick_leave';
        case 'trip':
        case 'business-trip':
        case 'businesstrip':
            return 'business_trip';
        default:
            return 'vacation';
    }
}

function blocksAssignmentForScheduleType(type: PersonalScheduleType): boolean {
    return type === 'vacation' || type === 'sick_leave';
}

function normalizePersonalScheduleVisibility(
    value: unknown,
    scheduleType: PersonalScheduleType
): CalendarPersonalScheduleVisibility {
    if (blocksAssignmentForScheduleType(scheduleType)) {
        return 'organization';
    }

    const normalized = normalizeString(value)?.toLowerCase();
    if (normalized && ['organization', 'org', 'team', 'public'].includes(normalized)) {
        return 'organization';
    }
    if (normalized && ['personal', 'private', 'self'].includes(normalized)) {
        return 'personal';
    }

    return 'personal';
}

function mapProposalStatusToAssignmentStatus(status: ProposalStatus): AssignmentStatus {
    switch (status) {
        case 'executed':
            return 'scheduled';
        case 'approved':
            return 'confirmed';
        default:
            return 'pending';
    }
}

function toAssignmentProposalType(type: ProposalType): Assignment['proposal_type'] {
    return ASSIGNMENT_PROPOSAL_TYPES.has(type) ? (type as Assignment['proposal_type']) : undefined;
}

function pickAssignmentDate(proposal: ProposalRecord): string | null {
    const payload = proposal.payload;
    return (
        toDateKeyFromUnknown(payload.due_date) ||
        toDateKeyFromUnknown(payload.date) ||
        toDateKeyFromUnknown(payload.start_date) ||
        toDateKeyFromUnknown(payload.recorded_date) ||
        toDateKeyFromUnknown(proposal.executed_at) ||
        toDateKeyFromUnknown(proposal.created_at)
    );
}

function toAssignment(proposal: ProposalRecord): Assignment | null {
    const date = pickAssignmentDate(proposal);
    if (!date) {
        return null;
    }

    const payload = proposal.payload;
    const title = normalizeString(payload.title);
    const siteName = normalizeString(payload.site_name) || title || '現場アサイン';

    const siteId =
        normalizeString(payload.site_id) || 'unassigned';

    const userId =
        normalizeString(payload.assignee_id) ||
        normalizeString(payload.user_id) ||
        proposal.created_by.id;

    return {
        id: proposal.id,
        user_id: userId,
        site_id: siteId,
        site_name: siteName,
        client_name: normalizeString(payload.client_name) || undefined,
        date,
        status: mapProposalStatusToAssignmentStatus(proposal.status),
        start_time: toTimeLabel(payload.start_time),
        end_time: toTimeLabel(payload.end_time),
        source: 'proposal',
        proposal_type: toAssignmentProposalType(proposal.type),
    };
}

function toPersonalScheduleFromProposal(proposal: ProposalRecord): CalendarPersonalSchedule | null {
    if (proposal.type !== 'leave.request') {
        return null;
    }

    const startDate =
        toDateKeyFromUnknown(proposal.payload.start_date) ||
        toDateKeyFromUnknown(proposal.payload.startDate) ||
        toDateKeyFromUnknown(proposal.payload.date);
    if (!startDate) {
        return null;
    }

    const endDate =
        toDateKeyFromUnknown(proposal.payload.end_date) ||
        toDateKeyFromUnknown(proposal.payload.endDate) ||
        startDate;

    const userId =
        normalizeString(proposal.payload.user_id) ||
        normalizeString(proposal.payload.userId) ||
        normalizeString(proposal.payload.target_user_id) ||
        normalizeString(proposal.payload.targetUserId) ||
        (proposal.created_by.type === 'human' ? proposal.created_by.id : null);

    if (!userId || !endDate || startDate > endDate) {
        return null;
    }

    const scheduleType = normalizePersonalScheduleType(
        proposal.payload.schedule_type ??
            proposal.payload.scheduleType ??
            proposal.payload.type ??
            proposal.payload.leave_type ??
            proposal.payload.leaveType
    );
    const title =
        normalizeString(proposal.payload.title) ||
        normalizeString(proposal.payload.name) ||
        PERSONAL_SCHEDULE_TYPE_LABELS[scheduleType];

    return {
        id: proposal.id,
        user_id: userId,
        start_date: startDate,
        end_date: endDate,
        type: scheduleType,
        title,
        start_time: toTimeLabel(proposal.payload.start_time),
        end_time: toTimeLabel(proposal.payload.end_time),
        blocks_assignment: blocksAssignmentForScheduleType(scheduleType),
        visibility: normalizePersonalScheduleVisibility(
            proposal.payload.visibility ??
                proposal.payload.visibility_scope ??
                proposal.payload.visibilityScope ??
                proposal.payload.display_scope ??
                proposal.payload.displayScope,
            scheduleType
        ),
        reason:
            normalizeString(proposal.payload.reason) ||
            normalizeString(proposal.payload.note) ||
            proposal.description,
        address: normalizeString(proposal.payload.address ?? proposal.payload.location ?? proposal.payload.place),
        color: normalizeString(proposal.payload.color),
        approved: proposal.status === 'approved',
        status: proposal.status === 'approved' ? 'approved' : 'pending',
        source: 'proposal',
    };
}

function toPersonalScheduleFromRow(row: PersonalSchedule): CalendarPersonalSchedule {
    return {
        id: row.id,
        user_id: row.user_id,
        start_date: row.start_date,
        end_date: row.end_date,
        type: row.type,
        title: row.title || PERSONAL_SCHEDULE_TYPE_LABELS[row.type],
        start_time: row.start_time,
        end_time: row.end_time,
        address: row.address,
        color: row.color,
        blocks_assignment: row.blocks_assignment,
        visibility: normalizePersonalScheduleVisibility(
            (row as PersonalSchedule & { visibility?: PersonalScheduleVisibility }).visibility,
            row.type
        ),
        reason: row.reason,
        approved: row.approved,
        status: row.approved ? 'approved' : 'pending',
        source: 'personal_schedule',
    };
}

function enrichAssignmentsWithSiteData(assignments: Assignment[], sites: Site[]): Assignment[] {
    if (sites.length === 0) {
        return assignments;
    }
    const siteById = new Map<string, Site>();
    const siteByName = new Map<string, Site>();
    for (const site of sites) {
        siteById.set(site.id, site);
        siteByName.set(site.name, site);
    }

    return assignments.map((assignment) => {
        const site = assignment.site_id
            ? siteById.get(assignment.site_id)
            : assignment.site_name
                ? siteByName.get(assignment.site_name)
                : undefined;
        if (!site) {
            return assignment;
        }

        const clientName = site.client?.name;
        const clientColor = getSiteClientColorOption(site);
        const nextAssignment =
            clientName && !assignment.client_name
                ? {
                    ...assignment,
                    client_name: clientName,
                    client_color: clientColor?.bar ?? null,
                    client_color_text: clientColor?.text ?? null,
                }
                : clientColor && !assignment.client_color
                  ? {
                      ...assignment,
                      client_color: clientColor.bar,
                      client_color_text: clientColor.text,
                  }
                : assignment;

        return site.status === 'completed'
            ? { ...nextAssignment, status: 'completed' }
            : nextAssignment;
    });
}

function toDateRange(start: Date, end: Date): string[] {
    const dates: string[] = [];
    const current = new Date(start);
    while (current <= end) {
        dates.push(toDateKey(current));
        current.setDate(current.getDate() + 1);
    }
    return dates;
}

function projectSitesToAssignments(
    sites: Site[],
    baseAssignments: Assignment[],
    monthStart: Date,
    monthEnd: Date,
    todayKey: string
): Assignment[] {
    const assignmentKeys = new Set(
        baseAssignments.map((assignment) => `${assignment.date}:${assignment.site_id}`)
    );

    return sites.flatMap((site) => {
        const isTentativeSite = site.status === 'tentative';
        const isCompletedSite = site.status === 'completed';
        if (!['active', 'in_progress', 'tentative', 'completed'].includes(site.status)) {
            return [];
        }

        const scheduleMode = normalizeSiteScheduleMode(site.schedule_mode);
        const workingWeekdays = normalizeWeekdays(site.working_weekdays);
        const customWorkDates = normalizeDateList(site.custom_work_dates);
        const completedDate = toDateKeyFromUnknown(site.completed_at);
        const siteAssignmentStatus: AssignmentStatus = isCompletedSite
            ? 'completed'
            : isTentativeSite
              ? 'tentative'
              : 'scheduled';

        if (scheduleMode === 'custom') {
            return customWorkDates
                .filter((date) => date >= toDateKey(monthStart) && date <= toDateKey(monthEnd))
                .filter((date) => !completedDate || date <= completedDate)
                .filter((date) => !assignmentKeys.has(`${date}:${site.id}`))
                .map<Assignment>((date) => {
                    const clientColor = getSiteClientColorOption(site);
                    return {
                        id: `site:${site.id}:${date}`,
                        user_id: 'site',
                        site_id: site.id,
                        site_name: site.name,
                        client_name: site.client?.name,
                        client_color: clientColor?.bar ?? null,
                        client_color_text: clientColor?.text ?? null,
                        date,
                        status: siteAssignmentStatus,
                        source: 'site',
                        worker_count: Array.isArray(site.assigned_users) ? site.assigned_users.length : 0,
                    };
                });
        }

        const explicitStart = toDateKeyFromUnknown(site.started_at);
        const explicitEnd = toDateKeyFromUnknown(site.expected_completion_at);
        const rangeEndKey = isCompletedSite ? completedDate || explicitEnd || explicitStart : explicitEnd;

        if (isTentativeSite && !explicitStart && !explicitEnd) {
            return [];
        }
        if (isCompletedSite && !rangeEndKey) {
            return [];
        }

        const rangeStart = explicitStart
            ? new Date(`${explicitStart}T00:00:00`)
            : isCompletedSite && explicitEnd
              ? new Date(`${explicitEnd}T00:00:00`)
            : isCompletedSite && rangeEndKey
              ? new Date(`${rangeEndKey}T00:00:00`)
            : isTentativeSite && explicitEnd
              ? new Date(`${explicitEnd}T00:00:00`)
            : new Date(todayKey);
        const rangeEnd = rangeEndKey
            ? new Date(`${rangeEndKey}T00:00:00`)
            : isTentativeSite && explicitStart
              ? new Date(`${explicitStart}T00:00:00`)
            : explicitStart
              ? monthEnd
              : new Date(rangeStart);

        const normalizedStart = rangeStart < monthStart ? monthStart : rangeStart;
        const normalizedEnd = rangeEnd > monthEnd ? monthEnd : rangeEnd;

        if (normalizedStart > normalizedEnd) {
            return [];
        }

        return toDateRange(normalizedStart, normalizedEnd)
            .filter((date) => {
                if (scheduleMode !== 'weekdays' || workingWeekdays.length === 0) {
                    return true;
                }
                return workingWeekdays.includes(new Date(`${date}T00:00:00`).getDay());
            })
            .filter((date) => !assignmentKeys.has(`${date}:${site.id}`))
            .map<Assignment>((date) => {
                const clientColor = getSiteClientColorOption(site);
                return {
                    id: `site:${site.id}:${date}`,
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    client_name: site.client?.name,
                    client_color: clientColor?.bar ?? null,
                    client_color_text: clientColor?.text ?? null,
                    date,
                    status: siteAssignmentStatus,
                    source: 'site',
                    worker_count: Array.isArray(site.assigned_users) ? site.assigned_users.length : 0,
                };
            });
    });
}

function attachClientColorsToSites(sites: Site[], clients: Client[]): Site[] {
    const clientById = new Map(clients.map((client) => [client.id, client]));

    return sites.map((site) => {
        const clientId = site.client?.id || site.client_id;
        const client = clientId ? clientById.get(clientId) : undefined;
        if (!client) {
            return site;
        }

        const clientColor = getClientColorOption(client);

        return {
            ...site,
            client: {
                ...site.client,
                id: site.client?.id || client.id,
                name: site.client?.name || client.name,
                calendar_color_token:
                    client.calendar_color_token || getStableClientColorToken(client.id || client.name),
                calendar_color: clientColor.bar,
            },
        };
    });
}

function buildAssignmentIndex(assignments: Assignment[]): Record<string, Assignment[]> {
    const byDate: Record<string, Assignment[]> = {};

    for (const assignment of assignments) {
        if (!byDate[assignment.date]) {
            byDate[assignment.date] = [];
        }
        byDate[assignment.date].push(assignment);
    }

    Object.values(byDate).forEach((dateAssignments) => {
        dateAssignments.sort((a, b) => {
            const aTime = a.start_time || '99:99';
            const bTime = b.start_time || '99:99';
            if (aTime !== bTime) {
                return aTime.localeCompare(bTime);
            }
            return a.site_name.localeCompare(b.site_name);
        });
    });

    return byDate;
}

async function fetchCalendarProposals(): Promise<ProposalRecord[]> {
    const responses = await Promise.all(
        CALENDAR_PROPOSAL_TYPES.flatMap((type) =>
            CALENDAR_PROPOSAL_STATUSES.map((status) =>
                fetchProposals({
                    type,
                    status,
                    limit: MAX_SCHEDULE_PROPOSALS,
                })
            )
        )
    );

    const merged = new Map<string, ProposalRecord>();
    for (const proposal of responses.flat()) {
        merged.set(proposal.id, proposal);
    }

    return Array.from(merged.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

async function fetchLeaveRequestProposals(): Promise<ProposalRecord[]> {
    const responses = await Promise.all(
        LEAVE_PROPOSAL_STATUSES.map((status) =>
            fetchProposals({
                type: 'leave.request',
                status,
                limit: MAX_SCHEDULE_PROPOSALS,
            })
        )
    );

    const merged = new Map<string, ProposalRecord>();
    for (const proposal of responses.flat()) {
        merged.set(proposal.id, proposal);
    }

    return Array.from(merged.values()).sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function generateCalendarDays(
    year: number,
    month: number,
    assignmentsByDate: Record<string, Assignment[]>,
    schedulesByDate: Record<string, CalendarPersonalSchedule[]>
): CalendarDay[] {
    const days: CalendarDay[] = [];
    const firstDay = new Date(year, month - 1, 1);

    const startDate = new Date(firstDay);
    const weekday = (startDate.getDay() + 6) % 7; // Monday=0
    startDate.setDate(startDate.getDate() - weekday);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 41);

    const currentDate = new Date(startDate);
    const todayStr = toDateKey(new Date());

    while (currentDate <= endDate) {
        const dateStr = toDateKey(currentDate);
        const isCurrentMonth = currentDate.getMonth() === month - 1;
        const dayOfWeek = currentDate.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        const shift: Shift = {
            id: `shift-${dateStr}`,
            user_id: 'user-1',
            date: dateStr,
            available: !isWeekend,
            note: isWeekend ? '定休日' : undefined,
        };

        days.push({
            date: dateStr,
            day: currentDate.getDate(),
            shift,
            assignments: assignmentsByDate[dateStr] || [],
            personal_schedules: schedulesByDate[dateStr] || [],
            isToday: dateStr === todayStr,
            isCurrentMonth,
            isWeekend,
        });

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return days;
}

function getCalendarVisibleRange(year: number, month: number): { from: string; to: string } {
    const firstDay = new Date(year, month - 1, 1);
    const startDate = new Date(firstDay);
    const weekday = (startDate.getDay() + 6) % 7;
    startDate.setDate(startDate.getDate() - weekday);

    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 41);

    return {
        from: toDateKey(startDate),
        to: toDateKey(endDate),
    };
}

function getCalendarYearRange(year: number): { from: string; to: string } {
    return {
        from: `${year}-01-01`,
        to: `${year}-12-31`,
    };
}

function buildPersonalScheduleIndex(
    schedules: CalendarPersonalSchedule[]
): Record<string, CalendarPersonalSchedule[]> {
    const byDate: Record<string, CalendarPersonalSchedule[]> = {};

    for (const schedule of schedules) {
        const start = new Date(`${schedule.start_date}T00:00:00`);
        const end = new Date(`${schedule.end_date}T00:00:00`);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
            continue;
        }

        for (const date of toDateRange(start, end)) {
            if (!byDate[date]) {
                byDate[date] = [];
            }
            byDate[date].push(schedule);
        }
    }

    return byDate;
}

function mergePersonalSchedules(
    persisted: CalendarPersonalSchedule[],
    proposalBacked: CalendarPersonalSchedule[]
): CalendarPersonalSchedule[] {
    const merged = new Map<string, CalendarPersonalSchedule>();

    persisted.forEach((schedule) => {
        merged.set(
            schedule.id ||
                `${schedule.user_id}:${schedule.start_date}:${schedule.end_date}:${schedule.type}:${schedule.title}:${schedule.start_time || ''}:${schedule.end_time || ''}`,
            schedule
        );
    });

    proposalBacked.forEach((schedule) => {
        const key =
            schedule.id ||
            `${schedule.user_id}:${schedule.start_date}:${schedule.end_date}:${schedule.type}:${schedule.title}:${schedule.start_time || ''}:${schedule.end_time || ''}`;
        if (!merged.has(key)) {
            merged.set(key, schedule);
        }
    });

    return Array.from(merged.values());
}

function countRestDaysByUser(
    schedules: CalendarPersonalSchedule[],
    range: { from: string; to: string }
): Record<string, number> {
    const restDayKeysByUser = new Map<string, Set<string>>();
    const rangeStart = new Date(`${range.from}T00:00:00`);
    const rangeEnd = new Date(`${range.to}T00:00:00`);

    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime())) {
        return {};
    }

    schedules.forEach((schedule) => {
        if (!schedule.blocks_assignment) {
            return;
        }
        const scheduleStart = new Date(`${schedule.start_date}T00:00:00`);
        const scheduleEnd = new Date(`${schedule.end_date}T00:00:00`);

        if (
            Number.isNaN(scheduleStart.getTime()) ||
            Number.isNaN(scheduleEnd.getTime()) ||
            scheduleStart > scheduleEnd
        ) {
            return;
        }

        const start = scheduleStart < rangeStart ? rangeStart : scheduleStart;
        const end = scheduleEnd > rangeEnd ? rangeEnd : scheduleEnd;

        if (start > end) {
            return;
        }

        const restDayKeys = restDayKeysByUser.get(schedule.user_id) ?? new Set<string>();
        toDateRange(start, end).forEach((date) => restDayKeys.add(date));
        restDayKeysByUser.set(schedule.user_id, restDayKeys);
    });

    return Array.from(restDayKeysByUser.entries()).reduce<Record<string, number>>(
        (summary, [userId, dates]) => ({
            ...summary,
            [userId]: dates.size,
        }),
        {}
    );
}

export const useCalendar = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
    const [proposalAssignments, setProposalAssignments] = useState<Assignment[]>([]);
    const [personalSchedules, setPersonalSchedules] = useState<CalendarPersonalSchedule[]>([]);
    const [annualRestDaysByUser, setAnnualRestDaysByUser] = useState<Record<string, number>>({});
    const [sites, setSites] = useState<Site[]>([]);
    const [reloadVersion, setReloadVersion] = useState(0);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    const reloadAssignments = useCallback(() => {
        setReloadVersion((current) => current + 1);
    }, []);

    useEffect(() => {
        let active = true;

        const loadAssignments = async () => {
            try {
                const visibleRange = getCalendarVisibleRange(year, month);
                const yearRange = getCalendarYearRange(year);
                const [
                    proposals,
                    leaveProposals,
                    organizationScheduleRows,
                    personalScheduleRows,
                    annualOrganizationScheduleRows,
                    annualPersonalScheduleRows,
                    sitesData,
                    clientsData,
                ] = await Promise.all([
                    fetchCalendarProposals(),
                    fetchLeaveRequestProposals(),
                    fetchPersonalSchedules({
                        from: visibleRange.from,
                        to: visibleRange.to,
                        scope: 'organization',
                    }),
                    fetchPersonalSchedules({
                        from: visibleRange.from,
                        to: visibleRange.to,
                        scope: 'personal',
                    }),
                    fetchPersonalSchedules({
                        from: yearRange.from,
                        to: yearRange.to,
                        scope: 'organization',
                    }),
                    fetchPersonalSchedules({
                        from: yearRange.from,
                        to: yearRange.to,
                        scope: 'personal',
                    }),
                    fetchSites(),
                    fetchClients(),
                ]);
                const assignments = proposals
                    .map((proposal) => toAssignment(proposal))
                    .filter((assignment): assignment is Assignment => assignment !== null);
                const leaveSchedules = leaveProposals
                    .map((proposal) => toPersonalScheduleFromProposal(proposal))
                    .filter((schedule): schedule is CalendarPersonalSchedule => schedule !== null);
                const schedules = mergePersonalSchedules(
                    [
                        ...organizationScheduleRows.map(toPersonalScheduleFromRow),
                        ...personalScheduleRows.map(toPersonalScheduleFromRow),
                    ],
                    leaveSchedules
                );
                const annualSchedules = mergePersonalSchedules(
                    [
                        ...annualOrganizationScheduleRows.map(toPersonalScheduleFromRow),
                        ...annualPersonalScheduleRows.map(toPersonalScheduleFromRow),
                    ],
                    leaveSchedules
                );

                if (!active) {
                    return;
                }
                setProposalAssignments(assignments);
                setPersonalSchedules(schedules);
                setAnnualRestDaysByUser(countRestDaysByUser(annualSchedules, yearRange));
                setSites(attachClientColorsToSites(sitesData, clientsData));
            } catch (error) {
                console.error('Failed to load calendar assignments:', error);
                if (active) {
                    setProposalAssignments([]);
                    setPersonalSchedules([]);
                    setAnnualRestDaysByUser({});
                    setSites([]);
                }
            }
        };

        void loadAssignments();

        return () => {
            active = false;
        };
    }, [month, reloadVersion, year]);

    const assignmentsByDate = useMemo(() => {
        const monthStart = new Date(year, month - 1, 1);
        const monthEnd = new Date(year, month, 0);
        const todayKey = toDateKey(new Date());
        const projectedSiteAssignments = projectSitesToAssignments(
            sites,
            proposalAssignments,
            monthStart,
            monthEnd,
            todayKey
        );

        const enriched = enrichAssignmentsWithSiteData(
            [...proposalAssignments, ...projectedSiteAssignments],
            sites
        );
        return buildAssignmentIndex(enriched);
    }, [month, proposalAssignments, sites, year]);

    const calendarDays = useMemo(
        () =>
            generateCalendarDays(
                year,
                month,
                assignmentsByDate,
                buildPersonalScheduleIndex(personalSchedules)
            ),
        [year, month, assignmentsByDate, personalSchedules]
    );

    const selectedDate = useMemo(() => {
        if (calendarDays.length === 0) {
            return null;
        }

        if (selectedDateKey) {
            const matched = calendarDays.find((day) => day.date === selectedDateKey);
            if (matched) {
                return matched;
            }
        }

        return (
            calendarDays.find((day) => day.isToday) ||
            calendarDays.find((day) => day.isCurrentMonth) ||
            calendarDays[0]
        );
    }, [calendarDays, selectedDateKey]);

    const nextMonth = useCallback(() => {
        setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    }, []);

    const prevMonth = useCallback(() => {
        setCurrentDate((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    }, []);

    const goToMonth = useCallback((nextYear: number, nextMonth: number) => {
        setCurrentDate(new Date(nextYear, nextMonth - 1, 1));
        setSelectedDateKey(null);
    }, []);

    const goToToday = useCallback(() => {
        const now = new Date();
        setCurrentDate(now);
        setSelectedDateKey(toDateKey(now));
    }, []);

    const selectDate = useCallback((date: CalendarDay) => {
        setSelectedDateKey(date.date);
    }, []);

    return {
        currentDate,
        year,
        month,
        calendarDays,
        annualRestDaysByUser,
        selectedDate,
        sites,
        nextMonth,
        prevMonth,
        goToMonth,
        goToToday,
        selectDate,
        reloadAssignments,
    };
};
