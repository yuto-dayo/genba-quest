import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    type PathRewardConfirmationSummary,
    type PathV33MonthlyPreview,
    type PathV33TeamFeed,
    type TeamRewardSummary,
} from "../../lib/api";
import { OtherPayoutModal } from "./OtherPayoutModal";
import { TeamSummaryModal } from "./TeamSummaryModal";

const fetchPathRewardConfirmation = vi.fn();
const fetchPathV33MonthlyPreview = vi.fn();
const fetchPathV33TeamFeed = vi.fn();
const fetchTeamRewardSummary = vi.fn();
const submitPathV33Objection = vi.fn();

vi.mock("../../lib/api", () => ({
    fetchPathRewardConfirmation: (...args: unknown[]) => fetchPathRewardConfirmation(...args),
    fetchPathV33MonthlyPreview: (...args: unknown[]) => fetchPathV33MonthlyPreview(...args),
    fetchPathV33TeamFeed: (...args: unknown[]) => fetchPathV33TeamFeed(...args),
    fetchTeamRewardSummary: (...args: unknown[]) => fetchTeamRewardSummary(...args),
    submitPathV33Objection: (...args: unknown[]) => submitPathV33Objection(...args),
}));

vi.mock("../ObjectionSubmitSheet", () => ({
    ObjectionSubmitSheet: ({
        open,
        target,
        onSubmit,
    }: {
        open: boolean;
        target: { member_name: string } | null;
        onSubmit: (input: { proposed_tier: 2; reason: string }) => void;
    }) => open && target ? (
        <div role="dialog" aria-label="objection sheet">
            <span>{target.member_name}さんへの異議</span>
            <button type="button" onClick={() => onSubmit({ proposed_tier: 2, reason: "現場で確認したため" })}>
                異議を提出
            </button>
        </div>
    ) : null,
}));

vi.mock("./OwnPayoutModal", () => ({
    OwnPayoutModal: ({ selfMemberId }: { selfMemberId: string }) => (
        <div role="dialog" aria-label="own reward modal">
            自分の報酬 {selfMemberId}
        </div>
    ),
}));

const summary: PathRewardConfirmationSummary = {
    month: "2026-05",
    member_id: "member-other",
    member_name: "田中",
    status: "確定済み",
    estimated_amount: 245000,
    base_amount: 216000,
    result_amount: 240000,
    correction_amount: 5000,
    delta_amount: 29000,
    delta_empty_state: null,
    top_reasons: [
        {
            key: "workload",
            label: "出勤",
            direction: "increase",
            summary: "18日分を反映",
            impact_amount: 29000,
            evidence_refs: [],
        },
    ],
    increase_reasons: [],
    decrease_reasons: [],
    explanation_cards: [],
    explanation_missing: false,
    explanation_missing_message: null,
    site_breakdown: [
        {
            site_id: "site-1",
            site_name: "青山ビル",
            amount: 120000,
            reflected_ratio: 1,
            reason_summary: "主導分",
            correction_state: "なし",
            evidence_refs: [],
            detail: {
                self_explanation: {
                    amount: 120000,
                    floor_amount: 80000,
                    result_amount: 40000,
                    correction_amount: 0,
                    reflected_ratio: 1,
                    credited_units: 10,
                    reason_lines: [],
                },
                site_summary: {
                    distributable_profit: 500000,
                    participant_count: 3,
                    self_rank: 1,
                    self_band: "top",
                    privacy_mode: "band_only",
                    anonymous_relative_distribution: [],
                },
            },
        },
    ],
    pending_close_sites: [],
    corrections: {
        total_amount: 5000,
        applied_amount: 5000,
        count: 1,
        has_corrections: true,
        items: [],
    },
    evidence_refs: [],
    internal_controls: {
        can_manage: false,
        month: "2026-05",
    },
};

const preview: PathV33MonthlyPreview = {
    month: "2026-05",
    member_id: "member-other",
    prior_level: "L2",
    current: {
        level: "L3",
        weight_milli: 1200,
        score: 4.2,
        total_work_days: 18,
        draft_count: 1,
        drafts: [{ site_id: "site-1", tier: 3, work_days: 18 }],
    },
    drafts: [
        {
            id: "draft-1",
            org_id: "org-1",
            site_id: "site-1",
            member_id: "member-other",
            tier: 3,
            work_days: 18,
            self_comment: "",
            evidence: {},
            submitted_at: "2026-05-10T00:00:00.000Z",
            locked_at: null,
        },
    ],
};

const feed: PathV33TeamFeed = {
    month: "2026-05",
    members: [],
    timeline: [
        {
            draft_id: "draft-1",
            member_id: "member-other",
            member_name: "田中",
            site_id: "site-1",
            site_name: "青山ビル",
            tier: 3,
            work_days: 18,
            self_comment: "",
            submitted_at: "2026-05-10T00:00:00.000Z",
        },
    ],
};

const teamSummary: TeamRewardSummary = {
    month: "2026-05",
    self_member_id: "member-self",
    is_finalized: true,
    members: [
        {
            member_id: "member-self",
            nickname: "自分",
            level: "L2",
            attendance_days: 12,
            amount: 180000,
            status: "finalized",
            has_invoice: false,
            has_paid: false,
        },
        {
            member_id: "member-other",
            nickname: "田中",
            level: "L3",
            attendance_days: 18,
            amount: 245000,
            status: "finalized",
            has_invoice: true,
            has_paid: false,
        },
    ],
};

describe("OtherPayoutModal", () => {
    beforeEach(() => {
        vi.resetAllMocks();
        fetchPathRewardConfirmation.mockImplementation((targetMonth: string) => Promise.resolve({
            ...summary,
            month: targetMonth,
            is_objection_window: true,
        }));
        fetchPathV33MonthlyPreview.mockResolvedValue(preview);
        fetchPathV33TeamFeed.mockResolvedValue(feed);
        fetchTeamRewardSummary.mockResolvedValue(teamSummary);
        submitPathV33Objection.mockResolvedValue({ id: "objection-1" });
    });

    it("shows another member reward details without invoice state and submits an objection in window", async () => {
        render(
            <OtherPayoutModal
                memberId="member-other"
                month="2026-05"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("田中さんの報酬")).toBeInTheDocument();
        expect(screen.getAllByText("￥245,000").length).toBeGreaterThan(0);
        expect(screen.getByText("L3")).toBeInTheDocument();
        expect(screen.getByText("18日")).toBeInTheDocument();
        expect(screen.getByText("過去3ヶ月推移")).toBeInTheDocument();
        expect(screen.queryByText("未発行")).not.toBeInTheDocument();
        expect(screen.queryByText("発行中")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "異議を申し立てる" }));
        expect(await screen.findByRole("dialog", { name: "objection sheet" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "異議を提出" }));

        await waitFor(() => expect(submitPathV33Objection).toHaveBeenCalledWith({
            target_draft_id: "draft-1",
            proposed_tier: 2,
            reason: "現場で確認したため",
            evidence: {
                source: "money_other_reward_modal",
                month: "2026-05",
                member_id: "member-other",
            },
        }));
        expect(await screen.findByText("異議を提出しました")).toBeInTheDocument();
    });

    it("hides the objection action outside the objection window", async () => {
        fetchPathRewardConfirmation.mockImplementation((targetMonth: string) => Promise.resolve({
            ...summary,
            month: targetMonth,
            is_objection_window: false,
        }));

        render(
            <OtherPayoutModal
                memberId="member-other"
                month="2026-05"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByText("田中さんの報酬")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "異議を申し立てる" })).not.toBeInTheDocument();
        expect(screen.getAllByRole("button", { name: "閉じる" }).length).toBeGreaterThan(0);
    });

    it("lets the team summary list switch into other and self reward modals", async () => {
        render(
            <TeamSummaryModal
                month="2026-05"
                selfUserId="user-self"
                onClose={vi.fn()}
            />,
        );

        expect(await screen.findByRole("button", { name: /田中/ })).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: /田中/ }));
        expect(await screen.findByText("田中さんの報酬")).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole("button", { name: "閉じる" })[0]);
        fireEvent.click(await screen.findByRole("button", { name: /自分/ }));
        expect(screen.getByRole("dialog", { name: "own reward modal" })).toBeInTheDocument();
    });
});
