/**
 * Design Principles API Router
 * Think Again × Thompson Sampling: 設計原則のベイズ的確信度を公開
 * 参照: docs/DESIGN_PHILOSOPHY.md
 */

import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { PrincipleService, PrincipleStatus } from "../services/PrincipleService";
import { ActorRef } from "../services/PolicyEngine";

const router = Router();
router.use(requireOrgMembership("member"));

function getPrincipleService(req: AuthenticatedRequest): PrincipleService {
  return new PrincipleService(req.orgId!);
}

function normalizeParam(value: string | string[] | undefined): string | null {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return null;
}

// ============================================================
// GET /api/v1/principles - 全原則の確信度一覧
// ============================================================

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const service = getPrincipleService(req);
    const status = req.query.status as PrincipleStatus | undefined;
    const principles = await service.listPrinciples(status);
    res.json({ data: principles });
  } catch (err) {
    console.error("[PRINCIPLES] List failed:", err);
    res.status(500).json({ error: "Failed to list principles" });
  }
});

// ============================================================
// GET /api/v1/principles/:name - 特定原則の確信度
// ============================================================

router.get("/:name", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = normalizeParam(req.params.name);
    if (!name) {
      res.status(400).json({ error: "Invalid principle name" });
      return;
    }

    const service = getPrincipleService(req);
    const principle = await service.getPrinciple(name);
    if (!principle) {
      res.status(404).json({ error: "Principle not found" });
      return;
    }
    res.json({ data: principle });
  } catch (err) {
    console.error("[PRINCIPLES] Get failed:", err);
    res.status(500).json({ error: "Failed to get principle" });
  }
});

// ============================================================
// GET /api/v1/principles/:name/observations - 観測履歴
// ============================================================

router.get("/:name/observations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = normalizeParam(req.params.name);
    if (!name) {
      res.status(400).json({ error: "Invalid principle name" });
      return;
    }

    const service = getPrincipleService(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const observations = await service.getObservations(name, limit);
    res.json({ data: observations });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'PRINCIPLE_NOT_FOUND') {
      res.status(404).json({ error: "Principle not found" });
      return;
    }
    console.error("[PRINCIPLES] Observations list failed:", err);
    res.status(500).json({ error: "Failed to list observations" });
  }
});

// ============================================================
// POST /api/v1/principles/:name/observations - 観測を記録
// ============================================================

router.post("/:name/observations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const name = normalizeParam(req.params.name);
    if (!name) {
      res.status(400).json({ error: "Invalid principle name" });
      return;
    }

    const { outcome, reason, proposal_id } = req.body;

    if (typeof outcome !== 'boolean') {
      res.status(400).json({ error: "outcome (boolean) is required" });
      return;
    }
    if (!reason || typeof reason !== 'string') {
      res.status(400).json({ error: "reason (string) is required" });
      return;
    }

    const observedBy: ActorRef = {
      type: 'system',
      id: req.userId!,
      name: req.userName || 'System',
    };

    const service = getPrincipleService(req);
    const observation = await service.recordObservation({
      principleName: name,
      outcome,
      reason,
      observedBy,
      proposalId: proposal_id,
    });

    res.status(201).json({ data: observation });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'PRINCIPLE_NOT_FOUND') {
      res.status(404).json({ error: "Principle not found" });
      return;
    }
    console.error("[PRINCIPLES] Record observation failed:", err);
    res.status(500).json({ error: "Failed to record observation" });
  }
});

export default router;
