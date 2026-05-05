import { describe, expect, it } from "vitest";
import { buildPathProposalHref, getPathProposalContext, isPathModuleProposal } from "./pathProposal";

describe("pathProposal helpers", () => {
    it("recognizes PATH V3.2 reward proposals without legacy module markers", () => {
        const proposal = {
            id: "proposal-v32",
            type: "reward.calculate",
            description: "2026-05 PATH V3.2 Simple monthly distribution",
            payload: {
                path_module_version: "v3.2-simple",
                calculation_system: "path_v32_simple",
                month: "2026-05",
                member_payouts: [{ member_id: "member-1" }],
            },
        };

        expect(isPathModuleProposal(proposal)).toBe(true);
        expect(getPathProposalContext(proposal)).toMatchObject({
            month: "2026-05",
        });
        expect(buildPathProposalHref(proposal)).toBe("/luqo?tab=path&proposal=proposal-v32&period=2026-05");
    });
});
