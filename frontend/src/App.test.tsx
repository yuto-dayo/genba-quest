import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { useActiveOrgStore } from "./stores/activeOrg";

const fetchAppEntryState = vi.fn();
const bootstrapFirstOrg = vi.fn();
const bootstrapOrg = vi.fn();
const fetchPathForms = vi.fn();
const fetchPathAiReviews = vi.fn();
const getSession = vi.fn();
const onAuthStateChange = vi.fn();

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

vi.mock("./pages/Today", () => ({
    Today: () => <div>today-page</div>,
}));

vi.mock("./pages/Calendar", () => ({
    Calendar: () => <div>calendar-page</div>,
}));

vi.mock("./pages/Sites", () => ({
    Sites: () => <div>sites-page</div>,
}));

vi.mock("./pages/Money", () => ({
    Money: () => <div>money-page</div>,
}));

vi.mock("./pages/Settings", () => ({
    Settings: () => <div>settings-page</div>,
}));

vi.mock("./pages/Communications", () => ({
    Communications: () => <div>communications-page</div>,
}));

vi.mock("./pages/LUQO", () => ({
    default: () => <div>luqo-page</div>,
}));

vi.mock("./components/FloatingActionButton", () => ({
    FloatingActionButton: ({
        items,
    }: {
        items: Array<{ id: string; label: string; onClick: () => void }>;
    }) => (
        <div>
            {items.map((item) => (
                <button key={item.id} type="button" onClick={item.onClick}>
                    {item.label}
                </button>
            ))}
        </div>
    ),
}));

vi.mock("./components/CommunicationRecordSheet", () => ({
    CommunicationRecordSheet: () => null,
}));

vi.mock("./components/today/MonthlyEvaluationModal", () => ({
    MonthlyEvaluationModal: () => null,
}));

vi.mock("./lib/api", async () => {
    const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
    return {
        ...actual,
        fetchAppEntryState: (...args: unknown[]) => fetchAppEntryState(...args),
        bootstrapFirstOrg: (...args: unknown[]) => bootstrapFirstOrg(...args),
        bootstrapOrg: (...args: unknown[]) => bootstrapOrg(...args),
        fetchPathForms: (...args: unknown[]) => fetchPathForms(...args),
        fetchPathAiReviews: (...args: unknown[]) => fetchPathAiReviews(...args),
    };
});

vi.mock("./lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => getSession(...args),
            onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
        },
    },
}));

describe("App entry gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        useActiveOrgStore.setState({ activeOrgId: null, options: [] });

        fetchPathForms.mockResolvedValue({ forms: [] });
        fetchPathAiReviews.mockResolvedValue({ reviews: [] });
        getSession.mockResolvedValue({
            data: {
                session: {
                    user: {
                        id: "user-1",
                    },
                },
            },
        });
        onAuthStateChange.mockReturnValue({
            data: {
                subscription: {
                    unsubscribe: vi.fn(),
                },
            },
        });
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it("renders system bootstrap and does not mount app shell when entry state is needs_system_bootstrap", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_system_bootstrap",
            viewer_email: "worker@example.com",
        });

        render(<App />);

        expect(await screen.findByText("最初の組織を作成")).toBeInTheDocument();
        expect(screen.queryByText("today-page")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "組織を作成" })).toBeInTheDocument();
    });

    it("renders invite-only onboarding when entry state is needs_onboarding", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_onboarding",
            viewer_email: "worker@example.com",
            bootstrap_allowed: false,
            memberships: [],
            pending_invites: [],
        });

        render(<App />);

        expect(await screen.findByText("招待を受けて参加")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "組織を作成" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "招待で参加" })).toBeInTheDocument();
    });

    it("shows bootstrap form on onboarding when bootstrap is allowed", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_onboarding",
            viewer_email: "worker@example.com",
            bootstrap_allowed: true,
            memberships: [],
            pending_invites: [],
        });

        render(<App />);

        expect(await screen.findByText("参加方法を選択")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "組織を作成" })).toBeInTheDocument();
        expect(screen.getByText("新しい組織を作成")).toBeInTheDocument();
    });

    it("shows bootstrap form when invite action state also allows bootstrap", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_invite_action",
            viewer_email: "worker@example.com",
            bootstrap_allowed: true,
            memberships: [],
            pending_invites: [
                {
                    invite_id: "invite-1",
                    org_id: "org-1",
                    org_name: "GENBA 本部",
                    role: "member",
                    email_normalized: "worker@example.com",
                },
            ],
        });

        render(<App />);

        expect(await screen.findByText("招待されている組織があります")).toBeInTheDocument();
        expect(screen.getByText("GENBA 本部")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "組織を作成" })).toBeInTheDocument();
        expect(screen.getByText("別の組織を作成")).toBeInTheDocument();
    });

    it("shows the unified communication FAB on today", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        expect(await screen.findByText("today-page")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "連絡を記録" })).toBeInTheDocument();
    });

    it("uses org bootstrap endpoint from onboarding state", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_onboarding",
            viewer_email: "worker@example.com",
            bootstrap_allowed: true,
            memberships: [],
            pending_invites: [],
        });
        bootstrapOrg.mockResolvedValue({
            active_org: {
                id: "org-1",
                name: "PATH.インテリア",
                slug: "path-in",
                status: "active",
            },
            membership: {
                org_id: "org-1",
                user_id: "user-1",
                role: "admin",
                status: "active",
            },
        });

        render(<App />);

        fireEvent.change(await screen.findByPlaceholderText("例: GENBA 本部"), {
            target: { value: "PATH.インテリア" },
        });
        fireEvent.change(screen.getByPlaceholderText("例: genba-hq"), {
            target: { value: "path-in" },
        });
        fireEvent.click(screen.getByRole("button", { name: "組織を作成" }));

        await waitFor(() => {
            expect(bootstrapOrg).toHaveBeenCalledWith({
                name: "PATH.インテリア",
                slug: "path-in",
            });
        });

        expect(bootstrapFirstOrg).not.toHaveBeenCalled();
    });

    it("skips org picker when stored active org is still valid", async () => {
        window.localStorage.setItem("genbaquest.activeOrgId", "org-2");
        useActiveOrgStore.setState({ activeOrgId: "org-2", options: [] });
        fetchAppEntryState.mockResolvedValue({
            state: "needs_org_selection",
            viewer_email: "worker@example.com",
            memberships: [
                { org_id: "org-1", org_name: "Org One", role: "member" },
                { org_id: "org-2", org_name: "Org Two", role: "admin" },
            ],
        });

        render(<App />);

        await waitFor(() => {
            expect(screen.getByText("today-page")).toBeInTheDocument();
        });

        expect(screen.queryByText("開く組織を選択してください")).not.toBeInTheDocument();
    });

    it("renders org picker when stored active org is invalid", async () => {
        window.localStorage.setItem("genbaquest.activeOrgId", "org-x");
        useActiveOrgStore.setState({ activeOrgId: "org-x", options: [] });
        fetchAppEntryState.mockResolvedValue({
            state: "needs_org_selection",
            viewer_email: "worker@example.com",
            memberships: [
                { org_id: "org-1", org_name: "Org One", role: "member" },
                { org_id: "org-2", org_name: "Org Two", role: "admin" },
            ],
        });

        render(<App />);

        expect(await screen.findByText("開く組織を選択してください")).toBeInTheDocument();
        expect(screen.queryByText("today-page")).not.toBeInTheDocument();
    });

    it("transitions to the app shell after bootstrap succeeds", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_system_bootstrap",
            viewer_email: "worker@example.com",
        });
        bootstrapFirstOrg.mockResolvedValue({
            active_org: {
                id: "org-1",
                name: "GENBA 本部",
                slug: "genba-hq",
                status: "active",
            },
            membership: {
                org_id: "org-1",
                user_id: "user-1",
                role: "admin",
                status: "active",
            },
        });

        render(<App />);

        fireEvent.change(await screen.findByPlaceholderText("例: GENBA 本部"), {
            target: { value: "GENBA 本部" },
        });
        fireEvent.change(screen.getByPlaceholderText("例: genba-hq"), {
            target: { value: "Genba-HQ" },
        });
        fireEvent.click(screen.getByRole("button", { name: "組織を作成" }));

        await waitFor(() => {
            expect(bootstrapFirstOrg).toHaveBeenCalledWith({
                name: "GENBA 本部",
                slug: "Genba-HQ",
            });
        });

        expect(await screen.findByText("today-page")).toBeInTheDocument();
    });
});
