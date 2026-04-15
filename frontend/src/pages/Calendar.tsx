import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ChevronLeft,
    ChevronRight,
    Calendar as CalendarIcon,
    CalendarCheck,
    Rows,
    Workflow,
} from 'lucide-react';
import { useCalendar } from '../hooks/useCalendar';
import { MonthCalendar } from '../components/calendar/MonthCalendar';
import { WeekCalendar } from '../components/calendar/WeekCalendar';
import { DayDetail } from '../components/calendar/DayDetail';
import { AssignmentSimulator } from '../components/calendar/AssignmentSimulator';
import styles from './Calendar.module.css';

function getTodayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function Calendar() {
    const {
        year, month, calendarDays, selectedDate,
        nextMonth, prevMonth, goToToday, selectDate, reloadAssignments
    } = useCalendar();

    const [viewMode, setViewMode] = useState<'month' | 'week' | 'simulator'>('month');

    const todayKey = getTodayKey();
    const now = new Date();
    const viewingCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    const showTodayFab =
        viewMode !== 'simulator' && (!viewingCurrentMonth || selectedDate?.date !== todayKey);

    return (
        <div
            className={`${styles.container} ${
                viewMode === 'simulator' ? styles.simulatorMode : ''
            }`}
        >
            <div className={styles.header}>
                <div className={styles.titleGroup}>
                    <h2 className={styles.monthTitle}>{year}年 {month}月</h2>
                </div>

                <div className={styles.navGroup}>
                    <button className={styles.todayBtn} onClick={goToToday}>
                        今日
                    </button>
                    <button className={styles.navBtn} onClick={prevMonth} aria-label="前月">
                        <ChevronLeft size={20} />
                    </button>
                    <button className={styles.navBtn} onClick={nextMonth} aria-label="翌月">
                        <ChevronRight size={20} />
                    </button>
                </div>
            </div>

            <div className={styles.viewToggle}>
                <button
                    className={`${styles.toggleBtn} ${viewMode === 'month' ? styles.active : ''}`}
                    onClick={() => setViewMode('month')}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <CalendarIcon size={14} />
                        <span>月表示</span>
                    </div>
                </button>
                <button
                    className={`${styles.toggleBtn} ${viewMode === 'week' ? styles.active : ''}`}
                    onClick={() => setViewMode('week')}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' }}>
                        <Rows size={14} />
                        <span>週表示</span>
                    </div>
                </button>
                <button
                    className={`${styles.toggleBtn} ${viewMode === 'simulator' ? styles.active : ''}`}
                    onClick={() => setViewMode('simulator')}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '4px',
                        }}
                    >
                        <Workflow size={14} />
                        <span>編成</span>
                    </div>
                </button>
            </div>

            {viewMode === 'simulator' ? (
                selectedDate ? (
                    <AssignmentSimulator
                        key={`${selectedDate.date}-${selectedDate.assignments.length}`}
                        day={selectedDate}
                        onCommitted={reloadAssignments}
                    />
                ) : null
            ) : (
                <motion.div
                    key={viewMode}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.2 }}
                >
                    {viewMode === 'month' ? (
                        <MonthCalendar
                            days={calendarDays}
                            onSelectDate={selectDate}
                            selectedDate={selectedDate}
                        />
                    ) : (
                        <WeekCalendar
                            days={calendarDays}
                            onSelectDate={selectDate}
                            selectedDate={selectedDate}
                        />
                    )}
                </motion.div>
            )}

            <AnimatePresence mode="wait">
                {viewMode !== 'simulator' && selectedDate && (
                    <motion.div
                        key={selectedDate.date}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        transition={{ duration: 0.2 }}
                    >
                        <DayDetail day={selectedDate} />
                    </motion.div>
                )}
            </AnimatePresence>

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
        </div>
    );
}
