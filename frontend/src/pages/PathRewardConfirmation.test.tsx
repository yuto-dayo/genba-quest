import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PathRewardConfirmationPage from "./PathRewardConfirmation";

vi.mock("../components/luqo/rewardConfirmation/RewardConfirmationExperience", () => ({
    RewardConfirmationExperience: (props: {
        initialPeriod?: string | null;
        focusSiteId?: string | null;
        focusMemberId?: string | null;
        metaAction?: ReactNode;
    }) => (
        <div data-testid="reward-confirmation">
            REWARD_CONFIRMATION
            <span data-testid="reward-period">{props.initialPeriod ?? "(none)"}</span>
            <span data-testid="reward-site">{props.focusSiteId ?? "(none)"}</span>
            <span data-testid="reward-member">{props.focusMemberId ?? "(none)"}</span>
            <span data-testid="reward-meta-action">{props.metaAction ?? "(none)"}</span>
        </div>
    ),
}));

vi.mock("../components/PathV33PersonalDashboard", () => ({
    PathV33PersonalDashboard: ({ memberId, month }: { memberId: string; month: string }) => (
        <div data-testid="v33-personal">
            V33_PERSONAL <span data-testid="v33-personal-member">{memberId}</span>
            <span data-testid="v33-personal-month">{month}</span>
        </div>
    ),
}));

vi.mock("../components/PathV33TeamFeed", () => ({
    PathV33TeamFeedView: ({ month }: { month: string }) => (
        <div data-testid="v33-team">V33_TEAM <span data-testid="v33-team-month">{month}</span></div>
    ),
}));

vi.mock("../lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: vi.fn(async () => ({
                data: { session: { user: { id: "user-1" } } },
            })),
        },
    },
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
                            <PathRewardConfirmationPage />
                            <LocationProbe />
                        </>
                    )}
                />
            </Routes>
        </MemoryRouter>,
    );
}

describe("Path reward confirmation page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("defaults to the V3.3 personal dashboard", async () => {
        renderPage("/luqo");

        expect(await screen.findByTestId("v33-personal")).toHaveTextContent("V33_PERSONAL");
        expect(screen.queryByTestId("reward-confirmation")).not.toBeInTheDocument();
    });

    it("renders reward confirmation when the reward tab is active", async () => {
        renderPage("/luqo?tab=reward&period=2026-04&site=site-9&member=member-7");

        expect(screen.getByTestId("reward-confirmation")).toHaveTextContent("REWARD_CONFIRMATION");
        expect(screen.getByTestId("reward-period")).toHaveTextContent("2026-04");
        expect(screen.getByTestId("reward-site")).toHaveTextContent("site-9");
        expect(screen.getByTestId("reward-member")).toHaveTextContent("member-7");
    });

    it("renders the team feed when the team tab is active", async () => {
        renderPage("/luqo?tab=team");

        expect(screen.getByTestId("v33-team")).toHaveTextContent("V33_TEAM");
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
