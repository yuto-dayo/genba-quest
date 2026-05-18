import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommunicationRecordSheet } from "./CommunicationRecordSheet";

const addCommunicationLog = vi.fn();
const createCommunicationConversation = vi.fn();
const fetchMembers = vi.fn();
const fetchSites = vi.fn();
const updateCommunicationConversation = vi.fn();

vi.mock("framer-motion", () => ({
    motion: new Proxy(
        {},
        {
            get: () => ({ children, ...props }: ComponentProps<"div">) => <div {...props}>{children}</div>,
        },
    ),
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../lib/api", async () => {
    const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
    return {
        ...actual,
        addCommunicationLog: (...args: unknown[]) => addCommunicationLog(...args),
        createCommunicationConversation: (...args: unknown[]) => createCommunicationConversation(...args),
        fetchMembers: (...args: unknown[]) => fetchMembers(...args),
        fetchSites: (...args: unknown[]) => fetchSites(...args),
        updateCommunicationConversation: (...args: unknown[]) => updateCommunicationConversation(...args),
    };
});

const activeConversation = {
    id: "conv-1",
    title: "見積の件",
    status: "active",
    source_channel: "gmail",
    last_channel: "phone",
    client_name: "田中工務店",
    client_email: "tanaka@example.com",
    participant_summary: "田中さん",
    ai_summary: "見積条件の確認中",
    ai_priority: "high",
    next_action: "見積送付",
    next_action_due_date: "2026-04-25",
    last_activity_at: "2026-04-22T09:00:00.000Z",
    last_message_preview: "4/22 電話。金額を確認して折り返し",
    assignee: { id: "member-1", name: "田中", username: "tanaka", avatar_url: null },
    site: { id: "site-1", name: "渋谷ビル改修" },
    related_proposal_count: 1,
    created_at: "2026-04-10T09:00:00.000Z",
    updated_at: "2026-04-22T09:00:00.000Z",
} as const;

const members = [{ id: "member-1", full_name: "田中", username: "tanaka", avatar_url: null }];
const sites = [{ id: "site-1", name: "渋谷ビル改修", status: "active", created_at: "2026-04-01T00:00:00.000Z" }];

describe("CommunicationRecordSheet", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        fetchMembers.mockResolvedValue(members);
        fetchSites.mockResolvedValue(sites);
    });

    it("shows follow-up preview by default when active conversation exists", async () => {
        render(
            <CommunicationRecordSheet
                open
                onClose={vi.fn()}
                initialTargetKind="new_topic"
                activeConversationSummary={activeConversation}
                contactSeed={{ partnerName: "田中さん", partnerEmail: "tanaka@example.com", clientName: "田中工務店" }}
                availableMembers={members}
                availableSites={sites}
            />,
        );

        expect(await screen.findByText("保存先")).toBeInTheDocument();
        expect(screen.getByText("今の話の続き（見積の件）")).toBeInTheDocument();
        expect(screen.getByText("前回: 4/22 電話。金額を確認して折り返し")).toBeInTheDocument();
    });

    it("keeps the body when switching save target", async () => {
        render(
            <CommunicationRecordSheet
                open
                onClose={vi.fn()}
                activeConversationSummary={activeConversation}
                contactSeed={{ partnerName: "田中さん", partnerEmail: "tanaka@example.com", clientName: "田中工務店" }}
                availableMembers={members}
                availableSites={sites}
            />,
        );

        fireEvent.change(screen.getByLabelText("内容"), {
            target: { value: "金額の確認が終わった" },
        });
        fireEvent.click(screen.getByRole("button", { name: "変更" }));
        fireEvent.click(screen.getByRole("button", { name: "別の話として記録" }));

        expect(screen.getByLabelText("内容")).toHaveValue("金額の確認が終わった");
    });

    it("records a follow-up log without updating metadata when only body changed", async () => {
        addCommunicationLog.mockResolvedValue({});

        render(
            <CommunicationRecordSheet
                open
                onClose={vi.fn()}
                activeConversationSummary={activeConversation}
                contactSeed={{ partnerName: "田中さん", partnerEmail: "tanaka@example.com", clientName: "田中工務店" }}
                availableMembers={members}
                availableSites={sites}
            />,
        );

        fireEvent.change(screen.getByLabelText("内容"), {
            target: { value: "見積を今日中に送ると伝えた" },
        });
        fireEvent.click(screen.getByRole("button", { name: "電話として記録" }));

        await waitFor(() => {
            expect(addCommunicationLog).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    body: "見積を今日中に送ると伝えた",
                    channel: "phone",
                    direction: "internal",
                }),
            );
        });
        expect(updateCommunicationConversation).not.toHaveBeenCalled();
    });

    it("updates metadata too when supplemental fields changed", async () => {
        addCommunicationLog.mockResolvedValue({});
        updateCommunicationConversation.mockResolvedValue({});

        render(
            <CommunicationRecordSheet
                open
                onClose={vi.fn()}
                activeConversationSummary={activeConversation}
                contactSeed={{ partnerName: "田中さん", partnerEmail: "tanaka@example.com", clientName: "田中工務店" }}
                availableMembers={members}
                availableSites={sites}
            />,
        );

        fireEvent.change(screen.getByLabelText("内容"), {
            target: { value: "来週に再確認する" },
        });
        fireEvent.click(screen.getByRole("button", { name: /担当と次の動き/ }));
        fireEvent.change(screen.getByLabelText("次にやること"), {
            target: { value: "来週火曜に再確認" },
        });
        fireEvent.click(screen.getByRole("button", { name: "電話として記録" }));

        await waitFor(() => {
            expect(updateCommunicationConversation).toHaveBeenCalledWith(
                "conv-1",
                expect.objectContaining({
                    next_action: "来週火曜に再確認",
                }),
            );
        });
    });

    it("shows partial success when metadata update fails after log save", async () => {
        addCommunicationLog.mockResolvedValue({});
        updateCommunicationConversation.mockRejectedValue(new Error("META_UPDATE_FAILED"));

        render(
            <CommunicationRecordSheet
                open
                onClose={vi.fn()}
                activeConversationSummary={activeConversation}
                contactSeed={{ partnerName: "田中さん", partnerEmail: "tanaka@example.com", clientName: "田中工務店" }}
                availableMembers={members}
                availableSites={sites}
            />,
        );

        fireEvent.change(screen.getByLabelText("内容"), {
            target: { value: "見積は送った" },
        });
        fireEvent.click(screen.getByRole("button", { name: /担当と次の動き/ }));
        fireEvent.change(screen.getByLabelText("次にやること"), {
            target: { value: "反応待ち" },
        });
        fireEvent.click(screen.getByRole("button", { name: "電話として記録" }));

        expect(await screen.findByText("連絡は記録しました。担当と次の動きの更新だけ失敗しました。")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "もう一度更新する" })).toBeInTheDocument();
    });

    it("creates a new topic and auto-generates the title when omitted", async () => {
        createCommunicationConversation.mockResolvedValue({
            conversation: {
                ...activeConversation,
                id: "conv-2",
                title: "納期の件",
            },
        });

        render(
            <CommunicationRecordSheet
                open
                onClose={vi.fn()}
                initialTargetKind="new_topic"
                contactSeed={{ partnerName: "", partnerEmail: "", clientName: "" }}
                availableMembers={members}
                availableSites={sites}
            />,
        );

        fireEvent.change(screen.getByLabelText("内容"), {
            target: { value: "納期を一週間ずらしたい相談が来た" },
        });
        fireEvent.click(screen.getByRole("button", { name: "メッセージとして記録" }));

        await waitFor(() => {
            expect(createCommunicationConversation).toHaveBeenCalledWith(
                expect.objectContaining({
                    body: "納期を一週間ずらしたい相談が来た",
                    title: "納期を一週間ずらしたい相談が来た",
                }),
            );
        });
    });
});
