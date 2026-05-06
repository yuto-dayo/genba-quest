import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import communicationsRouter from "../../routes/communications";

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
};

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getHandler(method: "get" | "post" | "patch", path: string) {
  const layer = (communicationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method]
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("communications router", () => {
  const listHandler = getHandler("get", "/");
  const detailHandler = getHandler("get", "/:conversationId");
  const createHandler = getHandler("post", "/");
  const addLogHandler = getHandler("post", "/:conversationId/logs");
  const patchHandler = getHandler("patch", "/:conversationId");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET / returns hydrated conversation list", async () => {
    const conversationsChain = createChain({
      data: [
        {
          id: "conv-1",
          org_id: "org-1",
          title: "工程変更の相談",
          status: "waiting_internal",
          source_channel: "gmail",
          last_channel: "line",
          external_thread_key: "thread-1",
          assignee_user_id: "member-1",
          site_id: "site-1",
          site_name_snapshot: "渋谷ビル改修",
          client_name_snapshot: "田中工務店",
          client_email_snapshot: "tanaka@example.com",
          ai_summary: "工程変更の可否確認が必要",
          ai_priority: "high",
          next_action: "現場責任者へ確認",
          next_action_due_date: "2026-04-13",
          last_activity_at: "2026-04-12T09:00:00.000Z",
          last_message_preview: "LINE で日程調整の相談あり",
          created_by_user_id: "member-1",
          created_at: "2026-04-12T08:00:00.000Z",
          updated_at: "2026-04-12T09:00:00.000Z",
        },
      ],
      error: null,
    });
    const profilesChain = createChain({
      data: [{ id: "member-1", full_name: "山田太郎", username: "yamada", avatar_url: null }],
      error: null,
    });
    const sitesChain = createChain({
      data: [{ id: "site-1", name: "渋谷ビル改修" }],
      error: null,
    });
    const participantsChain = createChain({
      data: [
        {
          id: "participant-1",
          org_id: "org-1",
          conversation_id: "conv-1",
          participant_kind: "client",
          display_name: "田中工務店",
          email: "tanaka@example.com",
          phone: null,
          profile_id: null,
          is_primary: true,
          created_at: "2026-04-12T08:00:00.000Z",
          updated_at: "2026-04-12T08:00:00.000Z",
        },
      ],
      error: null,
    });
    const linksChain = createChain({
      data: [
        { conversation_id: "conv-1", proposal_id: "proposal-1" },
        { conversation_id: "conv-1", proposal_id: "proposal-2" },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [
      conversationsChain,
      profilesChain,
      sitesChain,
      participantsChain,
      linksChain,
    ]);

    const req = {
      orgId: "org-1",
      query: { limit: "20", offset: "0", status: "waiting_internal" },
    } as any;
    const res = createMockRes();

    await listHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "conv-1",
        title: "工程変更の相談",
        status: "waiting_internal",
        participant_summary: "田中工務店",
        related_proposal_count: 2,
        assignee: expect.objectContaining({ id: "member-1", name: "山田太郎" }),
        site: { id: "site-1", name: "渋谷ビル改修" },
      }),
    ]);
    expect(conversationsChain.eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(conversationsChain.eq).toHaveBeenCalledWith("status", "waiting_internal");
    expect(conversationsChain.range).toHaveBeenCalledWith(0, 19);
  });

  it("GET / returns 400 for invalid status", async () => {
    const req = {
      orgId: "org-1",
      query: { status: "invalid" },
    } as any;
    const res = createMockRes();

    await listHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid status query" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("GET /:conversationId returns detail with logs and related proposals", async () => {
    const conversationChain = createChain({
      data: {
        id: "conv-1",
        org_id: "org-1",
        title: "見積条件の確認",
        status: "active",
        source_channel: "gmail",
        last_channel: "phone",
        external_thread_key: "thread-1",
        assignee_user_id: "member-1",
        site_id: "site-1",
        site_name_snapshot: "新宿店舗改修",
        client_name_snapshot: "田中工務店",
        client_email_snapshot: "tanaka@example.com",
        ai_summary: "金額条件の再確認が必要",
        ai_priority: "medium",
        next_action: "見積条件を整理して返信",
        next_action_due_date: "2026-04-14",
        last_activity_at: "2026-04-12T10:00:00.000Z",
        last_message_preview: "電話で金額感のすり合わせ",
        created_by_user_id: "member-1",
        created_at: "2026-04-12T08:00:00.000Z",
        updated_at: "2026-04-12T10:00:00.000Z",
      },
      error: null,
    });
    const hydrateProfilesChain = createChain({
      data: [{ id: "member-1", full_name: "山田太郎", username: "yamada", avatar_url: null }],
      error: null,
    });
    const hydrateSitesChain = createChain({
      data: [{ id: "site-1", name: "新宿店舗改修" }],
      error: null,
    });
    const hydrateParticipantsChain = createChain({
      data: [
        {
          id: "participant-1",
          org_id: "org-1",
          conversation_id: "conv-1",
          participant_kind: "client",
          display_name: "田中工務店",
          email: "tanaka@example.com",
          phone: null,
          profile_id: null,
          is_primary: true,
          created_at: "2026-04-12T08:00:00.000Z",
          updated_at: "2026-04-12T08:00:00.000Z",
        },
      ],
      error: null,
    });
    const hydrateLinksChain = createChain({
      data: [{ conversation_id: "conv-1", proposal_id: "proposal-1" }],
      error: null,
    });
    const logsChain = createChain({
      data: [
        {
          id: "log-1",
          org_id: "org-1",
          conversation_id: "conv-1",
          channel: "gmail",
          direction: "inbound",
          log_kind: "message",
          subject: "見積条件の確認",
          body: "本文",
          summary: "要約",
          occurred_at: "2026-04-12T09:00:00.000Z",
          created_by_type: "integration",
          created_by_user_id: null,
          created_by_name_snapshot: "Gmail Watcher",
          external_source: "gmail",
          external_id: "message-1",
          metadata: { source_message_id: "message-1" },
          created_at: "2026-04-12T09:00:00.000Z",
          updated_at: "2026-04-12T09:00:00.000Z",
        },
      ],
      error: null,
    });
    const detailParticipantsChain = createChain({
      data: [
        {
          id: "participant-2",
          org_id: "org-1",
          conversation_id: "conv-1",
          participant_kind: "internal",
          display_name: "山田太郎",
          email: null,
          phone: null,
          profile_id: "member-1",
          is_primary: false,
          created_at: "2026-04-12T08:30:00.000Z",
          updated_at: "2026-04-12T08:30:00.000Z",
        },
      ],
      error: null,
    });
    const detailLinksChain = createChain({
      data: [{ conversation_id: "conv-1", proposal_id: "proposal-1" }],
      error: null,
    });
    const participantProfilesChain = createChain({
      data: [{ id: "member-1", full_name: "山田太郎", username: "yamada", avatar_url: null }],
      error: null,
    });
    const proposalsChain = createChain({
      data: [
        {
          id: "proposal-1",
          org_id: "org-1",
          type: "communication.task",
          status: "pending",
          payload: { title: "返信文作成" },
          description: "返信文を確認する",
          created_by: { type: "integration", id: "integration:gmail", name: "Gmail Watcher" },
          approvals: [],
          required_approvals: 1,
          created_at: "2026-04-12T09:10:00.000Z",
          updated_at: "2026-04-12T09:10:00.000Z",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [
      conversationChain,
      hydrateProfilesChain,
      hydrateSitesChain,
      hydrateParticipantsChain,
      hydrateLinksChain,
      logsChain,
      detailParticipantsChain,
      detailLinksChain,
      participantProfilesChain,
      proposalsChain,
    ]);

    const req = {
      orgId: "org-1",
      params: { conversationId: "conv-1" },
    } as any;
    const res = createMockRes();

    await detailHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation: expect.objectContaining({
          id: "conv-1",
          title: "見積条件の確認",
          assignee: expect.objectContaining({ id: "member-1", name: "山田太郎" }),
        }),
        logs: [expect.objectContaining({ id: "log-1", channel: "gmail" })],
        participants: [
          expect.objectContaining({
            id: "participant-2",
            profile: expect.objectContaining({ id: "member-1", name: "山田太郎" }),
          }),
        ],
        related_proposals: [expect.objectContaining({ id: "proposal-1", type: "communication.task" })],
      })
    );
  });

  it("POST / returns 400 when title is missing", async () => {
    const req = {
      orgId: "org-1",
      body: {
        channel: "phone",
        direction: "inbound",
        body: "会話内容",
      },
    } as any;
    const res = createMockRes();

    await createHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "title is required" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST / returns 400 when metadata is not an object", async () => {
    const req = {
      orgId: "org-1",
      body: {
        title: "LINEの確認",
        channel: "line",
        direction: "inbound",
        body: "確認お願いします",
        metadata: "invalid",
      },
    } as any;
    const res = createMockRes();

    await createHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "metadata must be an object" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST /:conversationId/logs stores evidence metadata", async () => {
    const existingChain = createChain({ data: { id: "conv-1" }, error: null });
    const insertLogChain = createChain({ data: { id: "log-1" }, error: null });
    const updateConversationChain = createChain({ data: null, error: null });
    const detailConversationChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      existingChain,
      insertLogChain,
      updateConversationChain,
      detailConversationChain,
    ]);

    const metadata = {
      entry_mode: "customer_paste",
      capture_method: "paste_primary",
      evidence_type: "external_original",
      original_locked: true,
      recorded_ui_version: "messenger_ledger_v1",
    };
    const req = {
      orgId: "org-1",
      userId: "user-1",
      userName: "山田太郎",
      params: { conversationId: "conv-1" },
      body: {
        channel: "line",
        direction: "inbound",
        body: "確認お願いします",
        log_kind: "message",
        metadata,
      },
    } as any;
    const res = createMockRes();

    await addLogHandler(req, res);

    expect(insertLogChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: "conv-1",
        channel: "line",
        direction: "inbound",
        log_kind: "message",
        metadata,
      })
    );
  });

  it("POST /:conversationId/logs returns 400 when metadata is not an object", async () => {
    const req = {
      orgId: "org-1",
      params: { conversationId: "conv-1" },
      body: {
        channel: "line",
        direction: "inbound",
        body: "確認お願いします",
        metadata: ["invalid"],
      },
    } as any;
    const res = createMockRes();

    await addLogHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "metadata must be an object" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("PATCH /:conversationId returns 400 when no fields are provided", async () => {
    const conversationChain = createChain({
      data: {
        id: "conv-1",
        org_id: "org-1",
        title: "進捗共有",
        status: "active",
        source_channel: "gmail",
        last_channel: "gmail",
        external_thread_key: "thread-1",
        assignee_user_id: null,
        site_id: null,
        site_name_snapshot: null,
        client_name_snapshot: "田中工務店",
        client_email_snapshot: null,
        ai_summary: "summary",
        ai_priority: "medium",
        next_action: null,
        next_action_due_date: null,
        last_activity_at: "2026-04-12T09:00:00.000Z",
        last_message_preview: "preview",
        created_by_user_id: null,
        created_at: "2026-04-12T08:00:00.000Z",
        updated_at: "2026-04-12T09:00:00.000Z",
      },
      error: null,
    });
    mockFrom.mockReturnValue(conversationChain);

    const req = {
      orgId: "org-1",
      params: { conversationId: "conv-1" },
      body: {},
    } as any;
    const res = createMockRes();

    await patchHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "No updatable fields provided" });
  });
});
