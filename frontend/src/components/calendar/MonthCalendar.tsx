import { type CSSProperties, useMemo, useRef } from 'react';
import { AlertCircle, CheckCircle2, Lock, Sparkles } from 'lucide-react';
import type { AvailabilityTokenKind, CalendarDay } from '../../types/calendar';
import styles from './CalendarComponents.module.css';

interface MonthCalendarProps {
    days: CalendarDay[];
    onSelectDate: (date: CalendarDay) => void;
    selectedDate: CalendarDay | null;
    onInspectDate?: (date: CalendarDay) => void;
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>;
    restInitialByUserId?: Record<string, string>;
    shortageSiteCountByDate?: Record<string, number>;
}

type DayStatus = 'free' | 'busy' | 'attention' | 'holiday';

interface DensitySummary {
    confirmedCount: number;
    pendingCount: number;
    tentativeCount: number;
    completedCount: number;
    activeCount: number;
    totalCount: number;
    availabilityKind: AvailabilityTokenKind | null;
}

interface CompletedSiteEntry {
    siteId: string;
    siteName: string;
    color: string | null;
    colorText: string | null;
}

interface CompletedRunSegment {
    id: string;
    siteId: string;
    siteName: string;
    color: string | null;
    colorText: string | null;
    dates: string[];
    row: number;
    columnStart: number;
    columnSpan: number;
    lane: number;
    startsRun: boolean;
    isSingleDay: boolean;
}

const DEFAULT_SCHEDULE_COLOR = '#0D9488';
const MAX_VISIBLE_COMPLETED_RUN_LANES = 2;
const JST_TIME_ZONE = 'Asia/Tokyo';

function getJstTodayDateValue(baseDate: Date = new Date()): string {
    const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: JST_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    });
    const parts = formatter.formatToParts(baseDate);
    const year = parts.find((part) => part.type === 'year')?.value ?? '';
    const month = parts.find((part) => part.type === 'month')?.value ?? '';
    const day = parts.find((part) => part.type === 'day')?.value ?? '';
    return `${year}-${month}-${day}`;
}

function resolveDayStatus(day: CalendarDay): DayStatus {
    if (day.shift?.available === false && day.assignments.length === 0) {
        return 'holiday';
    }
    if (day.assignments.some((assignment) => assignment.status === 'pending')) {
        return 'attention';
    }
    if (day.assignments.length > 0) {
        return 'busy';
    }
    return 'free';
}

function resolveAvailabilityKind(
    day: CalendarDay,
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>
): AvailabilityTokenKind | null {
    const draft = availabilityTokens?.[day.date];
    if (draft) {
        return draft;
    }
    if (
        day.personal_schedules.some(
            (schedule) =>
                schedule.blocks_assignment &&
                (schedule.status === 'approved' || schedule.status === 'pending')
        )
    ) {
        return 'leave_request';
    }
    return null;
}

function buildDensitySummary(
    day: CalendarDay,
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>
): DensitySummary {
    const completedCount = day.assignments.filter(
        (assignment) => assignment.status === 'completed'
    ).length;
    const confirmedCount = day.assignments.filter(
        (assignment) =>
            assignment.status === 'confirmed' ||
            assignment.status === 'scheduled'
    ).length;
    const pendingCount = day.assignments.filter(
        (assignment) => assignment.status === 'pending'
    ).length;
    const tentativeCount = day.assignments.filter(
        (assignment) => assignment.status === 'tentative'
    ).length;

    return {
        confirmedCount,
        pendingCount,
        tentativeCount,
        completedCount,
        activeCount: confirmedCount + pendingCount + tentativeCount,
        totalCount: day.assignments.length,
        availabilityKind: resolveAvailabilityKind(day, availabilityTokens),
    };
}

function getAvailabilityLabel(kind: AvailabilityTokenKind | null): string | null {
    if (kind === 'leave_request') {
        return '休';
    }
    if (kind === 'available') {
        return '空きあり';
    }
    return null;
}

function getAvailabilityMeta(kind: AvailabilityTokenKind | null) {
    if (kind === 'available') {
        return {
            icon: Sparkles,
            label: '空きあり',
            className: styles.availabilityAvailable,
        };
    }
    return null;
}

function getRestInitials(day: CalendarDay, restInitialByUserId?: Record<string, string>) {
    const initialsByUser = new Map<string, { initial: string; color: string }>();

    day.personal_schedules.forEach((schedule) => {
        if (schedule.status !== 'approved' && schedule.status !== 'pending') {
            return;
        }
        if (!schedule.blocks_assignment) {
            return;
        }

        const fallback = Array.from(schedule.user_id.trim())[0] || '?';
        initialsByUser.set(schedule.user_id, {
            initial: restInitialByUserId?.[schedule.user_id] ?? fallback,
            color: getScheduleColor(schedule.color),
        });
    });

    return Array.from(initialsByUser.entries()).map(([userId, rest]) => ({ userId, ...rest }));
}

function getScheduleColor(color: string | null | undefined): string {
    return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : DEFAULT_SCHEDULE_COLOR;
}

function getScheduleColorMarkers(day: CalendarDay) {
    return day.personal_schedules
        .filter(
            (schedule) =>
                !schedule.blocks_assignment &&
                (schedule.status === 'approved' || schedule.status === 'pending')
        )
        .slice(0, 4)
        .map((schedule) => ({
            id: schedule.id,
            color: getScheduleColor(schedule.color),
        }));
}

function getAdjacentDateKey(date: string, dayOffset: number): string | null {
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    parsed.setDate(parsed.getDate() + dayOffset);
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(
        parsed.getDate()
    ).padStart(2, '0')}`;
}

function dayHasCompletedSite(day: CalendarDay | undefined, siteId: string): boolean {
    return Boolean(
        day?.assignments.some(
            (assignment) => assignment.status === 'completed' && assignment.site_id === siteId
        )
    );
}

function getCompletedSiteEntries(day: CalendarDay): CompletedSiteEntry[] {
    const seen = new Set<string>();

    return day.assignments
        .filter(
            (assignment) =>
                assignment.status === 'completed' &&
                assignment.site_id &&
                assignment.site_id !== 'unassigned' &&
                !seen.has(assignment.site_id)
        )
        .map((assignment) => {
            seen.add(assignment.site_id);
            return {
                siteId: assignment.site_id,
                siteName: assignment.site_name,
                color: assignment.client_color || null,
                colorText: assignment.client_color_text || null,
            };
        });
}

function getCompletedSiteNames(day: CalendarDay): string[] {
    return getCompletedSiteEntries(day).map((entry) => entry.siteName);
}

function reserveCompletedRunLane(
    occupancyByRow: Map<number, Array<Set<number>>>,
    row: number,
    columnStart: number,
    columnEnd: number
): number {
    const lanes = occupancyByRow.get(row) ?? [];
    let laneIndex = 0;

    while (true) {
        const lane = lanes[laneIndex] ?? new Set<number>();
        let overlaps = false;

        for (let column = columnStart; column <= columnEnd; column += 1) {
            if (lane.has(column)) {
                overlaps = true;
                break;
            }
        }

        if (!overlaps) {
            for (let column = columnStart; column <= columnEnd; column += 1) {
                lane.add(column);
            }
            lanes[laneIndex] = lane;
            occupancyByRow.set(row, lanes);
            return laneIndex;
        }

        laneIndex += 1;
    }
}

function buildCompletedRunSegments(days: CalendarDay[]): CompletedRunSegment[] {
    const dayByDate = new Map(days.map((day) => [day.date, day]));
    const dayIndexByDate = new Map(days.map((day, index) => [day.date, index]));
    const visited = new Set<string>();
    const occupancyByRow = new Map<number, Array<Set<number>>>();
    const segments: CompletedRunSegment[] = [];

    days.forEach((day) => {
        getCompletedSiteEntries(day).forEach((entry) => {
            const seedKey = `${entry.siteId}:${day.date}`;
            if (visited.has(seedKey)) {
                return;
            }

            const run: Array<{ date: string; index: number }> = [];
            let currentDate: string | null = day.date;

            while (currentDate) {
                const currentDay = dayByDate.get(currentDate);
                const currentIndex = dayIndexByDate.get(currentDate);
                if (
                    !currentDay ||
                    currentIndex === undefined ||
                    !dayHasCompletedSite(currentDay, entry.siteId)
                ) {
                    break;
                }

                run.push({ date: currentDate, index: currentIndex });
                visited.add(`${entry.siteId}:${currentDate}`);
                currentDate = getAdjacentDateKey(currentDate, 1);
            }

            let runIndex = 0;
            while (runIndex < run.length) {
                const segmentStart = run[runIndex];
                const row = Math.floor(segmentStart.index / 7) + 1;
                let segmentEndIndex = runIndex;

                while (
                    segmentEndIndex + 1 < run.length &&
                    Math.floor(run[segmentEndIndex + 1].index / 7) + 1 === row
                ) {
                    segmentEndIndex += 1;
                }

                const segmentEnd = run[segmentEndIndex];
                const columnStart = (segmentStart.index % 7) + 1;
                const columnEnd = (segmentEnd.index % 7) + 1;
                const lane = reserveCompletedRunLane(occupancyByRow, row, columnStart, columnEnd);

                segments.push({
                    id: `${entry.siteId}:${segmentStart.date}:${segmentEnd.date}`,
                    siteId: entry.siteId,
                    siteName: entry.siteName,
                    color: entry.color,
                    colorText: entry.colorText,
                    dates: run
                        .slice(runIndex, segmentEndIndex + 1)
                        .map((runDay) => runDay.date),
                    row,
                    columnStart,
                    columnSpan: columnEnd - columnStart + 1,
                    lane,
                    startsRun: runIndex === 0,
                    isSingleDay: run.length === 1,
                });

                runIndex = segmentEndIndex + 1;
            }
        });
    });

    return segments.sort((a, b) => a.row - b.row || a.lane - b.lane || a.columnStart - b.columnStart);
}

function buildCompletedOverflowCountByDate(
    segments: CompletedRunSegment[]
): Record<string, number> {
    const counts: Record<string, number> = {};

    segments.forEach((segment) => {
        if (segment.lane < MAX_VISIBLE_COMPLETED_RUN_LANES) {
            return;
        }

        segment.dates.forEach((date) => {
            counts[date] = (counts[date] ?? 0) + 1;
        });
    });

    return counts;
}

export function MonthCalendar({
    days,
    onSelectDate,
    selectedDate,
    onInspectDate,
    availabilityTokens,
    restInitialByUserId,
    shortageSiteCountByDate,
}: MonthCalendarProps) {
    const weekDays = ['月', '火', '水', '木', '金', '土', '日'];
    const todayJstDate = getJstTodayDateValue();
    const longPressTimerRef = useRef<number | null>(null);
    const longPressTriggeredRef = useRef(false);
    const rowCount = Math.max(1, Math.ceil(days.length / 7));
    const completedRunSegments = useMemo(() => buildCompletedRunSegments(days), [days]);
    const visibleCompletedRunSegments = useMemo(
        () => completedRunSegments.filter((segment) => segment.lane < MAX_VISIBLE_COMPLETED_RUN_LANES),
        [completedRunSegments]
    );
    const completedOverflowCountByDate = useMemo(
        () => buildCompletedOverflowCountByDate(completedRunSegments),
        [completedRunSegments]
    );

    const clearLongPressTimer = () => {
        if (longPressTimerRef.current !== null) {
            window.clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const startLongPress = (day: CalendarDay) => {
        clearLongPressTimer();
        longPressTriggeredRef.current = false;
        if (!onInspectDate) {
            return;
        }

        longPressTimerRef.current = window.setTimeout(() => {
            longPressTriggeredRef.current = true;
            onInspectDate(day);
        }, 520);
    };

    const handleDateClick = (day: CalendarDay) => {
        if (longPressTriggeredRef.current) {
            longPressTriggeredRef.current = false;
            return;
        }
        onSelectDate(day);
    };

    return (
        <div>
            <div className={styles.weekHeader}>
                {weekDays.map((dow, index) => (
                    <span
                        key={index}
                        className={styles.weekHeaderLabel}
                        data-weekday={index === 5 ? 'sat' : index === 6 ? 'sun' : 'weekday'}
                    >
                        {dow}
                    </span>
                ))}
            </div>

            <div
                className={styles.monthGrid}
                style={{ '--calendar-row-count': rowCount } as CSSProperties}
            >
                {days.map((day) => {
                    const isSelected = selectedDate?.date === day.date;
                    const status = resolveDayStatus(day);
                    const density = buildDensitySummary(day, availabilityTokens);
                    const availabilityLabel = getAvailabilityLabel(density.availabilityKind);
                    const availabilityMeta = getAvailabilityMeta(density.availabilityKind);
                    const restInitials = getRestInitials(day, restInitialByUserId);
                    const scheduleColorMarkers = getScheduleColorMarkers(day);
                    const completedSiteNames = getCompletedSiteNames(day);
                    const completedOverflowCount = completedOverflowCountByDate[day.date] ?? 0;
                    const shortageSiteCount = shortageSiteCountByDate?.[day.date] ?? 0;
                    const isPastDay = day.date < todayJstDate;

                    return (
                        <button
                            type="button"
                            key={day.date}
                            className={[
                                styles.dayCell,
                                styles[`status_${status}`],
                                shortageSiteCount > 0 ? styles.shortageDay : '',
                                day.isToday ? styles.today : '',
                                !day.isCurrentMonth ? styles.otherMonth : '',
                                isSelected ? styles.selected : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onClick={() => handleDateClick(day)}
                            onPointerDown={() => startLongPress(day)}
                            onPointerUp={clearLongPressTimer}
                            onPointerLeave={clearLongPressTimer}
                            onPointerCancel={clearLongPressTimer}
                            onContextMenu={(event) => {
                                if (!onInspectDate) {
                                    return;
                                }
                                event.preventDefault();
                                clearLongPressTimer();
                                onInspectDate(day);
                            }}
                            aria-label={`${day.day}日 配置${density.activeCount}件${
                                availabilityLabel ? ` ${availabilityLabel}` : ''
                            }${density.tentativeCount > 0 ? ` 仮押さえ${density.tentativeCount}件` : ''
                            }${completedSiteNames.length > 0 ? ` 完了:${completedSiteNames.join('、')}` : ''
                            }${completedOverflowCount > 0 ? ` 完了ほか${completedOverflowCount}件` : ''
                            }${shortageSiteCount > 0 ? ` 人数不足${shortageSiteCount}件` : ''}${
                                density.pendingCount > 0 ? ' 要確認あり' : ''
                            }`}
                        >
                            <div className={styles.dayCellTop}>
                                <span className={styles.dayNumber}>{day.day}</span>
                                <span className={styles.dayCellBadges}>
                                    {density.pendingCount > 0 && (
                                        <span className={styles.dayWarn} aria-hidden="true">
                                            <AlertCircle size={12} />
                                        </span>
                                    )}
                                    {isPastDay && (
                                        <span
                                            className={styles.dayLockBadge}
                                            data-testid={`calendar-lock-${day.date}`}
                                            aria-hidden="true"
                                        >
                                            <Lock size={11} />
                                        </span>
                                    )}
                                    {density.tentativeCount > 0 && (
                                        <span className={styles.dayTentativeBadge} aria-hidden="true">
                                            仮
                                        </span>
                                    )}
                                    {completedOverflowCount > 0 && (
                                        <span className={styles.completedOverflowBadge} aria-hidden="true">
                                            +{completedOverflowCount}
                                        </span>
                                    )}
                                </span>
                            </div>

                            <div className={styles.dayDensity}>
                                <div className={styles.dayGlyphRow}>
                                    {restInitials.map((rest) => (
                                        <span
                                            className={styles.dayRestInitial}
                                            key={`${day.date}-${rest.userId}`}
                                            style={{ '--schedule-color': rest.color } as CSSProperties}
                                            aria-label={`${rest.initial} 休み`}
                                        >
                                            {rest.initial}
                                        </span>
                                    ))}

                                    {scheduleColorMarkers.length > 0 && (
                                        <span className={styles.scheduleColorDots} aria-hidden="true">
                                            {scheduleColorMarkers.map((marker) => (
                                                <span
                                                    key={`${day.date}-${marker.id}`}
                                                    className={styles.scheduleColorDot}
                                                    style={{ '--schedule-color': marker.color } as CSSProperties}
                                                />
                                            ))}
                                        </span>
                                    )}

                                    {availabilityMeta && (
                                        <span
                                            className={`${styles.availabilityIconChip} ${availabilityMeta.className}`}
                                            aria-label={availabilityMeta.label}
                                        >
                                            <availabilityMeta.icon
                                                size={12}
                                                className={styles.availabilityGlyph}
                                                aria-hidden="true"
                                            />
                                        </span>
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })}

                {visibleCompletedRunSegments.length > 0 && (
                    <div className={styles.completedRunLayer} aria-hidden="true">
                        {visibleCompletedRunSegments.map((segment) => (
                            <span
                                key={segment.id}
                                className={[
                                    styles.completedRunBar,
                                    segment.isSingleDay
                                        ? styles.completedRunBarSingle
                                        : segment.startsRun
                                          ? styles.completedRunBarStart
                                          : styles.completedRunBarContinuation,
                                ]
                                    .filter(Boolean)
                                    .join(' ')}
                                style={
                                    {
                                        '--completed-site-color': getScheduleColor(segment.color),
                                        '--completed-site-text': segment.colorText || '#FFFFFF',
                                        '--completed-run-row': segment.row,
                                        '--completed-run-column': segment.columnStart,
                                        '--completed-run-span': segment.columnSpan,
                                        '--completed-run-lane': segment.lane,
                                    } as CSSProperties
                                }
                            >
                                {segment.startsRun && (
                                    <span className={styles.completedSiteCheck}>
                                        <CheckCircle2 size={10} />
                                    </span>
                                )}
                                <span className={styles.completedSiteName}>{segment.siteName}</span>
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
