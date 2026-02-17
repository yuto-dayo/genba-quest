/**
 * Proposals API Router
 * DAO設計原則: 全状態変更はProposal経由で記録し監査可能に
 * 参照: docs/PROPOSAL_SYSTEM.md
 */

import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { ProposalService } from "../services/ProposalService";
import { ActorRef, ProposalType, ProposalStatus } from "../services/PolicyEngine";

const router = Router();
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || '00000000-0000-0000-0000-000000000001';

function getProposalService(req: AuthenticatedRequest): ProposalService {
  return new ProposalService(req.orgId || DEFAULT_ORG_ID);
}

// ============================================================
// Helper: ActorRefを構築
// ============================================================

function buildActorRef(req: AuthenticatedRequest, overrideType?: 'ai' | 'system' | 'integration'): ActorRef {
  return {
    type: overrideType || 'human',
    id: req.userId!,
    name: req.userName || 'Unknown User',
  };
}

type ProposalErrorMap = Record<string, { status: number; message: string }>;

function respondMappedError(res: Response, err: unknown, errorMap: ProposalErrorMap): boolean {
  const errorCode = err instanceof Error ? err.message : '';
  const mapped = errorMap[errorCode];

  if (!mapped) {
    return false;
  }

  res.status(mapped.status).json({
    error: mapped.message,
    code: errorCode,
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
    const { type, payload, description, actor_type } = req.body;

    if (!type || !payload || !description) {
      res.status(400).json({ error: "type, payload, description are required" });
      return;
    }

    const proposal = await getProposalService(req).create({
      type: type as ProposalType,
      payload,
      description,
      created_by: buildActorRef(req, actor_type),
    });

    res.status(201).json(proposal);
  } catch (err: any) {
    console.error("Create proposal error:", err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/v1/proposals
 * Proposal一覧取得
 */
router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { status, type, limit, offset } = req.query;

    const proposals = await getProposalService(req).list({
      status: status as ProposalStatus | undefined,
      type: type as ProposalType | undefined,
      limit: limit ? parseInt(limit as string, 10) : undefined,
      offset: offset ? parseInt(offset as string, 10) : undefined,
    });

    res.json(proposals);
  } catch (err: any) {
    console.error("List proposals error:", err);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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

    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// Lifecycle Operations
// ============================================================

/**
 * POST /api/v1/proposals/:id/submit
 * Proposal提出（draft → proposed）
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
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/proposals/approve/batch
 * Proposal一括承認
 */
router.post("/approve/batch", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { proposal_ids, reason, actor_type } = req.body as {
      proposal_ids?: string[];
      reason?: string;
      actor_type?: 'ai' | 'system' | 'integration';
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
      buildActorRef(req, actor_type),
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
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/v1/proposals/:id/approve
 * Proposal承認
 */
router.post("/:id/approve", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason, actor_type } = req.body;

    const result = await getProposalService(req).approve(
      id,
      buildActorRef(req, actor_type),
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
      'PROPOSAL_NOT_IN_PROPOSED_STATE': { status: 400, message: "Proposal is not in proposed state" },
      'AI_SELF_APPROVAL_PROHIBITED': { status: 403, message: "AI cannot approve AI-created proposals" },
      'AI_APPROVAL_NOT_ALLOWED_BY_POLICY': { status: 403, message: "AI approval not allowed by policy" },
      'INTEGRATION_APPROVAL_PROHIBITED': { status: 403, message: "Integration actor cannot approve proposals" },
      'APPROVER_NOT_ALLOWED_BY_POLICY': { status: 403, message: "Approver is not allowed by policy" },
      'ALREADY_APPROVED_BY_THIS_ACTOR': { status: 400, message: "Already approved by this actor" },
      'APPROVAL_COUNT_ALREADY_MET': { status: 400, message: "Required approval count already met" },
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
      'PROPOSAL_NOT_IN_PROPOSED_STATE': { status: 400, message: "Proposal is not in proposed state" },
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: err.message });
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
    };

    if (respondMappedError(res, err, errorMap)) {
      return;
    }

    res.status(500).json({ error: err.message });
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
    const { type, payload, description, actor_type } = req.body;

    if (!type || !payload || !description) {
      res.status(400).json({ error: "type, payload, description are required" });
      return;
    }

    const result = await getProposalService(req).createAndSubmit({
      type: type as ProposalType,
      payload,
      description,
      created_by: buildActorRef(req, actor_type),
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
    });
  } catch (err: any) {
    console.error("Create and submit proposal error:", err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
