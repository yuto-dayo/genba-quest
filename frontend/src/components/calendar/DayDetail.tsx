import type { CalendarDay } from '../../types/calendar';
import type { AssignmentStatus } from '../../types/calendar';
import { AlertCircle, Building2, Calendar as CalendarIcon, Check, CheckCircle2, Clock3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import styles from './CalendarComponents.module.css';

interface DayDetailProps {
    day: CalendarDay | null;
}

const STATUS_META: Record<
    AssignmentStatus,
    { label: string; icon: LucideIcon; className: string }
> = {
    pending: { label: '要確認', icon: AlertCircle, className: 'pending' },
    confirmed: { label: '確定', icon: CheckCircle2, className: 'confirmed' },
    scheduled: { label: '予定', icon: CalendarIcon, className: 'scheduled' },
    completed: { label: '完了', icon: Check, className: 'completed' },
};

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
                    <span className={styles.detailHolidayTag}>
                        <AlertCircle size={14} aria-hidden="true" />
                        休暇・不可
                    </span>
                )}
            </div>

            <div className={styles.assignmentList}>
                {day.assignments.length === 0 ? (
                    <div className={styles.detailEmpty}>予定はありません</div>
                ) : (
                    day.assignments.map((assignment) => {
                        const meta = STATUS_META[assignment.status];
                        const Icon = meta.icon;
                        return (
                            <div key={assignment.id} className={styles.assignmentCard}>
                                <div className={styles.timeSlot}>
                                    <Clock3 size={12} aria-hidden="true" />
                                    <span>{assignment.start_time || '未定'}</span>
                                </div>
                                <div className={styles.siteInfo}>
                                    <div className={styles.siteName}>{assignment.site_name}</div>
                                    {assignment.client_name && (
                                        <div className={styles.clientRow}>
                                            <Building2 size={12} aria-hidden="true" />
                                            <span>{assignment.client_name}</span>
                                        </div>
                                    )}
                                </div>
                                <span
                                    className={`${styles.statusBadge} ${styles[meta.className]}`}
                                    aria-label={meta.label}
                                >
                                    <Icon size={12} aria-hidden="true" />
                                    <span>{meta.label}</span>
                                </span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
