import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ChevronDown,
    Plus,
    UserRound,
    Users,
} from 'lucide-react';
import { FloatingActionButton } from '../components/FloatingActionButton';
import { useCalendar } from '../hooks/useCalendar';
import { MonthCalendar } from '../components/calendar/MonthCalendar';
import { DayScheduleBoard } from '../components/calendar/DayScheduleBoard';
import { CalendarScheduleModal } from '../components/calendar/CalendarScheduleModal';
import {
    deletePersonalSchedule,
    fetchMembers,
    fetchOrgContext,
    fetchSiteLineItems,
    rejectProposal,
    submitLeaveRequestProposal,
    updateSiteAssignedUsers,
    type Member,
    type SiteLineItem,
} from '../lib/api';
import { buildDayScheduleBoard } from '../lib/dayScheduleBoard';
import { supabase } from '../lib/supabase';
import type { CalendarScope } from '../types/calendarCockpit';
import type {
    AvailabilityTokenKind,
    CalendarDay,
    CalendarPersonalSchedule,
} from '../types/calendar';
import styles from './Calendar.module.css';

type CalendarAddMode = 'menu' | 'personal';
type CalendarViewMode = 'month' | 'year';

const ANNUAL_REST_TARGET_DAYS = 120;
const MONTH_OPTIONS = Array.from({ length: 12 }, (_, index) => index + 1);

function filterDayAssignments(day: CalendarDay, userId: string | null): CalendarDay {
    if (!userId) {
        return {
            ...day,
            assignments: [],
            personal_schedules: [],
        };
    }

    return {
        ...day,
        assignments: day.assignments.filter((assignment) => assignment.user_id === userId),
        personal_schedules: day.personal_schedules.filter((schedule) => schedule.user_id === userId),
        shift: {
            ...day.shift,
            id: day.shift?.id ?? `shift-${day.date}`,
            user_id: userId,
            date: day.date,
            available:
                day.shift?.available === false
                    ? false
                    : !day.personal_schedules.some(
                          (schedule) =>
                              schedule.user_id === userId &&
                              schedule.approved &&
                              schedule.blocks_assignment
                      ),
            note:
                day.shift?.note ||
                day.personal_schedules.find(
                    (schedule) =>
                        schedule.user_id === userId &&
                        schedule.approved &&
                        schedule.blocks_assignment
                )?.title ||
                undefined,
        },
    };
}

function buildScopeDays(days: CalendarDay[], scope: CalendarScope, userId: string | null) {
    if (scope === 'organization') {
        return days.map((day) => ({
            ...day,
            personal_schedules: day.personal_schedules.filter(
                (schedule) => schedule.visibility === 'organization'
            ),
        }));
    }
    return days.map((day) => filterDayAssignments(day, userId));
}

function findScopedSelectedDay(
    days: CalendarDay[],
    selectedDate: CalendarDay | null,
    scope: CalendarScope,
    userId: string | null
) {
    const selected = selectedDate
        ? days.find((day) => day.date === selectedDate.date) ?? null
        : null;

    if (!selected) {
        return null;
    }

    return scope === 'organization'
        ? {
              ...selected,
              personal_schedules: selected.personal_schedules.filter(
                  (schedule) => schedule.visibility === 'organization'
              ),
          }
        : filterDayAssignments(selected, userId);
}

function formatDateLabel(date: string) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
        return date;
    }

    return parsed.toLocaleDateString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
    });
}

function pickSelectedLeaveSchedule(
    selectedDate: CalendarDay | null,
    userId: string | null
): CalendarPersonalSchedule | null {
    if (!selectedDate || !userId) {
        return null;
    }

    return (
        selectedDate.personal_schedules.find(
            (schedule) =>
                schedule.user_id === userId &&
                schedule.status === 'approved' &&
                schedule.blocks_assignment
        ) ||
        selectedDate.personal_schedules.find(
            (schedule) =>
                schedule.user_id === userId &&
                schedule.status === 'pending' &&
                schedule.blocks_assignment
        ) ||
        null
    );
}

interface RestSummaryItem {
    id: string;
    name: string;
    initial: string;
    days: number;
}

function getMemberLabel(member: Member | undefined, fallback: string): string {
    return member?.display_name || member?.full_name || member?.username || fallback;
}

function getInitial(label: string): string {
    return Array.from(label.trim())[0] || '?';
}

function getMemberRestKey(member: Member): string {
    return member.user_id || member.id;
}

function buildRestSummaryItems(
    members: Member[],
    restDaysByUser: Record<string, number>,
    scope: CalendarScope,
    currentUserId: string | null
): RestSummaryItem[] {
    if (scope === 'personal') {
        const currentMember = currentUserId
            ? members.find((member) => member.id === currentUserId || member.user_id === currentUserId)
            : undefined;

        return [
            {
                id: currentUserId ?? 'current-user',
                name: getMemberLabel(currentMember, '自分'),
                initial: getInitial(getMemberLabel(currentMember, '自分')),
                days: currentUserId ? restDaysByUser[currentUserId] ?? 0 : 0,
            },
        ];
    }

    return members
        .filter((member) => member.status !== 'removed' && member.status !== 'suspended')
        .map((member) => {
            const restKey = getMemberRestKey(member);
            const label = getMemberLabel(member, member.id);
            return {
                id: restKey,
                name: label,
                initial: getInitial(label),
                days: restDaysByUser[restKey] ?? restDaysByUser[member.id] ?? 0,
            };
        })
        .sort((a, b) => {
            if (a.days !== b.days) {
                return b.days - a.days;
            }
            return a.name.localeCompare(b.name, 'ja');
        });
}

function countMonthlyRestDaysByUser(days: CalendarDay[]): Record<string, number> {
    const restDayKeysByUser = new Map<string, Set<string>>();

    days.forEach((day) => {
        if (!day.isCurrentMonth) {
            return;
        }

        day.personal_schedules.forEach((schedule) => {
            if (!schedule.blocks_assignment) {
                return;
            }
            const restDayKeys = restDayKeysByUser.get(schedule.user_id) ?? new Set<string>();
            restDayKeys.add(day.date);
            restDayKeysByUser.set(schedule.user_id, restDayKeys);
        });
    });

    return Array.from(restDayKeysByUser.entries()).reduce<Record<string, number>>(
        (summary, [userId, dates]) => ({
            ...summary,
            [userId]: dates.size,
        }),
        {}
    );
}

function YearRestSummary({
    items,
}: {
    items: RestSummaryItem[];
}) {
    return (
        <section className={styles.yearSummaryPanel} aria-labelledby="calendar-year-summary-title">
            <div className={styles.yearSummaryHeader}>
                <div>
                    <p className={styles.yearSummaryEyebrow}>年間</p>
                    <h2 id="calendar-year-summary-title">今年の休み状況</h2>
                </div>
                <span className={styles.yearSummaryTarget}>年間目標: {ANNUAL_REST_TARGET_DAYS}日</span>
            </div>

            {items.length > 0 ? (
                <div className={styles.yearSummaryList}>
                    {items.map((item) => {
                        const progress = Math.min(item.days / ANNUAL_REST_TARGET_DAYS, 1) * 100;
                        return (
                            <div className={styles.yearSummaryRow} key={item.id}>
                                <div className={styles.yearSummaryMember}>
                                    <span className={styles.restSummaryInitial} aria-hidden="true">
                                        {item.initial}
                                    </span>
                                    <span>{item.name}</span>
                                </div>
                                <div className={styles.yearSummaryMeterWrap}>
                                    <span className={styles.yearSummaryValue}>
                                        {item.days} / {ANNUAL_REST_TARGET_DAYS}日
                                    </span>
                                    <div className={styles.yearSummaryMeter} aria-hidden="true">
                                        <span style={{ width: `${progress}%` }} />
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            ) : (
                <p className={styles.yearSummaryEmpty}>休みデータはまだありません。</p>
            )}
        </section>
    );
}

export function Calendar() {
    const {
        year,
        month,
        calendarDays,
        annualRestDaysByUser,
        selectedDate,
        sites,
        goToMonth,
        selectDate,
        reloadAssignments,
    } = useCalendar();

    const [scope, setScope] = useState<CalendarScope>('organization');
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
    const [isAvailabilitySubmitting, setIsAvailabilitySubmitting] = useState(false);
    const [availabilityTokens, setAvailabilityTokens] = useState<
        Partial<Record<string, AvailabilityTokenKind>>
    >({});
    const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
    const [monthPickerOpen, setMonthPickerOpen] = useState(false);
    const [showAddModal, setShowAddModal] = useState(false);
    const [addModalMode, setAddModalMode] = useState<CalendarAddMode>('menu');
    const [lineItemsBySiteId, setLineItemsBySiteId] = useState<Record<string, SiteLineItem[] | undefined>>({});
    const [lineItemLoadStateBySiteId, setLineItemLoadStateBySiteId] = useState<Record<string, 'loading' | 'loaded' | 'error'>>({});
    const [selectedLineItemByDateSite, setSelectedLineItemByDateSite] = useState<Record<string, string | null>>({});
    const [assignedUserOverridesBySiteId, setAssignedUserOverridesBySiteId] = useState<Record<string, string[]>>({});
    const [assignmentToggleBusyKeys, setAssignmentToggleBusyKeys] = useState<string[]>([]);
    const monthPickerRef = useRef<HTMLDivElement>(null);
    const activeYearOptionRef = useRef<HTMLButtonElement | null>(null);
    const activeMonthOptionRef = useRef<HTMLButtonElement | null>(null);
    const selectedScheduleRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let active = true;

        const loadSessionUser = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (!active) {
                return;
            }

            if (session?.user?.id) {
                setCurrentUserId(session.user.id);
                return;
            }

            try {
                const context = await fetchOrgContext();
                if (active) {
                    setCurrentUserId(context.membership.user_id);
                }
            } catch (error) {
                console.error('Failed to load calendar user context:', error);
                if (active) {
                    setCurrentUserId(null);
                }
            }
        };

        void loadSessionUser();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        const loadMembers = async () => {
            try {
                const nextMembers = await fetchMembers();
                if (active) {
                    setMembers(nextMembers);
                }
            } catch (error) {
                console.error('Failed to load calendar members:', error);
                if (active) {
                    setMembers([]);
                }
            }
        };

        void loadMembers();

        return () => {
            active = false;
        };
    }, []);

    const handleCommitted = async () => {
        await reloadAssignments();
    };

    const handleSelectDate = (day: CalendarDay) => {
        const originalDay = calendarDays.find((candidate) => candidate.date === day.date) ?? day;
        selectDate(originalDay);
    };

    const handleOpenAddMenu = (day?: CalendarDay, mode: CalendarAddMode = 'menu') => {
        if (day) {
            const originalDay = calendarDays.find((candidate) => candidate.date === day.date) ?? day;
            selectDate(originalDay);
        }
        setAddModalMode(scope === 'personal' ? 'personal' : mode);
        setShowAddModal(true);
    };

    const handleInspectDate = (day: CalendarDay) => {
        const originalDay = calendarDays.find((candidate) => candidate.date === day.date) ?? day;
        selectDate(originalDay);
        setShowAddModal(false);

        window.requestAnimationFrame(() => {
            selectedScheduleRef.current?.scrollIntoView?.({
                behavior: 'smooth',
                block: 'start',
            });
            selectedScheduleRef.current?.focus?.({ preventScroll: true });
        });
    };

    const visibleDays = useMemo(
        () => buildScopeDays(calendarDays, scope, currentUserId),
        [calendarDays, currentUserId, scope]
    );

    const visibleSelectedDate = useMemo(
        () => findScopedSelectedDay(calendarDays, selectedDate, scope, currentUserId),
        [calendarDays, currentUserId, scope, selectedDate]
    );

    const monthlyRestDaysByUser = useMemo(
        () => countMonthlyRestDaysByUser(visibleDays),
        [visibleDays]
    );

    const monthlyRestSummaryItems = useMemo(
        () =>
            buildRestSummaryItems(
                members,
                monthlyRestDaysByUser,
                scope,
                currentUserId
            ),
        [currentUserId, members, monthlyRestDaysByUser, scope]
    );

    const annualRestSummaryItems = useMemo(
        () =>
            buildRestSummaryItems(
                members,
                annualRestDaysByUser,
                scope,
                currentUserId
            ),
        [annualRestDaysByUser, currentUserId, members, scope]
    );

    const restInitialByUserId = useMemo(() => {
        const initials = members.reduce<Record<string, string>>((summary, member) => {
            const label = getMemberLabel(member, member.id);
            summary[member.id] = getInitial(label);
            if (member.user_id) {
                summary[member.user_id] = getInitial(label);
            }
            return summary;
        }, {});

        monthlyRestSummaryItems.forEach((item) => {
            initials[item.id] = item.initial;
        });

        return initials;
    }, [members, monthlyRestSummaryItems]);

    const visibleSites = useMemo(
        () =>
            sites.map((site) => {
                const overrideAssignedUsers = assignedUserOverridesBySiteId[site.id];
                return overrideAssignedUsers
                    ? {
                          ...site,
                          assigned_users: overrideAssignedUsers,
                      }
                    : site;
            }),
        [assignedUserOverridesBySiteId, sites]
    );

    const shortageSiteCountByDate = useMemo(() => {
        if (scope !== 'organization') {
            return {};
        }

        return visibleDays.reduce<Record<string, number>>((summary, day) => {
            if (!day.isCurrentMonth) {
                return summary;
            }

            const board = buildDayScheduleBoard({ day, sites: visibleSites, members, drafts: [] });
            if (board.shortage_site_count > 0) {
                summary[day.date] = board.shortage_site_count;
            }
            return summary;
        }, {});
    }, [members, scope, visibleDays, visibleSites]);

    const selectedDayBoard = useMemo(
        () =>
            scope === 'organization' && visibleSelectedDate
                ? buildDayScheduleBoard({
                      day: visibleSelectedDate,
                      sites: visibleSites,
                      members,
                      drafts: [],
                  })
                : null,
        [members, scope, visibleSelectedDate, visibleSites]
    );

    useEffect(() => {
        if (!selectedDayBoard) {
            return;
        }

        selectedDayBoard.sites.forEach((site) => {
            if (lineItemLoadStateBySiteId[site.site_id]) {
                return;
            }

            setLineItemLoadStateBySiteId((current) => ({
                ...current,
                [site.site_id]: 'loading',
            }));

            void fetchSiteLineItems(site.site_id)
                .then((items) => {
                    setLineItemsBySiteId((current) => ({
                        ...current,
                        [site.site_id]: items,
                    }));
                    setLineItemLoadStateBySiteId((current) => ({
                        ...current,
                        [site.site_id]: 'loaded',
                    }));
                })
                .catch((error) => {
                    console.error('Failed to load site line items:', error);
                    setLineItemsBySiteId((current) => ({
                        ...current,
                        [site.site_id]: [],
                    }));
                    setLineItemLoadStateBySiteId((current) => ({
                        ...current,
                        [site.site_id]: 'error',
                    }));
                });
        });
    }, [lineItemLoadStateBySiteId, selectedDayBoard]);

    const handleSelectLineItem = (date: string, siteId: string, lineItemId: string | null) => {
        setSelectedLineItemByDateSite((current) => ({
            ...current,
            [`${date}:${siteId}`]: lineItemId,
        }));
    };

    const selectedLeaveSchedule = pickSelectedLeaveSchedule(visibleSelectedDate, currentUserId);
    const selectedAvailabilityToken = selectedLeaveSchedule
        ? 'leave_request'
        : visibleSelectedDate
          ? availabilityTokens[visibleSelectedDate.date] ?? null
          : null;

    const monthLabel = `${year}/${String(month).padStart(2, '0')}`;
    const yearOptions = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const start = Math.min(currentYear, year) - 3;
        const end = Math.max(currentYear, year) + 3;
        return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }, [year]);
    const modalInitialDate =
        visibleSelectedDate?.date ??
        selectedDate?.date ??
        `${year}-${String(month).padStart(2, '0')}-01`;

    useEffect(() => {
        if (!monthPickerOpen) {
            return undefined;
        }

        const handlePointerDown = (event: PointerEvent) => {
            if (
                monthPickerRef.current &&
                event.target instanceof Node &&
                !monthPickerRef.current.contains(event.target)
            ) {
                setMonthPickerOpen(false);
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMonthPickerOpen(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [monthPickerOpen]);

    useEffect(() => {
        if (viewMode !== 'month') {
            setMonthPickerOpen(false);
        }
    }, [viewMode]);

    useEffect(() => {
        if (!monthPickerOpen) {
            return;
        }

        const prefersReducedMotion =
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.requestAnimationFrame(() => {
            activeYearOptionRef.current?.scrollIntoView({
                block: 'center',
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
            });
            activeMonthOptionRef.current?.scrollIntoView({
                block: 'center',
                behavior: prefersReducedMotion ? 'auto' : 'smooth',
            });
        });
    }, [monthPickerOpen, month, year]);

    const setAvailabilityToken = (kind: AvailabilityTokenKind) => {
        if (!visibleSelectedDate) {
            return;
        }

        setAvailabilityTokens((current) => {
            if (current[visibleSelectedDate.date] === kind) {
                const next = { ...current };
                delete next[visibleSelectedDate.date];
                return next;
            }
            return {
                ...current,
                [visibleSelectedDate.date]: kind,
            };
        });
    };

    const submitLeaveRequest = async () => {
        if (!visibleSelectedDate || isAvailabilitySubmitting) {
            return;
        }

        setIsAvailabilitySubmitting(true);
        setAvailabilityMessage(null);

        try {
            const result = await submitLeaveRequestProposal({
                user_id: currentUserId ?? undefined,
                date: visibleSelectedDate.date,
            });
            await reloadAssignments();
            setAvailabilityTokens((current) => {
                const next = { ...current };
                delete next[visibleSelectedDate.date];
                return next;
            });
            setAvailabilityMessage(
                result.auto_executed
                    ? '休みを入れました。'
                    : '休みを入れました。組織カレンダーでは勤務より休みを優先します。'
            );
        } catch (error) {
            console.error('Failed to submit leave request:', error);
            setAvailabilityMessage('休みを入れられませんでした。もう一度お試しください。');
        } finally {
            setIsAvailabilitySubmitting(false);
        }
    };

    const clearAvailabilityToken = async () => {
        if (!visibleSelectedDate) {
            return;
        }

        if (isAvailabilitySubmitting) {
            return;
        }

        if (selectedLeaveSchedule) {
            setIsAvailabilitySubmitting(true);
            setAvailabilityMessage(null);

            try {
                if (selectedLeaveSchedule.source === 'personal_schedule') {
                    await deletePersonalSchedule(selectedLeaveSchedule.id);
                } else if (selectedLeaveSchedule.status === 'pending') {
                    await rejectProposal(selectedLeaveSchedule.id, '休みを解除');
                } else {
                    throw new Error('Approved leave proposal cannot be cleared before execution');
                }

                await reloadAssignments();
                setAvailabilityMessage('休みを解除しました。');
            } catch (error) {
                console.error('Failed to clear leave request:', error);
                setAvailabilityMessage('休みを解除できませんでした。もう一度お試しください。');
            } finally {
                setIsAvailabilitySubmitting(false);
            }
            return;
        }

        setAvailabilityTokens((current) => {
            if (!current[visibleSelectedDate.date]) {
                return current;
            }

            const next = { ...current };
            delete next[visibleSelectedDate.date];
            return next;
        });
    };

    const handleToggleAssignment = async ({
        date,
        site,
        member,
        selected,
    }: {
        date: string;
        site: { site_id: string; site_name: string };
        member: Member;
        selected: boolean;
        workLabel: string | null;
    }) => {
        const busyKey = `${date}:${site.site_id}:${member.id}`;
        const targetSite = visibleSites.find((item) => item.id === site.site_id);
        if (!targetSite) {
            return { ok: false, message: '現場を確認できませんでした。' };
        }

        const previousAssignedUsers = Array.from(new Set(targetSite.assigned_users ?? []));
        const nextAssignedUsers = selected
            ? previousAssignedUsers.filter((userId) => userId !== member.id)
            : Array.from(new Set([...previousAssignedUsers, member.id]));

        setAssignmentToggleBusyKeys((current) =>
            current.includes(busyKey) ? current : [...current, busyKey]
        );
        setAssignedUserOverridesBySiteId((current) => ({
            ...current,
            [site.site_id]: nextAssignedUsers,
        }));

        try {
            await updateSiteAssignedUsers(site.site_id, nextAssignedUsers);
            await reloadAssignments();
            return { ok: true };
        } catch (error) {
            console.error('Failed to toggle site assignment:', error);
            setAssignedUserOverridesBySiteId((current) => ({
                ...current,
                [site.site_id]: previousAssignedUsers,
            }));
            return { ok: false, message: '担当を変えられませんでした。もう一度お試しください。' };
        } finally {
            setAssignmentToggleBusyKeys((current) => current.filter((key) => key !== busyKey));
        }
    };

    return (
        <div className={styles.container}>
            <section className={styles.mainPanel}>
                <div className={styles.sectionHeader}>
                    <div className={styles.headerTools}>
                        <div className={styles.navGroup} ref={monthPickerRef}>
                            {viewMode === 'month' ? (
                                <>
                                    <button
                                        type="button"
                                        className={`${styles.monthNavLabel} ${styles.monthNavTrigger}`}
                                        onClick={() => setMonthPickerOpen((open) => !open)}
                                        aria-expanded={monthPickerOpen}
                                        aria-haspopup="dialog"
                                        aria-label={`${monthLabel} の月選択を${
                                            monthPickerOpen ? '閉じる' : '開く'
                                        }`}
                                    >
                                        <span>{monthLabel}</span>
                                        <ChevronDown
                                            size={16}
                                            className={styles.monthNavChevron}
                                            aria-hidden="true"
                                        />
                                    </button>
                                    <AnimatePresence>
                                        {monthPickerOpen && (
                                            <motion.div
                                                className={styles.monthPickerPanel}
                                                role="dialog"
                                                aria-label="表示月を選択"
                                                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                                                transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                                            >
                                                <div className={styles.monthPickerColumns}>
                                                    <div
                                                        className={styles.monthPickerColumn}
                                                        aria-label="年を選択"
                                                    >
                                                        {yearOptions.map((option) => (
                                                            <button
                                                                type="button"
                                                                key={option}
                                                                className={`${styles.monthPickerOption} ${
                                                                    option === year
                                                                        ? styles.monthPickerOptionActive
                                                                        : ''
                                                                }`}
                                                                ref={
                                                                    option === year
                                                                        ? activeYearOptionRef
                                                                        : undefined
                                                                }
                                                                onClick={() => goToMonth(option, month)}
                                                                aria-pressed={option === year}
                                                            >
                                                                {option}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div
                                                        className={styles.monthPickerDivider}
                                                        aria-hidden="true"
                                                    />
                                                    <div
                                                        className={styles.monthPickerColumn}
                                                        aria-label="月を選択"
                                                    >
                                                        {MONTH_OPTIONS.map((option) => (
                                                            <button
                                                                type="button"
                                                                key={option}
                                                                className={`${styles.monthPickerOption} ${
                                                                    option === month
                                                                        ? styles.monthPickerOptionActive
                                                                        : ''
                                                                }`}
                                                                ref={
                                                                    option === month
                                                                        ? activeMonthOptionRef
                                                                        : undefined
                                                                }
                                                                onClick={() => goToMonth(year, option)}
                                                                aria-pressed={option === month}
                                                            >
                                                                {String(option).padStart(2, '0')}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            ) : (
                                <span className={styles.monthNavLabel} aria-live="polite">
                                    {year}年
                                </span>
                            )}
                        </div>
                        <div className={styles.calendarControlsRow}>
                            <div
                                className={`${styles.segment} ${styles.calendarModeSegment}`}
                                role="group"
                                aria-label="表示対象と期間"
                            >
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${scope === 'organization' ? styles.scopeActive : ''}`}
                                    onClick={() => setScope('organization')}
                                    aria-pressed={scope === 'organization'}
                                >
                                    <Users size={14} />
                                    全体
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${scope === 'personal' ? styles.scopeActive : ''}`}
                                    onClick={() => setScope('personal')}
                                    aria-pressed={scope === 'personal'}
                                >
                                    <UserRound size={14} />
                                    自分
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${styles.modeBoundary} ${viewMode === 'month' ? styles.viewActive : ''}`}
                                    onClick={() => setViewMode('month')}
                                    aria-pressed={viewMode === 'month'}
                                >
                                    今月
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${viewMode === 'year' ? styles.viewActive : ''}`}
                                    onClick={() => setViewMode('year')}
                                    aria-pressed={viewMode === 'year'}
                                >
                                    今年
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                {viewMode === 'month' && (
                    <div
                        className={styles.restSummaryBar}
                        aria-label={`${month}月の休み数`}
                    >
                        <div className={styles.restSummaryHeader}>
                            <img
                                src="/yasumi-icon.png"
                                alt=""
                                aria-hidden="true"
                                className={styles.restSummaryIcon}
                            />
                        </div>
                        <div className={styles.restSummaryList}>
                            {monthlyRestSummaryItems.map((item) => (
                                <div
                                    className={styles.restSummaryItem}
                                    key={item.id}
                                    aria-label={`${item.name} ${item.days}日`}
                                    title={item.name}
                                >
                                    <span className={styles.restSummaryInitial} aria-hidden="true">
                                        {item.initial}
                                    </span>
                                    <span className={styles.restSummaryCount}>
                                        <strong>{item.days}</strong>
                                        <small>日</small>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {viewMode === 'month' && scope === 'personal' && visibleSelectedDate && (
                    <section
                        className={styles.personalAvailabilityPanel}
                        ref={selectedScheduleRef}
                        tabIndex={-1}
                    >
                        <div className={styles.personalAvailabilityHeader}>
                            <div>
                                <h3>空き・休み</h3>
                                <p>{formatDateLabel(visibleSelectedDate.date)}</p>
                            </div>
                            {selectedAvailabilityToken && (
                                <span className={styles.availabilityCurrent}>
                                    {selectedAvailabilityToken === 'leave_request'
                                        ? '休み'
                                        : '空きあり'}
                                </span>
                            )}
                        </div>

                        <div className={styles.availabilityTokenRow}>
                            <button
                                type="button"
                                className={`${styles.availabilityTokenButton} ${
                                    selectedAvailabilityToken === 'leave_request'
                                        ? styles.availabilityTokenLeaveActive
                                        : ''
                                }`}
                                onClick={() => void submitLeaveRequest()}
                                disabled={
                                    isAvailabilitySubmitting ||
                                    selectedLeaveSchedule !== null
                                }
                            >
                                {isAvailabilitySubmitting ? '送信中' : '休み'}
                            </button>
                            <button
                                type="button"
                                className={`${styles.availabilityTokenButton} ${
                                    selectedAvailabilityToken === 'available'
                                        ? styles.availabilityTokenAvailableActive
                                        : ''
                                }`}
                                onClick={() => setAvailabilityToken('available')}
                            >
                                空きあり
                            </button>
                            <button
                                type="button"
                                className={styles.availabilityTokenButton}
                                onClick={() => void clearAvailabilityToken()}
                                disabled={isAvailabilitySubmitting}
                            >
                                {isAvailabilitySubmitting && selectedLeaveSchedule ? '解除中' : '解除'}
                            </button>
                        </div>

                        {availabilityMessage && (
                            <p className={styles.availabilityMessage}>{availabilityMessage}</p>
                        )}
                    </section>
                )}

                <motion.div
                    key={`${scope}-${viewMode}`}
                    className={styles.canvasBlock}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    {viewMode === 'month' ? (
                        <MonthCalendar
                            days={visibleDays}
                            onSelectDate={handleSelectDate}
                            onInspectDate={handleInspectDate}
                            selectedDate={visibleSelectedDate}
                            availabilityTokens={scope === 'personal' ? availabilityTokens : undefined}
                            restInitialByUserId={restInitialByUserId}
                            shortageSiteCountByDate={
                                scope === 'organization' ? shortageSiteCountByDate : undefined
                            }
                        />
                    ) : (
                        <YearRestSummary items={annualRestSummaryItems} />
                    )}
                </motion.div>

                {viewMode === 'month' && scope === 'organization' && selectedDayBoard && (
                    <div ref={selectedScheduleRef} tabIndex={-1}>
                        <DayScheduleBoard
                            board={selectedDayBoard}
                            members={members}
                            lineItemsBySiteId={lineItemsBySiteId}
                            selectedLineItemByDateSite={selectedLineItemByDateSite}
                            busyWorkerKeys={assignmentToggleBusyKeys}
                            onToggleWorker={handleToggleAssignment}
                            onSelectLineItem={handleSelectLineItem}
                        />
                    </div>
                )}
            </section>

            <FloatingActionButton
                behavior="draggable"
                openLabel="予定の追加メニューを開く"
                closeLabel="予定の追加メニューを閉じる"
                items={[
                    {
                        id: 'personal-schedule',
                        label: '予定を入れる',
                        icon: <Plus size={18} />,
                        onClick: () => handleOpenAddMenu(undefined, 'personal'),
                    },
                ]}
            />

            <AnimatePresence>
                {showAddModal && (
                    <CalendarScheduleModal
                        initialDate={modalInitialDate}
                        scope={scope}
                        initialMode={addModalMode}
                        defaultMemberId={scope === 'personal' ? currentUserId : null}
                        onClose={() => setShowAddModal(false)}
                        onCreated={handleCommitted}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
