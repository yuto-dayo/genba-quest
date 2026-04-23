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

    const formatTimeRange = (start?: string, end?: string) => {
        if (start && end) {
            return `${start} - ${end}`;
        }
        if (start) {
            return start;
        }
        if (end) {
            return end;
        }
        return '未定';
    };

    return (
        <div className={styles.detailContainer}>
            <div className={styles.detailHeader}>
                <span className={styles.detailDate}>{formatDate(day.date)}</span>
                <div className={styles.detailMeta}>
                    <span className={styles.detailCountPill}>{day.assignments.length}</span>
                    {day.shift?.available === false && (
                        <span className={styles.detailHolidayTag}>
                            <AlertCircle size={14} aria-hidden="true" />
                            休み
                        </span>
                    )}
                </div>
            </div>

            <div className={styles.assignmentList}>
                {day.assignments.length === 0 ? (
                    <div className={styles.detailEmpty}>予定はありません</div>
                ) : (
                    day.assignments.map((assignment) => {
                        const meta = STATUS_META[assignment.status];
                        const Icon = meta.icon;
                        return (
                            <div
                                key={assignment.id}
                                className={`${styles.assignmentCard} ${styles[`assignment_${meta.className}`]}`}
                            >
                                <div className={styles.assignmentContent}>
                                    <div className={styles.assignmentTopLine}>
                                        <div className={styles.timeSlot}>
                                            <Clock3 size={12} aria-hidden="true" />
                                            <span>
                                                {formatTimeRange(
                                                    assignment.start_time,
                                                    assignment.end_time
                                                )}
                                            </span>
                                        </div>
                                        <span
                                            className={`${styles.statusIconBadge} ${styles[meta.className]}`}
                                            aria-label={meta.label}
                                        >
                                            <Icon size={14} aria-hidden="true" />
                                        </span>
                                    </div>
                                    <div className={styles.siteName}>{assignment.site_name}</div>
                                    {assignment.client_name && (
                                        <div className={styles.clientRow}>
                                            <Building2 size={12} aria-hidden="true" />
                                            <span>{assignment.client_name}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}
