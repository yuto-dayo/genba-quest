import type {
    PathCertificationStatus,
    PathDifficultyBand,
    PathLevel,
    PathQualityResult,
    PathRoleType,
    PathTradeFamily,
} from "../../../lib/api";

export type RewardMemberDraft = {
    member_id: string;
    name: string;
    credited_units: number;
    role_level: PathLevel | "";
    A: number;
    R: number;
    Q: number;
    guaranteed_pay: number;
    package_id: string;
    trade_family: PathTradeFamily;
    std_hours: number;
    difficulty_band: PathDifficultyBand;
    responsibility_share: number;
    role_type: PathRoleType;
    quality_result: PathQualityResult;
    rated_units: number;
};

export type WorkflowTone = "neutral" | "info" | "warn" | "good";
export type MemberWorkflowStage =
    | "missing_form"
    | "needs_ai"
    | "needs_finalize"
    | "needs_reward"
    | "done";
export type WorkflowStepState = "todo" | "doing" | "done";

export interface MemberWorkflowSummary {
    stage: MemberWorkflowStage;
    label: string;
    tone: WorkflowTone;
    nextAction: string;
    description: string;
}

export interface RewardCardBreakdownItem {
    label: string;
    value: string;
    helper?: string;
}

export interface RewardCardBreakdown {
    formula: string;
    note?: string;
    inputs: RewardCardBreakdownItem[];
}

export interface SelectedSiteSummary {
    siteIds: string[];
    labels: string[];
    sourceLabel: string | null;
    helper: string;
}

export interface RewardSourceLineageCard {
    id: string;
    siteId: string | null;
    title: string;
    badge: string;
    highlightLabel: string | null;
    value: string;
    helper: string;
    selected: boolean;
}

export interface WorkflowStepCard {
    title: string;
    state: WorkflowStepState;
    helper: string;
}

export interface PathCalculationMember {
    member_id: string;
    name: string;
    work_days: number;
    level: string;
    A: number;
    R: number;
    Q: number;
    monthly_point_total: number;
    monthly_coefficient: number;
    base_reward: number;
    variable_reward: number;
    total_reward: number;
}

export interface PathCalculationRun {
    proposal_id: string;
    month: string;
    finalized_at: string;
    calculation_version: string;
    profit_amount: number;
    base_pool_amount: number;
    variable_pool_amount: number;
    total_amount: number;
    members: PathCalculationMember[];
}

export interface LegacyRewardComparisonRow {
    member_id: string;
    name: string;
    pathAmount: number;
    luqoAmount: number;
    delta: number;
}

export type CertificationStatusLabelMap = Record<PathCertificationStatus, string>;
