import type { CSSProperties } from 'react';
import { CircleSlash, Sparkles } from 'lucide-react';
import type { AvailabilityTokenKind, CalendarDay } from '../../types/calendar';
import styles from './CalendarComponents.module.css';

interface WeekCalendarProps {
    days: CalendarDay[];
    onSelectDate: (date: CalendarDay) => void;
    selectedDate: CalendarDay | null;
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>;
}

function resolveAvailabilityLabel(
    day: CalendarDay,
    availabilityTokens?: Partial<Record<string, AvailabilityTokenKind>>
): string | null {
    const kind = availabilityTokens?.[day.date];
    if (kind === 'leave_request') {
        return '休み希望';
    }
    if (kind === 'available') {
        return '空きあり';
    }
    if (day.shift?.available === false) {
        return day.shift.note === '定休日' ? '休' : '休み希望';
    }
    return null;
}

function getAvailabilityMeta(label: string | null) {
    if (label === '空きあり') {
        return {
            icon: Sparkles,
            className: styles.availabilityAvailable,
            label,
        };
    }
    if (label === '休み希望' || label === '休') {
        return {
            icon: CircleSlash,
            className: label === '休' ? styles.availabilityHoliday : styles.availabilityLeave,
            label,
        };
    }
    return null;
}

export function WeekCalendar({
    days,
    onSelectDate,
    selectedDate,
    availabilityTokens,
}: WeekCalendarProps) {
    const targetDate = selectedDate || days.find((d) => d.isToday) || days[0];
    const targetIndex = days.findIndex((d) => d.date === targetDate.date);

    let startIndex = 0;
    if (targetIndex !== -1) {
        startIndex = Math.floor(targetIndex / 7) * 7;
    }

    if (startIndex < 0) startIndex = 0;
    if (startIndex >= days.length) startIndex = Math.max(0, days.length - 7);

    const weekDays = days.slice(startIndex, startIndex + 7);
    const weekLabels = ['月', '火', '水', '木', '金', '土', '日'];

    return (
        <div className={styles.weekGrid}>
            {weekDays.map((day, index) => {
                const isSelected = selectedDate?.date === day.date;
                const confirmedCount = day.assignments.filter(
                    (assignment) =>
                        assignment.status === 'confirmed' ||
                        assignment.status === 'scheduled' ||
                        assignment.status === 'completed'
                ).length;
                const pendingCount = day.assignments.filter(
                    (assignment) => assignment.status === 'pending'
                ).length;
                const totalCount = day.assignments.length;
                const availabilityLabel = resolveAvailabilityLabel(day, availabilityTokens);
                const availabilityMeta = getAvailabilityMeta(availabilityLabel);
                const total = Math.max(totalCount, 1);
                const meterStyle = {
                    '--week-confirmed-angle': `${(confirmedCount / total) * 360}deg`,
                    '--week-pending-angle': `${((confirmedCount + pendingCount) / total) * 360}deg`,
                } as CSSProperties;

                return (
                    <button
                        key={day.date}
                        type="button"
                        className={`${styles.weekDay} ${isSelected ? styles.selected : ''}`}
                        onClick={() => onSelectDate(day)}
                    >
                        <span className={styles.weekDayLabel}>{weekLabels[index]}</span>
                        <div className={styles.weekMeter} style={meterStyle} aria-hidden="true">
                            <span className={styles.weekMeterCircle}>
                                <span className={styles.weekMeterCore}>{day.day}</span>
                            </span>
                        </div>

                        <div className={styles.weekDayMeta}>
                            <span className={styles.weekCountBadge}>{totalCount}</span>
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
                    </button>
                );
            })}
        </div>
    );
}
