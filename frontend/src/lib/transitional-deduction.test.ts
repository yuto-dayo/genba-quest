import { describe, expect, it } from "vitest";
import {
    calculateTransitionalDeductionRate,
    classifyTransitionalPhase,
    nextTransitionalRateChange,
} from "./transitional-deduction";

describe("transitional-deduction", () => {
    it("keeps the invoice transitional measure boundaries exact", () => {
        expect(classifyTransitionalPhase("2026-09-30")).toBe("pre-introduction");
        expect(classifyTransitionalPhase("2026-10-01")).toBe("phase1-80");
        expect(calculateTransitionalDeductionRate("2029-09-30", "exempt")).toBe(0.8);
        expect(calculateTransitionalDeductionRate("2029-10-01", "exempt")).toBe(0.5);
        expect(calculateTransitionalDeductionRate("2032-10-01", "transitional")).toBe(0);
        expect(calculateTransitionalDeductionRate("2032-10-01", "registered")).toBe(1);
    });

    it("returns the countdown target for the company card", () => {
        expect(nextTransitionalRateChange("2029-09-01")).toEqual({
            date: "2029-10-01",
            fromRate: 0.8,
            toRate: 0.5,
        });
    });
});
