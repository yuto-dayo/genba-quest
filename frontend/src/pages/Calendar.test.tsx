import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./Calendar";
import type { CalendarDay } from "../types/calendar";

const fetchMembers = vi.fn();
const fetchOrgContext = vi.fn();
const commitAssignmentCreateDrafts = vi.fn();
const deletePersonalSchedule = vi.fn();
const rejectProposal = vi.fn();
const submitLeaveRequestProposal = vi.fn();
const getSession = vi.fn();
const reloadAssignments = vi.fn();
const selectDate = vi.fn();

const baseCalendarDay: CalendarDay = {
    date: "2026-04-25",
    day: 25,
    assignments: [],
    personal_schedules: [],
    isToday: false,
    isCurrentMonth: true,
    isWeekend: true,
};
let mockCalendarDays: CalendarDay[] = [baseCalendarDay];
let mockSelectedDate: CalendarDay = baseCalendarDay;
let mockAnnualRestDaysByUser: Record<string, number> = {};

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get:
                (_target, tag: string) =>
                (motionProps: ComponentProps<"div"> & {
                    initial?: unknown;
                    animate?: unknown;
                    exit?: unknown;
                    transition?: unknown;
                    whileHover?: unknown;
                    whileTap?: unknown;
                }) => {
                    const { children, ...props } = motionProps;
                    const domProps = { ...props } as Record<string, unknown>;

                    ["initial", "animate", "exit", "transition", "whileHover", "whileTap"].forEach((prop) => {
                        delete domProps[prop];
                    });

                    return createElement(tag, domProps, children);
                },
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../components/calendar/CalendarScheduleModal", () => ({
    CalendarScheduleModal: ({
        initialDate,
        scope,
        initialMode,
    }: {
        initialDate: string;
        scope: "organization" | "personal";
        initialMode?: "menu" | "personal" | "assignment";
    }) => (
        <div role="dialog">
            {initialMode === "personal"
                ? "予定を入れる"
                : initialMode === "assignment"
                  ? "現場に入れる"
                  : "追加する"}{" "}
            {initialDate}
            {(scope === "personal" || initialMode !== "assignment") && (
                <button type="button">予定を入れる</button>
            )}
            {scope === "organization" && initialMode !== "personal" && (
                <button type="button">現場に入れる</button>
            )}
        </div>
    ),
}));

vi.mock("../hooks/useCalendar", () => ({
    useCalendar: () => ({
        year: 2026,
        month: 4,
        calendarDays: mockCalendarDays,
        annualRestDaysByUser: mockAnnualRestDaysByUser,
        selectedDate: mockSelectedDate,
        sites: [],
        nextMonth: vi.fn(),
        prevMonth: vi.fn(),
        selectDate,
        reloadAssignments,
    }),
}));

vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
        ...actual,
        commitAssignmentCreateDrafts: (...args: unknown[]) => commitAssignmentCreateDrafts(...args),
        deletePersonalSchedule: (...args: unknown[]) => deletePersonalSchedule(...args),
        fetchMembers: (...args: unknown[]) => fetchMembers(...args),
        fetchOrgContext: (...args: unknown[]) => fetchOrgContext(...args),
        rejectProposal: (...args: unknown[]) => rejectProposal(...args),
        submitLeaveRequestProposal: (...args: unknown[]) => submitLeaveRequestProposal(...args),
    };
});

vi.mock("../lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => getSession(...args),
        },
    },
}));

describe("Calendar page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockCalendarDays = [baseCalendarDay];
        mockSelectedDate = baseCalendarDay;
        mockAnnualRestDaysByUser = {};
        fetchMembers.mockResolvedValue([]);
        fetchOrgContext.mockResolvedValue({ membership: { user_id: "user-1" } });
        deletePersonalSchedule.mockResolvedValue({ ok: true, id: "schedule-1" });
        rejectProposal.mockResolvedValue({ id: "proposal-1" });
        getSession.mockResolvedValue({
            data: {
                session: {
                    user: { id: "user-1" },
                },
            },
        });
    });

    it("selects the date without opening the add modal when a date is tapped", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: /25日/ }));

        expect(selectDate).toHaveBeenCalledWith(
            expect.objectContaining({ date: "2026-04-25" }),
        );
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("starts in month view and shows this month's rest counts", async () => {
        const dayWithLeave: CalendarDay = {
            ...baseCalendarDay,
            personal_schedules: [
                {
                    id: "schedule-1",
                    user_id: "user-1",
                    start_date: "2026-04-25",
                    end_date: "2026-04-25",
                    type: "vacation",
                    title: "休み",
                    blocks_assignment: true,
                    visibility: "organization",
                    reason: null,
                    approved: true,
                    status: "approved",
                    source: "personal_schedule",
                },
            ],
        };
        mockCalendarDays = [dayWithLeave];
        mockSelectedDate = dayWithLeave;
        fetchMembers.mockResolvedValue([
            {
                id: "member-1",
                user_id: "user-1",
                display_name: "ユート",
                full_name: null,
                username: null,
                avatar_url: null,
                status: "active",
            },
        ]);

        render(<Calendar />);

        expect(screen.getByRole("button", { name: "今月" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("button", { name: /25日/ })).toBeInTheDocument();
        expect(screen.getByText("今月の休み数")).toBeInTheDocument();
        expect(await screen.findByLabelText("ユート 1日")).toBeInTheDocument();
    });

    it("switches to year view summary and back to the month calendar", async () => {
        const dayWithLeave: CalendarDay = {
            ...baseCalendarDay,
            personal_schedules: [
                {
                    id: "schedule-1",
                    user_id: "user-1",
                    start_date: "2026-04-25",
                    end_date: "2026-04-25",
                    type: "vacation",
                    title: "休み",
                    blocks_assignment: true,
                    visibility: "organization",
                    reason: null,
                    approved: true,
                    status: "approved",
                    source: "personal_schedule",
                },
            ],
        };
        mockCalendarDays = [dayWithLeave];
        mockSelectedDate = dayWithLeave;
        mockAnnualRestDaysByUser = { "user-1": 42 };
        fetchMembers.mockResolvedValue([
            {
                id: "member-1",
                user_id: "user-1",
                display_name: "ユート",
                full_name: null,
                username: null,
                avatar_url: null,
                status: "active",
            },
        ]);

        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "今年" }));

        expect(screen.getByRole("button", { name: "今年" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.queryByText("今月の休み数")).not.toBeInTheDocument();
        expect(screen.queryByText("今年の休み数")).not.toBeInTheDocument();
        expect(screen.getByText("今年の休み状況")).toBeInTheDocument();
        expect(screen.getByText("年間目標: 120日")).toBeInTheDocument();
        expect(await screen.findByText("42 / 120日")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /25日/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "前月" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "翌月" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "今月" }));

        expect(screen.getByRole("button", { name: "今月" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByText("今月の休み数")).toBeInTheDocument();
        expect(await screen.findByLabelText("ユート 1日")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /25日/ })).toBeInTheDocument();
    });

    it("opens the personal schedule form from the calendar FAB", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "予定の追加メニューを開く" }));
        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "現場に入れる" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "予定を入れる" }));

        expect(screen.getByRole("dialog")).toHaveTextContent("予定を入れる 2026-04-25");
        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "現場に入れる" })).not.toBeInTheDocument();
    });

    it("opens the assignment form from the calendar FAB", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "予定の追加メニューを開く" }));
        fireEvent.click(screen.getByRole("button", { name: "現場に入れる" }));

        expect(screen.getByRole("dialog")).toHaveTextContent("現場に入れる 2026-04-25");
        expect(screen.queryByRole("button", { name: "予定を入れる" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "現場に入れる" })).toBeInTheDocument();
    });

    it("opens the add menu from a date long-press shortcut", () => {
        render(<Calendar />);

        fireEvent.contextMenu(screen.getByRole("button", { name: /25日/ }));

        expect(selectDate).toHaveBeenCalledWith(
            expect.objectContaining({ date: "2026-04-25" }),
        );
        expect(screen.getByRole("dialog")).toHaveTextContent("追加する 2026-04-25");
    });

    it("opens only the personal schedule form entry in personal scope", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "自分" }));
        fireEvent.click(screen.getByRole("button", { name: "予定の追加メニューを開く" }));

        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "現場に入れる" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "予定を入れる" }));

        expect(screen.getByRole("dialog")).toHaveTextContent("予定を入れる 2026-04-25");
    });

    it("clears a persisted leave schedule from the personal availability panel", async () => {
        const dayWithLeave: CalendarDay = {
            ...baseCalendarDay,
            personal_schedules: [
                {
                    id: "schedule-1",
                    user_id: "user-1",
                    start_date: "2026-04-25",
                    end_date: "2026-04-25",
                    type: "vacation",
                    title: "休み",
                    blocks_assignment: true,
                    visibility: "organization",
                    reason: null,
                    approved: true,
                    status: "approved",
                    source: "personal_schedule",
                },
            ],
        };
        mockCalendarDays = [dayWithLeave];
        mockSelectedDate = dayWithLeave;

        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "自分" }));
        await waitFor(() => {
            expect(screen.getByRole("button", { name: "休み" })).toBeDisabled();
        });

        fireEvent.click(screen.getByRole("button", { name: "解除" }));

        await waitFor(() => {
            expect(deletePersonalSchedule).toHaveBeenCalledWith("schedule-1");
        });
        expect(reloadAssignments).toHaveBeenCalled();
        expect(await screen.findByText("休みを解除しました。")).toBeInTheDocument();
    });

    it("rejects a pending leave proposal when clearing it", async () => {
        const dayWithPendingLeave: CalendarDay = {
            ...baseCalendarDay,
            personal_schedules: [
                {
                    id: "proposal-1",
                    user_id: "user-1",
                    start_date: "2026-04-25",
                    end_date: "2026-04-25",
                    type: "vacation",
                    title: "休み",
                    blocks_assignment: true,
                    visibility: "organization",
                    reason: null,
                    approved: false,
                    status: "pending",
                    source: "proposal",
                },
            ],
        };
        mockCalendarDays = [dayWithPendingLeave];
        mockSelectedDate = dayWithPendingLeave;

        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "自分" }));
        await waitFor(() => {
            expect(screen.getByRole("button", { name: "休み" })).toBeDisabled();
        });

        fireEvent.click(screen.getByRole("button", { name: "解除" }));

        await waitFor(() => {
            expect(rejectProposal).toHaveBeenCalledWith("proposal-1", "休みを解除");
        });
        expect(deletePersonalSchedule).not.toHaveBeenCalled();
    });
});
