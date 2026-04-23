import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import {
  getCommunicationInsightsSummary,
  listCommunicationContacts,
} from "../../services/communication-contact-read-model";

const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

function buildProposal(id: string, status: "draft" | "pending" | "approved" | "rejected" | "executed") {
  return {
    id,
    org_id: "org-1",
    type: "communication.task",
    status,
    payload: {},
    description: `${id} description`,
    created_by: { type: "integration", id: "integration:gmail", name: "Gmail Watcher" },
    approvals: [],
    required_approvals: 1,
    created_at: "2026-04-10T09:00:00.000Z",
    updated_at: "2026-04-10T09:00:00.000Z",
  };
}

describe("communication contact read model", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("aggregates conversations by contact and picks overdue as the representative status", async () => {
    setupMockFromSequence(mockFrom, [
      createChain({
        data: [
          {
            id: "conv-1",
            org_id: "org-1",
            title: "見積の確認",
            status: "active",
            source_channel: "gmail",
            last_channel: "gmail",
            assignee_user_id: "member-1",
            site_id: "site-1",
            site_name_snapshot: "渋谷ビル改修",
            client_name_snapshot: "田中工務店",
            client_email_snapshot: "tanaka@example.com",
            ai_summary: "見積条件の確認中",
            ai_priority: "high",
            next_action: "価格表を返す",
            next_action_due_date: "2026-04-15",
            last_activity_at: "2026-04-20T09:00:00.000Z",
            last_message_preview: "価格表の送付依頼",
            created_at: "2026-04-10T09:00:00.000Z",
            updated_at: "2026-04-20T09:00:00.000Z",
          },
          {
            id: "conv-2",
            org_id: "org-1",
            title: "日程調整",
            status: "waiting_client",
            source_channel: "line",
            last_channel: "line",
            assignee_user_id: "member-1",
            site_id: "site-1",
            site_name_snapshot: "渋谷ビル改修",
            client_name_snapshot: "田中工務店",
            client_email_snapshot: "tanaka@example.com",
            ai_summary: "返答待ち",
            ai_priority: "medium",
            next_action: "先方返信を待つ",
            next_action_due_date: "2026-04-25",
            last_activity_at: "2026-04-21T09:00:00.000Z",
            last_message_preview: "日程候補を送付済み",
            created_at: "2026-04-11T09:00:00.000Z",
            updated_at: "2026-04-21T09:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [
          {
            id: "participant-1",
            conversation_id: "conv-1",
            participant_kind: "client",
            display_name: "田中さん",
            email: "tanaka@example.com",
            phone: null,
            profile_id: null,
            is_primary: true,
            created_at: "2026-04-10T09:00:00.000Z",
          },
          {
            id: "participant-2",
            conversation_id: "conv-2",
            participant_kind: "client",
            display_name: "田中さん",
            email: "tanaka@example.com",
            phone: null,
            profile_id: null,
            is_primary: true,
            created_at: "2026-04-11T09:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [
          { id: "site-1", name: "渋谷ビル改修", client_id: "client-1", deleted_at: null },
        ],
        error: null,
      }),
      createChain({
        data: [
          { conversation_id: "conv-1", proposal_id: "proposal-1", created_at: "2026-04-10T09:00:00.000Z" },
          { conversation_id: "conv-2", proposal_id: "proposal-2", created_at: "2026-04-11T09:00:00.000Z" },
          { conversation_id: "conv-2", proposal_id: "proposal-3", created_at: "2026-04-11T09:30:00.000Z" },
        ],
        error: null,
      }),
      createChain({
        data: [
          {
            id: "log-1",
            conversation_id: "conv-1",
            channel: "gmail",
            direction: "outbound",
            log_kind: "message",
            subject: "価格表送付",
            body: "価格表を送付しました",
            summary: "価格表送付",
            occurred_at: "2026-04-20T08:00:00.000Z",
            created_by_type: "human",
            created_by_name_snapshot: "山田太郎",
            external_source: null,
            external_id: null,
            metadata: {},
            created_at: "2026-04-20T08:00:00.000Z",
          },
          {
            id: "log-2",
            conversation_id: "conv-2",
            channel: "line",
            direction: "inbound",
            log_kind: "message",
            subject: null,
            body: "確認します",
            summary: "確認します",
            occurred_at: "2026-04-21T08:00:00.000Z",
            created_by_type: "integration",
            created_by_name_snapshot: "LINE Import",
            external_source: "line",
            external_id: "line-1",
            metadata: {},
            created_at: "2026-04-21T08:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [{ id: "member-1", full_name: "山田太郎", username: "yamada", avatar_url: null }],
        error: null,
      }),
      createChain({
        data: [
          buildProposal("proposal-1", "pending"),
          buildProposal("proposal-2", "approved"),
          buildProposal("proposal-3", "draft"),
        ],
        error: null,
      }),
    ]);

    const result = await listCommunicationContacts({
      orgId: "org-1",
      includeResolved: true,
      page: 1,
      pageSize: 20,
      sort: "attention",
    });

    expect(result.total_count).toBe(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        contact_key: "tanaka@example.com",
        status: "overdue",
        relevant_conversation_id: "conv-1",
        client_name: "田中工務店",
        contact_name: "田中さん",
        in_flight_proposal_count: 2,
        owner: expect.objectContaining({ id: "member-1", name: "山田太郎" }),
      }),
    );
    expect(result.items[0].risk_flags).toContain("overdue_next_action");
  });

  it("uses external activity rather than internal notes to keep stale contacts flagged", async () => {
    setupMockFromSequence(mockFrom, [
      createChain({
        data: [
          {
            id: "conv-1",
            org_id: "org-1",
            title: "返信待ちフォロー",
            status: "waiting_internal",
            source_channel: "gmail",
            last_channel: "system",
            assignee_user_id: null,
            site_id: "site-1",
            site_name_snapshot: "神田ビル",
            client_name_snapshot: "青木設備",
            client_email_snapshot: "aoki@example.com",
            ai_summary: "フォローが必要",
            ai_priority: "high",
            next_action: "明日フォローする",
            next_action_due_date: "2026-04-30",
            last_activity_at: "2026-04-21T10:00:00.000Z",
            last_message_preview: "内部メモを更新",
            created_at: "2026-04-01T09:00:00.000Z",
            updated_at: "2026-04-21T10:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [
          {
            id: "participant-1",
            conversation_id: "conv-1",
            participant_kind: "client",
            display_name: "青木さん",
            email: "aoki@example.com",
            phone: null,
            profile_id: null,
            is_primary: true,
            created_at: "2026-04-01T09:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [{ id: "site-1", name: "神田ビル", client_id: "client-2", deleted_at: null }],
        error: null,
      }),
      createChain({
        data: [
          { conversation_id: "conv-1", proposal_id: "proposal-1", created_at: "2026-04-10T09:00:00.000Z" },
        ],
        error: null,
      }),
      createChain({
        data: [
          {
            id: "log-1",
            conversation_id: "conv-1",
            channel: "gmail",
            direction: "internal",
            log_kind: "note",
            subject: "内部整理",
            body: "内部メモだけ更新",
            summary: "内部整理",
            occurred_at: "2026-04-21T10:00:00.000Z",
            created_by_type: "human",
            created_by_name_snapshot: "山田太郎",
            external_source: null,
            external_id: null,
            metadata: {},
            created_at: "2026-04-21T10:00:00.000Z",
          },
          {
            id: "log-2",
            conversation_id: "conv-1",
            channel: "gmail",
            direction: "outbound",
            log_kind: "message",
            subject: "前回送信",
            body: "前回の送信",
            summary: "前回送信",
            occurred_at: "2026-04-01T08:00:00.000Z",
            created_by_type: "human",
            created_by_name_snapshot: "山田太郎",
            external_source: null,
            external_id: null,
            metadata: {},
            created_at: "2026-04-01T08:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [buildProposal("proposal-1", "pending")],
        error: null,
      }),
    ]);

    const result = await listCommunicationContacts({
      orgId: "org-1",
      includeResolved: true,
      page: 1,
      pageSize: 20,
      sort: "attention",
    });

    expect(result.items[0].days_since_latest_activity).toBe(1);
    expect(result.items[0].risk_flags).toEqual(
      expect.arrayContaining(["stale_7d", "pending_proposal_stale", "no_owner"]),
    );
  });

  it("builds insights including follow-up missing after proposal link and client rollups", async () => {
    setupMockFromSequence(mockFrom, [
      createChain({
        data: [
          {
            id: "conv-1",
            org_id: "org-1",
            title: "返信待ちフォロー",
            status: "waiting_internal",
            source_channel: "gmail",
            last_channel: "system",
            assignee_user_id: null,
            site_id: "site-1",
            site_name_snapshot: "神田ビル",
            client_name_snapshot: "青木設備",
            client_email_snapshot: "aoki@example.com",
            ai_summary: "フォローが必要",
            ai_priority: "high",
            next_action: "明日フォローする",
            next_action_due_date: "2026-04-30",
            last_activity_at: "2026-04-21T10:00:00.000Z",
            last_message_preview: "内部メモを更新",
            created_at: "2026-04-01T09:00:00.000Z",
            updated_at: "2026-04-21T10:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [
          {
            id: "participant-1",
            conversation_id: "conv-1",
            participant_kind: "client",
            display_name: "青木さん",
            email: "aoki@example.com",
            phone: null,
            profile_id: null,
            is_primary: true,
            created_at: "2026-04-01T09:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [{ id: "site-1", name: "神田ビル", client_id: "client-2", deleted_at: null }],
        error: null,
      }),
      createChain({
        data: [
          { conversation_id: "conv-1", proposal_id: "proposal-1", created_at: "2026-04-10T09:00:00.000Z" },
        ],
        error: null,
      }),
      createChain({
        data: [
          {
            id: "log-1",
            conversation_id: "conv-1",
            channel: "gmail",
            direction: "outbound",
            log_kind: "message",
            subject: "前回送信",
            body: "前回の送信",
            summary: "前回送信",
            occurred_at: "2026-04-01T08:00:00.000Z",
            created_by_type: "human",
            created_by_name_snapshot: "山田太郎",
            external_source: null,
            external_id: null,
            metadata: {},
            created_at: "2026-04-01T08:00:00.000Z",
          },
        ],
        error: null,
      }),
      createChain({
        data: [buildProposal("proposal-1", "pending")],
        error: null,
      }),
    ]);

    const summary = await getCommunicationInsightsSummary("org-1");

    expect(summary.proposal_health.follow_up_missing_after_link_count).toBe(1);
    expect(summary.client_health[0]).toEqual(
      expect.objectContaining({
        client_id: "client-2",
        client_name: "青木設備",
        open_contacts: 1,
        in_flight_proposal_count: 1,
      }),
    );
  });
});
