jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import {
  aggregateMonthlyLevel,
  bucketScoreToLevel,
  PathV33RewardService,
  requiredCoSigns,
  PATH_V33_LEVEL_WEIGHT_MILLI,
  PathV33Draft,
} from "../../services/PathV33RewardService";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

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

describe("PathV33RewardService.submitLevelDraft deadline guard", () => {
  const ORG_ID = "00000000-0000-4000-8000-000000000001";
  const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
  const SITE_ID = "22222222-2222-4222-8222-222222222222";
  const ACTOR = {
    type: "human" as const,
    id: MEMBER_ID,
    name: "Worker",
  };
  const DRAFT_ROW = {
    id: "33333333-3333-4333-8333-333333333333",
    org_id: ORG_ID,
    site_id: SITE_ID,
    member_id: MEMBER_ID,
    tier: 2,
    work_days: 2,
    self_comment: "",
    evidence: {},
    submitted_at: "2026-05-10T00:00:00.000Z",
    locked_at: null,
  };

  beforeAll(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function mockSubmitLevelDraftFlow(options: {
    completedAt: string | null;
    existingLockedAt?: string | null;
  }) {
    const existingDraft =
      typeof options.existingLockedAt === "string" ? { locked_at: options.existingLockedAt } : null;
    const siteRow = {
      id: SITE_ID,
      org_id: ORG_ID,
      completed_at: options.completedAt,
      created_at: "2026-05-01T00:00:00.000Z",
    };
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({ data: siteRow, error: null }),
      createChain({ data: [{ date: "2026-05-03" }, { date: "2026-05-04" }], error: null }),
      createChain({ data: existingDraft, error: null }),
      createChain({ data: DRAFT_ROW, error: null }),
      createChain({ data: [siteRow], error: null }),
      createChain({ data: [DRAFT_ROW], error: null }),
      createChain({ data: null, error: null }),
    ]);
  }

  it("allows submit when completed_at is null", async () => {
    mockSubmitLevelDraftFlow({ completedAt: null });
    const service = new PathV33RewardService(ORG_ID);

    const result = await service.submitLevelDraft({ site_id: SITE_ID, tier: 2 }, ACTOR);

    expect(result.draft.site_id).toBe(SITE_ID);
    expect(result.preview.month).toBe("2026-05");
  });

  it("allows submit within 7 days from completed_at", async () => {
    mockSubmitLevelDraftFlow({ completedAt: "2026-05-05T00:00:00.000Z" });
    const service = new PathV33RewardService(ORG_ID);

    const result = await service.submitLevelDraft({ site_id: SITE_ID, tier: 2 }, ACTOR);

    expect(result.draft.site_id).toBe(SITE_ID);
    expect(result.preview.month).toBe("2026-05");
  });

  it("throws deadline error when completed_at + 7 days has passed", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({
        data: {
          id: SITE_ID,
          org_id: ORG_ID,
          completed_at: "2026-05-01T00:00:00.000Z",
          created_at: "2026-05-01T00:00:00.000Z",
        },
        error: null,
      }),
    ]);
    const service = new PathV33RewardService(ORG_ID);

    await expect(service.submitLevelDraft({ site_id: SITE_ID, tier: 2 }, ACTOR)).rejects.toThrow(
      "PATH_V33_DRAFT_DEADLINE_PASSED",
    );
  });

  it("keeps existing locked behavior unchanged", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({
        data: {
          id: SITE_ID,
          org_id: ORG_ID,
          completed_at: null,
          created_at: "2026-05-01T00:00:00.000Z",
        },
        error: null,
      }),
      createChain({ data: [{ date: "2026-05-03" }], error: null }),
      createChain({ data: { locked_at: "2026-05-08T00:00:00.000Z" }, error: null }),
    ]);
    const service = new PathV33RewardService(ORG_ID);

    await expect(service.submitLevelDraft({ site_id: SITE_ID, tier: 2 }, ACTOR)).rejects.toThrow(
      "PATH_V33_DRAFT_LOCKED",
    );
  });
});

describe("PathV33RewardService.reviseLevelDraft", () => {
  const ORG_ID = "00000000-0000-4000-8000-000000000001";
  const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
  const OTHER_MEMBER_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const SITE_ID = "22222222-2222-4222-8222-222222222222";
  const DRAFT_ID = "33333333-3333-4333-8333-333333333333";
  const ACTOR = { type: "human" as const, id: MEMBER_ID, name: "Worker" };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function buildDraftRow(overrides: Record<string, unknown> = {}) {
    return {
      id: DRAFT_ID,
      org_id: ORG_ID,
      site_id: SITE_ID,
      member_id: MEMBER_ID,
      tier: 2,
      work_days: 3,
      self_comment: "before",
      evidence: {},
      submitted_at: "2026-05-02T00:00:00.000Z",
      locked_at: null,
      ...overrides,
    };
  }

  it("updates draft and stores revision row", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({ data: buildDraftRow(), error: null }),
      createChain({ data: buildDraftRow({ tier: 3, self_comment: "after" }), error: null }),
      createChain({ data: null, error: null }),
      createChain({
        data: { id: SITE_ID, org_id: ORG_ID, completed_at: "2026-05-01T00:00:00.000Z", created_at: "2026-05-01T00:00:00.000Z" },
        error: null,
      }),
      createChain({
        data: [{ id: SITE_ID, completed_at: "2026-05-01T00:00:00.000Z", created_at: "2026-05-01T00:00:00.000Z" }],
        error: null,
      }),
      createChain({ data: [buildDraftRow({ tier: 3, self_comment: "after" })], error: null }),
      createChain({ data: null, error: null }),
    ]);

    const service = new PathV33RewardService(ORG_ID);
    const result = await service.reviseLevelDraft(
      { draft_id: DRAFT_ID, tier: 3, self_comment: "after", reason: "記録を修正" },
      ACTOR,
    );

    expect(result.draft.tier).toBe(3);
    expect(result.draft.self_comment).toBe("after");
    expect(result.preview.month).toBe("2026-05");
  });

  it("throws when reason is empty", async () => {
    const service = new PathV33RewardService(ORG_ID);
    await expect(
      service.reviseLevelDraft({ draft_id: DRAFT_ID, tier: 2, self_comment: "", reason: "" }, ACTOR),
    ).rejects.toThrow("PATH_V33_REVISION_REASON_REQUIRED");
  });

  it("throws when reason is too long", async () => {
    const service = new PathV33RewardService(ORG_ID);
    await expect(
      service.reviseLevelDraft(
        { draft_id: DRAFT_ID, tier: 2, self_comment: "", reason: "a".repeat(501) },
        ACTOR,
      ),
    ).rejects.toThrow("PATH_V33_REVISION_REASON_TOO_LONG");
  });

  it("throws when draft owner mismatches", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({ data: buildDraftRow({ member_id: OTHER_MEMBER_ID }), error: null }),
    ]);

    const service = new PathV33RewardService(ORG_ID);
    await expect(
      service.reviseLevelDraft(
        { draft_id: DRAFT_ID, tier: 2, self_comment: "ok", reason: "修正理由あり" },
        ACTOR,
      ),
    ).rejects.toThrow("PATH_V33_DRAFT_OWNER_MISMATCH");
  });

  it("throws when draft is locked", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({ data: buildDraftRow({ locked_at: "2026-05-09T00:00:00.000Z" }), error: null }),
    ]);

    const service = new PathV33RewardService(ORG_ID);
    await expect(
      service.reviseLevelDraft(
        { draft_id: DRAFT_ID, tier: 2, self_comment: "ok", reason: "修正理由あり" },
        ACTOR,
      ),
    ).rejects.toThrow("PATH_V33_DRAFT_LOCKED");
  });

  it("returns success without revision when nothing changed", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({ data: buildDraftRow(), error: null }),
      createChain({
        data: { id: SITE_ID, org_id: ORG_ID, completed_at: "2026-05-01T00:00:00.000Z", created_at: "2026-05-01T00:00:00.000Z" },
        error: null,
      }),
      createChain({
        data: [{ id: SITE_ID, completed_at: "2026-05-01T00:00:00.000Z", created_at: "2026-05-01T00:00:00.000Z" }],
        error: null,
      }),
      createChain({ data: [buildDraftRow()], error: null }),
      createChain({ data: null, error: null }),
    ]);

    const service = new PathV33RewardService(ORG_ID);
    const result = await service.reviseLevelDraft(
      { draft_id: DRAFT_ID, tier: 2, self_comment: "before", reason: "理由あり" },
      ACTOR,
    );

    expect(result.draft.tier).toBe(2);
    expect(result.draft.self_comment).toBe("before");
  });

  it("throws when draft does not exist", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [createChain({ data: null, error: null })]);
    const service = new PathV33RewardService(ORG_ID);
    await expect(
      service.reviseLevelDraft(
        { draft_id: DRAFT_ID, tier: 2, self_comment: "ok", reason: "修正理由あり" },
        ACTOR,
      ),
    ).rejects.toThrow("PATH_V33_DRAFT_NOT_FOUND");
  });
});

describe("PathV33RewardService.fetchResponsibilityLockTargets", () => {
  const ORG_ID = "00000000-0000-4000-8000-000000000001";
  const MEMBER_ID = "11111111-1111-4111-8111-111111111111";
  const SITE_A = "22222222-2222-4222-8222-222222222222";
  const SITE_B = "33333333-3333-4333-8333-333333333333";

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-05-10T00:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns only worked-and-unsubmitted sites in 6-7 day window", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({
        data: [
          { id: SITE_A, name: "A棟", completed_at: "2026-05-03T00:00:00.000Z" },
          { id: SITE_B, name: "B棟", completed_at: "2026-05-03T05:00:00.000Z" },
        ],
        error: null,
      }),
      createChain({ data: [{ site_id: SITE_A }, { site_id: SITE_B }], error: null }),
      createChain({ data: [{ site_id: SITE_B }], error: null }),
    ]);

    const service = new PathV33RewardService(ORG_ID);
    const targets = await service.fetchResponsibilityLockTargets(MEMBER_ID);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ site_id: SITE_A, site_name: "A棟" });
  });

  it("returns empty when member has no participation", async () => {
    setupMockFromSequence(supabaseAdmin.from as jest.Mock, [
      createChain({ data: [{ id: SITE_A, name: "A棟", completed_at: "2026-05-03T00:00:00.000Z" }], error: null }),
      createChain({ data: [], error: null }),
    ]);

    const service = new PathV33RewardService(ORG_ID);
    await expect(service.fetchResponsibilityLockTargets(MEMBER_ID)).resolves.toEqual([]);
  });
});
