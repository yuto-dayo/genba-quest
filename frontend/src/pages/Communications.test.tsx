import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Communications } from "./Communications";

const fetchCommunicationContacts = vi.fn();
const fetchCommunicationContactDetail = vi.fn();
const fetchMembers = vi.fn();
const fetchSites = vi.fn();
const fetchClients = vi.fn();
const restoreClient = vi.fn();
const addCommunicationLog = vi.fn();
const createCommunicationConversation = vi.fn();
const clientSettingsModalProps = vi.fn();

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
    fetchClients: (...args: unknown[]) => fetchClients(...args),
    fetchMembers: (...args: unknown[]) => fetchMembers(...args),
    fetchSites: (...args: unknown[]) => fetchSites(...args),
    addCommunicationLog: (...args: unknown[]) => addCommunicationLog(...args),
    approveProposal: vi.fn(),
    createCommunicationConversation: (...args: unknown[]) => createCommunicationConversation(...args),
    executeProposal: vi.fn(),
    instructProposal: vi.fn(),
    rejectProposal: vi.fn(),
    restoreClient: (...args: unknown[]) => restoreClient(...args),
    updateCommunicationConversation: vi.fn(),
}));

vi.mock("../components/ClientSettingsModal", () => ({
    ClientSettingsModal: (props: {
        client?: { name?: string } | null;
        initialClient?: { name?: string } | null;
        onSaved: (client: unknown) => void;
        onDeleted: (clientId: string) => void;
    }) => {
        clientSettingsModalProps(props);
        return (
            <div role="dialog" aria-label="取引先マスタモーダル">
                <span>{props.client?.name || props.initialClient?.name || "新規取引先"}</span>
                <button type="button" onClick={() => props.onSaved({ id: "client-saved", name: "保存済み取引先" })}>
                    モーダル保存
                </button>
                <button type="button" onClick={() => props.onDeleted("client-1")}>
                    モーダル削除
                </button>
            </div>
        );
    },
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
        fetchClients.mockImplementation((params?: { status?: string }) => {
            if (params?.status === "deleted") {
                return Promise.resolve([
                    {
                        id: "client-deleted",
                        name: "削除済み商事",
                        contact_person: "削除さん",
                        email: "deleted@example.com",
                        phone: null,
                        address: null,
                        billing_name: "削除済み商事",
                        payment_terms: null,
                        invoice_notes_default: null,
                        created_at: "2026-04-01T00:00:00.000Z",
                        deleted_at: "2026-04-22T00:00:00.000Z",
                        deletion_reason: "重複",
                    },
                ]);
            }
            return Promise.resolve([
                {
                    id: "client-1",
                    name: "田中工務店",
                    contact_person: "田中さん",
                    email: "tanaka@example.com",
                    phone: "03-1234-5678",
                    address: "東京都渋谷区1-2-3",
                    billing_name: "田中工務店 御中",
                    payment_terms: "月末締め翌月末払い",
                    invoice_notes_default: "いつもありがとうございます。",
                    created_at: "2026-04-01T00:00:00.000Z",
                    deleted_at: null,
                },
            ]);
        });
        restoreClient.mockResolvedValue({ id: "client-deleted", name: "削除済み商事" });
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
                    client_id: "client-1",
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
                client_id: "client-1",
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
                    direction: "internal",
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
    });

    it("renders the messenger ledger list and detail without legacy board controls", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByText("連絡台帳")).toBeTruthy();
        });
        expect(await screen.findByRole("button", { name: /田中工務店/ })).toBeInTheDocument();
        expect(await screen.findByRole("heading", { name: "相手" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Board/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Analyze/ })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "Why now?" })).not.toBeInTheDocument();
        expect((await screen.findAllByText("価格表を返す")).length).toBeGreaterThan(0);
    });

    it("does not load the removed analyze insight endpoint", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await waitFor(() => {
            expect(screen.getByText("連絡台帳")).toBeTruthy();
        });
        expect(screen.queryByRole("heading", { name: "運用衛生" })).not.toBeInTheDocument();
        expect(screen.queryByRole("heading", { name: "会社単位の俯瞰" })).not.toBeInTheDocument();
    });

    it("renders a recording action without the legacy log label", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        expect((await screen.findAllByRole("button", { name: "連絡を記録" })).length).toBeGreaterThan(0);
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
        expect(screen.getAllByText("メッセージ").length).toBeGreaterThan(0);
        expect(screen.getAllByText("送信文").length).toBeGreaterThan(0);
        expect(screen.getAllByText("電話").length).toBeGreaterThan(0);
        expect(screen.getByText("電話で納期を確認")).toBeInTheDocument();
        expect(screen.getAllByLabelText("記録情報").length).toBeGreaterThan(0);
    });

    it("shows the client contact list from the client tab and opens detail before editing", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click((await screen.findAllByRole("tab", { name: "取引先" }))[0]);

        const clientRow = await screen.findByRole("button", { name: /田中さん/ });
        expect(clientRow).toBeInTheDocument();
        expect(screen.queryByText("東京都渋谷区1-2-3")).not.toBeInTheDocument();

        fireEvent.click(clientRow);
        expect((await screen.findAllByText("取引先名")).length).toBeGreaterThan(0);
        expect((await screen.findAllByText("支払条件")).length).toBeGreaterThan(0);
        expect(screen.getAllByText("月末締め翌月末払い").length).toBeGreaterThan(0);

        const clientCallsBeforeSave = fetchClients.mock.calls.length;
        fireEvent.click(screen.getAllByRole("button", { name: "編集" })[0]);
        expect(await screen.findByRole("dialog", { name: "取引先マスタモーダル" })).toBeInTheDocument();
        expect(clientSettingsModalProps).toHaveBeenLastCalledWith(expect.objectContaining({
            client: expect.objectContaining({ id: "client-1", name: "田中工務店" }),
        }));

        fireEvent.click(screen.getByRole("button", { name: "モーダル保存" }));
        await waitFor(() => {
            expect(fetchClients.mock.calls.length).toBeGreaterThan(clientCallsBeforeSave);
            expect(fetchCommunicationContacts).toHaveBeenCalledTimes(2);
        });
    });

    it("shows multiple people for the same registered client", async () => {
        fetchCommunicationContacts.mockResolvedValueOnce({
            items: [
                {
                    contact_key: "tanaka@example.com",
                    client_id: "client-1",
                    client_name: "田中工務店",
                    contact_name: "田中さん",
                    contact_email: "tanaka@example.com",
                    owner: { id: "member-1", name: "山田太郎", username: "yamada", avatar_url: null },
                    status: "waiting_internal",
                    risk_flags: [],
                    waiting_on: "internal",
                    attention_score: 30,
                    status_reason: "見積確認",
                    status_reason_source: "last_message_preview",
                    evidence_excerpt: "見積を確認します",
                    latest_activity_at: "2026-04-22T09:00:00.000Z",
                    last_external_activity_at: "2026-04-22T09:00:00.000Z",
                    days_since_latest_activity: 0,
                    last_inbound_at: "2026-04-22T09:00:00.000Z",
                    last_outbound_at: null,
                    days_since_client_response: 0,
                    next_action: "確認する",
                    next_action_due_date: null,
                    has_next_action: true,
                    relevant_conversation_id: "conv-1",
                    site: null,
                    conversation_count: 1,
                    open_conversation_count: 1,
                    in_flight_proposal_count: 0,
                },
                {
                    contact_key: "suzuki@example.com",
                    client_id: "client-1",
                    client_name: "田中工務店",
                    contact_name: "鈴木さん",
                    contact_email: "suzuki@example.com",
                    owner: { id: "member-1", name: "山田太郎", username: "yamada", avatar_url: null },
                    status: "waiting_client",
                    risk_flags: [],
                    waiting_on: "client",
                    attention_score: 10,
                    status_reason: "返答待ち",
                    status_reason_source: "last_message_preview",
                    evidence_excerpt: "返答待ちです",
                    latest_activity_at: "2026-04-22T10:00:00.000Z",
                    last_external_activity_at: "2026-04-22T10:00:00.000Z",
                    days_since_latest_activity: 0,
                    last_inbound_at: "2026-04-22T10:00:00.000Z",
                    last_outbound_at: null,
                    days_since_client_response: 0,
                    next_action: "待つ",
                    next_action_due_date: null,
                    has_next_action: true,
                    relevant_conversation_id: "conv-2",
                    site: null,
                    conversation_count: 1,
                    open_conversation_count: 1,
                    in_flight_proposal_count: 0,
                },
            ],
            total_count: 2,
        });

        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click((await screen.findAllByRole("tab", { name: "取引先" }))[0]);

        expect(await screen.findByRole("button", { name: /田中さん/ })).toBeInTheDocument();
        expect(await screen.findByRole("button", { name: /鈴木さん/ })).toBeInTheDocument();
        expect(screen.getAllByText("田中工務店").length).toBeGreaterThanOrEqual(2);
    });

    it("opens unregistered communication contacts as client registration candidates", async () => {
        fetchCommunicationContacts.mockResolvedValueOnce({
            items: [
                {
                    contact_key: "candidate@example.com",
                    client_id: null,
                    client_name: "未登録内装",
                    contact_name: "佐藤さん",
                    contact_email: "candidate@example.com",
                    owner: { id: "member-1", name: "山田太郎", username: "yamada", avatar_url: null },
                    status: "waiting_internal",
                    risk_flags: [],
                    waiting_on: "internal",
                    attention_score: 30,
                    status_reason: "折り返し",
                    status_reason_source: "last_message_preview",
                    evidence_excerpt: "折り返しお願いします",
                    latest_activity_at: "2026-04-22T09:00:00.000Z",
                    last_external_activity_at: "2026-04-22T09:00:00.000Z",
                    days_since_latest_activity: 0,
                    last_inbound_at: "2026-04-22T09:00:00.000Z",
                    last_outbound_at: null,
                    days_since_client_response: 0,
                    next_action: "登録する",
                    next_action_due_date: null,
                    has_next_action: true,
                    relevant_conversation_id: "conv-candidate",
                    site: null,
                    conversation_count: 1,
                    open_conversation_count: 1,
                    in_flight_proposal_count: 0,
                },
            ],
            total_count: 1,
        });

        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click((await screen.findAllByRole("tab", { name: "取引先" }))[0]);
        fireEvent.click(await screen.findByRole("button", { name: /未登録内装/ }));

        expect((await screen.findAllByText("登録候補")).length).toBeGreaterThan(0);
        fireEvent.click(screen.getAllByRole("button", { name: "登録" })[0]);

        expect(await screen.findByRole("dialog", { name: "取引先マスタモーダル" })).toBeInTheDocument();
        expect(clientSettingsModalProps).toHaveBeenLastCalledWith(expect.objectContaining({
            initialClient: expect.objectContaining({
                name: "未登録内装",
                contact_person: "佐藤さん",
                email: "candidate@example.com",
            }),
        }));
    });

    it("restores deleted clients from the deleted category", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        fireEvent.click((await screen.findAllByRole("tab", { name: "取引先" }))[0]);
        fireEvent.click(await screen.findByRole("button", { name: "削除済み" }));
        fireEvent.click(await screen.findByRole("button", { name: /削除済み商事/ }));
        fireEvent.click((await screen.findAllByRole("button", { name: "復元" }))[0]);

        await waitFor(() => {
            expect(restoreClient).toHaveBeenCalledWith("client-deleted");
            expect(fetchClients).toHaveBeenCalledWith({ status: "deleted" });
        });
    });

    it("records typed messages without copy confirmation", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await screen.findByRole("heading", { name: "証跡タイムライン" });
        expect(await screen.findByRole("radio", { name: "相手" })).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("radio", { name: "自分" })).toHaveAttribute("aria-checked", "false");
        expect(await screen.findByPlaceholderText("相手の発言を入力")).toBeInTheDocument();
        expect(screen.queryByRole("dialog", { name: "連絡を記録" })).not.toBeInTheDocument();
        expect(await screen.findByRole("button", { name: "メッセージとして記録" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "電話として記録" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "会話として記録" })).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("相手の発言を入力"), {
            target: { value: "価格表を送ってください" },
        });
        fireEvent.click(screen.getByRole("button", { name: "メッセージとして記録" }));

        await waitFor(() => {
            expect(addCommunicationLog).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    channel: "gmail",
                    direction: "inbound",
                    body: "価格表を送ってください",
                    log_kind: "message",
                    metadata: expect.objectContaining({
                        entry_mode: "message",
                        speaker_role: "client",
                        speaker_label: "相手",
                        capture_method: "typed_allowed",
                        evidence_type: "user_entered_note",
                        original_locked: false,
                        recorded_ui_version: "messenger_chat_v2",
                    }),
                }),
            );
        });
    });

    it("records phone notes from the phone send button", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await screen.findByRole("heading", { name: "証跡タイムライン" });
        fireEvent.change(await screen.findByPlaceholderText("相手の発言を入力"), {
            target: { value: "電話で納期を確認した" },
        });
        fireEvent.click(screen.getByRole("button", { name: "電話として記録" }));

        await waitFor(() => {
            expect(addCommunicationLog).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    channel: "phone",
                    direction: "inbound",
                    body: "電話で納期を確認した",
                    log_kind: "note",
                    metadata: expect.objectContaining({
                        entry_mode: "phone_note",
                        speaker_role: "client",
                        capture_method: "typed_allowed",
                        evidence_type: "user_entered_note",
                    }),
                }),
            );
        });
    });

    it("records self-authored messages as outbound bubbles from the speaker switch", async () => {
        render(
            <MemoryRouter initialEntries={["/communications"]}>
                <Routes>
                    <Route path="/communications" element={<Communications />} />
                </Routes>
            </MemoryRouter>,
        );

        await screen.findByRole("heading", { name: "証跡タイムライン" });
        fireEvent.click(screen.getByRole("radio", { name: "自分" }));
        expect(screen.getByRole("radio", { name: "自分" })).toHaveAttribute("aria-checked", "true");
        expect(await screen.findByPlaceholderText("自分の発言を入力")).toBeInTheDocument();

        fireEvent.change(screen.getByPlaceholderText("自分の発言を入力"), {
            target: { value: "本日中に送ります" },
        });
        fireEvent.click(screen.getByRole("button", { name: "メッセージとして記録" }));

        await waitFor(() => {
            expect(addCommunicationLog).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    channel: "gmail",
                    direction: "outbound",
                    body: "本日中に送ります",
                    log_kind: "message",
                    metadata: expect.objectContaining({
                        entry_mode: "message",
                        speaker_role: "team",
                        speaker_label: "自分",
                        capture_method: "typed_allowed",
                        evidence_type: "user_entered_note",
                    }),
                }),
            );
        });
    });
});
