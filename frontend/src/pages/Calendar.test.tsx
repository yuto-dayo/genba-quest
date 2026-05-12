import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Calendar } from "./Calendar";
import type { CalendarDay } from "../types/calendar";
import type { Site } from "../lib/api";

const fetchMembers = vi.fn();
const fetchOrgContext = vi.fn();
const fetchSiteLineItems = vi.fn();
const updateSiteAssignedUsers = vi.fn();
const deletePersonalSchedule = vi.fn();
const rejectProposal = vi.fn();
const submitLeaveRequestProposal = vi.fn();
const getSession = vi.fn();
const reloadAssignments = vi.fn();
const selectDate = vi.fn();
const goToMonth = vi.fn();

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
let mockSites: Site[] = [];

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
            {scope === "organization" && initialMode === "assignment" && (
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
        sites: mockSites,
        nextMonth: vi.fn(),
        prevMonth: vi.fn(),
        goToMonth,
        selectDate,
        reloadAssignments,
    }),
}));

vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
        ...actual,
        deletePersonalSchedule: (...args: unknown[]) => deletePersonalSchedule(...args),
        fetchMembers: (...args: unknown[]) => fetchMembers(...args),
        fetchOrgContext: (...args: unknown[]) => fetchOrgContext(...args),
        fetchSiteLineItems: (...args: unknown[]) => fetchSiteLineItems(...args),
        rejectProposal: (...args: unknown[]) => rejectProposal(...args),
        submitLeaveRequestProposal: (...args: unknown[]) => submitLeaveRequestProposal(...args),
        updateSiteAssignedUsers: (...args: unknown[]) => updateSiteAssignedUsers(...args),
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
        mockSites = [];
        fetchMembers.mockResolvedValue([]);
        fetchOrgContext.mockResolvedValue({ membership: { user_id: "user-1" } });
        fetchSiteLineItems.mockResolvedValue([]);
        updateSiteAssignedUsers.mockResolvedValue({});
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
        expect(screen.getByLabelText("4月の休み数")).toBeInTheDocument();
        expect(await screen.findByLabelText("ユート 1日")).toBeInTheDocument();
    });

    it("opens a collapsed month picker and jumps by year or month", () => {
        render(<Calendar />);

        expect(screen.queryByRole("dialog", { name: "表示月を選択" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "2026/04 の月選択を開く" }));

        expect(screen.getByRole("dialog", { name: "表示月を選択" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "2026/04 の月選択を閉じる" })).toHaveAttribute(
            "aria-expanded",
            "true"
        );

        fireEvent.click(screen.getByRole("button", { name: "2027" }));
        expect(goToMonth).toHaveBeenCalledWith(2027, 4);
        expect(screen.getByRole("dialog", { name: "表示月を選択" })).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "02" }));
        expect(goToMonth).toHaveBeenCalledWith(2026, 2);
        expect(screen.getByRole("dialog", { name: "表示月を選択" })).toBeInTheDocument();

        fireEvent.pointerDown(document.body);
        expect(screen.queryByRole("dialog", { name: "表示月を選択" })).not.toBeInTheDocument();
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
        expect(screen.getByLabelText("4月の休み数")).toBeInTheDocument();
        expect(await screen.findByLabelText("ユート 1日")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /25日/ })).toBeInTheDocument();
    });

    it("opens the personal schedule form from the calendar FAB", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "追加メニューを開く" }));
        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "新規現場" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "現場に入れる" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "予定を入れる" }));

        expect(screen.getByRole("dialog")).toHaveTextContent("予定を入れる 2026-04-25");
        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "現場に入れる" })).not.toBeInTheDocument();
    });

    it("shows a new-site action when opening the calendar FAB menu", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "追加メニューを開く" }));

        expect(screen.getByRole("button", { name: "新規現場" })).toBeInTheDocument();
    });

    it("selects and inspects the date from a date long-press shortcut", () => {
        render(<Calendar />);

        fireEvent.contextMenu(screen.getByRole("button", { name: /25日/ }));

        expect(selectDate).toHaveBeenCalledWith(
            expect.objectContaining({ date: "2026-04-25" }),
        );
        expect(screen.getByText("4/25(土) の現場")).toBeInTheDocument();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "現場に入れる" })).not.toBeInTheDocument();
    });

    it("shows compact site cards with registered work content and worker chips", async () => {
        const site: Site = {
            id: "site-1",
            name: "第一現場",
            status: "active",
            assigned_users: [],
            required_worker_count: null,
            created_at: "2026-04-01T00:00:00.000Z",
        };
        const dayWithSite: CalendarDay = {
            ...baseCalendarDay,
            assignments: [
                {
                    id: "site-row",
                    user_id: "site",
                    site_id: site.id,
                    site_name: site.name,
                    date: "2026-04-25",
                    status: "scheduled",
                    source: "site",
                },
            ],
            personal_schedules: [
                {
                    id: "vacation-1",
                    user_id: "worker-2",
                    start_date: "2026-04-25",
                    end_date: "2026-04-25",
                    type: "vacation",
                    title: "休み",
                    blocks_assignment: true,
                    visibility: "organization",
                    approved: true,
                    status: "approved",
                    source: "personal_schedule",
                },
            ],
        };
        mockSites = [site];
        mockCalendarDays = [dayWithSite];
        mockSelectedDate = dayWithSite;
        fetchMembers.mockResolvedValue([
            {
                id: "worker-1",
                display_name: "田中 太郎",
                full_name: null,
                username: null,
                avatar_url: null,
                status: "active",
            },
            {
                id: "worker-2",
                display_name: "佐藤 花子",
                full_name: null,
                username: null,
                avatar_url: null,
                status: "active",
            },
        ]);
        fetchSiteLineItems.mockResolvedValue([
            {
                id: "line-1",
                site_id: site.id,
                item_name: "床工事",
                quantity: 12,
                unit_name: "㎡",
                unit_price: 1000,
                sort_order: 0,
                created_by: null,
                created_at: "2026-04-01T00:00:00.000Z",
                updated_by: null,
                updated_at: "2026-04-01T00:00:00.000Z",
            },
        ]);

        render(<Calendar />);

        expect(screen.queryByText("Day Board")).not.toBeInTheDocument();
        expect(screen.queryByText("不足がある現場だけ、職人を追加します。")).not.toBeInTheDocument();
        expect(screen.queryByText("必要人数未設定")).not.toBeInTheDocument();
        expect(screen.queryByText("対象外")).not.toBeInTheDocument();
        expect(await screen.findByRole("combobox", { name: "工事内容" })).toHaveValue("line-1");
        expect(screen.getByRole("option", { name: "床工事 12㎡" })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "田中 太郎" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "佐藤 花子" })).not.toBeInTheDocument();
    });

    it("toggles worker chips directly without showing the draft footer", async () => {
        const site: Site = {
            id: "site-1",
            name: "第一現場",
            status: "active",
            assigned_users: [],
            required_worker_count: null,
            created_at: "2026-04-01T00:00:00.000Z",
        };
        const dayWithSite: CalendarDay = {
            ...baseCalendarDay,
            assignments: [
                {
                    id: "site-row",
                    user_id: "site",
                    site_id: site.id,
                    site_name: site.name,
                    date: "2026-04-25",
                    status: "scheduled",
                    source: "site",
                },
            ],
        };
        mockSites = [site];
        mockCalendarDays = [dayWithSite];
        mockSelectedDate = dayWithSite;
        fetchMembers.mockResolvedValue([
            {
                id: "worker-1",
                display_name: "田中 太郎",
                full_name: null,
                username: null,
                avatar_url: null,
                status: "active",
            },
        ]);
        fetchSiteLineItems.mockResolvedValue([
            {
                id: "line-1",
                site_id: site.id,
                item_name: "床工事",
                quantity: 12,
                unit_name: "㎡",
                unit_price: 1000,
                sort_order: 0,
                created_by: null,
                created_at: "2026-04-01T00:00:00.000Z",
                updated_by: null,
                updated_at: "2026-04-01T00:00:00.000Z",
            },
        ]);

        render(<Calendar />);

        const workerChip = await screen.findByRole("button", { name: "田中 太郎" });
        fireEvent.click(workerChip);

        await waitFor(() => {
            expect(updateSiteAssignedUsers).toHaveBeenCalledWith("site-1", ["worker-1"]);
        });
        expect(screen.queryByRole("button", { name: "変更案を送る" })).not.toBeInTheDocument();
        const selectedWorkerChip = screen
            .getAllByText("田中 太郎")
            .map((element) => element.closest("button"))
            .find((button) => button?.getAttribute("aria-pressed") === "true");
        expect(selectedWorkerChip).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(selectedWorkerChip!);

        await waitFor(() => {
            expect(updateSiteAssignedUsers).toHaveBeenLastCalledWith("site-1", []);
        });
        expect(screen.getByRole("button", { name: "田中 太郎" })).toHaveAttribute("aria-pressed", "false");
    });

    it("shows a quiet missing-work chip while still allowing worker selection", async () => {
        const site: Site = {
            id: "site-1",
            name: "第一現場",
            status: "active",
            assigned_users: [],
            required_worker_count: null,
            created_at: "2026-04-01T00:00:00.000Z",
        };
        const dayWithSite: CalendarDay = {
            ...baseCalendarDay,
            assignments: [
                {
                    id: "site-row",
                    user_id: "site",
                    site_id: site.id,
                    site_name: site.name,
                    date: "2026-04-25",
                    status: "scheduled",
                    source: "site",
                },
            ],
        };
        mockSites = [site];
        mockCalendarDays = [dayWithSite];
        mockSelectedDate = dayWithSite;
        fetchMembers.mockResolvedValue([
            {
                id: "worker-1",
                display_name: "田中 太郎",
                full_name: null,
                username: null,
                avatar_url: null,
                status: "active",
            },
        ]);
        fetchSiteLineItems.mockResolvedValue([]);

        render(<Calendar />);

        expect(await screen.findByText("工事内容未登録")).toBeInTheDocument();
        const workerChip = await screen.findByRole("button", { name: "田中 太郎" });
        fireEvent.click(workerChip);

        await waitFor(() => {
            expect(updateSiteAssignedUsers).toHaveBeenCalledWith("site-1", ["worker-1"]);
        });
        expect(screen.getByRole("button", { name: "田中 太郎" })).toHaveAttribute("aria-pressed", "true");
    });

    it("opens only the personal schedule form entry in personal scope", () => {
        render(<Calendar />);

        fireEvent.click(screen.getByRole("button", { name: "自分" }));
        fireEvent.click(screen.getByRole("button", { name: "追加メニューを開く" }));

        expect(screen.getByRole("button", { name: "予定を入れる" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "新規現場" })).toBeInTheDocument();
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
        const leaveToggle = await screen.findByRole("switch", { name: "休み" });
        expect(leaveToggle).toHaveAttribute("aria-checked", "true");

        fireEvent.click(leaveToggle);

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
        const leaveToggle = await screen.findByRole("switch", { name: "休み" });
        expect(leaveToggle).toHaveAttribute("aria-checked", "true");

        fireEvent.click(leaveToggle);

        await waitFor(() => {
            expect(rejectProposal).toHaveBeenCalledWith("proposal-1", "休みを解除");
        });
        expect(deletePersonalSchedule).not.toHaveBeenCalled();
    });
});
