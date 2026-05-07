import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TodayAssignments } from "./TodayAssignments";
import type { Site, SiteLineItem } from "../../lib/api";

const baseSiteAddress = "東京都渋谷区1-2-3";
const baseSite: Site = {
    id: "site-1",
    name: "渋谷マンション",
    status: "active",
    address: baseSiteAddress,
    created_at: "2026-04-22T00:00:00.000Z",
    description: "床とクロスの補修",
    client: {
        id: "client-1",
        name: "渋谷不動産",
        contact_person: "佐藤さん",
        phone: "03-1234-5678",
    },
};

const baseLineItem: SiteLineItem = {
    id: "line-item-1",
    site_id: baseSite.id,
    item_name: "床工事",
    quantity: 20,
    unit_name: "㎡",
    unit_price: 1800,
    sort_order: 0,
    created_by: null,
    created_at: "2026-04-22T00:00:00.000Z",
    updated_by: null,
    updated_at: "2026-04-22T00:00:00.000Z",
};

function renderAssignments(
    dayLogStatus: "none" | "saved" | "locked",
    lineItems: SiteLineItem[] = []
) {
    const onViewSiteMemo = vi.fn();
    const onPlanRole = vi.fn();
    const onRecordRewardInput = vi.fn();
    const onAddConstruction = vi.fn();

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
            members={[
                {
                    id: "member-1",
                    full_name: "山田 太郎",
                    username: "yamada",
                    avatar_url: null,
                },
            ]}
            siteLineItemsBySiteId={{ [baseSite.id]: lineItems }}
            onViewSiteMemo={onViewSiteMemo}
            onPlanRole={onPlanRole}
            onRecordRewardInput={onRecordRewardInput}
            onAddConstruction={onAddConstruction}
            getDayLogStatus={() => dayLogStatus}
            getSiteInputStatus={() => "role_missing"}
        />,
    );

    return {
        onViewSiteMemo,
        onPlanRole,
        onRecordRewardInput,
        onAddConstruction,
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

    it("keeps memo review available when the log is locked", () => {
        const { onViewSiteMemo } = renderAssignments("locked");

        fireEvent.click(screen.getByRole("button", { name: "メモ" }));

        expect(onViewSiteMemo).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
        expect(screen.queryByRole("button", { name: "今日やることを追加" })).not.toBeInTheDocument();
    });

    it("opens role planning from the site card without showing status chips", () => {
        const { onPlanRole } = renderAssignments("none");

        expect(screen.queryByText("今日の現場")).not.toBeInTheDocument();
        expect(screen.queryByText("確定")).not.toBeInTheDocument();
        expect(screen.queryByText("役割未入力")).not.toBeInTheDocument();
        expect(screen.queryByText("現場稼働")).not.toBeInTheDocument();
        expect(screen.queryByRole("link", { name: "地図" })).not.toBeInTheDocument();
        expect(screen.getByRole("link", { name: "地図を開く" })).toHaveAttribute(
            "href",
            expect.stringContaining(encodeURIComponent(baseSiteAddress)),
        );
        expect(screen.getByText(baseSiteAddress)).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "先方 佐藤さんに電話" })).toHaveAttribute(
            "href",
            "tel:0312345678",
        );
        expect(screen.getByText("佐藤さん")).toBeInTheDocument();
        expect(screen.getByLabelText("チーム担当: 山田 太郎")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "役割" }));

        expect(onPlanRole).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
    });

    it("shows construction chips, opens the detail modal, and opens the add flow", () => {
        const { onAddConstruction } = renderAssignments("none", [baseLineItem]);

        expect(screen.getByText("床工事")).toBeInTheDocument();
        expect(screen.queryByText(baseSite.description!)).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "渋谷マンションの工事内容を見る" }));

        expect(screen.getByRole("dialog", { name: "工事内容" })).toBeInTheDocument();
        expect(screen.getByText(baseSite.description!)).toBeInTheDocument();
        expect(screen.getAllByText("床工事").length).toBeGreaterThanOrEqual(2);
        expect(screen.getByText("20㎡ @¥1,800")).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole("button", { name: "工事追加" })[0]!);

        expect(onAddConstruction).toHaveBeenCalledWith(expect.objectContaining({ id: baseSite.id }));
    });
});
