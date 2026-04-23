import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Plus,
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    CalendarCheck,
    Clock3,
    Rows,
    UserRound,
    Users,
    Workflow,
} from 'lucide-react';
import { useCalendar } from '../hooks/useCalendar';
import { MonthCalendar } from '../components/calendar/MonthCalendar';
import { WeekCalendar } from '../components/calendar/WeekCalendar';
import { DayDetail } from '../components/calendar/DayDetail';
import { AssignmentSimulator } from '../components/calendar/AssignmentSimulator';
import { CalendarDraftTray } from '../components/calendar/CalendarDraftTray';
import { CalendarScheduleModal } from '../components/calendar/CalendarScheduleModal';
import { useAssignmentSimulatorStore } from '../hooks/useAssignmentSimulator';
import {
    fetchPendingProposals,
    type ProposalRecord,
    type ProposalType,
} from '../lib/api';
import { supabase } from '../lib/supabase';
import type {
    CalendarDisplayMode,
    CalendarScope,
    CalendarWorkflow,
    DecisionSummaryStat,
} from '../types/calendarCockpit';
import type { AvailabilityTokenKind, CalendarDay } from '../types/calendar';
import styles from './Calendar.module.css';

const ASSIGNMENT_PROPOSAL_TYPES: ProposalType[] = [
    'assignment.create',
    'assignment.update',
    'assignment.cancel',
];

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function normalizeString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function formatProposalType(type: ProposalType): string {
    switch (type) {
        case 'assignment.create':
            return '新規配置';
        case 'assignment.update':
            return '配置変更';
        case 'assignment.cancel':
            return '配置取消';
        default:
            return type;
    }
}

function formatProposalStatus(status: ProposalRecord['status']): string {
    switch (status) {
        case 'draft':
            return '下書き';
        case 'pending':
            return '確認待ち';
        case 'approved':
            return '承認済み';
        case 'executed':
            return '反映済み';
        case 'rejected':
            return '差し戻し';
        default:
            return status;
    }
}

function isProposalRelatedToUser(proposal: ProposalRecord, userId: string | null): boolean {
    if (!userId) {
        return false;
    }

    const payload = proposal.payload;
    const relatedIds = [
        normalizeString(payload.user_id),
        normalizeString(payload.assignee_id),
        normalizeString(payload.worker_id),
        normalizeString(payload.member_id),
    ].filter((value): value is string => Boolean(value));

    return proposal.created_by.id === userId || relatedIds.includes(userId);
}

function filterDayAssignments(day: CalendarDay, userId: string | null): CalendarDay {
    if (!userId) {
        return {
            ...day,
            assignments: [],
        };
    }

    return {
        ...day,
        assignments: day.assignments.filter((assignment) => assignment.user_id === userId),
    };
}

function buildScopeDays(days: CalendarDay[], scope: CalendarScope, userId: string | null) {
    if (scope === 'organization') {
        return days;
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

    return scope === 'organization' ? selected : filterDayAssignments(selected, userId);
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

function countAvailabilityTokens(
    visibleDays: CalendarDay[],
    availabilityTokens: Partial<Record<string, AvailabilityTokenKind>>
) {
    return visibleDays.reduce(
        (summary, day) => {
            if (!day.isCurrentMonth) {
                return summary;
            }

            const token = availabilityTokens[day.date];
            if (token === 'leave_request') {
                summary.leaveRequests += 1;
            }
            if (token === 'available') {
                summary.availableDays += 1;
            }
            return summary;
        },
        { leaveRequests: 0, availableDays: 0 }
    );
}

function buildDecisionSummary(
    scope: CalendarScope,
    visibleDays: CalendarDay[],
    selectedDay: CalendarDay | null,
    pendingProposals: ProposalRecord[],
    availabilityTokens: Partial<Record<string, AvailabilityTokenKind>>
): DecisionSummaryStat[] {
    const currentDay = selectedDay ?? visibleDays.find((day) => day.isToday) ?? visibleDays[0] ?? null;
    const visibleCurrentAssignments = currentDay?.assignments ?? [];
    const visibleSites = new Set(visibleCurrentAssignments.map((assignment) => assignment.site_id));
    const visibleWeek = currentDay
        ? visibleDays.filter((day) => {
              const current = new Date(currentDay.date);
              const candidate = new Date(day.date);
              const diff = (candidate.getTime() - current.getTime()) / (1000 * 60 * 60 * 24);
              return diff >= 0 && diff < 7;
          })
        : [];
    const weekAssignments = visibleWeek.reduce((sum, day) => sum + day.assignments.length, 0);
    const confirmedAssignments = visibleDays.reduce(
        (sum, day) =>
            sum +
            day.assignments.filter(
                (assignment) =>
                    assignment.status === 'confirmed' || assignment.status === 'scheduled'
            ).length,
        0
    );
    const availabilitySummary = countAvailabilityTokens(visibleDays, availabilityTokens);

    if (scope === 'organization') {
        return [
            {
                id: 'decision',
                label: '要確認',
                value: `${pendingProposals.length}件`,
                caption: '確認待ち',
                tone: pendingProposals.length > 0 ? 'warn' : 'neutral',
            },
            {
                id: 'sites',
                label: '現場数',
                value: `${visibleSites.size}件`,
                caption: '選んだ日の現場',
                tone: 'neutral',
            },
            {
                id: 'week',
                label: '今週の予定',
                value: `${weekAssignments}件`,
                caption: '7日分',
                tone: 'neutral',
            },
            {
                id: 'committed',
                label: '決定',
                value: `${confirmedAssignments}件`,
                caption: '決まった予定',
                tone: 'ok',
            },
        ];
    }

    const nextAssignment = visibleDays
        .flatMap((day) => day.assignments.map((assignment) => ({ ...assignment, date: day.date })))
        .sort((a, b) => a.date.localeCompare(b.date))[0];

    return [
        {
            id: 'next',
            label: '次の予定',
            value: nextAssignment ? formatDateLabel(nextAssignment.date) : '未設定',
            caption: nextAssignment ? nextAssignment.site_name : 'まだありません',
            tone: nextAssignment ? 'ok' : 'neutral',
        },
        {
            id: 'week',
            label: '今週の予定',
            value: `${weekAssignments}件`,
            caption: '自分の予定',
            tone: 'neutral',
        },
        {
            id: 'leave',
            label: '休み希望',
            value: `${availabilitySummary.leaveRequests}日`,
            caption:
                availabilitySummary.availableDays > 0
                    ? `空きあり ${availabilitySummary.availableDays}日`
                    : '今月の空き・休み希望',
            tone: availabilitySummary.leaveRequests > 0 ? 'warn' : 'neutral',
        },
        {
            id: 'pending',
            label: '変更',
            value: `${pendingProposals.length}件`,
            caption: `決定 ${confirmedAssignments}件`,
            tone: pendingProposals.length > 0 ? 'warn' : 'ok',
        },
    ];
}

export function Calendar() {
    const {
        year,
        month,
        calendarDays,
        selectedDate,
        nextMonth,
        prevMonth,
        goToToday,
        selectDate,
        reloadAssignments,
    } = useCalendar();

    const [scope, setScope] = useState<CalendarScope>('organization');
    const [workflow, setWorkflow] = useState<CalendarWorkflow>('operations');
    const [displayMode, setDisplayMode] = useState<CalendarDisplayMode>('week');
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [pendingProposals, setPendingProposals] = useState<ProposalRecord[]>([]);
    const [proposalReloadVersion, setProposalReloadVersion] = useState(0);
    const [showScheduleModal, setShowScheduleModal] = useState(false);
    const [availabilityTokens, setAvailabilityTokens] = useState<
        Partial<Record<string, AvailabilityTokenKind>>
    >({});
    const hasDraftAssignments = useAssignmentSimulatorStore(
        (state) => state.draft_assignments.length > 0
    );

    useEffect(() => {
        let active = true;

        const loadSessionUser = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (active) {
                setCurrentUserId(session?.user?.id ?? null);
            }
        };

        void loadSessionUser();

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        const loadPendingProposals = async () => {
            try {
                const proposals = await fetchPendingProposals();
                if (!active) {
                    return;
                }

                setPendingProposals(
                    proposals.filter((proposal) => ASSIGNMENT_PROPOSAL_TYPES.includes(proposal.type))
                );
            } catch (error) {
                console.error('Failed to load pending assignment proposals:', error);
                if (active) {
                    setPendingProposals([]);
                }
            }
        };

        void loadPendingProposals();

        return () => {
            active = false;
        };
    }, [proposalReloadVersion]);

    const handleCommitted = async () => {
        await reloadAssignments();
        setProposalReloadVersion((current) => current + 1);
    };

    const visibleDays = useMemo(
        () => buildScopeDays(calendarDays, scope, currentUserId),
        [calendarDays, currentUserId, scope]
    );

    const visibleSelectedDate = useMemo(
        () => findScopedSelectedDay(calendarDays, selectedDate, scope, currentUserId),
        [calendarDays, currentUserId, scope, selectedDate]
    );

    const visiblePendingProposals = useMemo(() => {
        if (scope === 'organization') {
            return pendingProposals;
        }

        return pendingProposals.filter((proposal) => isProposalRelatedToUser(proposal, currentUserId));
    }, [currentUserId, pendingProposals, scope]);

    const summaryStats = useMemo(
        () =>
            buildDecisionSummary(
                scope,
                visibleDays,
                visibleSelectedDate,
                visiblePendingProposals,
                availabilityTokens
            ),
        [availabilityTokens, scope, visibleDays, visiblePendingProposals, visibleSelectedDate]
    );

    const selectedAvailabilityToken = visibleSelectedDate
        ? availabilityTokens[visibleSelectedDate.date] ?? null
        : null;

    const todayKey = getTodayKey();
    const now = new Date();
    const viewingCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const showTodayFab =
        workflow === 'operations' &&
        displayMode !== 'dispatch' &&
        (!viewingCurrentMonth || visibleSelectedDate?.date !== todayKey);
    const monthLabel = `${year}年 ${month}月`;
    const scopeLabel = scope === 'organization' ? '全体' : '自分';
    const workflowLabel =
        workflow === 'operations' ? '予定' : workflow === 'proposals' ? '変更' : '組み替え';
    const activeViewLabel =
        workflow === 'operations'
            ? displayMode === 'month'
                ? '月'
                : displayMode === 'week'
                  ? '週'
                  : '日別'
            : workflow === 'proposals'
              ? '変更一覧'
              : scope === 'organization'
                ? '組み替え'
                : '自分への変更';
    const selectedDayLabel = visibleSelectedDate
        ? formatDateLabel(visibleSelectedDate.date)
        : '日付を選ぶ';
    const heroDescription =
        scope === 'organization'
            ? '空きと変更をすぐ見る。'
            : '自分の予定をすぐ見る。';
    const mainPanelTitle =
        workflow === 'operations'
            ? displayMode === 'dispatch'
                ? '日ごとの差配'
                : '予定'
            : workflow === 'proposals'
              ? '変更'
              : scope === 'organization'
                ? '組み替え'
                : '自分への変更';
    const mainPanelDescription =
        workflow === 'operations'
            ? scope === 'organization'
                ? '日ごとの動きを見る。'
                : '予定と都合を見る。'
            : workflow === 'proposals'
              ? '変わる予定を見る。'
              : scope === 'organization'
                ? '下書きを整える。'
                : '自分に関わる変更を見る。';

    const proposalPanelTitle = scope === 'organization' ? '確認待ち' : '自分の変更';

    const proposalPanelDescription =
        scope === 'organization'
            ? '先に見たい変更。'
            : '自分に関わる変更。';

    const heroHighlights = [
        {
            id: 'view',
            label: '表示中',
            value: `${scopeLabel} / ${workflowLabel}`,
            caption: activeViewLabel,
        },
        {
            id: 'selected',
            label: '選んだ日',
            value: selectedDayLabel,
            caption: visibleSelectedDate
                ? `${visibleSelectedDate.assignments.length}件`
                : '日付を選ぶ',
        },
        {
            id: 'pending',
            label: '要確認',
            value: `${visiblePendingProposals.length}件`,
            caption: hasDraftAssignments
                ? '下書きあり'
                : '承認待ち',
        },
    ];

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

    return (
        <div className={styles.container}>
            <div className={styles.hero}>
                <div className={styles.heroPrimary}>
                    <div className={styles.heroText}>
                        <span className={styles.eyebrow}>スケジュール</span>
                        <h1 className={styles.pageTitle}>予定をひと目で見る</h1>
                        <p className={styles.pageDescription}>{heroDescription}</p>
                    </div>

                    <div className={styles.heroMetaRow}>
                        <span className={styles.heroMetaChip}>
                            <CalendarIcon size={14} />
                            {monthLabel}
                        </span>
                        <span className={styles.heroMetaChip}>
                            {scope === 'organization' ? <Users size={14} /> : <UserRound size={14} />}
                            {scopeLabel}
                        </span>
                        <span className={styles.heroMetaChip}>
                            {workflow === 'operations' ? (
                                displayMode === 'month' ? (
                                    <CalendarIcon size={14} />
                                ) : displayMode === 'week' ? (
                                    <Rows size={14} />
                                ) : (
                                    <Workflow size={14} />
                                )
                            ) : workflow === 'proposals' ? (
                                <CalendarCheck size={14} />
                            ) : (
                                <Workflow size={14} />
                            )}
                            {activeViewLabel}
                        </span>
                    </div>

                    <div className={styles.heroActions}>
                        <button
                            type="button"
                            className={styles.primaryAction}
                            onClick={() => setShowScheduleModal(true)}
                        >
                            <Plus size={16} />
                            予定を追加
                        </button>
                        <div className={styles.navGroup}>
                            <button type="button" className={styles.todayBtn} onClick={goToToday}>
                                今日
                            </button>
                            <button
                                type="button"
                                className={styles.navBtn}
                                onClick={prevMonth}
                                aria-label="前月"
                            >
                                <ChevronLeft size={20} />
                            </button>
                            <button
                                type="button"
                                className={styles.navBtn}
                                onClick={nextMonth}
                                aria-label="翌月"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                    </div>
                </div>

                <div className={styles.heroInsightGrid}>
                    {heroHighlights.map((highlight) => (
                        <article key={highlight.id} className={styles.heroInsightCard}>
                            <span className={styles.heroInsightLabel}>{highlight.label}</span>
                            <strong className={styles.heroInsightValue}>{highlight.value}</strong>
                            <p className={styles.heroInsightCaption}>{highlight.caption}</p>
                        </article>
                    ))}
                </div>
            </div>

            <div className={styles.controlBoard}>
                <section className={styles.controlGroup}>
                    <div className={styles.controlHeader}>
                        <span className={styles.controlLabel}>表示範囲</span>
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
                </section>

                <section className={styles.controlGroup}>
                    <div className={styles.controlHeader}>
                        <span className={styles.controlLabel}>表示内容</span>
                    </div>
                    <div className={styles.segment}>
                        <button
                            type="button"
                            className={`${styles.segmentButton} ${workflow === 'operations' ? styles.active : ''}`}
                            onClick={() => setWorkflow('operations')}
                        >
                            <Clock3 size={14} />
                            予定
                        </button>
                        <button
                            type="button"
                            className={`${styles.segmentButton} ${workflow === 'proposals' ? styles.active : ''}`}
                            onClick={() => setWorkflow('proposals')}
                        >
                            <CalendarCheck size={14} />
                            変更
                        </button>
                        <button
                            type="button"
                            className={`${styles.segmentButton} ${workflow === 'scenarios' ? styles.active : ''}`}
                            onClick={() => setWorkflow('scenarios')}
                        >
                            <Workflow size={14} />
                            組み替え
                        </button>
                    </div>
                </section>

                <section className={styles.controlGroup}>
                    <div className={styles.controlHeader}>
                        <span className={styles.controlLabel}>表示方法</span>
                    </div>
                    <div className={styles.segment}>
                        {workflow === 'operations' ? (
                            <>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${displayMode === 'month' ? styles.active : ''}`}
                                    onClick={() => setDisplayMode('month')}
                                >
                                    <CalendarIcon size={14} />
                                    月
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${displayMode === 'week' ? styles.active : ''}`}
                                    onClick={() => setDisplayMode('week')}
                                >
                                    <Rows size={14} />
                                    週
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${displayMode === 'dispatch' ? styles.active : ''}`}
                                    onClick={() => setDisplayMode('dispatch')}
                                >
                                    <Workflow size={14} />
                                    日別
                                </button>
                            </>
                        ) : (
                            <span className={styles.modeNotice}>{activeViewLabel}</span>
                        )}
                    </div>
                </section>
            </div>

            <section className={styles.summarySection}>
                <div className={styles.sectionHeader}>
                    <div>
                        <span className={styles.sectionEyebrow}>今月の要点</span>
                        <h2>すぐわかる</h2>
                        <p>
                            {scope === 'organization'
                                ? '不足と変更を先に見る。'
                                : '予定と変更を先に見る。'}
                        </p>
                    </div>
                    <span className={styles.monthBadge}>{monthLabel}</span>
                </div>

                <div className={styles.summaryGrid}>
                    {summaryStats.map((stat) => (
                        <article
                            key={stat.id}
                            className={`${styles.summaryCard} ${
                                stat.tone === 'warn'
                                    ? styles.summaryWarn
                                    : stat.tone === 'ok'
                                      ? styles.summaryOk
                                      : ''
                            }`}
                        >
                            <span className={styles.summaryLabel}>{stat.label}</span>
                            <strong className={styles.summaryValue}>{stat.value}</strong>
                            <p className={styles.summaryCaption}>{stat.caption}</p>
                        </article>
                    ))}
                </div>
            </section>

            <div className={styles.contentGrid}>
                <section className={styles.mainPanel}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <span className={styles.sectionEyebrow}>メイン画面</span>
                            <h2>{mainPanelTitle}</h2>
                            <p>{mainPanelDescription}</p>
                        </div>
                    </div>

                    {workflow === 'operations' && (
                        <>
                            {displayMode === 'dispatch' ? (
                                visibleSelectedDate ? (
                                    <AssignmentSimulator
                                        key={`${scope}-${visibleSelectedDate.date}-${visibleSelectedDate.assignments.length}`}
                                        day={visibleSelectedDate}
                                        onCommitted={handleCommitted}
                                    />
                                ) : null
                            ) : (
                                <>
                                    {scope === 'personal' && visibleSelectedDate && (
                                        <section className={styles.personalAvailabilityPanel}>
                                            <div className={styles.personalAvailabilityHeader}>
                                                <div>
                                                    <h3>空き・休み</h3>
                                                    <p>
                                                        {formatDateLabel(visibleSelectedDate.date)}
                                                    </p>
                                                </div>
                                                {selectedAvailabilityToken && (
                                                    <span className={styles.availabilityCurrent}>
                                                        {selectedAvailabilityToken === 'leave_request'
                                                            ? '休み希望'
                                                            : '空きあり'}
                                                    </span>
                                                )}
                                            </div>

                                            <div className={styles.availabilityTokenRow}>
                                                <button
                                                    type="button"
                                                    className={`${styles.availabilityTokenButton} ${
                                                        selectedAvailabilityToken ===
                                                        'leave_request'
                                                            ? styles.availabilityTokenLeaveActive
                                                            : ''
                                                    }`}
                                                    onClick={() =>
                                                        setAvailabilityToken('leave_request')
                                                    }
                                                >
                                                    休み希望
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`${styles.availabilityTokenButton} ${
                                                        selectedAvailabilityToken === 'available'
                                                            ? styles.availabilityTokenAvailableActive
                                                            : ''
                                                    }`}
                                                    onClick={() =>
                                                        setAvailabilityToken('available')
                                                    }
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
                                        </section>
                                    )}

                                    <motion.div
                                        key={`${scope}-${displayMode}`}
                                        className={styles.canvasBlock}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.2 }}
                                    >
                                        {displayMode === 'month' ? (
                                            <MonthCalendar
                                                days={visibleDays}
                                                onSelectDate={(day) => {
                                                    const originalDay =
                                                        calendarDays.find(
                                                            (candidate) => candidate.date === day.date
                                                        ) ?? day;
                                                    selectDate(originalDay);
                                                }}
                                                selectedDate={visibleSelectedDate}
                                                availabilityTokens={
                                                    scope === 'personal'
                                                        ? availabilityTokens
                                                        : undefined
                                                }
                                            />
                                        ) : (
                                            <WeekCalendar
                                                days={visibleDays}
                                                onSelectDate={(day) => {
                                                    const originalDay =
                                                        calendarDays.find(
                                                            (candidate) => candidate.date === day.date
                                                        ) ?? day;
                                                    selectDate(originalDay);
                                                }}
                                                selectedDate={visibleSelectedDate}
                                                availabilityTokens={
                                                    scope === 'personal'
                                                        ? availabilityTokens
                                                        : undefined
                                                }
                                            />
                                        )}
                                    </motion.div>

                                    <AnimatePresence mode="wait">
                                        {visibleSelectedDate && (
                                            <motion.div
                                                key={`${scope}-${visibleSelectedDate.date}`}
                                                initial={{ opacity: 0, y: 10 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: 10 }}
                                                transition={{ duration: 0.2 }}
                                            >
                                                <DayDetail day={visibleSelectedDate} />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            )}
                        </>
                    )}

                    {workflow === 'proposals' && (
                        <div className={styles.proposalList}>
                            {visiblePendingProposals.length === 0 ? (
                                <div className={styles.emptyPanel}>
                                    確認待ちの変更はありません。
                                </div>
                            ) : (
                                visiblePendingProposals.map((proposal) => (
                                    <article key={proposal.id} className={styles.proposalCard}>
                                        <div className={styles.proposalMeta}>
                                            <span className={styles.proposalType}>
                                                {formatProposalType(proposal.type)}
                                            </span>
                                            <span className={styles.proposalStatus}>
                                                {formatProposalStatus(proposal.status)}
                                            </span>
                                        </div>
                                        <strong className={styles.proposalTitle}>
                                            {proposal.description}
                                        </strong>
                                        <p className={styles.proposalBody}>
                                            提出: {proposal.created_by.name} / 理由:{' '}
                                            {normalizeString(proposal.payload.override_reason) ??
                                                '記載なし'}
                                        </p>
                                    </article>
                                ))
                            )}
                        </div>
                    )}

                    {workflow === 'scenarios' && (
                        <>
                            {scope === 'organization' ? (
                                visibleSelectedDate ? (
                                    <AssignmentSimulator
                                        key={`scenario-${visibleSelectedDate.date}-${visibleSelectedDate.assignments.length}`}
                                        day={visibleSelectedDate}
                                        onCommitted={handleCommitted}
                                    />
                                ) : null
                            ) : (
                                <div className={styles.personalScenarioPanel}>
                                    <h3>自分の変更</h3>
                                    <p>
                                        自分に関わる変更だけ見ます。
                                    </p>
                                    <div className={styles.proposalList}>
                                        {visiblePendingProposals.length === 0 ? (
                                            <div className={styles.emptyPanel}>
                                                自分に関わる変更はありません。
                                            </div>
                                        ) : (
                                            visiblePendingProposals.map((proposal) => (
                                                <article
                                                    key={proposal.id}
                                                    className={styles.proposalCard}
                                                >
                                                    <div className={styles.proposalMeta}>
                                                        <span className={styles.proposalType}>
                                                            {formatProposalType(proposal.type)}
                                                        </span>
                                                        <span className={styles.proposalStatus}>
                                                            {formatProposalStatus(proposal.status)}
                                                        </span>
                                                    </div>
                                                    <strong className={styles.proposalTitle}>
                                                        {proposal.description}
                                                    </strong>
                                                    <p className={styles.proposalBody}>
                                                        {proposal.created_by.name} が変更を提出
                                                    </p>
                                                </article>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </section>

                <aside className={styles.sidePanel}>
                    <div className={styles.sectionHeader}>
                        <div>
                            <span className={styles.sectionEyebrow}>確認</span>
                            <h2>{proposalPanelTitle}</h2>
                            <p>{proposalPanelDescription}</p>
                        </div>
                    </div>

                    <div className={styles.sideStack}>
                        {visiblePendingProposals.length === 0 ? (
                            <div className={styles.emptyPanel}>先に見る変更はありません。</div>
                        ) : (
                            visiblePendingProposals.slice(0, 5).map((proposal) => (
                                <article key={proposal.id} className={styles.attentionCard}>
                                    <span className={styles.attentionType}>
                                        {formatProposalType(proposal.type)}
                                    </span>
                                    <strong>{proposal.description}</strong>
                                    <p>
                                        {proposal.created_by.name}
                                        {' が提出'}
                                    </p>
                                </article>
                            ))
                        )}

                        {visibleSelectedDate && workflow !== 'operations' && (
                            <div className={styles.drawerCard}>
                                <h3>この日の予定</h3>
                                <p>
                                    {formatDateLabel(visibleSelectedDate.date)} /{' '}
                                    {visibleSelectedDate.assignments.length}件
                                </p>
                            </div>
                        )}
                    </div>
                </aside>
            </div>

            {scope === 'organization' &&
                (workflow === 'scenarios' || displayMode === 'dispatch' || hasDraftAssignments) && (
                    <CalendarDraftTray onCommitted={handleCommitted} />
                )}

            <AnimatePresence>
                {showTodayFab && (
                    <motion.button
                        key="today-fab"
                        type="button"
                        className={styles.todayFab}
                        onClick={goToToday}
                        aria-label="今日に戻る"
                        initial={{ opacity: 0, scale: 0.85, y: 20 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.85, y: 20 }}
                        transition={{ duration: 0.18 }}
                    >
                        <CalendarCheck size={20} aria-hidden="true" />
                        <span>今日</span>
                    </motion.button>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showScheduleModal && (
                    <CalendarScheduleModal
                        initialDate={visibleSelectedDate?.date ?? todayKey}
                        defaultMemberId={scope === 'personal' ? currentUserId : null}
                        onClose={() => setShowScheduleModal(false)}
                        onCreated={handleCommitted}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
