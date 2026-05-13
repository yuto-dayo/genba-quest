import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PathV33PersonalDashboard } from "./PathV33PersonalDashboard";

const fetchPathV33MonthlyPreview = vi.fn();

vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
        ...actual,
        fetchPathV33MonthlyPreview: (...args: unknown[]) => fetchPathV33MonthlyPreview(...args),
    };
});

vi.mock("./LevelRevisionSheet", () => ({
    LevelRevisionSheet: ({ open }: { open: boolean }) =>
        open ? <div data-testid="level-revision-sheet">revision-open</div> : null,
}));

const basePreview = {
    month: "2026-05",
    member_id: "member-1",
    current: {
        level: "L3",
        weight_milli: 640,
        score: 1.8,
        total_work_days: 5,
        draft_count: 2,
        drafts: [],
    },
    prior_level: "L2",
    drafts: [
        {
            id: "draft-unlocked",
            org_id: "org-1",
            site_id: "site-1",
            member_id: "member-1",
            tier: 2,
            work_days: 2,
            self_comment: "comment",
            evidence: {},
            submitted_at: "2026-05-09T00:00:00.000Z",
            locked_at: null,
        },
        {
            id: "draft-locked",
            org_id: "org-1",
            site_id: "site-2",
            member_id: "member-1",
            tier: 3,
            work_days: 3,
            self_comment: "locked",
            evidence: {},
            submitted_at: "2026-05-08T00:00:00.000Z",
            locked_at: "2026-05-31T00:00:00.000Z",
        },
    ],
};

describe("PathV33PersonalDashboard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchPathV33MonthlyPreview.mockResolvedValue(basePreview);
    });

    it("shows revise button for unlocked draft and locked badge for locked draft", async () => {
        render(<PathV33PersonalDashboard memberId="member-1" month="2026-05" />);

        expect(await screen.findByText("今月の申告履歴")).toBeInTheDocument();
        const reviseButtons = screen.getAllByRole("button", { name: "修正" });
        expect(reviseButtons).toHaveLength(1);
        expect(screen.getByText("確定済")).toBeInTheDocument();
    });

    it("opens revision sheet when revise is clicked", async () => {
        render(<PathV33PersonalDashboard memberId="member-1" month="2026-05" />);

        fireEvent.click(await screen.findByRole("button", { name: "修正" }));

        await waitFor(() => {
            expect(screen.getByTestId("level-revision-sheet")).toBeInTheDocument();
        });
    });
});
