import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TodayAssignments } from "./TodayAssignments";
import type { Site } from "../../lib/api";

const baseSite: Site = {
    id: "site-1",
    name: "渋谷マンション",
    status: "active",
    address: "東京都渋谷区1-2-3",
    created_at: "2026-04-22T00:00:00.000Z",
};

function renderAssignments(dayLogStatus: "none" | "saved" | "locked") {
    const onCompleteFocusItem = vi.fn();
    const onViewSiteMemo = vi.fn();
    const onPlanRole = vi.fn();
    const onRecordRewardInput = vi.fn();
    const onAddFocusItem = vi.fn();

    render(
        <TodayAssignments
            assignments={[
                {
                    id: "assignment-1",
                    user_id: "member-1",
                    site_id: baseSite.id,
                    site_name: baseSite.name,
                    date: "2026-04-22",
                    status: "scheduled",
                    source: "proposal",
                },
            ]}
            sites={[baseSite]}
            focusItems={[]}
            completingId={null}
            onCompleteFocusItem={onCompleteFocusItem}
            onViewSiteMemo={onViewSiteMemo}
            onPlanRole={onPlanRole}
            onRecordRewardInput={onRecordRewardInput}
            onAddFocusItem={onAddFocusItem}
            getDayLogStatus={() => dayLogStatus}
            getSiteInputStatus={() => "role_missing"}
        />,
    );

    return {
        onViewSiteMemo,
        onPlanRole,
        onRecordRewardInput,
        onAddFocusItem,
    };
}

describe("TodayAssignments", () => {
    it("opens the unified memo sheet from the site card", () => {
        const { onViewSiteMemo } = renderAssignments("none");

        fireEvent.click(screen.getByRole("button", { name: "メモ" }));

        expect(onViewSiteMemo).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
        expect(screen.queryByRole("button", { name: "確認" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "メモ追加" })).not.toBeInTheDocument();
    });

    it("keeps the memo CTA after a log has been saved", () => {
        const { onViewSiteMemo } = renderAssignments("saved");

        fireEvent.click(screen.getByRole("button", { name: "メモ" }));

        expect(onViewSiteMemo).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
    });

    it("keeps memo review and focus-item quick add available when the log is locked", () => {
        const { onViewSiteMemo, onAddFocusItem } = renderAssignments("locked");

        fireEvent.click(screen.getByRole("button", { name: "メモ" }));
        fireEvent.click(screen.getByRole("button", { name: "今日やることを追加" }));

        expect(onViewSiteMemo).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
        expect(onAddFocusItem).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
    });

    it("opens role planning from the site card without showing status chips", () => {
        const { onPlanRole } = renderAssignments("none");

        expect(screen.queryByText("今日の現場")).not.toBeInTheDocument();
        expect(screen.queryByText("確定")).not.toBeInTheDocument();
        expect(screen.queryByText("役割未入力")).not.toBeInTheDocument();
        expect(screen.queryByText("1名")).not.toBeInTheDocument();
        expect(screen.queryByText("現場稼働")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "地図" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "地図を開く" })).toHaveAttribute(
            "href",
            expect.stringContaining(encodeURIComponent(baseSite.address)),
        );
        expect(screen.getByText(baseSite.address)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "役割" }));

        expect(onPlanRole).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
    });
});
