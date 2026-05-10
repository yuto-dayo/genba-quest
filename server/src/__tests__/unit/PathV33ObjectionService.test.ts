jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { isCoSignThresholdReached } from "../../services/PathV33ObjectionService";

describe("PathV33ObjectionService.isCoSignThresholdReached", () => {
  it("returns false until count reaches required", () => {
    expect(isCoSignThresholdReached(1, 2, false)).toBe(false);
    expect(isCoSignThresholdReached(2, 2, false)).toBe(true);
    expect(isCoSignThresholdReached(3, 2, false)).toBe(true);
  });

  it("lowers the bar by 1 when target self-agrees (floor 1)", () => {
    // teamSize 7 → required 3. Self-agreement: 2 enough.
    expect(isCoSignThresholdReached(2, 3, true)).toBe(true);
    expect(isCoSignThresholdReached(1, 3, true)).toBe(false);
  });

  it("never lets the bar drop below 1 even with self-agreement", () => {
    expect(isCoSignThresholdReached(1, 1, true)).toBe(true);
    expect(isCoSignThresholdReached(0, 1, true)).toBe(false);
  });

  it("handles the small-team objector-only scenario (§10 R3)", () => {
    // 3-person team: required = max(2, ceil(3/3)) = 2.
    // The objector's submission auto-counts as the 1st co-sign.
    // One more peer (not the target) signing → accepted.
    expect(isCoSignThresholdReached(2, 2, false)).toBe(true);
  });
});
