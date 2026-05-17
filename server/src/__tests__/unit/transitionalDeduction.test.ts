import {
  calculateTransitionalDeductionRate,
  classifyTransitionalPhase,
  nextTransitionalRateChange,
} from "../../lib/transitional-deduction";

describe("transitional deduction", () => {
  it("classifies boundary dates", () => {
    expect(classifyTransitionalPhase("2026-09-30")).toBe("pre-introduction");
    expect(classifyTransitionalPhase("2026-10-01")).toBe("phase1-80");
    expect(classifyTransitionalPhase("2029-09-30")).toBe("phase1-80");
    expect(classifyTransitionalPhase("2029-10-01")).toBe("phase2-50");
    expect(classifyTransitionalPhase("2032-09-30")).toBe("phase2-50");
    expect(classifyTransitionalPhase("2032-10-01")).toBe("phase3-0");
  });

  it("applies registered and transitional supplier rates", () => {
    expect(calculateTransitionalDeductionRate("2029-10-01", "registered")).toBe(1);
    expect(calculateTransitionalDeductionRate("2026-09-30", "exempt")).toBe(1);
    expect(calculateTransitionalDeductionRate("2026-10-01", "exempt")).toBe(0.8);
    expect(calculateTransitionalDeductionRate("2029-10-01", "transitional")).toBe(0.5);
    expect(calculateTransitionalDeductionRate("2032-10-01", "exempt")).toBe(0);
  });

  it("returns the next visible rate change", () => {
    expect(nextTransitionalRateChange("2026-09-30")).toEqual({
      date: "2026-10-01",
      fromRate: 1,
      toRate: 0.8,
    });
    expect(nextTransitionalRateChange("2032-10-01")).toBeNull();
  });
});
