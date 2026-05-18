/**
 * Proposals API Router
 * DAO設計原則: 全状態変更はProposal経由で記録し監査可能に
 * 参照: docs/PROPOSAL_SYSTEM.md
 */

import { createHash } from "crypto";
import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { ProposalService } from "../services/ProposalService";
import { ActorRef, ProposalType, ProposalStatus } from "../services/PolicyEngine";
import {
  listProposalsAssignedToUser,
  reassign as reassignReviewer,
} from "../services/ProposalAssignmentService";
import { supabaseAdmin } from "../lib/supabaseAdmin";

const router = Router();
router.use(requireOrgMembership("member"));
type ProposalErrorMap = Record<string, { status: number; message: string }>;

const HUMAN_PROPOSAL_ERROR_MAP: ProposalErrorMap = {
  ORG_CONTEXT_REQUIRED: { status: 403, message: "ORG_CONTEXT_REQUIRED" },
  ASSIGNMENT_PAST_DATE_LOCKED: { status: 422, message: "ASSIGNMENT_PAST_DATE_LOCKED" },
  INVALID_MEMBER_ID: { status: 400, message: "INVALID_MEMBER_ID" },
  INVALID_MEMBER_NAME: { status: 400, message: "INVALID_MEMBER_NAME" },
  MEMBERS_REQUIRED: { status: 400, message: "MEMBERS_REQUIRED" },
  DUPLICATE_MEMBER_ID: { status: 400, message: "DUPLICATE_MEMBER_ID" },
  UNKNOWN_MEMBER_IN_ORG: { status: 400, message: "UNKNOWN_MEMBER_IN_ORG" },
};

const CANONICAL_REWARD_GUARD_ERROR_MAP: ProposalErrorMap = {
  REWARD_CALCULATE_MONTH_CLOSE_REQUIRED: {
    status: 400,
    message: "REWARD_CALCULATE_MONTH_CLOSE_REQUIRED",
  },
  REWARD_ADJUST_MONTH_CLOSE_REQUIRED: {
    status: 400,
    message: "REWARD_ADJUST_MONTH_CLOSE_REQUIRED",
  },
  REWARD_ADJUST_REVENUE_BASIS_REQUIRED: {
    status: 400,
    message: "REWARD_ADJUST_REVENUE_BASIS_REQUIRED",
  },
  MONTH_CLOSE_NOT_FOUND: { status: 404, message: "MONTH_CLOSE_NOT_FOUND" },
  REVENUE_BASIS_NOT_FOUND: { status: 404, message: "REVENUE_BASIS_NOT_FOUND" },
  REWARD_CALCULATE_PATH_V22_REQUIRED: {
    status: 409,
    message: "REWARD_CALCULATE_PATH_V22_REQUIRED",
  },
  REWARD_ADJUST_PATH_V22_REQUIRED: {
    status: 409,
    message: "REWARD_ADJUST_PATH_V22_REQUIRED",
  },
  REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE: {
    status: 409,
    message: "REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE",
  },
  REWARD_ADJUST_REQUIRES_FIXED_MONTH_CLOSE: {
    status: 409,
    message: "REWARD_ADJUST_REQUIRES_FIXED_MONTH_CLOSE",
  },
  FIXED_MONTH_CLOSE_IMMUTABLE: { status: 409, message: "FIXED_MONTH_CLOSE_IMMUTABLE" },
  FIXED_MONTH_CLOSE_LINES_IMMUTABLE: {
    status: 409,
    message: "FIXED_MONTH_CLOSE_LINES_IMMUTABLE",
  },
  FIXED_REWARD_RUN_IMMUTABLE: { status: 409, message: "FIXED_REWARD_RUN_IMMUTABLE" },
  FIXED_REWARD_RUN_LINES_IMMUTABLE: {
    status: 409,
    message: "FIXED_REWARD_RUN_LINES_IMMUTABLE",
  },
};

const VALID_PROPOSAL_TYPES: ReadonlySet<string> = new Set<ProposalType>([
  'expense.create', 'expense.update', 'expense.void',
  'income.create', 'income.update',
  'invoice.create', 'invoice.send', 'invoice.mark_paid',
  'reward.calculate', 'reward.adjust',
  'skill.achieve', 'skill.revoke',
  'evaluation.submit', 'evaluation.finalize',
  'assignment.create', 'assignment.update', 'assignment.cancel',
  'leave.request',
  'communication.review', 'communication.task', 'task.revision.request',
  'site.create', 'site.complete',
  'policy.update',
  'member.classification.update',
  // プロフィール閲覧の本人承認 (Phase 2-1)
  'profile.view_request',
  // LUQO評価システム
  'luqo.catalog.add', 'luqo.star.achieve', 'luqo.score.update', 'luqo.reward.calculate',
]);
const DISALLOWED_INTEGRATION_TYPES: ReadonlySet<ProposalType> = new Set<ProposalType>([
  'policy.update',
  'task.revision.request',
]);
const CANONICAL_ROUTE_REQUIRED_ERROR_MAP: ProposalErrorMap = {
  SITE_COMPLETE_CANONICAL_RPC_REQUIRED: {
    status: 409,
    message: "SITE_COMPLETE_CANONICAL_RPC_REQUIRED",
  },
};

function getProposalService(req: AuthenticatedRequest): ProposalService {
  return new ProposalService(req.orgId!);
}

function requireHumanProposalOrgId(req: AuthenticatedRequest): string {
  if (!req.orgId) {
    throw new Error("ORG_CONTEXT_REQUIRED");
  }

  return req.orgId;
}

function isValidProposalType(type: string): type is ProposalType {
  return VALID_PROPOSAL_TYPES.has(type);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCanonicalRouteRequiredProposalType(type: ProposalType): boolean {
  return type === "site.complete";
}

function assertProposalTypeAllowedOnGenericRoutes(type: ProposalType): void {
  if (isCanonicalRouteRequiredProposalType(type)) {
    throw new Error("SITE_COMPLETE_CANONICAL_RPC_REQUIRED");
  }
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function buildDeterministicUuid(seed: string): string {
  const hash = createHash("sha256").update(seed).digest("hex").slice(0, 32).split("");
  hash[12] = "4";
  hash[16] = ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  return err.message.includes("duplicate key value") || err.message.includes("23505");
}

// ============================================================
// Helper: ActorRefを構築
// ============================================================

/**
 * ActorRefを構築（常にhuman）
 * セキュリティ: actor_typeはクライアント入力から受け取らない。
 * AI/systemアクターは内部的に明示構築すること。
 */
function buildActorRef(req: AuthenticatedRequest): ActorRef {
  return {
    type: 'human',
    id: req.userId!,
    name: req.userName || 'Unknown User',
  };
}

function findMappedProposalErrorCode(err: unknown, errorMap: ProposalErrorMap): string | null {
  const errorCode = err instanceof Error ? err.message : '';

  if (errorCode in errorMap) {
    return errorCode;
  }

  return Object.keys(errorMap).find((candidate) => errorCode.includes(candidate)) ?? null;
}

function respondMappedError(res: Response, err: unknown, errorMap: ProposalErrorMap): boolean {
  const mappedCode = findMappedProposalErrorCode(err, errorMap);

  if (!mappedCode) {
    return false;
  }

  const mapped = errorMap[mappedCode];
  res.status(mapped.status).json({
    error: mapped.message,
    code: mappedCode,
  });

  return true;
}

// ============================================================
// CRUD Operations
// ============================================================

/**
 * POST /api/v1/proposals
 * Proposal作成（draft状態）
 */
router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, payload, description, document_id, site_id } = req.body;

    if (!type || !payload || !description) {
      res.status(400).json({ error: "type, payload, description are required" });
      return;
    }

    if (!isPlainObject(payload)) {
      res.status(400).json({ error: "payload must be a JSON object" });
      return;
    }

    if (!isValidProposalType(type)) {
      res.status(400).json({ error: `Invalid proposal type: ${type}` });
      return;
    }

    assertProposalTypeAllowedOnGenericRoutes(type);

    const proposal = await new ProposalService(requireHumanProposalOrgId(req)).create({
      type,
      payload,
      description,
      created_by: buildActorRef(req),
      document_id: normalizeString(document_id),
      site_id: normalizeString(site_id),
    });

    res.status(201).json(proposal);
  } catch (err: any) {
    if (
      respondMappedError(res, err, {
        ...HUMAN_PROPOSAL_ERROR_MAP,
        ...CANONICAL_ROUTE_REQUIRED_ERROR_MAP,
      })
    ) {
      return;
    }

    console.error("Create proposal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/integration
 * integration actor 用の Proposal作成（冪等化: source+external_id）
 */
router.post("/integration", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, payload, description, source, external_id, integration_name, submit = true, document_id, site_id } = req.body as {
      type?: string;
      payload?: Record<string, unknown>;
      description?: string;
      source?: string;
      external_id?: string;
      integration_name?: string;
      submit?: boolean;
      document_id?: string;
      site_id?: string;
    };

    if (!type || !payload || !description || !source || !external_id) {
      res.status(400).json({
        error: "type, payload, description, source, external_id are required",
      });
      return;
    }

    if (!isPlainObject(payload)) {
      res.status(400).json({ error: "payload must be a JSON object" });
      return;
    }

    if (!isValidProposalType(type)) {
      res.status(400).json({ error: `Invalid proposal type: ${type}` });
      return;
    }

    if (DISALLOWED_INTEGRATION_TYPES.has(type)) {
      res.status(400).json({ error: `proposal type is not allowed for integration: ${type}` });
      return;
    }

    assertProposalTypeAllowedOnGenericRoutes(type);

    const normalizedDescription = normalizeString(description);
    const normalizedSource = normalizeString(source);
    const normalizedExternalId = normalizeString(external_id);
    const normalizedIntegrationName = normalizeString(integration_name);
    if (!normalizedDescription || !normalizedSource || !normalizedExternalId) {
      res.status(400).json({
        error: "description, source, external_id must not be empty",
      });
      return;
    }

    const orgId = req.orgId!;
    const proposalId = buildDeterministicUuid(`${orgId}:${normalizedSource}:${normalizedExternalId}`);
    const integrationActorId = `integration:${normalizedSource}`;
    const integrationActorName = normalizedIntegrationName || `Integration(${normalizedSource})`;
    const integrationActor: ActorRef = {
      type: "integration",
      id: integrationActorId,
      name: integrationActorName,
    };
    const integrationMetadata = {
      source: normalizedSource,
      external_id: normalizedExternalId,
    };

    const service = getProposalService(req);
    const input = {
      id: proposalId,
      type,
      payload: {
        ...payload,
        _integration: integrationMetadata,
      },
      description: normalizedDescription,
      created_by: integrationActor,
      org_id: orgId,
      document_id: normalizeString(document_id),
      site_id: normalizeString(site_id),
    };

    if (submit) {
      const result = await service.createAndSubmit(input);
      res.status(201).json({
        proposal: result.proposal,
        auto_approved: result.autoApproved,
        auto_executed: result.autoExecuted,
        submitted: true,
        deduplicated: false,
      });
      return;
    }

    const proposal = await service.create(input);
    res.status(201).json({
      proposal,
      auto_approved: false,
      auto_executed: false,
      submitted: false,
      deduplicated: false,
    });
  } catch (err: unknown) {
    const { source, external_id } = req.body as {
      source?: string;
      external_id?: string;
    };
    const normalizedSource = normalizeString(source);
    const normalizedExternalId = normalizeString(external_id);
    const orgId = req.orgId!;

    if (normalizedSource && normalizedExternalId && isDuplicateKeyError(err)) {
      const proposalId = buildDeterministicUuid(`${orgId}:${normalizedSource}:${normalizedExternalId}`);
      const existing = await getProposalService(req).getById(proposalId);
      if (existing) {
        const submitted = existing.status !== "draft";
        const autoExecuted = existing.status === "executed";
        const autoApproved = existing.status === "approved" || autoExecuted;
        res.status(200).json({
          proposal: existing,
          auto_approved: autoApproved,
          auto_executed: autoExecuted,
          submitted,
          deduplicated: true,
        });
        return;
      }
    }

    if (
      respondMappedError(res, err, {
        ...HUMAN_PROPOSAL_ERROR_MAP,
        ...CANONICAL_REWARD_GUARD_ERROR_MAP,
        ...CANONICAL_ROUTE_REQUIRED_ERROR_MAP,
      })
    ) {
      return;
    }

    console.error("Create integration proposal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/v1/proposals
 * Proposal一覧取得
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, type, site_id, limit, offset } = req.query;

    const proposals = await getProposalService(req).list({
      status: status as ProposalStatus | undefined,
      type: type as ProposalType | undefined,
      siteId: normalizeString(site_id),
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json(proposals);
  } catch (err: any) {
    console.error("List proposals error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/v1/proposals/pending
 * 承認待ちProposal一覧
 */
router.get("/pending", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proposals = await getProposalService(req).getPendingApprovals();
    res.json(proposals);
  } catch (err: any) {
    console.error("Get pending proposals error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/v1/proposals/assigned-to-me
 * 自分が承認担当として割り当てられている pending proposal の一覧 (PR #3 ベルドロワー用)
 */
router.get("/assigned-to-me", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const orgId = req.orgId!;
    const list = await listProposalsAssignedToUser(orgId, req.userId);
    res.json(list);
  } catch (err: any) {
    console.error("Get assigned-to-me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/:id/reassign
 * 「他の人に回す」 — 現在の割当先 reviewer のみ実行可能
 */
router.post("/:id/reassign", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const proposalId = req.params.id as string;
    const orgId = req.orgId!;

    const { data: proposal, error: fetchErr } = await supabaseAdmin
      .from("proposals")
      .select("id, org_id, status, assigned_reviewer_id, reassignment_count, created_by")
      .eq("id", proposalId)
      .eq("org_id", orgId)
      .single();

    if (fetchErr || !proposal) {
      res.status(404).json({ error: "Proposal not found" });
      return;
    }
    if (proposal.status !== "pending") {
      res.status(409).json({ error: "REASSIGN_REQUIRES_PENDING_STATUS" });
      return;
    }
    if (proposal.assigned_reviewer_id !== req.userId) {
      res.status(403).json({ error: "REASSIGN_REQUIRES_CURRENT_ASSIGNEE" });
      return;
    }

    const createdBy = proposal.created_by as { type?: string; id?: string };
    const creatorUserId = createdBy?.type === "human" && typeof createdBy.id === "string" ? createdBy.id : null;

    const result = await reassignReviewer({
      org_id: orgId,
      proposal_id: proposalId,
      current_reviewer_id: req.userId,
      creator_user_id: creatorUserId,
      current_reassignment_count: (proposal.reassignment_count as number) ?? 0,
    });

    if (!result) {
      res.status(409).json({ error: "NO_OTHER_REVIEWER_AVAILABLE" });
      return;
    }
    res.json(result);
  } catch (err: any) {
    console.error("Reassign proposal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/v1/proposals/:id
 * Proposal詳細取得
 */
router.get("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const proposal = await getProposalService(req).getById(id);

    if (!proposal) {
      res.status(404).json({ error: "Proposal not found" });
      return;
    }

    res.json(proposal);
  } catch (err: any) {
    console.error("Get proposal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /api/v1/proposals/:id
 * Proposal削除（draft状態のみ）
 */
router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    await getProposalService(req).delete(id);
    res.status(204).send();
  } catch (err: any) {
    console.error("Delete proposal error:", err);

    const errorMap: ProposalErrorMap = {
      'PROPOSAL_NOT_FOUND': { status: 404, message: "Proposal not found" },
      'CAN_ONLY_DELETE_DRAFT_PROPOSALS': { status: 400, message: "Can only delete draft proposals" },
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Lifecycle Operations
// ============================================================

/**
 * POST /api/v1/proposals/:id/submit
 * Proposal提出（draft → pending）
 * 自動承認の場合は即時approved/executedに遷移
 */
router.post("/:id/submit", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const result = await getProposalService(req).submit(id, buildActorRef(req));

    res.json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
    });
  } catch (err: any) {
    console.error("Submit proposal error:", err);

    const errorMap: ProposalErrorMap = {
      'PROPOSAL_NOT_FOUND': { status: 404, message: "Proposal not found" },
      'PROPOSAL_ALREADY_SUBMITTED': { status: 400, message: "Proposal already submitted" },
      ...CANONICAL_REWARD_GUARD_ERROR_MAP,
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/approve/batch
 * Proposal一括承認
 */
router.post("/approve/batch", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { proposal_ids, reason } = req.body as {
      proposal_ids?: string[];
      reason?: string;
    };

    if (!Array.isArray(proposal_ids) || proposal_ids.length === 0) {
      res.status(400).json({ error: "proposal_ids must be a non-empty array" });
      return;
    }

    if (proposal_ids.length > 100) {
      res.status(400).json({ error: "proposal_ids must contain at most 100 items" });
      return;
    }

    const result = await getProposalService(req).approveBatch(
      proposal_ids,
      buildActorRef(req),
      reason
    );

    res.json({
      total: result.total,
      success_count: result.successCount,
      failed_count: result.failedCount,
      results: result.results.map((item) => ({
        proposal_id: item.proposalId,
        success: item.success,
        proposal: item.proposal,
        is_fully_approved: item.isFullyApproved,
        auto_executed: item.autoExecuted,
        error: item.error,
      })),
    });
  } catch (err: any) {
    console.error("Batch approve proposals error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/:id/approve
 * Proposal承認
 */
router.post("/:id/approve", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;

    const result = await getProposalService(req).approve(
      id,
      buildActorRef(req),
      reason
    );

    res.json({
      proposal: result.proposal,
      is_fully_approved: result.isFullyApproved,
      auto_executed: result.autoExecuted,
    });
  } catch (err: any) {
    console.error("Approve proposal error:", err);

    const errorMap: ProposalErrorMap = {
      'PROPOSAL_NOT_FOUND': { status: 404, message: "Proposal not found" },
      'PROPOSAL_NOT_IN_PENDING_STATE': { status: 400, message: "Proposal is not in pending state" },
      'PROPOSAL_NOT_IN_PROPOSED_STATE': { status: 400, message: "Proposal is not in pending state" },
      'ATOMIC_RPC_REQUIRED': { status: 503, message: "Atomic proposal RPC is required but unavailable" },
      'AI_SELF_APPROVAL_PROHIBITED': { status: 403, message: "AI cannot approve AI-created proposals" },
      'AI_APPROVAL_NOT_ALLOWED_BY_POLICY': { status: 403, message: "AI approval not allowed by policy" },
      'INTEGRATION_APPROVAL_PROHIBITED': { status: 403, message: "Integration actor cannot approve proposals" },
      'APPROVER_NOT_ALLOWED_BY_POLICY': { status: 403, message: "Approver is not allowed by policy" },
      'ALREADY_APPROVED_BY_THIS_ACTOR': { status: 400, message: "Already approved by this actor" },
      'APPROVAL_COUNT_ALREADY_MET': { status: 400, message: "Required approval count already met" },
      ...CANONICAL_REWARD_GUARD_ERROR_MAP,
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/reject/batch
 * Proposal一括却下
 */
router.post("/reject/batch", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { proposal_ids, reason } = req.body as {
      proposal_ids?: string[];
      reason?: string;
    };

    if (!Array.isArray(proposal_ids) || proposal_ids.length === 0) {
      res.status(400).json({ error: "proposal_ids must be a non-empty array" });
      return;
    }

    if (proposal_ids.length > 100) {
      res.status(400).json({ error: "proposal_ids must contain at most 100 items" });
      return;
    }

    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const result = await getProposalService(req).rejectBatch(
      proposal_ids,
      buildActorRef(req),
      reason
    );

    res.json({
      total: result.total,
      success_count: result.successCount,
      failed_count: result.failedCount,
      results: result.results.map((item) => ({
        proposal_id: item.proposalId,
        success: item.success,
        proposal: item.proposal,
        error: item.error,
      })),
    });
  } catch (err: any) {
    console.error("Batch reject proposals error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/:id/reject
 * Proposal却下
 */
router.post("/:id/reject", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body;

    if (!reason) {
      res.status(400).json({ error: "reason is required" });
      return;
    }

    const proposal = await getProposalService(req).reject(id, buildActorRef(req), reason);
    res.json(proposal);
  } catch (err: any) {
    console.error("Reject proposal error:", err);

    const errorMap: ProposalErrorMap = {
      'PROPOSAL_NOT_FOUND': { status: 404, message: "Proposal not found" },
      'PROPOSAL_NOT_IN_PENDING_STATE': { status: 400, message: "Proposal is not in pending state" },
      'PROPOSAL_NOT_IN_PROPOSED_STATE': { status: 400, message: "Proposal is not in pending state" },
      'ATOMIC_RPC_REQUIRED': { status: 503, message: "Atomic proposal RPC is required but unavailable" },
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/:id/instruct
 * 既存提案に対する指示（再提案リクエスト）を作成して提出
 */
router.post("/:id/instruct", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { instruction } = req.body as { instruction?: string };
    const normalizedInstruction = normalizeString(instruction);

    if (!normalizedInstruction) {
      res.status(400).json({ error: "instruction is required" });
      return;
    }

    const target = await getProposalService(req).getById(id);
    if (!target) {
      res.status(404).json({ error: "Proposal not found", code: "PROPOSAL_NOT_FOUND" });
      return;
    }

    if (target.status !== "pending") {
      res.status(400).json({
        error: "Instruction can only be created for pending proposals",
        code: "PROPOSAL_NOT_IN_PENDING_STATE",
      });
      return;
    }

    const payload = isPlainObject(target.payload) ? target.payload : {};
    const sourceMessageId = normalizeString(payload.source_message_id);
    const parentProposalId = normalizeString(payload.parent_proposal_id);

    const result = await getProposalService(req).createAndSubmit({
      type: "task.revision.request",
      payload: {
        target_proposal_id: target.id,
        target_type: target.type,
        target_status: target.status,
        instruction: normalizedInstruction,
        source_message_id: sourceMessageId,
        parent_proposal_id: parentProposalId,
        target_snapshot: {
          description: target.description,
          payload_preview: payload,
        },
      },
      description: `提案への修正指示: ${normalizedInstruction}`,
      created_by: buildActorRef(req),
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      submitted: true,
    });
  } catch (err: any) {
    console.error("Create instruction proposal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/v1/proposals/:id/execute
 * Proposal実行（approved → executed）
 */
router.post("/:id/execute", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const proposal = await getProposalService(req).execute(id, buildActorRef(req));
    res.json(proposal);
  } catch (err: any) {
    console.error("Execute proposal error:", err);

    const errorMap: ProposalErrorMap = {
      'PROPOSAL_NOT_FOUND': { status: 404, message: "Proposal not found" },
      'PROPOSAL_NOT_APPROVED': { status: 400, message: "Proposal is not approved" },
      'INSUFFICIENT_APPROVALS': { status: 400, message: "Insufficient approvals for execution" },
      'POLICY_APPROVER_REQUIREMENTS_NOT_MET': { status: 400, message: "Policy approver requirements not met" },
      'ATOMIC_RPC_REQUIRED': { status: 503, message: "Atomic proposal RPC is required but unavailable" },
      ...CANONICAL_REWARD_GUARD_ERROR_MAP,
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: "Internal server error" });
  }
});

// ============================================================
// Convenience Endpoints
// ============================================================

/**
 * POST /api/v1/proposals/create-and-submit
 * 作成と提出を一度に行う便利エンドポイント
 */
router.post("/create-and-submit", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { type, payload, description } = req.body;

    if (!type || !payload || !description) {
      res.status(400).json({ error: "type, payload, description are required" });
      return;
    }

    if (!isPlainObject(payload)) {
      res.status(400).json({ error: "payload must be a JSON object" });
      return;
    }

    if (!isValidProposalType(type)) {
      res.status(400).json({ error: `Invalid proposal type: ${type}` });
      return;
    }

    assertProposalTypeAllowedOnGenericRoutes(type);

    const result = await new ProposalService(requireHumanProposalOrgId(req)).createAndSubmit({
      type,
      payload,
      description,
      created_by: buildActorRef(req),
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
    });
  } catch (err: any) {
    if (
      respondMappedError(res, err, {
        ...HUMAN_PROPOSAL_ERROR_MAP,
        ...CANONICAL_REWARD_GUARD_ERROR_MAP,
        ...CANONICAL_ROUTE_REQUIRED_ERROR_MAP,
      })
    ) {
      return;
    }

    console.error("Create and submit proposal error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
