import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./Calendar";

const fetchMembers = vi.fn();
const fetchOrgContext = vi.fn();
const commitAssignmentCreateDrafts = vi.fn();
const submitLeaveRequestProposal = vi.fn();
const getSession = vi.fn();
const reloadAssignments = vi.fn();
const selectDate = vi.fn();

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
        calendarDays: [
            {
                date: "2026-04-25",
                day: 25,
                assignments: [],
                personal_schedules: [],
                isToday: false,
                isCurrentMonth: true,
                isWeekend: true,
            },
        ],
        annualRestDaysByUser: {},
        selectedDate: {
            date: "2026-04-25",
            day: 25,
            assignments: [],
            personal_schedules: [],
            isToday: false,
            isCurrentMonth: true,
            isWeekend: true,
        },
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
        fetchMembers: (...args: unknown[]) => fetchMembers(...args),
        fetchOrgContext: (...args: unknown[]) => fetchOrgContext(...args),
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
        fetchMembers.mockResolvedValue([]);
        fetchOrgContext.mockResolvedValue({ membership: { user_id: "user-1" } });
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
});
