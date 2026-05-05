export interface Shift {
    id: string;
    user_id: string;
    date: string; // YYYY-MM-DD
    available: boolean;
    note?: string;
}

export type AvailabilityTokenKind = 'leave_request' | 'available';
export type CalendarPersonalScheduleType =
    | 'event'
    | 'task'
    | 'vacation'
    | 'sick_leave'
    | 'business_trip'
    | 'training';
export type CalendarPersonalScheduleStatus = 'pending' | 'approved';
export type CalendarPersonalScheduleVisibility = 'personal' | 'organization';

export interface CalendarPersonalSchedule {
    id: string;
    user_id: string;
    start_date: string;
    end_date: string;
    type: CalendarPersonalScheduleType;
    title: string;
    start_time?: string | null;
    end_time?: string | null;
    address?: string | null;
    color?: string | null;
    blocks_assignment: boolean;
    visibility: CalendarPersonalScheduleVisibility;
    reason?: string | null;
    approved: boolean;
    status: CalendarPersonalScheduleStatus;
    source: 'personal_schedule' | 'proposal';
}

export type AssignmentStatus = 'pending' | 'tentative' | 'scheduled' | 'confirmed' | 'completed';

export interface Assignment {
    id: string;
    user_id: string;
    site_id: string;
    site_name: string;
    client_name?: string;
    client_color?: string | null;
    client_color_text?: string | null;
    date: string; // YYYY-MM-DD
    status: AssignmentStatus;
    start_time?: string;
    end_time?: string;
    source?: "proposal" | "site";
    proposal_type?: "assignment.create" | "assignment.update" | "assignment.cancel";
    worker_count?: number;
}

// UI用の日別データ
export interface CalendarDay {
    date: string; // YYYY-MM-DD
    day: number;
    shift?: Shift;
    assignments: Assignment[];
    personal_schedules: CalendarPersonalSchedule[];
    isToday: boolean;
    isCurrentMonth: boolean;
    isWeekend: boolean;
}
