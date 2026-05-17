import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, JSX, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import styles from "./App.module.css";
import { useActiveOrgStore } from "./stores/activeOrg";

const fetchAppEntryState = vi.fn();
const bootstrapFirstOrg = vi.fn();
const bootstrapOrg = vi.fn();
const fetchNotifications = vi.fn();
const markNotificationRead = vi.fn();
const fetchPendingApprovals = vi.fn();
const fetchPendingProposals = vi.fn();
const fetchResponsibilityLockTargets = vi.fn();
const fetchMyProfile = vi.fn();
const acceptOrgInvite = vi.fn();
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
const signInWithOtp = vi.fn();
const signInWithPassword = vi.fn();
const signInWithOAuth = vi.fn();
const signUp = vi.fn();
const resetPasswordForEmail = vi.fn();
const updateUser = vi.fn();
let authStateCallback: ((event: string, session: unknown) => void) | null = null;

const FRAMER_MOTION_PROPS = [
    "initial",
    "animate",
    "exit",
    "transition",
    "layout",
    "layoutId",
    "whileHover",
    "whileTap",
    "whileFocus",
    "whileDrag",
    "drag",
    "dragConstraints",
    "onAnimationStart",
    "onAnimationComplete",
];

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: (_target, prop) => {
                const Tag = (typeof prop === "string" ? prop : "div") as keyof JSX.IntrinsicElements;
                return (motionProps: ComponentProps<"div"> & Record<string, unknown>) => {
                    const { children, ...rest } = motionProps;
                    const domProps = { ...rest } as Record<string, unknown>;
                    FRAMER_MOTION_PROPS.forEach((key) => {
                        delete domProps[key];
                    });
                    return <Tag {...domProps}>{children}</Tag>;
                };
            },
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

vi.mock("./pages/PathRewardConfirmation", () => ({
    default: () => <div>luqo-page</div>,
}));

vi.mock("./components/LevelDraftSheet", () => ({
    LevelDraftSheet: ({
        open,
        siteName,
        pendingCount,
        dismissible,
        noticeMessage,
        onSubmitted,
        onSubmitError,
    }: {
        open: boolean;
        siteName: string;
        pendingCount?: number;
        dismissible?: boolean;
        noticeMessage?: string | null;
        onSubmitted?: () => Promise<void> | void;
        onSubmitError?: (message: string) => Promise<void> | void;
    }) =>
        open ? (
            <div data-testid="level-draft-sheet">
                <span>{siteName}</span>
                {typeof pendingCount === "number" ? (
                    <span data-testid="level-draft-pending-count">{pendingCount}</span>
                ) : null}
                <span data-testid="level-draft-dismissible">{String(Boolean(dismissible))}</span>
                {noticeMessage ? <span data-testid="level-draft-notice">{noticeMessage}</span> : null}
                <button type="button" onClick={() => void onSubmitted?.()}>
                    mock-submit-level-draft
                </button>
                <button
                    type="button"
                    onClick={() => void onSubmitError?.("PATH_V33_DRAFT_DEADLINE_PASSED")}
                >
                    mock-deadline-error
                </button>
            </div>
        ) : null,
}));

vi.mock("./components/onboarding/OnboardingWizard", () => ({
    OnboardingWizard: ({ onComplete }: { onComplete: () => Promise<void> | void }) => (
        <div>
            <p>profile-onboarding</p>
            <button type="button" onClick={() => void onComplete()}>
                complete-profile
            </button>
        </div>
    ),
}));

vi.mock("./lib/api", async () => {
    const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
    return {
        ...actual,
        fetchAppEntryState: (...args: unknown[]) => fetchAppEntryState(...args),
        bootstrapFirstOrg: (...args: unknown[]) => bootstrapFirstOrg(...args),
        bootstrapOrg: (...args: unknown[]) => bootstrapOrg(...args),
        fetchNotifications: (...args: unknown[]) => fetchNotifications(...args),
        markNotificationRead: (...args: unknown[]) => markNotificationRead(...args),
        fetchPendingApprovals: (...args: unknown[]) => fetchPendingApprovals(...args),
        fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
        fetchResponsibilityLockTargets: (...args: unknown[]) =>
            fetchResponsibilityLockTargets(...args),
        fetchMyProfile: (...args: unknown[]) => fetchMyProfile(...args),
        acceptOrgInvite: (...args: unknown[]) => acceptOrgInvite(...args),
    };
});

vi.mock("./lib/supabase", () => ({
    supabase: {
        auth: {
            getSession: (...args: unknown[]) => getSession(...args),
            onAuthStateChange: (...args: unknown[]) => onAuthStateChange(...args),
            signInWithOtp: (...args: unknown[]) => signInWithOtp(...args),
            signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
            signInWithOAuth: (...args: unknown[]) => signInWithOAuth(...args),
            signUp: (...args: unknown[]) => signUp(...args),
            resetPasswordForEmail: (...args: unknown[]) => resetPasswordForEmail(...args),
            updateUser: (...args: unknown[]) => updateUser(...args),
        },
    },
}));

describe("App entry gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
        vi.stubEnv("VITE_API_URL", "http://localhost:4001");
        authStateCallback = null;
        window.history.pushState({}, "", "/");
        window.localStorage.clear();
        document.cookie = "genba_quest_dev_auth_session=; Path=/; Max-Age=0";
        useActiveOrgStore.setState({ activeOrgId: null, options: [] });

        fetchNotifications.mockResolvedValue([]);
        markNotificationRead.mockResolvedValue({
            id: "notification-1",
            user_id: "user-1",
            type: "system_alert",
            title: "read",
            message: "read",
            data: {},
            read: true,
            created_at: "2026-05-08T00:00:00.000Z",
        });
        fetchPendingApprovals.mockResolvedValue([]);
        fetchPendingProposals.mockResolvedValue([]);
        fetchResponsibilityLockTargets.mockResolvedValue([]);
        fetchMyProfile.mockResolvedValue({
            profile: {
                id: "user-1",
                username: null,
                nickname: "ユト",
                full_name: "山田 太郎",
                avatar_url: null,
                onboarding_completed_at: "2026-05-01T00:00:00.000Z",
                phone: null,
                job_type: "内装",
                employment_kind: "employee",
                trade_name: null,
                invoice_registration_number: null,
                bank_name: null,
                branch_name: null,
                account_type: null,
                account_number: null,
                account_holder_kana: null,
                postal_code: null,
                prefecture: null,
                city: null,
                address_line1: null,
                address_line2: null,
                emergency_contact_name: null,
                emergency_phone: null,
            },
        });
        acceptOrgInvite.mockResolvedValue({
            active_org: {
                id: "org-1",
                name: "GENBA 本部",
                slug: "genba-hq",
                status: "active",
            },
            membership: {
                org_id: "org-1",
                user_id: "user-1",
                role: "member",
                status: "active",
            },
        });
        getSession.mockResolvedValue({
            data: {
                session: {
                    user: {
                        id: "user-1",
                    },
                },
            },
        });
        onAuthStateChange.mockImplementation((callback: (event: string, session: unknown) => void) => {
            authStateCallback = callback;
            return {
                data: {
                    subscription: {
                        unsubscribe: vi.fn(),
                    },
                },
            };
        });
        signInWithOtp.mockResolvedValue({ error: null });
        signInWithPassword.mockResolvedValue({ error: null });
        signInWithOAuth.mockResolvedValue({ error: null });
        signUp.mockResolvedValue({ data: { session: null }, error: null });
        resetPasswordForEmail.mockResolvedValue({ error: null });
        updateUser.mockResolvedValue({ error: null });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        window.localStorage.clear();
        document.cookie = "genba_quest_dev_auth_session=; Path=/; Max-Age=0";
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

    it("shows profile onboarding for users without onboarding_completed_at and continues after completion", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });
        fetchMyProfile
            .mockResolvedValueOnce({
                profile: {
                    id: "user-1",
                    username: null,
                    nickname: "ユト",
                    full_name: "山田 太郎",
                    avatar_url: null,
                    onboarding_completed_at: null,
                    phone: null,
                    job_type: "内装",
                    employment_kind: "employee",
                    trade_name: null,
                    invoice_registration_number: null,
                    bank_name: null,
                    branch_name: null,
                    account_type: null,
                    account_number: null,
                    account_holder_kana: null,
                    postal_code: null,
                    prefecture: null,
                    city: null,
                    address_line1: null,
                    address_line2: null,
                    emergency_contact_name: null,
                    emergency_phone: null,
                },
            })
            .mockResolvedValueOnce({
                profile: {
                    id: "user-1",
                    username: null,
                    nickname: "ユト",
                    full_name: "山田 太郎",
                    avatar_url: null,
                    onboarding_completed_at: "2026-05-12T00:00:00.000Z",
                    phone: null,
                    job_type: "内装",
                    employment_kind: "employee",
                    trade_name: null,
                    invoice_registration_number: null,
                    bank_name: null,
                    branch_name: null,
                    account_type: null,
                    account_number: null,
                    account_holder_kana: null,
                    postal_code: null,
                    prefecture: null,
                    city: null,
                    address_line1: null,
                    address_line2: null,
                    emergency_contact_name: null,
                    emergency_phone: null,
                },
            });

        render(<App />);

        expect(await screen.findByText("profile-onboarding")).toBeInTheDocument();
        expect(screen.queryByText("today-page")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "complete-profile" }));

        expect(await screen.findByText("today-page")).toBeInTheDocument();
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

        expect(await screen.findByText("チームに参加しましょう")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "組織を作成" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "招待で参加する" })).toBeInTheDocument();
    });

    it("hides bootstrap form on onboarding even when bootstrap is allowed", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_onboarding",
            viewer_email: "worker@example.com",
            bootstrap_allowed: true,
            memberships: [],
            pending_invites: [],
        });

        render(<App />);

        expect(await screen.findByText("チームに参加しましょう")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "組織を作成" })).not.toBeInTheDocument();
        expect(screen.queryByText("新しい組織を作成")).not.toBeInTheDocument();
    });

    it("hides bootstrap form when invite action state also allows bootstrap", async () => {
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
        expect(screen.queryByRole("button", { name: "組織を作成" })).not.toBeInTheDocument();
        expect(screen.queryByText("別の組織を作成")).not.toBeInTheDocument();
        expect(screen.queryByText("新しい組織を作成")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "参加する" })).toBeInTheDocument();
        expect(screen.getByText("このメールで招待を確認できました。参加できない場合は、管理者に参加設定の確認を依頼してください。")).toBeInTheDocument();
    });

    it("accepts a pending invite and enters the app", async () => {
        getSession.mockResolvedValue({
            data: {
                session: {
                    user: {
                        id: "user-1",
                        email: "worker@example.com",
                    },
                },
            },
        });
        fetchAppEntryState.mockResolvedValue({
            state: "needs_invite_action",
            viewer_email: "worker@example.com",
            bootstrap_allowed: false,
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

        fireEvent.click(await screen.findByRole("button", { name: "参加する" }));

        await waitFor(() => {
            expect(acceptOrgInvite).toHaveBeenCalledWith("invite-1");
        });
        expect(await screen.findByText("today-page")).toBeInTheDocument();
    });

    it("does not render a FAB on today", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        expect(await screen.findByText("today-page")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "連絡を記録" })).not.toBeInTheDocument();
    });

    it("redirects legacy PATH reward links into the Money reward modal route", async () => {
        window.history.pushState({}, "", "/path?reward=1&member=member-1&period=2026-05&site=site-1");
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        expect(await screen.findByText("money-page")).toBeInTheDocument();
        await waitFor(() => {
            expect(window.location.pathname).toBe("/money");
            expect(window.location.search).toBe("?modal=reward&member=member-1&period=2026-05&site=site-1");
        });
        expect(screen.queryByRole("link", { name: /PATH/ })).not.toBeInTheDocument();
    });

    it("collapses the shared header on downward scroll and restores it on upward scroll", async () => {
        let scrollY = 0;
        const scrollYSpy = vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        const header = await screen.findByRole("banner");
        expect(header).not.toHaveClass(styles.headerCollapsed);

        scrollY = 180;
        fireEvent.scroll(window);

        await waitFor(() => {
            expect(header).toHaveClass(styles.headerCollapsed);
        });

        scrollY = 120;
        fireEvent.scroll(window);

        await waitFor(() => {
            expect(header).toHaveClass(styles.headerCollapsed);
        });

        scrollY = 70;
        fireEvent.scroll(window);

        await waitFor(() => {
            expect(header).not.toHaveClass(styles.headerCollapsed);
        });

        scrollYSpy.mockRestore();
    });

    it("opens the completed site level draft task from the bell", async () => {
        fetchNotifications.mockResolvedValue([
            {
                id: "notification-1",
                user_id: "user-1",
                type: "system_alert",
                title: "現場完了: A棟クロス",
                message: "現場内容を見ながら入力してください",
                read: false,
                created_at: "2026-05-08T00:00:00.000Z",
                data: {
                    task_type: "site_level_draft",
                    site_id: "site-1",
                    site_name: "A棟クロス",
                    member_id: "user-1",
                },
            },
        ]);
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        const bell = await screen.findByRole("button", { name: "未処理が1件あります" });
        fireEvent.click(bell);

        const inboxItem = await screen.findByRole("button", { name: /A棟クロス/ });
        fireEvent.click(inboxItem);

        // V3.3: bell → inbox → LevelDraftSheet (no navigation to /sites)
        const sheet = await screen.findByTestId("level-draft-sheet");
        expect(sheet).toHaveTextContent("A棟クロス");
        expect(screen.getByTestId("level-draft-pending-count")).toHaveTextContent("1");
        expect(fetchNotifications).toHaveBeenCalledWith({ unread_only: true, limit: 50 });
    });

    it("opens forced responsibility lock draft as non-dismissible when targets exist", async () => {
        fetchResponsibilityLockTargets.mockResolvedValue([
            {
                site_id: "site-lock-1",
                site_name: "期限直前現場",
                completed_at: "2026-05-03T00:00:00.000Z",
                deadline_at: "2026-05-10T00:00:00.000Z",
            },
        ]);
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        const sheet = await screen.findByTestId("level-draft-sheet");
        expect(sheet).toHaveTextContent("期限直前現場");
        expect(screen.getByTestId("level-draft-dismissible")).toHaveTextContent("false");
    });

    it("skips deadline-passed forced target and advances to next with notice", async () => {
        fetchResponsibilityLockTargets.mockResolvedValue([
            {
                site_id: "site-lock-1",
                site_name: "期限超過現場",
                completed_at: "2026-05-03T00:00:00.000Z",
                deadline_at: "2026-05-10T00:00:00.000Z",
            },
            {
                site_id: "site-lock-2",
                site_name: "次の現場",
                completed_at: "2026-05-03T01:00:00.000Z",
                deadline_at: "2026-05-10T01:00:00.000Z",
            },
        ]);
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        expect(await screen.findByTestId("level-draft-sheet")).toHaveTextContent("期限超過現場");
        fireEvent.click(screen.getByRole("button", { name: "mock-deadline-error" }));

        await waitFor(() => {
            expect(screen.getByTestId("level-draft-sheet")).toHaveTextContent("次の現場");
        });
        expect(screen.getByTestId("level-draft-notice")).toHaveTextContent(
            "期限を過ぎた現場はスキップしました。必要なら PATH 画面から修正申請してください。",
        );
    });

    it("marks submitted notification as read and auto-advances to the next site draft", async () => {
        fetchNotifications
            .mockResolvedValueOnce([
                {
                    id: "notification-1",
                    user_id: "user-1",
                    type: "system_alert",
                    title: "現場完了: A棟クロス",
                    message: "現場内容を見ながら入力してください",
                    read: false,
                    created_at: "2026-05-08T00:00:00.000Z",
                    data: {
                        task_type: "site_level_draft",
                        site_id: "site-1",
                        site_name: "A棟クロス",
                        member_id: "user-1",
                    },
                },
                {
                    id: "notification-2",
                    user_id: "user-1",
                    type: "system_alert",
                    title: "現場完了: B棟塗装",
                    message: "現場内容を見ながら入力してください",
                    read: false,
                    created_at: "2026-05-08T01:00:00.000Z",
                    data: {
                        task_type: "site_level_draft",
                        site_id: "site-2",
                        site_name: "B棟塗装",
                        member_id: "user-1",
                    },
                },
            ])
            .mockResolvedValueOnce([
                {
                    id: "notification-2",
                    user_id: "user-1",
                    type: "system_alert",
                    title: "現場完了: B棟塗装",
                    message: "現場内容を見ながら入力してください",
                    read: false,
                    created_at: "2026-05-08T01:00:00.000Z",
                    data: {
                        task_type: "site_level_draft",
                        site_id: "site-2",
                        site_name: "B棟塗装",
                        member_id: "user-1",
                    },
                },
            ]);
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        const bell = await screen.findByRole("button", { name: "未処理が2件あります" });
        fireEvent.click(bell);
        const draftItems = await screen.findAllByRole("button", { name: /A棟クロス/ });
        fireEvent.click(draftItems[0]);
        expect(await screen.findByTestId("level-draft-sheet")).toHaveTextContent("A棟クロス");

        fireEvent.click(screen.getByRole("button", { name: "mock-submit-level-draft" }));

        await waitFor(() => {
            expect(markNotificationRead).toHaveBeenCalledWith("notification-1");
        });
        await waitFor(() => {
            expect(screen.getByTestId("level-draft-sheet")).toHaveTextContent("B棟塗装");
        });
    });

    it("closes the sheet after submit when only same-site notifications remain", async () => {
        fetchNotifications
            .mockResolvedValueOnce([
                {
                    id: "notification-1",
                    user_id: "user-1",
                    type: "system_alert",
                    title: "現場完了: A棟クロス",
                    message: "現場内容を見ながら入力してください",
                    read: false,
                    created_at: "2026-05-08T00:00:00.000Z",
                    data: {
                        task_type: "site_level_draft",
                        site_id: "site-1",
                        site_name: "A棟クロス",
                        member_id: "user-1",
                    },
                },
                {
                    id: "notification-1b",
                    user_id: "user-1",
                    type: "system_alert",
                    title: "現場完了: A棟クロス(再通知)",
                    message: "現場内容を見ながら入力してください",
                    read: false,
                    created_at: "2026-05-08T01:00:00.000Z",
                    data: {
                        task_type: "site_level_draft",
                        site_id: "site-1",
                        site_name: "A棟クロス",
                        member_id: "user-1",
                    },
                },
            ])
            .mockResolvedValueOnce([
                {
                    id: "notification-1b",
                    user_id: "user-1",
                    type: "system_alert",
                    title: "現場完了: A棟クロス(再通知)",
                    message: "現場内容を見ながら入力してください",
                    read: false,
                    created_at: "2026-05-08T01:00:00.000Z",
                    data: {
                        task_type: "site_level_draft",
                        site_id: "site-1",
                        site_name: "A棟クロス",
                        member_id: "user-1",
                    },
                },
            ]);
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        const bell = await screen.findByRole("button", { name: "未処理が2件あります" });
        fireEvent.click(bell);
        const draftItems = await screen.findAllByRole("button", { name: /A棟クロス/ });
        fireEvent.click(draftItems[0]);
        expect(await screen.findByTestId("level-draft-sheet")).toHaveTextContent("A棟クロス");

        fireEvent.click(screen.getByRole("button", { name: "mock-submit-level-draft" }));

        await waitFor(() => {
            expect(markNotificationRead).toHaveBeenCalledWith("notification-1");
        });
        await waitFor(() => {
            expect(screen.queryByTestId("level-draft-sheet")).not.toBeInTheDocument();
        });
    });

    it("does not expose org bootstrap from onboarding state", async () => {
        fetchAppEntryState.mockResolvedValue({
            state: "needs_onboarding",
            viewer_email: "worker@example.com",
            bootstrap_allowed: true,
            memberships: [],
            pending_invites: [],
        });

        render(<App />);

        expect(await screen.findByText("チームに参加しましょう")).toBeInTheDocument();
        expect(screen.queryByPlaceholderText("例: GENBA 本部")).not.toBeInTheDocument();
        expect(screen.queryByPlaceholderText("例: genba-hq")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "組織を作成" })).not.toBeInTheDocument();
        expect(bootstrapOrg).not.toHaveBeenCalled();
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

    it("signs returning users in with email and password", async () => {
        getSession.mockResolvedValue({ data: { session: null } });

        render(<App />);

        fireEvent.change(await screen.findByLabelText("メールアドレス"), {
            target: { value: "Worker@Example.com" },
        });
        fireEvent.change(screen.getByLabelText("パスワード"), {
            target: { value: "password-1234" },
        });
        fireEvent.click(screen.getByRole("button", { name: "ログイン" }));

        await waitFor(() => {
            expect(signInWithPassword).toHaveBeenCalledWith({
                email: "worker@example.com",
                password: "password-1234",
            });
        });
    });

    it("starts Google login with the current origin as the redirect target", async () => {
        getSession.mockResolvedValue({ data: { session: null } });

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "Googleで続ける" }));

        await waitFor(() => {
            expect(signInWithOAuth).toHaveBeenCalledWith({
                provider: "google",
                options: {
                    redirectTo: window.location.origin,
                },
            });
        });
    });

    it("shows an error and releases the Google login button when OAuth fails", async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        signInWithOAuth.mockResolvedValue({
            error: new Error("provider not configured"),
        });

        render(<App />);

        const googleButton = await screen.findByRole("button", { name: "Googleで続ける" });
        fireEvent.click(googleButton);

        expect(await screen.findByText("Googleログインできませんでした。")).toBeInTheDocument();
        await waitFor(() => {
            expect(googleButton).toBeEnabled();
        });
    });

    it("sets a password on the explicit first-registration flow", async () => {
        getSession.mockResolvedValue({ data: { session: null } });

        render(<App />);

        fireEvent.change(await screen.findByLabelText("メールアドレス"), {
            target: { value: "new-worker@example.com" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "はじめての方はこちら（パスワードを決めてアカウントを作る）" }),
        );
        fireEvent.change(await screen.findByLabelText("パスワードを決める"), {
            target: { value: "password-1234" },
        });
        fireEvent.change(screen.getByLabelText("パスワードをもう一度"), {
            target: { value: "password-1234" },
        });
        fireEvent.click(screen.getByRole("button", { name: "アカウントを作る" }));

        await waitFor(() => {
            expect(signUp).toHaveBeenCalledWith({
                email: "new-worker@example.com",
                password: "password-1234",
                options: {
                    emailRedirectTo: window.location.origin,
                },
            });
        });
    });

    it("localizes invalid email errors on first registration", async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        signUp.mockResolvedValue({
            data: { session: null },
            error: new Error('Email address "worker@example.com" is invalid'),
        });

        render(<App />);

        fireEvent.change(await screen.findByLabelText("メールアドレス"), {
            target: { value: "worker@example.com" },
        });
        fireEvent.click(
            screen.getByRole("button", { name: "はじめての方はこちら（パスワードを決めてアカウントを作る）" }),
        );
        fireEvent.change(await screen.findByLabelText("パスワードを決める"), {
            target: { value: "password-1234" },
        });
        fireEvent.change(screen.getByLabelText("パスワードをもう一度"), {
            target: { value: "password-1234" },
        });
        fireEvent.click(screen.getByRole("button", { name: "アカウントを作る" }));

        expect(await screen.findByText("メールアドレスの形式を確認してください。")).toBeInTheDocument();
    });

    it("shows a local rate-limit message instead of the raw Supabase error", async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        signInWithOtp.mockResolvedValue({
            error: new Error("email rate limit exceeded"),
        });

        render(<App />);

        fireEvent.change(await screen.findByLabelText("メールアドレス"), {
            target: { value: "worker@example.com" },
        });
        // Magic-link entry is now nested in a <details> disclosure; open it first.
        fireEvent.click(
            screen.getByText("パスワードを使わずに入る（メールでログインリンク）"),
        );
        fireEvent.click(await screen.findByRole("button", { name: "ログインリンクをメールで送る" }));

        expect(await screen.findByText("メール送信の上限に達しました。しばらく待ってから再度お試しください。")).toBeInTheDocument();
    });

    it("sends a password reset email for returning users", async () => {
        getSession.mockResolvedValue({ data: { session: null } });

        render(<App />);

        fireEvent.change(await screen.findByLabelText("メールアドレス"), {
            target: { value: "Worker@Example.com" },
        });
        fireEvent.click(screen.getByRole("button", { name: "パスワードを忘れた" }));

        await waitFor(() => {
            expect(resetPasswordForEmail).toHaveBeenCalledWith(
                "worker@example.com",
                {
                    redirectTo: `${window.location.origin}/?auth=recovery`,
                },
            );
        });
        expect(await screen.findByText("worker@example.com に確認リンクを送りました。メールから開くと続きに進めます。")).toBeInTheDocument();
    });

    it("keeps the password reset action tappable before an email is entered", async () => {
        getSession.mockResolvedValue({ data: { session: null } });

        render(<App />);

        const resetButton = await screen.findByRole("button", { name: "パスワードを忘れた" });
        expect(resetButton).toBeEnabled();

        fireEvent.click(resetButton);

        expect(await screen.findByText("メールアドレスを入力してください。")).toBeInTheDocument();
        expect(resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("does not accept an invite when the authenticated session has no email", async () => {
        getSession.mockResolvedValue({
            data: {
                session: {
                    user: {
                        id: "user-1",
                        email: null,
                    },
                },
            },
        });
        fetchAppEntryState.mockResolvedValue({
            state: "needs_invite_action",
            viewer_email: null,
            bootstrap_allowed: false,
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

        fireEvent.click(await screen.findByRole("button", { name: "参加する" }));

        expect(await screen.findByText("ログイン中のメールアドレスを確認できません。別の方法でログインしてください。")).toBeInTheDocument();
        expect(acceptOrgInvite).not.toHaveBeenCalled();
    });

    it("does not accept an invite when there is no pending invite", async () => {
        getSession.mockResolvedValue({
            data: {
                session: {
                    user: {
                        id: "user-1",
                        email: "worker@example.com",
                    },
                },
            },
        });
        fetchAppEntryState.mockResolvedValue({
            state: "needs_onboarding",
            viewer_email: "worker@example.com",
            bootstrap_allowed: false,
            memberships: [],
            pending_invites: [],
        });

        render(<App />);

        expect(await screen.findByText("チームに参加しましょう")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "参加する" })).not.toBeInTheDocument();
        expect(acceptOrgInvite).not.toHaveBeenCalled();
    });

    it("stops on the password recovery screen until a new password is saved", async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        await screen.findByText("ログインして始める");
        await act(async () => {
            authStateCallback?.("PASSWORD_RECOVERY", {
                user: {
                    id: "user-1",
                    email: "worker@example.com",
                },
            });
        });

        expect(await screen.findByText("新しいパスワードを設定")).toBeInTheDocument();
        expect(screen.queryByText("today-page")).not.toBeInTheDocument();

        fireEvent.change(screen.getByLabelText("新しいパスワード"), {
            target: { value: "new-password-1234" },
        });
        fireEvent.change(screen.getByLabelText("新しいパスワード（確認）"), {
            target: { value: "new-password-1234" },
        });
        fireEvent.click(screen.getByRole("button", { name: "パスワードを更新" }));

        await waitFor(() => {
            expect(updateUser).toHaveBeenCalledWith({ password: "new-password-1234" });
        });
        expect(await screen.findByText("today-page")).toBeInTheDocument();
    });

    it("allows local development to enter through dev auth without sending email", async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });

        render(<App />);

        fireEvent.click(await screen.findByRole("button", { name: "開発用ユーザーで入る" }));

        expect(await screen.findByText("today-page")).toBeInTheDocument();
        expect(signInWithOtp).not.toHaveBeenCalled();
        expect(signInWithPassword).not.toHaveBeenCalled();
        expect(signUp).not.toHaveBeenCalled();
        expect(resetPasswordForEmail).not.toHaveBeenCalled();
        expect(updateUser).not.toHaveBeenCalled();
    });

    it("hides development auth when the browser is configured for hosted Supabase", async () => {
        vi.stubEnv("VITE_SUPABASE_URL", "https://example-ref.supabase.co");
        getSession.mockResolvedValue({ data: { session: null } });

        render(<App />);

        expect(await screen.findByText("ログインして始める")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "開発用ユーザーで入る" })).not.toBeInTheDocument();
    });

    it("restores local development auth from the dev auth cookie", async () => {
        getSession.mockResolvedValue({ data: { session: null } });
        fetchAppEntryState.mockResolvedValue({
            state: "ready",
            active_org: { org_id: "org-1", org_name: "GENBA 本部", role: "admin" },
            memberships: [{ org_id: "org-1", org_name: "GENBA 本部", role: "admin" }],
        });
        document.cookie = "genba_quest_dev_auth_session=true; Path=/";

        render(<App />);

        expect(await screen.findByText("today-page")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "開発用ユーザーで入る" })).not.toBeInTheDocument();
        expect(signInWithOtp).not.toHaveBeenCalled();
        expect(signInWithPassword).not.toHaveBeenCalled();
    });
});
