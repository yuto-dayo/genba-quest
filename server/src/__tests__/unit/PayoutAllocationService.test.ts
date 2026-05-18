jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {},
}));

import { PayoutAllocationService, type PayoutBalance } from "../../services/PayoutAllocationService";

function totalAllocated(lines: ReturnType<typeof PayoutAllocationService.allocateProRata>): number {
  return lines.reduce((sum, line) => sum + line.allocated, 0);
}

function makeBalances(seed: number): PayoutBalance[] {
  const count = 1 + (seed % 8);
  return Array.from({ length: count }, (_, index) => {
    const value = (seed * 1103515245 + index * 12345) >>> 0;
    return {
      member_id: `member-${String(index).padStart(2, "0")}`,
      unsettled: value % 250_000,
    };
  });
}

describe("PayoutAllocationService.allocateProRata", () => {
  it("allocates full balances when the receipt covers all unsettled amounts", () => {
    const lines = PayoutAllocationService.allocateProRata(200_000, [
      { member_id: "b", unsettled: 60_000 },
      { member_id: "a", unsettled: 40_000 },
      { member_id: "zero", unsettled: 0 },
    ]);

    expect(lines).toEqual([
      { member_id: "a", allocated: 40_000, unsettled_after: 0 },
      { member_id: "b", allocated: 60_000, unsettled_after: 0 },
    ]);
  });

  it("uses largest remainder rounding so the allocated total exactly matches the receipt", () => {
    const lines = PayoutAllocationService.allocateProRata(100_000, [
      { member_id: "a", unsettled: 60_000 },
      { member_id: "b", unsettled: 60_000 },
      { member_id: "c", unsettled: 80_000 },
    ]);

    expect(lines).toEqual([
      { member_id: "a", allocated: 30_000, unsettled_after: 30_000 },
      { member_id: "b", allocated: 30_000, unsettled_after: 30_000 },
      { member_id: "c", allocated: 40_000, unsettled_after: 40_000 },
    ]);
    expect(totalAllocated(lines)).toBe(100_000);
  });

  it("is deterministic for the same input regardless of original balance order", () => {
    const balances = [
      { member_id: "c", unsettled: 80_000 },
      { member_id: "a", unsettled: 60_000 },
      { member_id: "b", unsettled: 60_000 },
    ];

    const first = PayoutAllocationService.allocateProRata(100_001, balances);
    const second = PayoutAllocationService.allocateProRata(100_001, [...balances].reverse());

    expect(second).toEqual(first);
  });

  it("preserves the allocation sum invariant across generated examples", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const balances = makeBalances(seed);
      const received = (seed * 7919) % 600_000;
      const unsettledTotal = balances.reduce((sum, balance) => sum + balance.unsettled, 0);

      const lines = PayoutAllocationService.allocateProRata(received, balances);

      expect(totalAllocated(lines)).toBe(Math.min(received, unsettledTotal));
      expect(PayoutAllocationService.allocateProRata(received, balances)).toEqual(lines);
      expect(lines.every((line) => line.allocated > 0)).toBe(true);
      expect(lines.every((line) => line.unsettled_after >= 0)).toBe(true);
    }
  });
});
