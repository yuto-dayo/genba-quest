export interface Shift {
    id: string;
    user_id: string;
    date: string; // YYYY-MM-DD
    available: boolean;
    note?: string;
}

export type AssignmentStatus = 'pending' | 'scheduled' | 'confirmed' | 'completed';

export interface Assignment {
    id: string;
    user_id: string;
    site_id: string;
    site_name: string;
    date: string; // YYYY-MM-DD
    status: AssignmentStatus;
    start_time?: string;
    end_time?: string;
}

// UI用の日別データ
export interface CalendarDay {
    date: string; // YYYY-MM-DD
    day: number;
    shift?: Shift;
    assignments: Assignment[];
    isToday: boolean;
    isCurrentMonth: boolean;
    isWeekend: boolean;
}
