import { describe, expect, it, vi } from "vitest";
import { previewLUQOReward, submitLUQORewardProposal } from "./api";

vi.mock("./supabase", () => ({
    getAuthToken: vi.fn().mockResolvedValue("token"),
}));

describe("legacy LUQO client validation", () => {
    it("rejects reward preview when member_id is blank", () => {
        expect(() =>
            previewLUQOReward({
                period: "2026-04",
                profit: 10000,
                members: [
                    {
                        member_id: "",
                        name: "田中",
                        days: 10,
                        tech_stars: 3,
                        speed_stars: 2,
                    },
                ],
            }),
        ).toThrow("LEGACY_LUQO_MEMBER_ID_REQUIRED:0");
    });

    it("rejects legacy reward proposal when member_id is blank", () => {
        expect(() =>
            submitLUQORewardProposal({
                period: "2026-04",
                profit: 10000,
                company_rate: 0.4,
                breakdown: [
                    {
                        member_id: "",
                        name: "田中",
                        days: 10,
                        tech_stars: 3,
                        speed_stars: 2,
                        S: 80,
                        V: 50,
                        combo: 40,
                        effort: 400,
                        ratio: 1,
                        amount: 6000,
                    },
                ],
            }),
        ).toThrow("LEGACY_LUQO_MEMBER_ID_REQUIRED:0");
    });
});
