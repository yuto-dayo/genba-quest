import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LUQOPage from "./LUQO";

vi.mock("../components/luqo/rewardConfirmation/RewardConfirmationExperience", () => ({
    RewardConfirmationExperience: (props: {
        initialPeriod?: string | null;
        focusSiteId?: string | null;
        focusMemberId?: string | null;
    }) => (
        <div data-testid="reward-confirmation">
            REWARD_CONFIRMATION
            <span data-testid="reward-period">{props.initialPeriod ?? "(none)"}</span>
            <span data-testid="reward-site">{props.focusSiteId ?? "(none)"}</span>
            <span data-testid="reward-member">{props.focusMemberId ?? "(none)"}</span>
        </div>
    ),
}));

vi.mock("../lib/api", () => ({
    fetchLUQOScores: vi.fn().mockResolvedValue({ scores: [] }),
    fetchLUQORewardCalculations: vi.fn().mockResolvedValue({ calculations: [] }),
}));

function renderPage(initialEntry: string) {
    function LocationProbe() {
        const location = useLocation();
        return <div data-testid="location-search">{location.search || "(empty)"}</div>;
    }

    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
                <Route
                    path="/luqo"
                    element={(
                        <>
                            <LUQOPage />
                            <LocationProbe />
                        </>
                    )}
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe("/luqo page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("renders reward confirmation as the primary experience", async () => {
        renderPage("/luqo");

        expect(screen.getByTestId("reward-confirmation")).toHaveTextContent("REWARD_CONFIRMATION");
        expect(screen.getByText("旧 LUQO 互換レイヤー")).toBeInTheDocument();
    });

    it("passes deep link params into the reward confirmation experience", async () => {
        renderPage("/luqo?period=2026-04&site=site-9&member=member-7");

        expect(screen.getByTestId("reward-period")).toHaveTextContent("2026-04");
        expect(screen.getByTestId("reward-site")).toHaveTextContent("site-9");
        expect(screen.getByTestId("reward-member")).toHaveTextContent("member-7");
    });

    it("keeps non-legacy query params while stripping the old reward flag", async () => {
        renderPage("/luqo?tab=reward&period=2026-04");

        expect(screen.getByTestId("reward-confirmation")).toHaveTextContent("REWARD_CONFIRMATION");
        expect(screen.getByTestId("location-search")).toHaveTextContent("?tab=reward&period=2026-04");
    });

    it("strips only the legacy reward query flag", async () => {
        renderPage("/luqo?period=2026-04&reward=1&site=site-9&member=member-7&proposal=proposal-1");

        expect(screen.getByTestId("location-search")).toHaveTextContent(
            "?period=2026-04&site=site-9&member=member-7&proposal=proposal-1",
        );
    });
});
