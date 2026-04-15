import { AlertCircle } from 'lucide-react';
import type { CalendarDay } from '../../types/calendar';
import styles from './CalendarComponents.module.css';

interface MonthCalendarProps {
    days: CalendarDay[];
    onSelectDate: (date: CalendarDay) => void;
    selectedDate: CalendarDay | null;
}

type DayStatus = 'free' | 'busy' | 'attention' | 'holiday';

function resolveDayStatus(day: CalendarDay): DayStatus {
    if (day.shift?.available === false && day.assignments.length === 0) {
        return 'holiday';
    }
    if (day.assignments.some((a) => a.status === 'pending')) {
        return 'attention';
    }
    if (day.assignments.length > 0) {
        return 'busy';
    }
    return 'free';
}

function uniqueSiteNames(day: CalendarDay): string[] {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const a of day.assignments) {
        if (!a.site_name || seen.has(a.site_name)) continue;
        seen.add(a.site_name);
        names.push(a.site_name);
    }
    return names;
}

export function MonthCalendar({ days, onSelectDate, selectedDate }: MonthCalendarProps) {
    const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

    return (
        <div>
            <div className={styles.weekHeader}>
                {weekDays.map((dow, i) => (
                    <span
                        key={i}
                        className={styles.weekHeaderLabel}
                        data-weekday={i === 5 ? 'sat' : i === 6 ? 'sun' : 'weekday'}
                    >
                        {dow}
                    </span>
                ))}
            </div>

            <div className={styles.monthGrid}>
                {days.map((day) => {
                    const isSelected = selectedDate?.date === day.date;
                    const status = resolveDayStatus(day);
                    const siteNames = uniqueSiteNames(day);
                    const primarySite = siteNames[0];
                    const overflow = siteNames.length - 1;
                    const hasPending = status === 'attention';

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
                            aria-label={`${day.day}日${
                                primarySite ? ` ${primarySite}${overflow > 0 ? ` 他${overflow}件` : ''}` : ''
                            }${hasPending ? ' 要確認あり' : ''}`}
                        >
                            <div className={styles.dayCellTop}>
                                <span className={styles.dayNumber}>{day.day}</span>
                                {hasPending && (
                                    <span className={styles.dayWarn} aria-hidden="true">
                                        <AlertCircle size={12} />
                                    </span>
                                )}
                            </div>
                            {day.isCurrentMonth && primarySite && (
                                <div className={styles.dayCellBody}>
                                    <span className={styles.dayCellSite} title={primarySite}>
                                        {primarySite}
                                    </span>
                                    {overflow > 0 && (
                                        <span className={styles.dayCellOverflow}>+{overflow}</span>
                                    )}
                                </div>
                            )}
                            {day.isCurrentMonth && !primarySite && status === 'holiday' && (
                                <div className={styles.dayCellBody}>
                                    <span className={styles.dayCellHolidayLabel}>休</span>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
