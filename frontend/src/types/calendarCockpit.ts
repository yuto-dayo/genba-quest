export type CalendarScope = 'organization' | 'personal';

export type CalendarWorkflow = 'operations' | 'proposals' | 'scenarios';

export type CalendarDisplayMode = 'month' | 'week' | 'dispatch';

export type ProposalLifecycle =
    | 'draft'
    | 'pending'
    | 'approved'
    | 'executed'
    | 'rejected';

export type ProposalEffect =
    | 'add'
    | 'move'
    | 'remove'
    | 'leave_request'
    | 'availability_update';

export type ProposalEvaluation = 'ok' | 'warning' | 'blocking_conflict';

export type ProposalRelevance = 'mine' | 'requires_my_action' | 'watch_only';

export interface DecisionSummaryStat {
    id: string;
    label: string;
    value: string;
    caption: string;
    tone?: 'neutral' | 'ok' | 'warn';
}
