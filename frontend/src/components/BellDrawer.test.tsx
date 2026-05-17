import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRecord } from "../lib/api";
import { BellDrawer } from "./BellDrawer";

const navigate = vi.fn();
const track = vi.fn();

vi.mock("react-router-dom", async () => {
    const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
    return {
        ...actual,
        useNavigate: () => navigate,
    };
});

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
    useTransform: () => 0,
}));

vi.mock("./ApprovalCard", () => ({
    ApprovalCard: () => <div>approval-card</div>,
}));

vi.mock("../lib/api", () => ({
    reviewExpense: vi.fn(),
}));

vi.mock("../lib/telemetry", () => ({
    track: (...args: unknown[]) => track(...args),
}));

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

describe("BellDrawer month close reminders", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("routes unread month close reminders to the Money month-close modal", () => {
        const onClose = vi.fn();

        render(
            <MemoryRouter>
                <BellDrawer
                    open
                    onClose={onClose}
                    selfApprovals={[]}
                    consensusPending={[]}
                    notifications={[monthCloseNotification]}
                    onSelfApprovalComplete={vi.fn()}
                    onOpenProposal={vi.fn()}
                />
            </MemoryRouter>,
        );

        fireEvent.click(screen.getByRole("button", { name: /2026-05 分の月確定ができます/ }));

        expect(track).toHaveBeenCalledWith({
            type: "money.month_close.cta_seen",
            from: "bell",
        });
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(navigate).toHaveBeenCalledWith("/money?modal=month_close&period=2026-05");
    });
});
