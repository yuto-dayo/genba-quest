import { render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LevelDraftSheet } from "./LevelDraftSheet";

const fetchPathV33MonthlyPreview = vi.fn();
const submitPathV33LevelDraft = vi.fn();
const fetchSite = vi.fn();

vi.mock("framer-motion", () => ({
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
}));

vi.mock("../lib/api", () => ({
    fetchPathV33MonthlyPreview: (...args: unknown[]) => fetchPathV33MonthlyPreview(...args),
    submitPathV33LevelDraft: (...args: unknown[]) => submitPathV33LevelDraft(...args),
    fetchSite: (...args: unknown[]) => fetchSite(...args),
}));

const basePreview = {
    month: "2026-05",
    member_id: "member-1",
    current: {
        level: "L3",
        weight_milli: 640,
        score: 1.8,
        total_work_days: 1,
        draft_count: 1,
        drafts: [{ site_id: "site-1", tier: 2, work_days: 1 }],
    },
    prior_level: null,
    drafts: [
        {
            id: "draft-1",
            org_id: "org-1",
            site_id: "site-1",
            member_id: "member-1",
            tier: 2,
            work_days: 1,
            self_comment: "",
            evidence: {},
            submitted_at: "2026-05-01T00:00:00.000Z",
            locked_at: null,
        },
    ],
} as const;

describe("LevelDraftSheet", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchPathV33MonthlyPreview.mockResolvedValue(basePreview);
        submitPathV33LevelDraft.mockResolvedValue({ draft: basePreview.drafts[0], preview: basePreview });
    });

    it("shows site work type chips and address fetched by site id", async () => {
        fetchSite.mockResolvedValue({
            id: "site-1",
            name: "渋谷マンション",
            address: "東京都渋谷区1-2-3",
            work_types: ["内装", "塗装"],
        });

        render(
            <LevelDraftSheet
                open
                onClose={() => {}}
                siteId="site-1"
                siteName="初期名"
                memberId="member-1"
            />,
        );

        await waitFor(() => {
            expect(fetchSite).toHaveBeenCalledWith("site-1");
        });

        expect(await screen.findByText("内装")).toBeInTheDocument();
        expect(screen.getByText("塗装")).toBeInTheDocument();
        expect(screen.getByText("東京都渋谷区1-2-3")).toBeInTheDocument();
    });

    it("keeps fallback header and hides site meta when fetchSite fails", async () => {
        fetchSite.mockRejectedValue(new Error("boom"));

        render(
            <LevelDraftSheet
                open
                onClose={() => {}}
                siteId="site-1"
                siteName="フォールバック現場"
                memberId="member-1"
            />,
        );

        await waitFor(() => {
            expect(fetchSite).toHaveBeenCalledWith("site-1");
        });
        expect(screen.queryByText("東京都渋谷区1-2-3")).not.toBeInTheDocument();
        expect(screen.queryByText("内装")).not.toBeInTheDocument();
    });

    it("does not fetch site info while closed", () => {
        render(
            <LevelDraftSheet
                open={false}
                onClose={() => {}}
                siteId="site-1"
                siteName="閉じた現場"
                memberId="member-1"
            />,
        );

        expect(fetchSite).not.toHaveBeenCalled();
        expect(fetchPathV33MonthlyPreview).not.toHaveBeenCalled();
    });
});
