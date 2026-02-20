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

function getGetHandler(path: string) {
  const layer = (communicationsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.get
  );

  if (!layer) {
    throw new Error(`GET handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("communications router", () => {
  const listHandler = getGetHandler("/");
  const detailHandler = getGetHandler("/:messageId");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET / returns mapped communication review list", async () => {
    const listChain = createChain({
      data: [
        {
          id: "review-1",
          type: "communication.review",
          status: "pending",
          description: "review description",
          payload: {
            source_message_id: "message-1",
            source_message_subject: "見積もり確認のお願い",
            source_message_from: "client@example.com",
            source_message_date: "2026-02-20T08:00:00.000Z",
            source_message_body_preview: "preview",
            source_message_body_full: "full body",
            summary: "summary",
            priority: "high",
            due_date: "2026-02-21",
            suggested_tasks: [{ id: "task-1" }, { id: "task-2" }],
          },
          created_at: "2026-02-20T08:00:00.000Z",
          updated_at: "2026-02-20T08:05:00.000Z",
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(listChain);

    const req = {
      orgId: "org-1",
      query: { limit: "10", offset: "0", status: "pending" },
    } as any;
    const res = createMockRes();

    await listHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([
      {
        review_proposal_id: "review-1",
        source_message_id: "message-1",
        source_message_subject: "見積もり確認のお願い",
        source_message_from: "client@example.com",
        source_message_date: "2026-02-20T08:00:00.000Z",
        source_message_body_preview: "preview",
        source_message_body_full: "full body",
        summary: "summary",
        priority: "high",
        due_date: "2026-02-21",
        review_status: "pending",
        task_suggestion_count: 2,
        created_at: "2026-02-20T08:00:00.000Z",
        updated_at: "2026-02-20T08:05:00.000Z",
      },
    ]);
    expect(mockFrom).toHaveBeenCalledWith("proposals");
    expect(listChain.eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(listChain.eq).toHaveBeenCalledWith("type", "communication.review");
    expect(listChain.eq).toHaveBeenCalledWith("status", "pending");
    expect(listChain.range).toHaveBeenCalledWith(0, 9);
  });

  it("GET / returns 400 when status query is invalid", async () => {
    const req = {
      query: { status: "invalid-status" },
      orgId: "org-1",
    } as any;
    const res = createMockRes();

    await listHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Invalid status query" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("GET /:messageId returns review + tasks + revisions", async () => {
    const reviewChain = createChain({
      data: [
        {
          id: "review-1",
          type: "communication.review",
          status: "pending",
          description: "review description",
          payload: {
            source_message_id: "message-1",
            source_message_subject: "進捗共有",
            source_message_from: "client@example.com",
            source_message_body_preview: "preview",
            source_message_body_full: "full body",
            summary: "summary",
            priority: "medium",
          },
          created_at: "2026-02-20T08:00:00.000Z",
          updated_at: "2026-02-20T08:05:00.000Z",
        },
      ],
      error: null,
    });
    const detailChain = createChain({
      data: [
        {
          id: "task-1",
          type: "communication.task",
          status: "pending",
          description: "task description",
          payload: {
            title: "返信ドラフト作成",
            priority: "high",
            due_date: "2026-02-21",
            suggested_reply: "ドラフト案",
            parent_proposal_id: "review-1",
            source_message_id: "message-1",
          },
          created_at: "2026-02-20T09:00:00.000Z",
          updated_at: "2026-02-20T09:00:00.000Z",
        },
        {
          id: "revision-1",
          type: "task.revision.request",
          status: "pending",
          description: "指示",
          payload: {
            instruction: "トーンを丁寧語にしてください",
            target_proposal_id: "task-1",
            parent_proposal_id: "review-1",
            source_message_id: "message-1",
          },
          created_at: "2026-02-20T10:00:00.000Z",
          updated_at: "2026-02-20T10:00:00.000Z",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [reviewChain, detailChain]);

    const req = {
      orgId: "org-1",
      params: { messageId: "message-1" },
    } as any;
    const res = createMockRes();

    await detailHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      review: expect.objectContaining({
        review_proposal_id: "review-1",
        source_message_id: "message-1",
      }),
      tasks: [
        {
          proposal_id: "task-1",
          type: "communication.task",
          status: "pending",
          title: "返信ドラフト作成",
          description: "task description",
          priority: "high",
          due_date: "2026-02-21",
          suggested_reply: "ドラフト案",
          parent_proposal_id: "review-1",
          created_at: "2026-02-20T09:00:00.000Z",
        },
      ],
      revisions: [
        {
          proposal_id: "revision-1",
          type: "task.revision.request",
          status: "pending",
          instruction: "トーンを丁寧語にしてください",
          target_proposal_id: "task-1",
          parent_proposal_id: "review-1",
          created_at: "2026-02-20T10:00:00.000Z",
        },
      ],
    });

    expect(reviewChain.eq).toHaveBeenCalledWith("payload->>source_message_id", "message-1");
    expect(detailChain.eq).toHaveBeenCalledWith("payload->>source_message_id", "message-1");
  });

  it("GET /:messageId returns 404 when review is not found", async () => {
    const reviewChain = createChain({ data: [], error: null });
    mockFrom.mockReturnValue(reviewChain);

    const req = {
      orgId: "org-1",
      params: { messageId: "missing-message" },
    } as any;
    const res = createMockRes();

    await detailHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Communication not found" });
  });
});
