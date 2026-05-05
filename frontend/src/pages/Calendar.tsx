import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
    ChevronLeft,
    ChevronRight,
    Plus,
    UserRound,
    Users,
} from 'lucide-react';
import { FloatingActionButton } from '../components/FloatingActionButton';
import { useCalendar } from '../hooks/useCalendar';
import { MonthCalendar } from '../components/calendar/MonthCalendar';
import { DayScheduleBoard } from '../components/calendar/DayScheduleBoard';
import { DraftAssignmentFooter } from '../components/calendar/DraftAssignmentFooter';
import { CalendarScheduleModal } from '../components/calendar/CalendarScheduleModal';
import { useDraftAssignmentCreates } from '../hooks/useDraftAssignmentCreates';
import {
    commitAssignmentCreateDrafts,
    fetchMembers,
    fetchOrgContext,
    submitLeaveRequestProposal,
    type Member,
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

type CalendarAddMode = 'menu' | 'personal' | 'assignment';

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

interface AnnualRestSummaryItem {
    id: string;
    name: string;
    initial: string;
    days: number;
}

type RestSummaryRange = 'year' | 'month';

function getMemberLabel(member: Member | undefined, fallback: string): string {
    return member?.display_name || member?.full_name || member?.username || fallback;
}

function getInitial(label: string): string {
    return Array.from(label.trim())[0] || '?';
}

function buildAnnualRestSummaryItems(
    members: Member[],
    annualRestDaysByUser: Record<string, number>,
    scope: CalendarScope,
    currentUserId: string | null
): AnnualRestSummaryItem[] {
    if (scope === 'personal') {
        const currentMember = currentUserId
            ? members.find((member) => member.id === currentUserId || member.user_id === currentUserId)
            : undefined;

        return [
            {
                id: currentUserId ?? 'current-user',
                name: getMemberLabel(currentMember, '自分'),
                initial: getInitial(getMemberLabel(currentMember, '自分')),
                days: currentUserId ? annualRestDaysByUser[currentUserId] ?? 0 : 0,
            },
        ];
    }

    return members
        .filter((member) => member.status !== 'removed' && member.status !== 'suspended')
        .map((member) => ({
            id: member.id,
            name: getMemberLabel(member, member.id),
            initial: getInitial(getMemberLabel(member, member.id)),
            days: annualRestDaysByUser[member.id] ?? 0,
        }))
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

export function Calendar() {
    const {
        year,
        month,
        calendarDays,
        annualRestDaysByUser,
        selectedDate,
        sites,
        nextMonth,
        prevMonth,
        selectDate,
        reloadAssignments,
    } = useCalendar();

    const [scope, setScope] = useState<CalendarScope>('organization');
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [draftCommitMessage, setDraftCommitMessage] = useState<string | null>(null);
    const [isDraftSubmitting, setIsDraftSubmitting] = useState(false);
    const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);
    const [isAvailabilitySubmitting, setIsAvailabilitySubmitting] = useState(false);
    const [availabilityTokens, setAvailabilityTokens] = useState<
        Partial<Record<string, AvailabilityTokenKind>>
    >({});
    const [restSummaryRange, setRestSummaryRange] = useState<RestSummaryRange>('year');
    const [showAddModal, setShowAddModal] = useState(false);
    const [addModalMode, setAddModalMode] = useState<CalendarAddMode>('menu');
    const { drafts, addDraft, removeDraft, clearDrafts } = useDraftAssignmentCreates();

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

    const restSummaryItems = useMemo(
        () =>
            buildAnnualRestSummaryItems(
                members,
                restSummaryRange === 'year' ? annualRestDaysByUser : monthlyRestDaysByUser,
                scope,
                currentUserId
            ),
        [annualRestDaysByUser, currentUserId, members, monthlyRestDaysByUser, restSummaryRange, scope]
    );

    const restInitialByUserId = useMemo(() => {
        const initials = members.reduce<Record<string, string>>((summary, member) => {
            summary[member.id] = getInitial(getMemberLabel(member, member.id));
            return summary;
        }, {});

        restSummaryItems.forEach((item) => {
            initials[item.id] = item.initial;
        });

        return initials;
    }, [members, restSummaryItems]);

    const shortageSiteCountByDate = useMemo(() => {
        if (scope !== 'organization') {
            return {};
        }

        return visibleDays.reduce<Record<string, number>>((summary, day) => {
            if (!day.isCurrentMonth) {
                return summary;
            }

            const board = buildDayScheduleBoard({ day, sites, members, drafts });
            if (board.shortage_site_count > 0) {
                summary[day.date] = board.shortage_site_count;
            }
            return summary;
        }, {});
    }, [drafts, members, scope, sites, visibleDays]);

    const selectedDayBoard = useMemo(
        () =>
            scope === 'organization' && visibleSelectedDate
                ? buildDayScheduleBoard({
                      day: visibleSelectedDate,
                      sites,
                      members,
                      drafts,
                  })
                : null,
        [drafts, members, scope, sites, visibleSelectedDate]
    );

    const selectedLeaveSchedule = pickSelectedLeaveSchedule(visibleSelectedDate, currentUserId);
    const selectedAvailabilityToken = selectedLeaveSchedule
        ? 'leave_request'
        : visibleSelectedDate
          ? availabilityTokens[visibleSelectedDate.date] ?? null
          : null;

    const monthLabel = `${year}/${String(month).padStart(2, '0')}`;
    const modalInitialDate =
        visibleSelectedDate?.date ??
        selectedDate?.date ??
        `${year}-${String(month).padStart(2, '0')}-01`;

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

    const clearAvailabilityToken = () => {
        if (!visibleSelectedDate) {
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

    const handleAddDraft = (
        draft: Parameters<typeof addDraft>[0],
        occupiedWorkerIdsForDate: string[]
    ) => {
        setDraftCommitMessage(null);
        return addDraft(draft, { occupiedWorkerIdsForDate });
    };

    const handleSubmitDrafts = async () => {
        if (drafts.length === 0 || isDraftSubmitting) {
            return;
        }

        setIsDraftSubmitting(true);
        setDraftCommitMessage(null);

        try {
            const result = await commitAssignmentCreateDrafts(
                drafts.map((draft) => ({
                    id: draft.id,
                    worker_id: draft.worker_id,
                    site_id: draft.site_id,
                    site_name: draft.site_name,
                    date: draft.date,
                }))
            );

            result.results
                .filter((item) => item.success)
                .forEach((item) => removeDraft(item.draft_id));

            if (result.ok) {
                await handleCommitted();
            }

            setDraftCommitMessage(result.message);
        } catch (error) {
            console.error('Failed to submit assignment drafts:', error);
            setDraftCommitMessage('変更案を送れませんでした。もう一度お試しください。');
        } finally {
            setIsDraftSubmitting(false);
        }
    };

    return (
        <div className={styles.container}>
            <section className={styles.mainPanel}>
                <div className={styles.sectionHeader}>
                    <div className={styles.headerTools}>
                        <div className={styles.navGroup}>
                            <button
                                type="button"
                                className={styles.navBtn}
                                onClick={prevMonth}
                                aria-label="前月"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <span className={styles.monthNavLabel} aria-live="polite">
                                {monthLabel}
                            </span>
                            <button
                                type="button"
                                className={styles.navBtn}
                                onClick={nextMonth}
                                aria-label="翌月"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                        <div className={styles.segment}>
                            <button
                                type="button"
                                className={`${styles.segmentButton} ${scope === 'organization' ? styles.active : ''}`}
                                onClick={() => setScope('organization')}
                            >
                                <Users size={14} />
                                全体
                            </button>
                            <button
                                type="button"
                                className={`${styles.segmentButton} ${scope === 'personal' ? styles.active : ''}`}
                                onClick={() => setScope('personal')}
                            >
                                <UserRound size={14} />
                                自分
                            </button>
                        </div>
                    </div>
                </div>

                <div
                    className={styles.restSummaryBar}
                    aria-label={`${restSummaryRange === 'year' ? `${year}年` : `${month}月`}の休み数`}
                >
                    <div className={styles.restSummaryHeader}>
                        <div className={styles.restSummaryToggle} aria-label="休みカウントの期間">
                            <button
                                type="button"
                                className={`${styles.restSummaryToggleButton} ${
                                    restSummaryRange === 'year' ? styles.restSummaryToggleActive : ''
                                }`}
                                onClick={() => setRestSummaryRange('year')}
                                aria-pressed={restSummaryRange === 'year'}
                            >
                                今年
                            </button>
                            <button
                                type="button"
                                className={`${styles.restSummaryToggleButton} ${
                                    restSummaryRange === 'month' ? styles.restSummaryToggleActive : ''
                                }`}
                                onClick={() => setRestSummaryRange('month')}
                                aria-pressed={restSummaryRange === 'month'}
                            >
                                今月
                            </button>
                        </div>
                    </div>
                    <div className={styles.restSummaryList}>
                        {restSummaryItems.map((item) => (
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

                {scope === 'personal' && visibleSelectedDate && (
                    <section className={styles.personalAvailabilityPanel}>
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
                                onClick={clearAvailabilityToken}
                            >
                                解除
                            </button>
                        </div>

                        {availabilityMessage && (
                            <p className={styles.availabilityMessage}>{availabilityMessage}</p>
                        )}
                    </section>
                )}

                <motion.div
                    key={scope}
                    className={styles.canvasBlock}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    <MonthCalendar
                        days={visibleDays}
                        onSelectDate={handleSelectDate}
                        onOpenDateActions={handleOpenAddMenu}
                        selectedDate={visibleSelectedDate}
                        availabilityTokens={scope === 'personal' ? availabilityTokens : undefined}
                        restInitialByUserId={restInitialByUserId}
                        shortageSiteCountByDate={
                            scope === 'organization' ? shortageSiteCountByDate : undefined
                        }
                    />
                </motion.div>

                {scope === 'organization' && selectedDayBoard && (
                    <DayScheduleBoard
                        board={selectedDayBoard}
                        members={members}
                        onAddDraft={handleAddDraft}
                    />
                )}
            </section>

            {scope === 'organization' && (
                <DraftAssignmentFooter
                    drafts={drafts}
                    isSubmitting={isDraftSubmitting}
                    message={draftCommitMessage}
                    onRemove={removeDraft}
                    onClear={() => {
                        clearDrafts();
                        setDraftCommitMessage(null);
                    }}
                    onSubmit={() => void handleSubmitDrafts()}
                />
            )}

            <FloatingActionButton
                behavior="draggable"
                openLabel="予定の追加メニューを開く"
                closeLabel="予定の追加メニューを閉じる"
                items={
                    scope === 'personal'
                        ? [
                              {
                                  id: 'personal-schedule',
                                  label: '予定を入れる',
                                  icon: <Plus size={18} />,
                                  onClick: () => handleOpenAddMenu(undefined, 'personal'),
                              },
                          ]
                        : [
                              {
                                  id: 'personal-schedule',
                                  label: '予定を入れる',
                                  icon: <Plus size={18} />,
                                  onClick: () => handleOpenAddMenu(undefined, 'personal'),
                              },
                              {
                                  id: 'assignment',
                                  label: '現場に入れる',
                                  icon: <Users size={18} />,
                                  onClick: () => handleOpenAddMenu(undefined, 'assignment'),
                              },
                          ]
                }
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
