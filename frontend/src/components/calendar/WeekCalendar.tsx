import React from 'react';
import type { CalendarDay } from '../../types/calendar';
import styles from './CalendarComponents.module.css';

interface WeekCalendarProps {
    days: CalendarDay[];
    onSelectDate: (date: CalendarDay) => void;
    selectedDate: CalendarDay | null;
}

export function WeekCalendar({ days, onSelectDate, selectedDate }: WeekCalendarProps) {
    // 選択された日が含まれる週を表示、または今日が含まれる週
    const targetDate = selectedDate || days.find(d => d.isToday) || days[0];

    // targetDateが含まれる週の始まり（月曜）を探す
    // daysは連続している前提
    const targetIndex = days.findIndex(d => d.date === targetDate.date);
    // targetIndexから遡って月曜を探す、あるいは単に7日分表示する
    // generateMockDataは月曜始まりで生成しているので、配列のインデックスを7で割れば週がわかる

    let startIndex = 0;
    if (targetIndex !== -1) {
        startIndex = Math.floor(targetIndex / 7) * 7;
    }

    // 範囲外チェック
    if (startIndex < 0) startIndex = 0;
    if (startIndex >= days.length) startIndex = days.length - 7;

    const weekDays = days.slice(startIndex, startIndex + 7);
    const weekLabels = ['月', '火', '水', '木', '金', '土', '日'];

    return (
        <div className={styles.weekGrid}>
            {weekDays.map((day, i) => {
                const isSelected = selectedDate?.date === day.date;
                return (
                    <div
                        key={day.date}
                        className={`${styles.weekDay} ${isSelected ? styles.selected : ''}`}
                        onClick={() => onSelectDate(day)}
                    >
                        <span className={styles.weekDayLabel}>{weekLabels[i]}</span>
                        <span className={styles.weekDayNumber}>{day.day}</span>
                        <div className={styles.indicators}>
                            {day.assignments.length > 0 && <div className={`${styles.dot} ${styles.assignment}`} style={{ backgroundColor: isSelected ? 'white' : '' }} />}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
