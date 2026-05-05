import { supabaseAdmin } from "../lib/supabaseAdmin";

export const PATH_REWARD_CALCULATION_SYSTEM = "path_v2";
export const PATH_REWARD_CALCULATION_VERSION = "path_v2";
export const BASE_POOL_RATE = 0.85;
export const VARIABLE_POOL_RATE = 0.15;

export const LEVEL_COEFFICIENTS = {
  L1: 0.85,
  L2: 1.0,
  L3: 1.15,
  L4: 1.3,
  L5: 1.45,
} as const;

export const MONTHLY_COEFFICIENT_RULES = [
  { min: 0, max: 1, coefficient: 0.9 },
  { min: 2, max: 4, coefficient: 1.0 },
  { min: 5, max: 6, coefficient: 1.1 },
] as const;

export type PathLevel = keyof typeof LEVEL_COEFFICIENTS;

export interface PathRewardProfitInputs {
  sales: number;
  outsourcing_cost: number;
  materials_cost: number;
  parking_cost: number;
  transport_cost: number;
  other_direct_cost: number;
  common_cost: number;
  reserve_amount: number;
}

export interface PathRewardMemberInput {
  member_id: string;
  name: string;
  work_days: number;
  level: PathLevel;
  A: number;
  R: number;
  Q: number;
}

export interface PathRewardMemberResult extends PathRewardMemberInput {
  level_coefficient: number;
  base_weight: number;
  monthly_point_total: number;
  monthly_coefficient: number;
  base_reward: number;
  variable_reward: number;
  total_reward: number;
}

export interface PathRewardPreview {
  calculation_system: typeof PATH_REWARD_CALCULATION_SYSTEM;
  calculation_version: typeof PATH_REWARD_CALCULATION_VERSION;
  month: string;
  profit_inputs: PathRewardProfitInputs;
  profit_amount: number;
  base_pool_rate: number;
  variable_pool_rate: number;
  base_pool_amount: number;
  variable_pool_amount: number;
  total_amount: number;
  member_count: number;
  members: PathRewardMemberResult[];
  constant_snapshot: {
    base_pool_rate: number;
    variable_pool_rate: number;
    level_coefficients: typeof LEVEL_COEFFICIENTS;
    monthly_coefficient_rules: typeof MONTHLY_COEFFICIENT_RULES;
  };
}

export interface RewardCalculationSnapshotRow {
  id: string;
  org_id: string;
  month: string;
  proposal_id: string;
  member_id: string;
  calculation_system: string;
  calculation_version: string;
  input_snapshot: Record<string, unknown>;
  result_snapshot: Record<string, unknown>;
  policy_snapshot: Record<string, unknown>;
  executed_by: Record<string, unknown> | null;
  finalized_at: string;
  created_at: string;
}

interface PathRewardPreviewInput {
  month: string;
  profit_inputs: PathRewardProfitInputs;
  members: PathRewardMemberInput[];
}

const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assert(condition: unknown, code: string): void {
  if (!condition) {
    throw new Error(code);
  }
}

function normalizeMoney(value: number): number {
  assert(Number.isFinite(value), "INVALID_MONEY_VALUE");
  return Math.round(value);
}

function distributeByWeights(total: number, weights: number[]): number[] {
  if (weights.length === 0) {
    return [];
  }

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  assert(totalWeight > 0, "INVALID_WEIGHT_TOTAL");

  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) {
      return remaining;
    }

    const amount = Math.round((total * weight) / totalWeight);
    remaining -= amount;
    return amount;
  });
}

export function resolveMonthlyCoefficient(monthlyPointTotal: number): number {
  const rule = MONTHLY_COEFFICIENT_RULES.find(
    ({ min, max }) => monthlyPointTotal >= min && monthlyPointTotal <= max,
  );

  if (!rule) {
    throw new Error("INVALID_MONTHLY_POINT_TOTAL");
  }

  return rule.coefficient;
}

export function calculateProfitAmount(input: PathRewardProfitInputs): number {
  return normalizeMoney(
    input.sales
      - input.outsourcing_cost
      - input.materials_cost
      - input.parking_cost
      - input.transport_cost
      - input.other_direct_cost
      - input.common_cost
      - input.reserve_amount,
  );
}

function validatePreviewInput(input: PathRewardPreviewInput): void {
  assert(MONTH_PATTERN.test(input.month), "INVALID_MONTH_FORMAT");
  assert(Array.isArray(input.members) && input.members.length > 0, "MEMBERS_REQUIRED");

  const profitAmount = calculateProfitAmount(input.profit_inputs);
  assert(profitAmount > 0, "NON_POSITIVE_PROFIT_AMOUNT");

  for (const member of input.members) {
    assert(UUID_PATTERN.test(member.member_id), "INVALID_MEMBER_ID");
    assert(typeof member.name === "string" && member.name.trim().length > 0, "INVALID_MEMBER_NAME");
    assert(Number.isFinite(member.work_days) && member.work_days >= 0, "INVALID_WORK_DAYS");
    assert(member.level in LEVEL_COEFFICIENTS, "INVALID_LEVEL");
    assert(Number.isInteger(member.A) && member.A >= 0 && member.A <= 2, "INVALID_A_SCORE");
    assert(Number.isInteger(member.R) && member.R >= 0 && member.R <= 2, "INVALID_R_SCORE");
    assert(Number.isInteger(member.Q) && member.Q >= 0 && member.Q <= 2, "INVALID_Q_SCORE");
  }

  const totalBaseWeight = input.members.reduce((sum, member) => {
    return sum + member.work_days * LEVEL_COEFFICIENTS[member.level];
  }, 0);
  assert(totalBaseWeight > 0, "BASE_WEIGHT_REQUIRED");
}

export class PathRewardService {
  constructor(private readonly orgId: string) {}

  calculatePreview(input: PathRewardPreviewInput): PathRewardPreview {
    validatePreviewInput(input);

    const normalizedProfitInputs: PathRewardProfitInputs = {
      sales: normalizeMoney(input.profit_inputs.sales),
      outsourcing_cost: normalizeMoney(input.profit_inputs.outsourcing_cost),
      materials_cost: normalizeMoney(input.profit_inputs.materials_cost),
      parking_cost: normalizeMoney(input.profit_inputs.parking_cost),
      transport_cost: normalizeMoney(input.profit_inputs.transport_cost),
      other_direct_cost: normalizeMoney(input.profit_inputs.other_direct_cost),
      common_cost: normalizeMoney(input.profit_inputs.common_cost),
      reserve_amount: normalizeMoney(input.profit_inputs.reserve_amount),
    };

    const profitAmount = calculateProfitAmount(normalizedProfitInputs);
    const basePoolAmount = Math.round(profitAmount * BASE_POOL_RATE);
    const variablePoolAmount = profitAmount - basePoolAmount;

    const membersWithDerived = input.members.map((member) => {
      const levelCoefficient = LEVEL_COEFFICIENTS[member.level];
      const monthlyPointTotal = member.A + member.R + member.Q;
      const monthlyCoefficient = resolveMonthlyCoefficient(monthlyPointTotal);

      return {
        ...member,
        level_coefficient: levelCoefficient,
        base_weight: member.work_days * levelCoefficient,
        monthly_point_total: monthlyPointTotal,
        monthly_coefficient: monthlyCoefficient,
      };
    });

    const baseRewards = distributeByWeights(
      basePoolAmount,
      membersWithDerived.map((member) => member.base_weight),
    );
    const variableRewards = distributeByWeights(
      variablePoolAmount,
      membersWithDerived.map((member) => member.monthly_coefficient),
    );

    const members = membersWithDerived.map((member, index) => ({
      ...member,
      base_reward: baseRewards[index] || 0,
      variable_reward: variableRewards[index] || 0,
      total_reward: (baseRewards[index] || 0) + (variableRewards[index] || 0),
    }));

    return {
      calculation_system: PATH_REWARD_CALCULATION_SYSTEM,
      calculation_version: PATH_REWARD_CALCULATION_VERSION,
      month: input.month,
      profit_inputs: normalizedProfitInputs,
      profit_amount: profitAmount,
      base_pool_rate: BASE_POOL_RATE,
      variable_pool_rate: VARIABLE_POOL_RATE,
      base_pool_amount: basePoolAmount,
      variable_pool_amount: variablePoolAmount,
      total_amount: members.reduce((sum, member) => sum + member.total_reward, 0),
      member_count: members.length,
      members,
      constant_snapshot: {
        base_pool_rate: BASE_POOL_RATE,
        variable_pool_rate: VARIABLE_POOL_RATE,
        level_coefficients: LEVEL_COEFFICIENTS,
        monthly_coefficient_rules: MONTHLY_COEFFICIENT_RULES,
      },
    };
  }

  buildProposalPayload(preview: PathRewardPreview): Record<string, unknown> {
    return {
      calculation_system: preview.calculation_system,
      calculation_version: preview.calculation_version,
      month: preview.month,
      profit_inputs: preview.profit_inputs,
      profit_amount: preview.profit_amount,
      base_pool_amount: preview.base_pool_amount,
      variable_pool_amount: preview.variable_pool_amount,
      constant_snapshot: preview.constant_snapshot,
      members: preview.members,
      amount_total: preview.total_amount,
      total_amount: preview.total_amount,
      currency: "JPY",
    };
  }

  async listSnapshots(params?: {
    month?: string;
    member_id?: string;
    proposal_id?: string;
    limit?: number;
  }): Promise<RewardCalculationSnapshotRow[]> {
    let query = supabaseAdmin
      .from("reward_calculation_snapshots")
      .select("*")
      .eq("org_id", this.orgId)
      .order("finalized_at", { ascending: false });

    if (params?.month) {
      query = query.eq("month", params.month);
    }

    if (params?.member_id) {
      query = query.eq("member_id", params.member_id);
    }

    if (params?.proposal_id) {
      query = query.eq("proposal_id", params.proposal_id);
    }

    if (typeof params?.limit === "number") {
      query = query.limit(params.limit);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch reward calculation snapshots: ${error.message}`);
    }

    return (data ?? []) as RewardCalculationSnapshotRow[];
  }
}
