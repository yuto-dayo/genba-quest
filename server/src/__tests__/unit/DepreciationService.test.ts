jest.mock("../../lib/supabaseClient", () => ({ supabaseAdmin: {} }));
jest.mock("../../lib/supabaseAdmin", () => ({ supabaseAdmin: {} }));

import { DepreciationService } from "../../services/DepreciationService";

describe("DepreciationService", () => {
    const service = new DepreciationService({} as any);

    it("classifies assets by statutory thresholds and special limit", () => {
        expect(service.classifyAsset(99000, 0)).toBe("expense_immediate");
        expect(service.classifyAsset(150000, 0)).toBe("three_year_special");
        expect(service.classifyAsset(250000, 0)).toBe("small_amount_special");
        expect(service.classifyAsset(250000, 2800000)).toBe("standard_depreciation");
        expect(service.classifyAsset(300000, 0)).toBe("standard_depreciation");
    });

    it("generates a 36 month schedule with rounded yen and total preserved", () => {
        const schedules = service.generateSchedule({
            acquisitionAmount: 150000,
            acquisitionDate: "2026-05-18",
            classification: "three_year_special",
            usefulLifeYears: 3,
        });

        expect(schedules).toHaveLength(36);
        expect(schedules[0]).toEqual({ scheduled_month: "2026-05", amount: 4167 });
        expect(schedules.reduce((sum, row) => sum + row.amount, 0)).toBe(150000);
    });

    it("uses category defaults for standard depreciation", () => {
        expect(service.defaultUsefulLifeYears("車両")).toBe(6);
        expect(service.defaultUsefulLifeYears("PC")).toBe(4);
        expect(service.defaultUsefulLifeYears("工具")).toBe(5);
    });
});
