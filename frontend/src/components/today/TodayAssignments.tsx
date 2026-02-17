import React from 'react';
import { MapPin, Briefcase } from 'lucide-react';
import type { Assignment } from '../../types/calendar';
import styles from './TodayComponents.module.css';

interface TodayAssignmentsProps {
    assignments: Assignment[];
}

export function TodayAssignments({ assignments }: TodayAssignmentsProps) {
    return (
        <div className={styles.assignmentsContainer}>
            <div className={styles.assignmentsHeader}>
                <Briefcase size={20} />
                <span>今日のアサイン</span>
            </div>

            {assignments.length === 0 ? (
                <div className={styles.emptyAssignments}>
                    <span>予定はありません</span>
                </div>
            ) : (
                assignments.map(assignment => (
                    <div key={assignment.id} className={styles.assignmentCard}>
                        <div className={styles.timeSlot}>
                            {assignment.start_time || '09:00'}
                        </div>
                        <div className={styles.siteName}>
                            {assignment.site_name}
                        </div>
                        <MapPin size={16} className="text-gray-400" />
                    </div>
                ))
            )}
        </div>
    );
}
