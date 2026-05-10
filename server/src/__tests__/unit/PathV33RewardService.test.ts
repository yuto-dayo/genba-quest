jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import {
  aggregateMonthlyLevel,
  bucketScoreToLevel,
  requiredCoSigns,
  PATH_V33_LEVEL_WEIGHT_MILLI,
  PathV33Draft,
} from "../../services/PathV33RewardService";

describe("PathV33RewardService.bucketScoreToLevel", () => {
  it("maps below-1.3 to L1", () => {
    expect(bucketScoreToLevel(0)).toBe("L1");
    expect(bucketScoreToLevel(1.0)).toBe("L1");
    expect(bucketScoreToLevel(1.29)).toBe("L1");
  });

  it("maps L2 boundary (1.3) inclusive", () => {
    expect(bucketScoreToLevel(1.3)).toBe("L2");
    expect(bucketScoreToLevel(1.79)).toBe("L2");
  });

  it("maps L3 boundary (1.8) inclusive", () => {
    expect(bucketScoreToLevel(1.8)).toBe("L3");
    expect(bucketScoreToLevel(2.19)).toBe("L3");
  });

  it("maps L4 boundary (2.2) inclusive", () => {
    expect(bucketScoreToLevel(2.2)).toBe("L4");
    expect(bucketScoreToLevel(2.69)).toBe("L4");
  });

  it("maps L5 boundary (2.7) inclusive", () => {
    expect(bucketScoreToLevel(2.7)).toBe("L5");
    expect(bucketScoreToLevel(3.0)).toBe("L5");
  });
});

describe("PathV33RewardService.aggregateMonthlyLevel", () => {
  it("returns L1 default when no drafts", () => {
    const result = aggregateMonthlyLevel([]);
    expect(result.level).toBe("L1");
    expect(result.weight_milli).toBe(PATH_V33_LEVEL_WEIGHT_MILLI.L1);
    expect(result.score).toBe(0);
    expect(result.total_work_days).toBe(0);
    expect(result.draft_count).toBe(0);
  });

  it("ignores drafts with zero or negative work_days", () => {
    const drafts: PathV33Draft[] = [
      { site_id: "a", tier: 3, work_days: 0 },
      { site_id: "b", tier: 1, work_days: -1 },
    ];
    const result = aggregateMonthlyLevel(drafts);
    expect(result.level).toBe("L1");
    expect(result.draft_count).toBe(0);
  });

  it("matches spec §4 worked example: 主導×5 + 標準×8 + 補助×2 → L4 score 2.20", () => {
    const drafts: PathV33Draft[] = [
      { site_id: "X", tier: 3, work_days: 5 },
      { site_id: "Y", tier: 2, work_days: 8 },
      { site_id: "Z", tier: 1, work_days: 2 },
    ];
    const result = aggregateMonthlyLevel(drafts);
    expect(result.score).toBe(2.2);
    expect(result.level).toBe("L4");
    expect(result.weight_milli).toBe(800);
    expect(result.total_work_days).toBe(15);
    expect(result.draft_count).toBe(3);
  });

  it("all-tier-1 across many days → L1", () => {
    const drafts: PathV33Draft[] = [
      { site_id: "a", tier: 1, work_days: 10 },
      { site_id: "b", tier: 1, work_days: 5 },
    ];
    const result = aggregateMonthlyLevel(drafts);
    expect(result.score).toBe(1);
    expect(result.level).toBe("L1");
  });

  it("all-tier-3 → L5 熟練", () => {
    const drafts: PathV33Draft[] = [
      { site_id: "a", tier: 3, work_days: 4 },
      { site_id: "b", tier: 3, work_days: 6 },
    ];
    const result = aggregateMonthlyLevel(drafts);
    expect(result.score).toBe(3);
    expect(result.level).toBe("L5");
    expect(result.weight_milli).toBe(1000);
  });

  it("single 主導 day on a 1-day month → L5 (no minimum work-day floor per spec)", () => {
    const result = aggregateMonthlyLevel([{ site_id: "a", tier: 3, work_days: 1 }]);
    expect(result.level).toBe("L5");
  });

  it("rejects invalid tier values", () => {
    expect(() =>
      aggregateMonthlyLevel([{ site_id: "a", tier: 5 as 3, work_days: 1 }]),
    ).toThrow("PATH_V33_INVALID_TIER");
  });

  it("rounds score to 2 decimals to keep boundary behavior deterministic", () => {
    // (2*1 + 3*1) / 2 = 2.5 → L4
    const result = aggregateMonthlyLevel([
      { site_id: "a", tier: 2, work_days: 1 },
      { site_id: "b", tier: 3, work_days: 1 },
    ]);
    expect(result.score).toBe(2.5);
    expect(result.level).toBe("L4");
  });
});

describe("PathV33RewardService.requiredCoSigns", () => {
  it("matches spec §6 table for non-self-agreed", () => {
    expect(requiredCoSigns(2, false)).toBe(2);
    expect(requiredCoSigns(3, false)).toBe(2);
    expect(requiredCoSigns(6, false)).toBe(2);
    expect(requiredCoSigns(7, false)).toBe(3);
    expect(requiredCoSigns(9, false)).toBe(3);
    expect(requiredCoSigns(10, false)).toBe(4);
    expect(requiredCoSigns(13, false)).toBe(5);
  });

  it("drops by 1 when target self-agrees, never below 1", () => {
    expect(requiredCoSigns(2, true)).toBe(1);
    expect(requiredCoSigns(7, true)).toBe(2);
    expect(requiredCoSigns(13, true)).toBe(4);
  });

  it("rejects invalid team sizes", () => {
    expect(() => requiredCoSigns(0, false)).toThrow("PATH_V33_INVALID_TEAM_SIZE");
    expect(() => requiredCoSigns(-1, false)).toThrow("PATH_V33_INVALID_TEAM_SIZE");
  });
});
