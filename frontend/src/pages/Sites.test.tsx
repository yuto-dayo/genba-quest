import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { Sites } from "./Sites";
import type { Site } from "../lib/api";

const fetchSites = vi.fn();
const fetchSite = vi.fn();

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

vi.mock("../lib/api", () => ({
    fetchSites: (...args: unknown[]) => fetchSites(...args),
    fetchSite: (...args: unknown[]) => fetchSite(...args),
}));

vi.mock("../components/FloatingActionButton", () => ({
    FloatingActionButton: () => null,
}));

vi.mock("../components/SiteFormModal", () => ({
    SiteFormModal: () => null,
}));

vi.mock("../components/ClientSettingsModal", () => ({
    ClientSettingsModal: () => null,
}));

vi.mock("../components/SiteDetailModal", () => ({
    SiteDetailModal: ({
        site,
        onClose,
    }: {
        site: Site;
        onClose: () => void;
    }) => (
        <div>
            <p>detail:{site.name}</p>
            <button type="button" onClick={onClose}>
                閉じる
            </button>
        </div>
    ),
}));

const baseSite: Site = {
    id: "site-1",
    name: "渋谷マンション",
    status: "completed",
    created_at: "2026-04-18T00:00:00.000Z",
};

describe("Sites", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("opens the requested site detail from the site query param", async () => {
        fetchSites.mockResolvedValue([baseSite]);
        fetchSite.mockResolvedValue(baseSite);

        render(
            <MemoryRouter initialEntries={["/sites?site=site-1"]}>
                <Routes>
                    <Route path="/sites" element={<Sites />} />
                </Routes>
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(fetchSite).toHaveBeenCalledWith("site-1");
        });

        expect(await screen.findByText("detail:渋谷マンション")).toBeInTheDocument();
    });

    it("returns to the Money reward modal when a site detail opened from PATH is closed", async () => {
        fetchSites.mockResolvedValue([baseSite]);
        fetchSite.mockResolvedValue(baseSite);

        render(
            <MemoryRouter initialEntries={["/sites?site=site-1&return=luqo&period=2026-04&reward=1&member=member-1"]}>
                <Routes>
                    <Route path="/sites" element={<Sites />} />
                    <Route path="/money" element={<div data-testid="money-page">Money reward</div>} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByText("detail:渋谷マンション")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "閉じる" }));

        expect(await screen.findByTestId("money-page")).toBeInTheDocument();
    });
});
