// PATH V3.3 transparent governance reward service.
// Phase 1: pure aggregation function only. DB integration lands in later phases.
// Spec: docs/REWARD_SYSTEM_V33.md §3-4

export const PATH_V33_RULE_VERSION = "3.3.0-transparent";
export const PATH_V33_CALCULATION_SYSTEM = "path_v33_transparent";

export const PATH_V33_LEVEL_WEIGHT_MILLI = {
  L1: 410,
  L2: 512,
  L3: 640,
  L4: 800,
  L5: 1000,
} as const;

export type PathV33Level = keyof typeof PATH_V33_LEVEL_WEIGHT_MILLI;
export type PathV33Tier = 1 | 2 | 3;

export const PATH_V33_TIER_LABELS: Record<PathV33Tier, string> = {
  1: "補助",
  2: "標準",
  3: "主導",
};

export const PATH_V33_LEVEL_LABELS: Record<PathV33Level, string> = {
  L1: "見習い",
  L2: "補助主体",
  L3: "標準",
  L4: "中堅",
  L5: "熟練",
};

// Bucket boundaries: score < min skips. First match wins (descending order).
// Boundary semantics: score >= min → that level. So 1.3 → L2, 1.8 → L3, etc.
export const PATH_V33_SCORE_BUCKETS: ReadonlyArray<{ min: number; level: PathV33Level }> = [
  { min: 2.7, level: "L5" },
  { min: 2.2, level: "L4" },
  { min: 1.8, level: "L3" },
  { min: 1.3, level: "L2" },
  { min: 0, level: "L1" },
];

export interface PathV33Draft {
  site_id: string;
  tier: PathV33Tier;
  work_days: number;
}

export interface PathV33AggregationResult {
  level: PathV33Level;
  weight_milli: number;
  score: number;
  total_work_days: number;
  draft_count: number;
  drafts: PathV33Draft[];
}

export function bucketScoreToLevel(score: number): PathV33Level {
  for (const bucket of PATH_V33_SCORE_BUCKETS) {
    if (score >= bucket.min) {
      return bucket.level;
    }
  }
  return "L1";
}

// Aggregate per-site self-declared tiers into a monthly level via weighted average.
// Pure function — no IO. Drafts with work_days <= 0 are ignored (cannot weight).
// If no usable drafts exist, default to L1 (新人初期レベル per spec §2 Q4).
export function aggregateMonthlyLevel(
  drafts: ReadonlyArray<PathV33Draft>,
): PathV33AggregationResult {
  const usable = drafts.filter((d) => Number.isFinite(d.work_days) && d.work_days > 0);

  if (usable.length === 0) {
    return {
      level: "L1",
      weight_milli: PATH_V33_LEVEL_WEIGHT_MILLI.L1,
      score: 0,
      total_work_days: 0,
      draft_count: 0,
      drafts: [],
    };
  }

  let weightedTierSum = 0;
  let totalDays = 0;
  for (const d of usable) {
    if (d.tier !== 1 && d.tier !== 2 && d.tier !== 3) {
      throw new Error("PATH_V33_INVALID_TIER");
    }
    weightedTierSum += d.tier * d.work_days;
    totalDays += d.work_days;
  }

  const score = weightedTierSum / totalDays;
  const rounded = Math.round(score * 100) / 100;
  const level = bucketScoreToLevel(rounded);

  return {
    level,
    weight_milli: PATH_V33_LEVEL_WEIGHT_MILLI[level],
    score: rounded,
    total_work_days: totalDays,
    draft_count: usable.length,
    drafts: usable.map((d) => ({ site_id: d.site_id, tier: d.tier, work_days: d.work_days })),
  };
}

// Co-sign required count per spec §6: max(2, ceil(team_size / 3)).
// If the target member self-agrees, requirement drops by 1 (floor 1).
export function requiredCoSigns(teamSize: number, targetSelfAgreed: boolean): number {
  if (!Number.isFinite(teamSize) || teamSize < 1) {
    throw new Error("PATH_V33_INVALID_TEAM_SIZE");
  }
  const base = Math.max(2, Math.ceil(teamSize / 3));
  return targetSelfAgreed ? Math.max(1, base - 1) : base;
}
