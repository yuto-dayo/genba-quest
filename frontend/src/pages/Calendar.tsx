import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Rows } from 'lucide-react';
import { useCalendar } from '../hooks/useCalendar';
import { MonthCalendar } from '../components/calendar/MonthCalendar';
import { WeekCalendar } from '../components/calendar/WeekCalendar';
import { DayDetail } from '../components/calendar/DayDetail';
import styles from './Calendar.module.css';

export function Calendar() {
    const {
        year, month, calendarDays, selectedDate,
        nextMonth, prevMonth, goToToday, selectDate
    } = useCalendar();

    const [viewMode, setViewMode] = useState<'month' | 'week'>('month');

    return (
        <div className={styles.container}>
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
            </div>

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

            <AnimatePresence mode="wait">
                {selectedDate && (
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
        </div>
    );
}
