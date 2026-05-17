import { afterEach, describe, expect, it, vi } from "vitest";
import { track } from "./telemetry";

describe("track", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
    });

    it("logs telemetry events in development", () => {
        vi.stubEnv("DEV", true);
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

        track({ type: "money.fab.clicked", from_tab: "transactions" });

        expect(debugSpy).toHaveBeenCalledWith("[telemetry]", {
            type: "money.fab.clicked",
            from_tab: "transactions",
        });
    });

    it("stays silent outside development", () => {
        vi.stubEnv("DEV", false);
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

        track({ type: "money.shield.opened" });

        expect(debugSpy).not.toHaveBeenCalled();
    });
});
