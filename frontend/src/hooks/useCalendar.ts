import { useState, useMemo, useCallback, useEffect } from 'react';
import type { CalendarDay, Assignment, AssignmentStatus, Shift } from '../types/calendar';
import {
    fetchSites,
    fetchProposals,
    type ProposalRecord,
    type ProposalStatus,
    type Site,
} from '../lib/api';
import { normalizeDateList, normalizeSiteScheduleMode, normalizeWeekdays } from '../lib/siteSchedule';

const MAX_SCHEDULE_PROPOSALS = 200;
const CALENDAR_PROPOSAL_TYPES = ['assignment.create', 'assignment.update'] as const;
const CALENDAR_PROPOSAL_STATUSES: ProposalStatus[] = ['approved', 'executed'];

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
        if (assignment.client_name) {
            return assignment;
        }
        const site = assignment.site_id
            ? siteById.get(assignment.site_id)
            : assignment.site_name
                ? siteByName.get(assignment.site_name)
                : undefined;
        const clientName = site?.client?.name;
        return clientName ? { ...assignment, client_name: clientName } : assignment;
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
        if (!['active', 'in_progress'].includes(site.status)) {
            return [];
        }

        const scheduleMode = normalizeSiteScheduleMode(site.schedule_mode);
        const workingWeekdays = normalizeWeekdays(site.working_weekdays);
        const customWorkDates = normalizeDateList(site.custom_work_dates);

        if (scheduleMode === 'custom') {
            return customWorkDates
                .filter((date) => date >= toDateKey(monthStart) && date <= toDateKey(monthEnd))
                .filter((date) => !assignmentKeys.has(`${date}:${site.id}`))
                .map<Assignment>((date) => ({
                    id: `site:${site.id}:${date}`,
                    user_id: 'site',
                    site_id: site.id,
                    site_name: site.name,
                    client_name: site.client?.name,
                    date,
                    status: 'scheduled',
                    source: 'site',
                    worker_count: Array.isArray(site.assigned_users) ? site.assigned_users.length : 0,
                }));
        }

        const explicitStart = toDateKeyFromUnknown(site.started_at);
        const explicitEnd = toDateKeyFromUnknown(site.expected_completion_at);

        const rangeStart = explicitStart
            ? new Date(explicitStart)
            : new Date(todayKey);
        const rangeEnd = explicitEnd
            ? new Date(explicitEnd)
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
            .map<Assignment>((date) => ({
                id: `site:${site.id}:${date}`,
                user_id: 'site',
                site_id: site.id,
                site_name: site.name,
                client_name: site.client?.name,
                date,
                status: 'scheduled',
                source: 'site',
                worker_count: Array.isArray(site.assigned_users) ? site.assigned_users.length : 0,
            }));
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

function generateCalendarDays(
    year: number,
    month: number,
    assignmentsByDate: Record<string, Assignment[]>
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
            isToday: dateStr === todayStr,
            isCurrentMonth,
            isWeekend,
        });

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return days;
}

export const useCalendar = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null);
    const [proposalAssignments, setProposalAssignments] = useState<Assignment[]>([]);
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
                const [proposals, sitesData] = await Promise.all([
                    fetchCalendarProposals(),
                    fetchSites(),
                ]);
                const assignments = proposals
                    .map((proposal) => toAssignment(proposal))
                    .filter((assignment): assignment is Assignment => assignment !== null);

                if (!active) {
                    return;
                }
                setProposalAssignments(assignments);
                setSites(sitesData);
            } catch (error) {
                console.error('Failed to load calendar assignments:', error);
                if (active) {
                    setProposalAssignments([]);
                    setSites([]);
                }
            }
        };

        void loadAssignments();

        return () => {
            active = false;
        };
    }, [reloadVersion]);

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
        () => generateCalendarDays(year, month, assignmentsByDate),
        [year, month, assignmentsByDate]
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
        selectedDate,
        nextMonth,
        prevMonth,
        goToToday,
        selectDate,
        reloadAssignments,
    };
};
