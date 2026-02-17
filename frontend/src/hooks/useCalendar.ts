import { useState, useMemo, useCallback } from 'react';
import type { CalendarDay, Assignment, Shift } from '../types/calendar';

// モックデータ生成ヘルパー
const generateMockData = (year: number, month: number): CalendarDay[] => {
    const days: CalendarDay[] = [];
    const firstDay = new Date(year, month - 1, 1);

    // カレンダーの開始日（前の月の残りと合わせる）
    const startDate = new Date(firstDay);
    startDate.setDate(startDate.getDate() - startDate.getDay() + 1); // 月曜始まり

    // 6週間分生成（42日）
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 41);

    const currentDate = new Date(startDate);
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    while (currentDate <= endDate) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        const isCurrentMonth = currentDate.getMonth() === month - 1;
        const dayOfWeek = currentDate.getDay(); // 0: Sun, 1: Mon...
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

        // モックアサイン生成
        const assignments: Assignment[] = [];
        // ランダムにアサインを追加（平日のみ、確率30%）
        if (!isWeekend && Math.random() < 0.3) {
            assignments.push({
                id: `assign-${dateStr}`,
                user_id: 'user-1',
                site_id: 'site-1',
                site_name: Math.random() > 0.5 ? '渋谷再開発プロジェクト' : '新宿駅前ビル工事',
                date: dateStr,
                status: Math.random() > 0.8 ? 'pending' : (currentDate < today ? 'completed' : 'scheduled'),
                start_time: '09:00',
                end_time: '18:00'
            });
        }

        // モックシフト生成
        const shift: Shift = {
            id: `shift-${dateStr}`,
            user_id: 'user-1',
            date: dateStr,
            available: !isWeekend, // 土日は休み設定
            note: isWeekend ? '定休日' : undefined
        };

        days.push({
            date: dateStr,
            day: currentDate.getDate(),
            shift,
            assignments,
            isToday: dateStr === todayStr,
            isCurrentMonth,
            isWeekend
        });

        currentDate.setDate(currentDate.getDate() + 1);
    }

    return days;
};

export const useCalendar = () => {
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<CalendarDay | null>(null);

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth() + 1;

    const calendarDays = useMemo(() => generateMockData(year, month), [year, month]);

    // 月が変わったら今日の日付を選択（初回含む）
    const currentMonthKey = `${year}-${month}`;
    const [lastMonthKey, setLastMonthKey] = useState('');
    if (currentMonthKey !== lastMonthKey) {
        setLastMonthKey(currentMonthKey);
        const today = calendarDays.find(d => d.isToday);
        if (today) {
            setSelectedDate(today);
        }
    }

    const nextMonth = useCallback(() => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));
    }, []);

    const prevMonth = useCallback(() => {
        setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
    }, []);

    const goToToday = useCallback(() => {
        const now = new Date();
        setCurrentDate(now);
        // selectedDateはuseEffectで更新される
    }, []);

    const selectDate = useCallback((date: CalendarDay) => {
        setSelectedDate(date);
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
        selectDate
    };
};
