import { describe, expect, it } from "vitest";
import {
    buildMoneyRedirectFromLegacyRoute,
    buildMoneyRewardHref,
} from "./legacyRouteRedirect";

describe("legacy route redirects", () => {
    it("converts legacy reward links to the Money reward modal", () => {
        const params = new URLSearchParams("reward=1&member=member-1&period=2026-05&site=site-1");

        expect(buildMoneyRedirectFromLegacyRoute(params)).toBe(
            "/money?modal=reward&member=member-1&period=2026-05&site=site-1",
        );
    });

    it("converts legacy PATH proposal links to the Money proposal entry", () => {
        const params = new URLSearchParams("tab=path&proposal=proposal-1&period=2026-05");

        expect(buildMoneyRedirectFromLegacyRoute(params)).toBe("/money?proposal=proposal-1&period=2026-05");
    });

    it("builds canonical Money reward hrefs", () => {
        expect(buildMoneyRewardHref({ period: "2026-05", site: "site-1" })).toBe(
            "/money?modal=reward&period=2026-05&site=site-1",
        );
    });
});
