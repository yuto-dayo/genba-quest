import React from 'react';
import type { CalendarDay } from '../../types/calendar';
import { MapPin } from 'lucide-react';
import styles from './CalendarComponents.module.css';

interface DayDetailProps {
    day: CalendarDay | null;
}

export function DayDetail({ day }: DayDetailProps) {
    if (!day) return null;

    const formatDate = (dateStr: string) => {
        const d = new Date(dateStr);
        const days = ['日', '月', '火', '水', '木', '金', '土'];
        return `${d.getMonth() + 1}月${d.getDate()}日 (${days[d.getDay()]})`;
    };

    return (
        <div className={styles.detailContainer}>
            <div className={styles.detailHeader}>
                <span className={styles.detailDate}>{formatDate(day.date)}</span>
                {day.shift?.available === false && (
                    <span style={{ color: 'var(--md-sys-color-error)', fontWeight: 500 }}>
                        休暇・不可
                    </span>
                )}
            </div>

            <div className={styles.assignmentList}>
                {day.assignments.length === 0 ? (
                    <div style={{
                        color: 'var(--md-sys-color-on-surface-variant)',
                        textAlign: 'center',
                        padding: '20px'
                    }}>
                        予定はありません
                    </div>
                ) : (
                    day.assignments.map(assignment => (
                        <div key={assignment.id} className={styles.assignmentCard}>
                            <div className={styles.timeSlot}>
                                {assignment.start_time || '未定'}
                            </div>
                            <div className={styles.siteInfo}>
                                <div className={styles.siteName}>{assignment.site_name}</div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: 'var(--md-sys-color-on-surface-variant)' }}>
                                    <MapPin size={12} />
                                    <span>現場ID: {assignment.site_id}</span>
                                </div>
                            </div>
                            <span className={`${styles.statusBadge} ${styles[assignment.status]}`}>
                                {assignment.status === 'pending' && '承認待ち'}
                                {assignment.status === 'scheduled' && '予定'}
                                {assignment.status === 'confirmed' && '確定'}
                                {assignment.status === 'completed' && '完了'}
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
