export const PATH_V31_CUTOVER_DATE = process.env.PATH_V31_CUTOVER_DATE || "2026-05-01";

function assertDate(value: string, code: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(code);
  }

  return value;
}

export const PATH_V31_CUTOVER_MONTH = assertDate(
  PATH_V31_CUTOVER_DATE,
  "INVALID_PATH_V31_CUTOVER_DATE",
).slice(0, 7);

export const PATH_V31_RULE_VERSION = "3.1.0";
export const PATH_V31_ENGINE_VERSION = "path_v31-engine-2026-04-22";

export const PATH_V31_DEFAULT_RULE_CONSTANTS = {
  FLOOR_RATE: 0.35,
  RESULT_RATE: 0.65,
  NONLINEAR_EXPONENT: 1.12,
  ROLE_COEFFICIENTS: {
    assist: 1.0,
    lead: 1.8,
    solo: 2.4,
    support: 0.0,
  },
  SPEED_COEFFICIENTS: {
    slow: 0.97,
    normal: 1.0,
    fast: 1.05,
  },
  LEAD_BASELINE_RATIO_STANDARD: 0.9,
  LEAD_BASELINE_RATIO_HIGH_RISK: 0.93,
  FIXED_TEMPLATES: {
    solo_100: [{ slot: 1, share_ratio: 1.0 }],
    lead_assist_70_30: [
      { slot: 1, share_ratio: 0.7 },
      { slot: 2, share_ratio: 0.3 },
    ],
    co_lead_50_50: [
      { slot: 1, share_ratio: 0.5 },
      { slot: 2, share_ratio: 0.5 },
    ],
    lead_assist2_60_25_15: [
      { slot: 1, share_ratio: 0.6 },
      { slot: 2, share_ratio: 0.25 },
      { slot: 3, share_ratio: 0.15 },
    ],
    lead_training_60_40: [
      { slot: 1, share_ratio: 0.6 },
      { slot: 2, share_ratio: 0.4 },
    ],
  },
} as const;

export function monthFromDate(value: string): string {
  return assertDate(value, "INVALID_DATE_FORMAT").slice(0, 7);
}

export function isOnOrAfterCutoverDate(value: string): boolean {
  return assertDate(value, "INVALID_DATE_FORMAT") >= PATH_V31_CUTOVER_DATE;
}

export function isOnOrAfterCutoverMonth(value: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(value)) {
    throw new Error("INVALID_MONTH_FORMAT");
  }

  return value >= PATH_V31_CUTOVER_MONTH;
}

export function assertV22WriteAllowed(input: { month?: string | null; date?: string | null }): void {
  if (input.month && isOnOrAfterCutoverMonth(input.month)) {
    throw new Error("PATH_V31_CUTOVER_ENFORCED");
  }

  if (input.date && isOnOrAfterCutoverDate(input.date)) {
    throw new Error("PATH_V31_CUTOVER_ENFORCED");
  }
}
