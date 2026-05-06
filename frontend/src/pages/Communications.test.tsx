import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Communications } from "./Communications";

const fetchCommunicationContacts = vi.fn();
const fetchCommunicationContactDetail = vi.fn();
const fetchCommunicationInsightsSummary = vi.fn();
const fetchMembers = vi.fn();
const fetchSites = vi.fn();
const addCommunicationLog = vi.fn();
const createCommunicationConversation = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", () => ({
    fetchCommunicationContacts: (...args: unknown[]) => fetchCommunicationContacts(...args),
    fetchCommunicationContactDetail: (...args: unknown[]) => fetchCommunicationContactDetail(...args),
    fetchCommunicationInsightsSummary: (...args: unknown[]) => fetchCommunicationInsightsSummary(...args),
    fetchMembers: (...args: unknown[]) => fetchMembers(...args),
    fetchSites: (...args: unknown[]) => fetchSites(...args),
    addCommunicationLog: (...args: unknown[]) => addCommunicationLog(...args),
    approveProposal: vi.fn(),
    createCommunicationConversation: (...args: unknown[]) => createCommunicationConversation(...args),
    executeProposal: vi.fn(),
    instructProposal: vi.fn(),
    rejectProposal: vi.fn(),
    updateCommunicationConversation: vi.fn(),
}));

vi.mock("../components/ProposalDetailModal", () => ({
    ProposalDetailModal: () => null,
}));

vi.mock("../components/FloatingActionButton", () => ({
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

describe("Communications page", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchMembers.mockResolvedValue([{ id: "member-1", full_name: "山田太郎", username: "yamada" }]);
        fetchSites.mockResolvedValue([{ id: "site-1", name: "渋谷ビル改修" }]);
        addCommunicationLog.mockResolvedValue({});
        createCommunicationConversation.mockResolvedValue({
            conversation: {
                id: "conv-new",
                client_name: "田中工務店",
            },
        });
        fetchCommunicationContacts.mockResolvedValue({
            items: [
                {
                    contact_key: "tanaka@example.com",
                    client_name: "田中工務店",
                    contact_name: "田中さん",
                    contact_email: "tanaka@example.com",
                    owner: { id: "member-1", name: "山田太郎", username: "yamada", avatar_url: null },
                    status: "overdue",
                    risk_flags: ["overdue_next_action", "pending_proposal_stale"],
                    waiting_on: "internal",
                    attention_score: 180,
                    status_reason: "価格表を返す",
                    status_reason_source: "next_action",
                    evidence_excerpt: "価格表を返す",
                    latest_activity_at: "2026-04-21T09:00:00.000Z",
                    last_external_activity_at: "2026-04-20T09:00:00.000Z",
                    days_since_latest_activity: 1,
                    last_inbound_at: "2026-04-20T08:00:00.000Z",
                    last_outbound_at: "2026-04-19T08:00:00.000Z",
                    days_since_client_response: 1,
                    next_action: "価格表を返す",
                    next_action_due_date: "2026-04-15",
                    has_next_action: true,
                    relevant_conversation_id: "conv-1",
                    site: { id: "site-1", name: "渋谷ビル改修" },
                    conversation_count: 2,
                    open_conversation_count: 2,
                    in_flight_proposal_count: 2,
                },
            ],
            total_count: 1,
        });
        fetchCommunicationContactDetail.mockResolvedValue({
            summary: {
                contact_key: "tanaka@example.com",
                client_name: "田中工務店",
                contact_name: "田中さん",
                contact_email: "tanaka@example.com",
                owner: { id: "member-1", name: "山田太郎", username: "yamada", avatar_url: null },
                status: "overdue",
                risk_flags: ["overdue_next_action"],
                waiting_on: "internal",
                attention_score: 100,
                status_reason: "価格表を返す",
                status_reason_source: "next_action",
                evidence_excerpt: "価格表を返す",
                latest_activity_at: "2026-04-21T09:00:00.000Z",
                last_external_activity_at: "2026-04-20T09:00:00.000Z",
                days_since_latest_activity: 1,
                last_inbound_at: "2026-04-20T08:00:00.000Z",
                last_outbound_at: "2026-04-19T08:00:00.000Z",
                days_since_client_response: 1,
                next_action: "価格表を返す",
                next_action_due_date: "2026-04-15",
                has_next_action: true,
                relevant_conversation_id: "conv-1",
                site: { id: "site-1", name: "渋谷ビル改修" },
                conversation_count: 2,
                open_conversation_count: 2,
                in_flight_proposal_count: 2,
            },
            why_now: [{ code: "overdue", title: "期限超過", description: "2026-04-15 期限の動きが止まっています。" }],
            related_proposals: [],
            conversations: [
                {
                    id: "conv-1",
                    title: "見積の確認",
                    status: "active",
                    source_channel: "gmail",
                    last_channel: "gmail",
                    client_name: "田中工務店",
                    client_email: "tanaka@example.com",
                    participant_summary: "田中さん",
                    ai_summary: "見積条件の確認中",
                    ai_priority: "high",
                    next_action: "価格表を返す",
                    next_action_due_date: "2026-04-15",
                    last_activity_at: "2026-04-21T09:00:00.000Z",
                    last_message_preview: "価格表の送付依頼",
                    assignee: { id: "member-1", name: "山田太郎", username: "yamada", avatar_url: null },
                    site: { id: "site-1", name: "渋谷ビル改修" },
                    related_proposal_count: 2,
                    created_at: "2026-04-10T09:00:00.000Z",
                    updated_at: "2026-04-21T09:00:00.000Z",
                },
            ],
            recent_logs: [
                {
                    id: "log-in",
                    conversation_id: "conv-1",
                    conversation_title: "見積の確認",
                    channel: "line",
                    direction: "inbound",
                    log_kind: "message",
                    subject: null,
                    body: "価格表を送ってください",
                    summary: null,
                    occurred_at: "2026-04-20T08:00:00.000Z",
                    created_by_type: "human",
                    created_by_name: "山田太郎",
                    external_source: null,
                    external_id: null,
                    metadata: { evidence_type: "external_original", entry_mode: "customer_paste" },
                    created_at: "2026-04-20T08:01:00.000Z",
                },
                {
                    id: "log-out",
                    conversation_id: "conv-1",
                    conversation_title: "見積の確認",
                    channel: "line",
                    direction: "outbound",
                    log_kind: "message",
                    subject: null,
                    body: "本日中に送ります",
                    summary: null,
                    occurred_at: "2026-04-20T09:00:00.000Z",
                    created_by_type: "human",
                    created_by_name: "山田太郎",
                    external_source: null,
                    external_id: null,
                    metadata: { evidence_type: "team_sent_copy", entry_mode: "team_paste" },
                    created_at: "2026-04-20T09:01:00.000Z",
                },
                {
                    id: "log-phone",
                    conversation_id: "conv-1",
                    conversation_title: "見積の確認",
                    channel: "phone",
                    direction: "internal",
                    log_kind: "note",
                    subject: null,
                    body: "電話で納期を確認",
                    summary: null,
                    occurred_at: "2026-04-20T10:00:00.000Z",
                    created_by_type: "human",
                    created_by_name: "山田太郎",
                    external_source: null,
                    external_id: null,
                    metadata: { evidence_type: "oral_note", entry_mode: "phone_note" },
                    created_at: "2026-04-20T10:01:00.000Z",
                },
            ],
            default_conversation_id: "conv-1",
        });
        fetchCommunicationInsightsSummary.mockResolvedValue({
            hygiene: {
                open_contacts: 1,
                owner_coverage_rate: 1,
                next_action_coverage_rate: 1,
                overdue_rate: 1,
                overdue_count: 1,
                no_next_action_count: 0,
                no_owner_count: 0,
            },
            stagnation: { stale_7d_count: 0, by_status: [], by_owner: [] },
            proposal_health: { in_flight_stale_count: 1, follow_up_missing_after_link_count: 1 },
            owner_workload: [],
            reason_clusters: [{ key: "pricing", label: "価格", count: 1 }],
            client_health: [
                {
                    rollup_key: "client-1",
                    client_id: "client-1",
                    client_name: "田中工務店",
                    open_contacts: 1,
                    overdue_count: 1,
                    in_flight_proposal_count: 2,
                    owner_count: 1,
                    sites: ["渋谷ビル改修"],
                },
            ],
        });
    });

    it("renders the board summary and detail sheet from the new read model", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByText("要対応")).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: /田中工務店/ })).toBeInTheDocument();
        expect(await screen.findByRole("heading", { name: "Why now?" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "集約サマリ" })).toBeInTheDocument();
        expect((await screen.findAllByText("価格表を返す")).length).toBeGreaterThan(0);
    });

    it("loads analyze insights when the analyze tab is opened", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click(await screen.findByRole("button", { name: /Analyze/ }));

        await waitFor(() => {
            expect(fetchCommunicationInsightsSummary).toHaveBeenCalled();
        });

        expect(await screen.findByRole("heading", { name: "運用衛生" })).toBeInTheDocument();
        expect(screen.getByRole("heading", { name: "会社単位の俯瞰" })).toBeInTheDocument();
    });

    it("renders a single FAB action for recording communication", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole("button", { name: "連絡を記録" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "ログ追加" })).not.toBeInTheDocument();
    });

    it("renders messenger ledger badges in the communication timeline", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        expect(await screen.findByRole("heading", { name: "証跡タイムライン" })).toBeInTheDocument();
        expect(screen.getByText("コピペ原文")).toBeInTheDocument();
        expect(screen.getByText("送信文")).toBeInTheDocument();
        expect(screen.getByText("聞き取り")).toBeInTheDocument();
        expect(screen.getByText("電話で納期を確認")).toBeInTheDocument();
    });

    it("records customer pasted text with evidence metadata after confirmation", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await screen.findByRole("heading", { name: "証跡タイムライン" });
        fireEvent.click(await screen.findByRole("button", { name: "連絡を記録" }));
        expect(await screen.findByRole("tab", { name: /相手の文章を貼る/ })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /こちらの文章を貼る/ })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /電話メモを書く/ })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: /現場会話を書く/ })).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("LINE・メール・SMSからコピーした相手の文章を貼り付けます。"), {
            target: { value: "価格表を送ってください" },
        });
        fireEvent.click(screen.getByRole("button", { name: "相手文として記録" }));
        expect(await screen.findByText("これは原文コピーとして記録されます。貼り付け元の文章と同じか確認してください。")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "このまま記録" }));

        await waitFor(() => {
            expect(addCommunicationLog).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    channel: "gmail",
                    direction: "inbound",
                    body: "価格表を送ってください",
                    log_kind: "message",
                    metadata: expect.objectContaining({
                        entry_mode: "customer_paste",
                        capture_method: "paste_primary",
                        evidence_type: "external_original",
                        original_locked: true,
                        recorded_ui_version: "messenger_ledger_v1",
                    }),
                }),
            );
        });
    });

    it("records phone notes as typed oral evidence", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await screen.findByRole("heading", { name: "証跡タイムライン" });
        fireEvent.click(await screen.findByRole("button", { name: "連絡を記録" }));
        fireEvent.click(await screen.findByRole("tab", { name: /電話メモを書く/ }));
        fireEvent.change(await screen.findByPlaceholderText("誰が何を話したか、あとで確認できる粒度で書きます。"), {
            target: { value: "電話で納期を確認した" },
        });
        fireEvent.click(screen.getByRole("button", { name: "電話メモを残す" }));

        await waitFor(() => {
            expect(addCommunicationLog).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    channel: "phone",
                    direction: "internal",
                    body: "電話で納期を確認した",
                    log_kind: "note",
                    metadata: expect.objectContaining({
                        entry_mode: "phone_note",
                        capture_method: "typed_allowed",
                        evidence_type: "oral_note",
                    }),
                }),
            );
        });
    });
});
