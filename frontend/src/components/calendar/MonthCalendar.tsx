import React from 'react';
import type { CalendarDay } from '../../types/calendar';
import styles from './CalendarComponents.module.css';

interface MonthCalendarProps {
    days: CalendarDay[];
    onSelectDate: (date: CalendarDay) => void;
    selectedDate: CalendarDay | null;
}

export function MonthCalendar({ days, onSelectDate, selectedDate }: MonthCalendarProps) {
    const weekDays = ['月', '火', '水', '木', '金', '土', '日'];

    return (
        <div>
            {/* 曜日ヘッダー */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '8px', textAlign: 'center' }}>
                {weekDays.map((dow, i) => (
                    <span key={i} style={{
                        font: 'var(--md-sys-typescale-label-medium)',
                        color: i === 5 ? 'var(--md-sys-color-primary)' : i === 6 ? 'var(--md-sys-color-error)' : 'var(--md-sys-color-on-surface-variant)'
                    }}>
                        {dow}
                    </span>
                ))}
            </div>

            <div className={styles.monthGrid}>
                {days.map((day) => {
                    const isSelected = selectedDate?.date === day.date;
                    const hasAssignment = day.assignments.length > 0;
                    const isHoliday = day.shift?.available === false;

                    return (
                        <div
                            key={day.date}
                            className={`${styles.dayCell} ${day.isToday ? styles.today : ''} ${!day.isCurrentMonth ? styles.otherMonth : ''} ${isSelected ? styles.selected : ''}`}
                            onClick={() => onSelectDate(day)}
                        >
                            <span className={styles.dayNumber}>{day.day}</span>
                            <div className={styles.indicators}>
                                {hasAssignment && <div className={`${styles.dot} ${styles.assignment}`} />}
                                {isHoliday && <div className={`${styles.dot} ${styles.holiday}`} />}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
