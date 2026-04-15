import { AlertCircle } from 'lucide-react';
import styles from './TodayComponents.module.css';

interface PendingBadgeProps {
    count: number;
    onClick?: () => void;
}

export function PendingBadge({ count, onClick }: PendingBadgeProps) {
    if (count === 0) return null;

    const content = (
        <>
            <AlertCircle size={14} />
            <span>承認待ち {count}件</span>
        </>
    );

    if (onClick) {
        return (
            <button type="button" className={styles.badgeButton} onClick={onClick}>
                <span className={styles.badgeContainer}>{content}</span>
            </button>
        );
    }

    return (
        <div className={styles.badgeContainer}>
            {content}
        </div>
    );
}
