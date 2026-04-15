export type SimulatorWarningClass = 'BLOCK' | 'WARN' | 'INFO';

export type SimulatorWarningCode =
    | 'slot_full'
    | 'double_booking'
    | 'skill_gap'
    | 'over_limit';

export type SimulatorSkillLevel = 'bronze' | 'silver' | 'gold';

export interface SimulatorWorker {
    user_id: string;
    name: string;
    skills: string[];
    assigned_days: number;
    max_days: number;
}

export interface SimulatorSlot {
    slot_id: string;
    site_id: string;
    site_name: string;
    date: string;
    required_skill: string;
    required_level: SimulatorSkillLevel;
    required_count: number;
}

export type SimulatorPlacementSource = 'committed' | 'draft';

export interface SimulatorPlacement {
    id: string;
    source: SimulatorPlacementSource;
    worker_id: string;
    slot_id: string;
    site_id: string;
    site_name: string;
    date: string;
    warning_codes: SimulatorWarningCode[];
}

export interface SimulatorWarning {
    id: string;
    source: 'draft' | 'attempt';
    class: SimulatorWarningClass;
    code: SimulatorWarningCode;
    message: string;
    worker_id: string;
    slot_id: string;
}

export interface SimulatorCommitResult {
    ok: boolean;
    total_proposals: number;
    pending_count: number;
    auto_approved_count: number;
    message: string;
}

export interface SimulatorCommitPayload {
    placements: Array<{
        worker_id: string;
        slot_id: string;
        site_id: string;
        site_name: string;
        date: string;
    }>;
    override_reason: string;
}
