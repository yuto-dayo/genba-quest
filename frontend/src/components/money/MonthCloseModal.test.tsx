import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRecord, PathV33Objection, TeamRewardSummary } from "../../lib/api";
import { MonthCloseModal } from "./MonthCloseModal";

const track = vi.fn();
const expirePathV33MonthObjections = vi.fn();
const fetchNotifications = vi.fn();
const fetchPathModuleMonthCloseSummary = vi.fn();
const fetchPathV33OpenObjections = vi.fn();
const fetchSiteCostTransferPreview = vi.fn();
const fetchTeamRewardSummary = vi.fn();
const finalizePathV33Month = vi.fn();
const lockPathV33MonthDrafts = vi.fn();
const markNotificationRead = vi.fn();

vi.mock("../../lib/api", () => {
    return {
        expirePathV33MonthObjections: (...args: unknown[]) => expirePathV33MonthObjections(...args),
        fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
        fetchPathModuleMonthCloseSummary: (...args: unknown[]) => fetchPathModuleMonthCloseSummary(...args),
        fetchPathV33OpenObjections: (...args: unknown[]) => fetchPathV33OpenObjections(...args),
        fetchSiteCostTransferPreview: (...args: unknown[]) => fetchSiteCostTransferPreview(...args),
        fetchTeamRewardSummary: (...args: unknown[]) => fetchTeamRewardSummary(...args),
        finalizePathV33Month: (...args: unknown[]) => finalizePathV33Month(...args),
        lockPathV33MonthDrafts: (...args: unknown[]) => lockPathV33MonthDrafts(...args),
        markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
    };
});

vi.mock("../../lib/telemetry", () => ({
    track: (...args: unknown[]) => track(...args),
}));

const rewardSummary: TeamRewardSummary = {
    month: "2026-05",
    self_member_id: "member-1",
    is_finalized: false,
    members: [
        {
            member_id: "member-1",
            nickname: "ユウト",
            level: "L3",
            attendance_days: 18,
            amount: 240000,
            status: "preview",
            has_invoice: false,
            has_paid: false,
        },
        {
            member_id: "member-2",
            nickname: "アオイ",
            level: "L2",
            attendance_days: 16,
            amount: 180000,
            status: "preview",
            has_invoice: false,
            has_paid: false,
        },
    ],
};

const monthCloseNotification: NotificationRecord = {
    id: "notification-month-close",
    user_id: "user-1",
    type: "month_close_reminder",
    title: "月確定",
    message: "月確定できます",
    data: { month: "2026-05" },
    read: false,
    created_at: "2026-05-01T00:00:00.000Z",
};

const openObjection: PathV33Objection = {
    id: "objection-1",
    org_id: "org-1",
    target_member_id: "member-2",
    target_month: "2026-05",
    target_draft_id: "draft-1",
    objector_id: "member-1",
    proposed_tier: 3,
    reason: "確認が必要",
    evidence: {},
    co_signs: [],
    target_self_response: null,
    required_co_signs: 1,
    status: "open",
    expires_at: "2026-05-10T00:00:00.000Z",
    resolved_at: null,
    resolved_tier: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
};

function setupDefaults() {
    fetchTeamRewardSummary.mockResolvedValue(rewardSummary);
    fetchPathV33OpenObjections.mockResolvedValue([]);
    fetchPathModuleMonthCloseSummary.mockResolvedValue({
        month: "2026-05",
        closes: [],
        reward_runs: [],
        eligible_closes: [],
    });
    fetchSiteCostTransferPreview.mockResolvedValue({ month: "2026-05", transfers: [] });
    fetchNotifications.mockResolvedValue([monthCloseNotification]);
    markNotificationRead.mockResolvedValue({ ...monthCloseNotification, read: true });
    lockPathV33MonthDrafts.mockResolvedValue({ month: "2026-05", locked_draft_count: 2, recounted_drafts: 2 });
    expirePathV33MonthObjections.mockResolvedValue({ month: "2026-05", expired_objection_count: 0 });
    finalizePathV33Month.mockResolvedValue({ month: "2026-05", members: [] });
}

describe("MonthCloseModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        track.mockClear();
        setupDefaults();
    });

    it("runs lock, expire, finalize in order and marks the reminder read", async () => {
        const onCompleted = vi.fn();

        render(<MonthCloseModal month="2026-05" onClose={vi.fn()} onCompleted={onCompleted} />);

        expect(await screen.findByText("5月分を確定します")).toBeInTheDocument();
        expect(screen.getByText("2人")).toBeInTheDocument();
        expect(screen.getByText("￥420,000")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "5月分を確定" }));

        await waitFor(() => expect(lockPathV33MonthDrafts).toHaveBeenCalledWith("2026-05"));
        expect(expirePathV33MonthObjections).toHaveBeenCalledWith("2026-05");
        expect(finalizePathV33Month).toHaveBeenCalledWith("2026-05");
        await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith("notification-month-close"));
        expect(track).toHaveBeenCalledWith({
            type: "money.month_close.completed",
            duration_ms: expect.any(Number),
            members_count: 2,
        });
        expect(onCompleted).toHaveBeenCalledTimes(1);
        expect(screen.getByText("月確定が完了しました")).toBeInTheDocument();
    });

    it("disables finalization while open objections remain", async () => {
        fetchPathV33OpenObjections.mockResolvedValueOnce([openObjection]);

        render(<MonthCloseModal month="2026-05" onClose={vi.fn()} />);

        expect(await screen.findByText("1件の異議が決着していません")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "5月分を確定" })).toBeDisabled();
    });

    it("shows the failed step and retries from that step", async () => {
        expirePathV33MonthObjections
            .mockRejectedValueOnce(new Error("network down"))
            .mockResolvedValueOnce({ month: "2026-05", expired_objection_count: 0 });

        render(<MonthCloseModal month="2026-05" onClose={vi.fn()} />);

        fireEvent.click(await screen.findByRole("button", { name: "5月分を確定" }));
        expect(await screen.findByText(/異議処理失敗: network down/)).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "5月分を確定" }));

        await waitFor(() => expect(finalizePathV33Month).toHaveBeenCalledWith("2026-05"));
        expect(lockPathV33MonthDrafts).toHaveBeenCalledTimes(1);
        expect(expirePathV33MonthObjections).toHaveBeenCalledTimes(2);
    });
});
