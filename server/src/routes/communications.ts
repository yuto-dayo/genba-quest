import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router = Router();
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";

const COMMUNICATION_REVIEW_TYPE = "communication.review";
const COMMUNICATION_DETAIL_TYPES = ["communication.task", "task.revision.request"] as const;
const VALID_PROPOSAL_STATUSES = new Set(["draft", "pending", "approved", "rejected", "executed"]);

type CommunicationProposalStatus = "draft" | "pending" | "approved" | "rejected" | "executed";

type ProposalRow = {
  id: string;
  type: string;
  status: string;
  description: string;
  payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

interface CommunicationListItem {
  review_proposal_id: string;
  source_message_id: string;
  source_message_subject: string;
  source_message_from: string;
  source_message_date: string | null;
  source_message_body_preview: string;
  source_message_body_full: string;
  summary: string;
  priority: string | null;
  due_date: string | null;
  review_status: CommunicationProposalStatus;
  task_suggestion_count: number;
  created_at: string;
  updated_at: string;
}

interface CommunicationTaskItem {
  proposal_id: string;
  type: "communication.task";
  status: CommunicationProposalStatus;
  title: string;
  description: string;
  priority: string | null;
  due_date: string | null;
  suggested_reply: string | null;
  parent_proposal_id: string | null;
  created_at: string;
}

interface CommunicationRevisionItem {
  proposal_id: string;
  type: "task.revision.request";
  status: CommunicationProposalStatus;
  instruction: string;
  target_proposal_id: string | null;
  parent_proposal_id: string | null;
  created_at: string;
}

interface CommunicationDetailResponse {
  review: CommunicationListItem;
  tasks: CommunicationTaskItem[];
  revisions: CommunicationRevisionItem[];
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.min(Math.floor(parsed), 100);
}

function normalizeOffset(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizeStatus(raw: unknown): CommunicationProposalStatus | null {
  const normalized = normalizeString(raw);
  if (!normalized) {
    return null;
  }

  if (!VALID_PROPOSAL_STATUSES.has(normalized)) {
    return null;
  }

  return normalized as CommunicationProposalStatus;
}

function readPayloadText(payload: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = normalizeString(payload[key]);
    if (value) {
      return value;
    }
  }
  return null;
}

function readTaskSuggestionCount(payload: Record<string, unknown>): number {
  const suggestions = payload.suggested_tasks;
  if (Array.isArray(suggestions)) {
    return suggestions.length;
  }

  const countValue = payload.task_suggestion_count;
  if (typeof countValue === "number" && Number.isFinite(countValue) && countValue >= 0) {
    return Math.floor(countValue);
  }

  if (typeof countValue === "string") {
    const parsed = Number(countValue);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed);
    }
  }

  return 0;
}

function mapReviewProposal(row: ProposalRow): CommunicationListItem | null {
  const payload = row.payload || {};
  const sourceMessageId = readPayloadText(payload, ["source_message_id"]);
  if (!sourceMessageId) {
    return null;
  }

  const bodyPreview = readPayloadText(payload, [
    "source_message_body_preview",
    "email_body_preview",
  ]) || "";

  const bodyFull = readPayloadText(payload, [
    "source_message_body_full",
    "email_body_full",
  ]) || bodyPreview;

  return {
    review_proposal_id: row.id,
    source_message_id: sourceMessageId,
    source_message_subject: readPayloadText(payload, ["source_message_subject", "email_subject"]) || "(件名なし)",
    source_message_from: readPayloadText(payload, ["source_message_from", "email_from"]) || "送信者不明",
    source_message_date: readPayloadText(payload, ["source_message_date"]),
    source_message_body_preview: bodyPreview,
    source_message_body_full: bodyFull,
    summary: readPayloadText(payload, ["summary"]) || row.description,
    priority: readPayloadText(payload, ["priority"]),
    due_date: readPayloadText(payload, ["due_date"]),
    review_status: row.status as CommunicationProposalStatus,
    task_suggestion_count: readTaskSuggestionCount(payload),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTaskProposal(row: ProposalRow): CommunicationTaskItem | null {
  if (row.type !== "communication.task") {
    return null;
  }

  const payload = row.payload || {};
  const title = readPayloadText(payload, ["title"]) || "メール対応タスク";
  const description = readPayloadText(payload, ["description"]) || row.description;

  return {
    proposal_id: row.id,
    type: "communication.task",
    status: row.status as CommunicationProposalStatus,
    title,
    description,
    priority: readPayloadText(payload, ["priority"]),
    due_date: readPayloadText(payload, ["due_date"]),
    suggested_reply: readPayloadText(payload, ["suggested_reply"]),
    parent_proposal_id: readPayloadText(payload, ["parent_proposal_id"]),
    created_at: row.created_at,
  };
}

function mapRevisionProposal(row: ProposalRow): CommunicationRevisionItem | null {
  if (row.type !== "task.revision.request") {
    return null;
  }

  const payload = row.payload || {};
  const instruction = readPayloadText(payload, ["instruction"]) || row.description;

  return {
    proposal_id: row.id,
    type: "task.revision.request",
    status: row.status as CommunicationProposalStatus,
    instruction,
    target_proposal_id: readPayloadText(payload, ["target_proposal_id"]),
    parent_proposal_id: readPayloadText(payload, ["parent_proposal_id"]),
    created_at: row.created_at,
  };
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = req.orgId || DEFAULT_ORG_ID;
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const statusParam = req.query.status;
    const status = normalizeStatus(statusParam);

    if (statusParam !== undefined && status === null) {
      res.status(400).json({ error: "Invalid status query" });
      return;
    }

    let query = supabaseAdmin
      .from("proposals")
      .select("id,type,status,description,payload,created_at,updated_at")
      .eq("org_id", orgId)
      .eq("type", COMMUNICATION_REVIEW_TYPE)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to fetch communications: ${error.message}`);
    }

    const rows = (data || []) as ProposalRow[];
    const result: CommunicationListItem[] = rows
      .map(mapReviewProposal)
      .filter((item): item is CommunicationListItem => item !== null);

    res.json(result);
  } catch (err: unknown) {
    console.error("List communications error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/:messageId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = req.orgId || DEFAULT_ORG_ID;
    const messageId = normalizeString(req.params.messageId);

    if (!messageId) {
      res.status(400).json({ error: "Invalid messageId" });
      return;
    }

    const { data: reviewRows, error: reviewError } = await supabaseAdmin
      .from("proposals")
      .select("id,type,status,description,payload,created_at,updated_at")
      .eq("org_id", orgId)
      .eq("type", COMMUNICATION_REVIEW_TYPE)
      .eq("payload->>source_message_id", messageId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (reviewError) {
      throw new Error(`Failed to fetch communication review: ${reviewError.message}`);
    }

    const reviewRow = (reviewRows || [])[0] as ProposalRow | undefined;
    if (!reviewRow) {
      res.status(404).json({ error: "Communication not found" });
      return;
    }

    const review = mapReviewProposal(reviewRow);
    if (!review) {
      res.status(404).json({ error: "Communication not found" });
      return;
    }

    const { data: detailRows, error: detailError } = await supabaseAdmin
      .from("proposals")
      .select("id,type,status,description,payload,created_at,updated_at")
      .eq("org_id", orgId)
      .in("type", [...COMMUNICATION_DETAIL_TYPES])
      .eq("payload->>source_message_id", messageId)
      .order("created_at", { ascending: false });

    if (detailError) {
      throw new Error(`Failed to fetch communication detail: ${detailError.message}`);
    }

    const detailProposals = (detailRows || []) as ProposalRow[];
    const tasks: CommunicationTaskItem[] = [];
    const revisions: CommunicationRevisionItem[] = [];

    for (const row of detailProposals) {
      const task = mapTaskProposal(row);
      if (task) {
        tasks.push(task);
        continue;
      }

      const revision = mapRevisionProposal(row);
      if (revision) {
        revisions.push(revision);
      }
    }

    const response: CommunicationDetailResponse = {
      review,
      tasks,
      revisions,
    };

    res.json(response);
  } catch (err: unknown) {
    console.error("Get communication detail error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
