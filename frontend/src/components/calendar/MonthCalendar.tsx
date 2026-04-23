import { AlertCircle, CircleSlash, Sparkles } from 'lucide-react';
import type { AvailabilityTokenKind, CalendarDay } from '../../types/calendar';
import styles from './CalendarComponents.module.css';

interface MonthCalendarProps {
    days: CalendarDay[];
    onSelectDate: (date: CalendarDay) => void;
    selectedDate: CalendarDay | null;
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>;
}

type DayStatus = 'free' | 'busy' | 'attention' | 'holiday';

interface DensitySummary {
    confirmedCount: number;
    pendingCount: number;
    totalCount: number;
    availabilityKind: AvailabilityTokenKind | 'holiday' | null;
}

type AssignmentMarkerTone = 'confirmed' | 'pending' | 'neutral';

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
): AvailabilityTokenKind | 'holiday' | null {
    const draft = availabilityTokens?.[day.date];
    if (draft) {
        return draft;
    }
    if (day.shift?.available === false) {
        return day.shift.note === '定休日' ? 'holiday' : 'leave_request';
    }
    return null;
}

function buildDensitySummary(
    day: CalendarDay,
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>
): DensitySummary {
    const confirmedCount = day.assignments.filter(
        (assignment) =>
            assignment.status === 'confirmed' ||
            assignment.status === 'scheduled' ||
            assignment.status === 'completed'
    ).length;
    const pendingCount = day.assignments.filter(
        (assignment) => assignment.status === 'pending'
    ).length;

    return {
        confirmedCount,
        pendingCount,
        totalCount: day.assignments.length,
        availabilityKind: resolveAvailabilityKind(day, availabilityTokens),
    };
}

function getAvailabilityLabel(kind: AvailabilityTokenKind | 'holiday' | null): string | null {
    if (kind === 'leave_request') {
        return '休み希望';
    }
    if (kind === 'available') {
        return '空きあり';
    }
    if (kind === 'holiday') {
        return '休';
    }
    return null;
}

function getAvailabilityMeta(kind: AvailabilityTokenKind | 'holiday' | null) {
    if (kind === 'leave_request') {
        return {
            icon: CircleSlash,
            label: '休み希望',
            className: styles.availabilityLeave,
        };
    }
    if (kind === 'available') {
        return {
            icon: Sparkles,
            label: '空きあり',
            className: styles.availabilityAvailable,
        };
    }
    if (kind === 'holiday') {
        return {
            icon: CircleSlash,
            label: '休み',
            className: styles.availabilityHoliday,
        };
    }
    return null;
}

function buildAssignmentMarkers({ confirmedCount, pendingCount, totalCount }: DensitySummary) {
    const markers: AssignmentMarkerTone[] = [];
    const visibleCount = Math.min(totalCount, 4);
    const neutralCount = Math.max(0, totalCount - confirmedCount - pendingCount);

    for (let index = 0; index < Math.min(confirmedCount, visibleCount); index += 1) {
        markers.push('confirmed');
    }

    for (
        let index = 0;
        index < Math.min(pendingCount, visibleCount - markers.length);
        index += 1
    ) {
        markers.push('pending');
    }

    for (
        let index = 0;
        index < Math.min(neutralCount, visibleCount - markers.length);
        index += 1
    ) {
        markers.push('neutral');
    }

    while (markers.length < visibleCount) {
        markers.push('neutral');
    }

    return markers;
}

export function MonthCalendar({
    days,
    onSelectDate,
    selectedDate,
    availabilityTokens,
}: MonthCalendarProps) {
    const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

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

            <div className={styles.monthGrid}>
                {days.map((day) => {
                    const isSelected = selectedDate?.date === day.date;
                    const status = resolveDayStatus(day);
                    const density = buildDensitySummary(day, availabilityTokens);
                    const availabilityLabel = getAvailabilityLabel(density.availabilityKind);
                    const availabilityMeta = getAvailabilityMeta(density.availabilityKind);
                    const markers = buildAssignmentMarkers(density);
                    const total = Math.max(density.totalCount, 1);
                    const confirmedRatio =
                        density.totalCount === 0 ? 0 : density.confirmedCount / total;
                    const pendingRatio =
                        density.totalCount === 0 ? 0 : density.pendingCount / total;

                    return (
                        <button
                            type="button"
                            key={day.date}
                            className={[
                                styles.dayCell,
                                styles[`status_${status}`],
                                day.isToday ? styles.today : '',
                                !day.isCurrentMonth ? styles.otherMonth : '',
                                isSelected ? styles.selected : '',
                            ]
                                .filter(Boolean)
                                .join(' ')}
                            onClick={() => onSelectDate(day)}
                            aria-label={`${day.day}日 配置${density.totalCount}件${
                                availabilityLabel ? ` ${availabilityLabel}` : ''
                            }${density.pendingCount > 0 ? ' 要確認あり' : ''}`}
                        >
                            <div className={styles.dayCellTop}>
                                <span className={styles.dayNumber}>{day.day}</span>
                                {density.pendingCount > 0 && (
                                    <span className={styles.dayWarn} aria-hidden="true">
                                        <AlertCircle size={12} />
                                    </span>
                                )}
                            </div>

                            <div className={styles.dayDensity}>
                                <div className={styles.dayDensityTrack} aria-hidden="true">
                                    <span
                                        className={styles.dayDensityConfirmed}
                                        style={{ width: `${confirmedRatio * 100}%` }}
                                    />
                                    <span
                                        className={styles.dayDensityPending}
                                        style={{ width: `${pendingRatio * 100}%` }}
                                    />
                                </div>

                                <div className={styles.dayGlyphRow}>
                                    {density.totalCount > 0 && (
                                        <>
                                            <div className={styles.dayDotGroup} aria-hidden="true">
                                                {markers.map((marker, index) => (
                                                    <span
                                                        key={`${day.date}-${marker}-${index}`}
                                                        className={`${styles.dayDot} ${
                                                            marker === 'confirmed'
                                                                ? styles.dayDotConfirmed
                                                                : marker === 'pending'
                                                                  ? styles.dayDotPending
                                                                  : styles.dayDotNeutral
                                                        }`}
                                                    />
                                                ))}
                                            </div>
                                            <span className={styles.dayCountBadge}>
                                                {density.totalCount}
                                            </span>
                                        </>
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
            </div>
        </div>
    );
}
