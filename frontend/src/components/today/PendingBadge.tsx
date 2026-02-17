import React from 'react';
import { AlertCircle } from 'lucide-react';
import styles from './TodayComponents.module.css';

interface PendingBadgeProps {
    count: number;
}

export function PendingBadge({ count }: PendingBadgeProps) {
    if (count === 0) return null;

    return (
        <div className={styles.badgeContainer}>
            <AlertCircle size={14} />
            <span>承認待ち {count}件</span>
        </div>
    );
}
