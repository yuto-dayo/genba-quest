import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalRecord } from "../lib/api";
import { Today } from "./Today";

const fetchFocusItems = vi.fn();
const fetchSites = vi.fn();
const fetchMembers = vi.fn();
const fetchSiteDocuments = vi.fn();
const fetchSiteLineItems = vi.fn();
const fetchPendingProposals = vi.fn();
const fetchPathV31DayLogs = vi.fn();
const fetchPathV31SiteMemberRolePlans = vi.fn();
const fetchPathV31SiteMemberRewardInputs = vi.fn();
const savePathV31DayLog = vi.fn();
const savePathV31SiteMemberRolePlan = vi.fn();
const savePathV31SiteMemberRewardInput = vi.fn();
const approveProposal = vi.fn();
const executeProposal = vi.fn();
const instructProposal = vi.fn();
const rejectProposal = vi.fn();

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
    fetchMembers: (...args: unknown[]) => fetchMembers(...args),
    fetchSiteDocuments: (...args: unknown[]) => fetchSiteDocuments(...args),
    fetchSiteLineItems: (...args: unknown[]) => fetchSiteLineItems(...args),
    fetchPendingProposals: (...args: unknown[]) => fetchPendingProposals(...args),
    fetchPathV31DayLogs: (...args: unknown[]) => fetchPathV31DayLogs(...args),
    fetchPathV31SiteMemberRolePlans: (...args: unknown[]) => fetchPathV31SiteMemberRolePlans(...args),
    fetchPathV31SiteMemberRewardInputs: (...args: unknown[]) => fetchPathV31SiteMemberRewardInputs(...args),
    savePathV31DayLog: (...args: unknown[]) => savePathV31DayLog(...args),
    savePathV31SiteMemberRolePlan: (...args: unknown[]) => savePathV31SiteMemberRolePlan(...args),
    savePathV31SiteMemberRewardInput: (...args: unknown[]) => savePathV31SiteMemberRewardInput(...args),
    approveProposal: (...args: unknown[]) => approveProposal(...args),
    completeFocusItem: vi.fn(),
    createFocusItem: vi.fn(),
    executeProposal: (...args: unknown[]) => executeProposal(...args),
    instructProposal: (...args: unknown[]) => instructProposal(...args),
    rejectProposal: (...args: unknown[]) => rejectProposal(...args),
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
                date: "2026-04-23",
                day: 23,
                assignments: [
                    {
                        id: "assignment-1",
                        user_id: "user-1",
                        site_id: "site-1",
                        site_name: "渋谷マンション",
                        date: "2026-04-23",
                        status: "scheduled",
                        source: "proposal",
                    },
                ],
                personal_schedules: [],
                isToday: true,
                isCurrentMonth: true,
                isWeekend: false,
            },
        ],
    }),
}));

vi.mock("../components/ProposalDetailModal", () => ({
    ProposalDetailModal: ({
        isActing,
        onApprove,
        onExecute,
        proposal,
    }: {
        isActing?: boolean;
        onApprove: (proposalId: string, reason?: string) => void;
        onExecute: (proposalId: string) => void;
        proposal: ProposalRecord;
    }) => (
        <div data-testid="proposal-detail-modal">
            <p>{proposal.description}</p>
            <button
                type="button"
                disabled={isActing}
                onClick={() => {
                    if (proposal.status === "approved") {
                        onExecute(proposal.id);
                    } else {
                        onApprove(proposal.id, "確認しました");
                    }
                }}
            >
                {proposal.status === "approved" ? "実行する" : "承認する"}
            </button>
        </div>
    ),
}));

vi.mock("../components/SiteDetailModal", () => ({
    SiteDetailModal: () => null,
}));

vi.mock("../components/SiteFormModal", () => ({
    SiteFormModal: ({
        initialAction,
        onSuccess,
        site,
    }: {
        initialAction?: string;
        onSuccess: () => void;
        site: { name: string };
    }) => (
        <div data-testid="site-form-modal">
            <p>{site.name}</p>
            <p>{initialAction}</p>
            <button type="button" onClick={onSuccess}>
                保存
            </button>
        </div>
    ),
}));

vi.mock("../components/today/MonthlySummary", () => ({
    MonthlySummary: ({ sites }: { sites: Array<{ id: string; name: string }> }) => (
        <div data-testid="monthly-summary">{sites.map((site) => site.name).join(",")}</div>
    ),
}));

vi.mock("../components/today/PendingBadge", () => ({
    PendingBadge: ({ count, onClick }: { count: number; onClick: () => void }) => (
        <button type="button" onClick={onClick}>
            pending:{count}
        </button>
    ),
}));

const pendingProposal: ProposalRecord = {
    id: "proposal-1",
    org_id: "org-1",
    type: "communication.task",
    status: "pending",
    created_by: { type: "ai", id: "sherpa", name: "Sherpa" },
    payload: { source_message_subject: "追加見積" },
    description: "追加見積の返答を準備する",
    approvals: [],
    required_approvals: 1,
    created_at: "2026-05-05T00:00:00.000Z",
    updated_at: "2026-05-05T00:00:00.000Z",
};

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
        fetchMembers.mockResolvedValue([
            {
                id: "user-1",
                full_name: "山田 太郎",
                username: "yamada",
                avatar_url: null,
            },
        ]);
        fetchSiteDocuments.mockResolvedValue([
            {
                id: "doc-1",
                doc_type: "other",
                original_filename: "工程写真.pdf",
                mime_type: "application/pdf",
                drive_file_url: "https://example.com/doc",
                created_at: "2026-04-22T09:30:00.000Z",
            },
        ]);
        fetchSiteLineItems.mockResolvedValue([]);
        fetchPendingProposals.mockResolvedValue([]);
        fetchPathV31DayLogs.mockResolvedValue({ logs: [] });
        fetchPathV31SiteMemberRolePlans.mockResolvedValue({ plans: [] });
        fetchPathV31SiteMemberRewardInputs.mockResolvedValue({ inputs: [] });
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
        savePathV31SiteMemberRolePlan.mockResolvedValue({
            plan: {
                id: "role-plan-1",
                org_id: "org-1",
                site_id: "site-1",
                member_id: "user-1",
                role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
                note: "",
                created_at: "2026-04-22T09:00:00.000Z",
                updated_at: "2026-04-22T09:00:00.000Z",
            },
        });
        savePathV31SiteMemberRewardInput.mockResolvedValue({
            input: {
                id: "reward-input-1",
                org_id: "org-1",
                site_id: "site-1",
                member_id: "user-1",
                participation_units: 1,
                responsibility_level: "member",
                role_shares: { planning: 1, quality: 0, admin: 0, client: 0 },
                note: "",
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

        const memoButton = await screen.findByRole("button", { name: "メモ" });
        fireEvent.click(memoButton);
        await waitFor(() => {
            expect(document.body.textContent).toContain("メモ・添付");
        });
        expect(screen.queryByRole("button", { name: "確認" })).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "追加" }));

        await waitFor(() => {
            expect(document.querySelector('textarea[placeholder="進み具合、注意点、引き継ぎを一言"]')).not.toBeNull();
        });
        expect(screen.getByRole("heading", { name: "渋谷マンション" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "一覧" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "追加" })).toBeInTheDocument();
        expect(screen.queryByText("メモする現場")).not.toBeInTheDocument();
        expect(screen.queryByText("テスト住所")).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "メモ追加" })).not.toBeInTheDocument();
        expect(screen.queryByText("メモ一覧")).not.toBeInTheDocument();
        expect(screen.queryByText("添付書類")).not.toBeInTheDocument();
        expect(screen.queryByText("工程写真.pdf")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "画像・書類を添付" })).toBeInTheDocument();
        expect(screen.queryByText("キャンセル")).not.toBeInTheDocument();

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

        expect(await screen.findByRole("button", { name: "メモ" })).toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "メモ追加" })).not.toBeInTheDocument();
    });

    it("opens memo review and switches to the add form from the sheet", async () => {
        render(
            <MemoryRouter initialEntries={["/today"]}>
                <Routes>
                    <Route path="/today" element={<Today />} />
                </Routes>
            </MemoryRouter>,
        );

        const reviewButton = await screen.findByRole("button", { name: "メモ" });
        fireEvent.click(reviewButton);

        await waitFor(() => {
            expect(screen.getByRole("heading", { name: "渋谷マンション" })).toBeInTheDocument();
        });
        expect(screen.getByRole("button", { name: "一覧" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "追加" })).toBeInTheDocument();
        expect(screen.queryByText("確認する現場")).not.toBeInTheDocument();
        expect(screen.queryByText("テスト住所")).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "メモ確認" })).not.toBeInTheDocument();
        expect(screen.getByText("メモ・添付")).toBeInTheDocument();
        expect(screen.queryByText("閉じる")).not.toBeInTheDocument();
        expect(screen.queryByText("メモ一覧")).not.toBeInTheDocument();
        expect(screen.queryByText("添付書類")).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "添付を追加・管理" })).not.toBeInTheDocument();
        await waitFor(() => {
            expect(document.body.textContent).toContain("工程写真.pdf");
        });
        expect(screen.queryByLabelText("メモ")).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "追加" }));
        await waitFor(() => {
            expect(document.querySelector('textarea[placeholder="進み具合、注意点、引き継ぎを一言"]')).not.toBeNull();
        });
        fireEvent.click(screen.getByRole("button", { name: "一覧" }));
        await waitFor(() => {
            expect(screen.queryByLabelText("メモ")).not.toBeInTheDocument();
        });
    });

    it("saves role plans and then opens responsibility input with planned role shares", async () => {
        render(
            <MemoryRouter initialEntries={["/today"]}>
                <Routes>
                    <Route path="/today" element={<Today />} />
                </Routes>
            </MemoryRouter>,
        );

        const roleButton = await screen.findByRole("button", { name: "役割" });
        fireEvent.click(roleButton);
        fireEvent.change(screen.getByLabelText("段取り"), { target: { value: "1" } });
        fireEvent.click(screen.getByRole("button", { name: "保存" }));

        await waitFor(() => {
            expect(savePathV31SiteMemberRolePlan).toHaveBeenCalledWith(
                expect.objectContaining({
                    site_id: "site-1",
                    member_id: "user-1",
                    role_shares: expect.objectContaining({ planning: 1 }),
                }),
            );
        });

        const responsibilityButton = await screen.findByRole("button", { name: "責任" });
        fireEvent.click(responsibilityButton);
        fireEvent.click(screen.getByRole("button", { name: "保存" }));

        await waitFor(() => {
            expect(savePathV31SiteMemberRewardInput).toHaveBeenCalledWith(
                expect.objectContaining({
                    site_id: "site-1",
                    member_id: "user-1",
                    participation_units: 1,
                    role_shares: expect.objectContaining({ planning: 1 }),
                }),
            );
        });
    });

    it("opens the pending proposal sheet from the proposal query param", async () => {
        fetchPendingProposals.mockResolvedValueOnce([pendingProposal]);

        render(
            <MemoryRouter initialEntries={["/today?proposal=proposal-1"]}>
                <Routes>
                    <Route path="/today" element={<Today />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole("heading", { name: "承認待ち Proposal" })).toBeInTheDocument();
        expect(screen.getAllByText("追加見積の返答を準備する").length).toBeGreaterThan(0);
    });

    it("shows execution-complete copy when approval auto-executes from Today", async () => {
        fetchPendingProposals
            .mockResolvedValueOnce([pendingProposal])
            .mockResolvedValueOnce([]);
        approveProposal.mockResolvedValueOnce({
            proposal: { ...pendingProposal, status: "executed" },
            is_fully_approved: true,
            auto_executed: true,
        });

        render(
            <MemoryRouter initialEntries={["/today?proposal=proposal-1"]}>
                <Routes>
                    <Route path="/today" element={<Today />} />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole("button", { name: "承認する" }));

        await waitFor(() => expect(approveProposal).toHaveBeenCalledWith("proposal-1", "確認しました"));
        expect(await screen.findByText("承認し、実行まで完了しました。")).toBeInTheDocument();
    });
});
