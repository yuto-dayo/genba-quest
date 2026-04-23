import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Today } from "./Today";

const fetchFocusItems = vi.fn();
const fetchSites = vi.fn();
const fetchPendingProposals = vi.fn();
const fetchPathV31DayLogs = vi.fn();
const savePathV31DayLog = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => (
                <div {...props}>{children}</div>
            ),
        },
    ),
}));

vi.mock("../lib/api", () => ({
    fetchFocusItems: (...args: unknown[]) => fetchFocusItems(...args),
    fetchSites: (...args: unknown[]) => fetchSites(...args),
    fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
    fetchPathV31DayLogs: (...args: unknown[]) => fetchPathV31DayLogs(...args),
    savePathV31DayLog: (...args: unknown[]) => savePathV31DayLog(...args),
    approveProposal: vi.fn(),
    completeFocusItem: vi.fn(),
    createFocusItem: vi.fn(),
    executeProposal: vi.fn(),
    instructProposal: vi.fn(),
    rejectProposal: vi.fn(),
    updateFocusItem: vi.fn(),
}));

vi.mock("../lib/pathProposal", () => ({
    buildPathProposalHref: vi.fn(() => null),
    getPathProposalContext: vi.fn(() => null),
    isPathModuleProposal: vi.fn(() => false),
}));

vi.mock("../lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: vi.fn().mockResolvedValue({
                data: {
                    session: {
                        user: { id: "user-1" },
                    },
                },
            }),
        },
    },
}));

vi.mock("../hooks/useCalendar", () => ({
    useCalendar: () => ({
        calendarDays: [
            {
                date: "2026-04-22",
                day: 22,
                assignments: [
                    {
                        id: "assignment-1",
                        user_id: "user-1",
                        site_id: "site-1",
                        site_name: "渋谷マンション",
                        date: "2026-04-22",
                        status: "scheduled",
                        source: "proposal",
                    },
                ],
                isToday: true,
                isCurrentMonth: true,
                isWeekend: false,
            },
        ],
        selectDate: vi.fn(),
        selectedDate: null,
    }),
}));

vi.mock("../components/calendar/WeekCalendar", () => ({
    WeekCalendar: () => <div data-testid="week-calendar" />,
}));

vi.mock("../components/ProposalDetailModal", () => ({
    ProposalDetailModal: () => null,
}));

vi.mock("../components/SiteDetailModal", () => ({
    SiteDetailModal: () => null,
}));

vi.mock("../components/today/MonthlySummary", () => ({
    MonthlySummary: () => <div data-testid="monthly-summary" />,
}));

vi.mock("../components/today/PendingBadge", () => ({
    PendingBadge: ({ count, onClick }: { count: number; onClick: () => void }) => (
        <button type="button" onClick={onClick}>
            pending:{count}
        </button>
    ),
}));

describe("Today page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchFocusItems.mockResolvedValue([]);
        fetchSites.mockResolvedValue([
            {
                id: "site-1",
                name: "渋谷マンション",
                status: "active",
                created_at: "2026-04-22T00:00:00.000Z",
            },
        ]);
        fetchPendingProposals.mockResolvedValue([]);
        fetchPathV31DayLogs.mockResolvedValue({ logs: [] });
        savePathV31DayLog.mockResolvedValue({
            log: {
                id: "log-1",
                org_id: "org-1",
                date: "2026-04-22",
                site_id: "site-1",
                member_id: "user-1",
                trade_families: ["wall_finish"],
                role_type: "assist",
                credited_unit: 1,
                memo: "",
                locked_by_site_close_id: null,
                created_at: "2026-04-22T09:00:00.000Z",
                updated_at: "2026-04-22T09:00:00.000Z",
            },
        });
    });

    it("preloads today's logs for the current user and updates the card state after save", async () => {
        render(
            <MemoryRouter initialEntries={["/today"]}>
                <Routes>
                    <Route path="/today" element={<Today />} />
                </Routes>
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(fetchPathV31DayLogs).toHaveBeenCalledWith(
                expect.objectContaining({
                    member_id: "user-1",
                    limit: 50,
                }),
            );
        });

        const recordButton = await screen.findByRole("button", { name: "記録" });
        fireEvent.click(recordButton);

        expect(await screen.findByRole("heading", { name: "今日の記録" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "保存" }));

        await waitFor(() => {
            expect(savePathV31DayLog).toHaveBeenCalledWith(
                expect.objectContaining({
                    site_id: "site-1",
                    member_id: "user-1",
                    date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
                    credited_unit: 1,
                }),
            );
        });

        expect(await screen.findByRole("button", { name: "編集" })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "今日の記録" })).not.toBeInTheDocument();
    });
});
