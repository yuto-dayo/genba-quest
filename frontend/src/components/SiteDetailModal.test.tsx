import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SiteDetailModal } from "./SiteDetailModal";
import type { Site } from "../lib/api";

const fetchSiteDocuments = vi.fn();
const uploadSiteDocument = vi.fn();
const deleteSite = vi.fn();
const fetchMembers = vi.fn();
const fetchSiteLineItems = vi.fn();
const fetchPathV31DayLogs = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => (
                <div {...props}>{children}</div>
            ),
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
        ...actual,
        fetchSiteDocuments: (...args: unknown[]) => fetchSiteDocuments(...args),
        uploadSiteDocument: (...args: unknown[]) => uploadSiteDocument(...args),
        deleteSite: (...args: unknown[]) => deleteSite(...args),
        fetchMembers: (...args: unknown[]) => fetchMembers(...args),
        fetchSiteLineItems: (...args: unknown[]) => fetchSiteLineItems(...args),
        fetchPathV31DayLogs: (...args: unknown[]) => fetchPathV31DayLogs(...args),
    };
});

const completedSite: Site = {
    id: "site-1",
    name: "渋谷マンション",
    status: "completed",
    close_phase: "completed_close_executed",
    completed_at: "2026-04-18T09:30:00.000Z",
    created_at: "2026-04-18T00:00:00.000Z",
};

const activeSite: Site = {
    id: "site-2",
    name: "新宿ビル",
    status: "active",
    created_at: "2026-04-18T00:00:00.000Z",
};

describe("SiteDetailModal", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchSiteDocuments.mockResolvedValue([]);
        fetchSiteLineItems.mockResolvedValue([]);
        fetchMembers.mockResolvedValue([]);
        fetchPathV31DayLogs.mockResolvedValue({
            logs: [
                {
                    id: "log-1",
                    org_id: "org-1",
                    date: "2026-04-18",
                    site_id: "site-2",
                    member_id: "member-1",
                    trade_families: ["wall_finish"],
                    role_type: "assist",
                    credited_unit: 1,
                    memo: "",
                    locked_by_site_close_id: null,
                    created_at: "2026-04-18T00:00:00.000Z",
                    updated_at: "2026-04-18T00:00:00.000Z",
                },
            ],
        });
    });

    it("shows operator-only guidance instead of a reverse completion action", () => {
        render(
            <MemoryRouter initialEntries={["/sites?site=site-1"]}>
                <Routes>
                    <Route
                        path="/sites"
                        element={(
                            <SiteDetailModal
                                site={completedSite}
                                onClose={() => {}}
                                onUpdated={() => {}}
                            />
                        )}
                    />
                </Routes>
            </MemoryRouter>,
        );

        expect(screen.getByText("完了: 2026/4/18")).toBeInTheDocument();
        expect(
            screen.getByText("現場締めまで確定しています。変更が必要な場合は reopen / reverse の運用フローで戻します。"),
        ).toBeInTheDocument();
        expect(screen.queryByText("完了にする")).not.toBeInTheDocument();
        expect(
            screen.getByRole("link", { name: "この月のPATH報酬を確認" }),
        ).toHaveAttribute("href", "/path?period=2026-04&reward=1&site=site-1");
    });

    it("preserves LUQO context when returning to the reward flow", () => {
        render(
            <MemoryRouter
                initialEntries={["/sites?site=site-1&return=luqo&period=2026-03&member=member-7&reward=1"]}
            >
                <Routes>
                    <Route
                        path="/sites"
                        element={(
                            <SiteDetailModal
                                site={completedSite}
                                onClose={() => {}}
                                onUpdated={() => {}}
                            />
                        )}
                    />
                </Routes>
            </MemoryRouter>,
        );

        expect(
            screen.getByRole("link", { name: "この月のPATH報酬を確認" }),
        ).toHaveAttribute(
            "href",
            "/path?period=2026-03&reward=1&site=site-1&member=member-7",
        );
    });

    it("opens the close modal from the complete action", async () => {
        render(
            <MemoryRouter initialEntries={["/sites?site=site-2"]}>
                <Routes>
                    <Route
                        path="/sites"
                        element={(
                            <SiteDetailModal
                                site={activeSite}
                                onClose={() => {}}
                                onUpdated={() => {}}
                            />
                        )}
                    />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click(screen.getByRole("button", { name: "完了にする" }));

        await waitFor(() => {
            expect(fetchPathV31DayLogs).toHaveBeenCalledWith({ site_id: "site-2", limit: 200 });
        });
    });
});
