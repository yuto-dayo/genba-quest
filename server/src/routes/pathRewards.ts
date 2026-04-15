import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { ProposalService } from "../services/ProposalService";
import { ActorRef } from "../services/PolicyEngine";
import { PathRewardService } from "../services/PathRewardService";

const router = Router();
const DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID || "00000000-0000-0000-0000-000000000001";

function getOrgId(req: AuthenticatedRequest): string {
  return req.orgId || DEFAULT_ORG_ID;
}

function buildActorRef(req: AuthenticatedRequest): ActorRef {
  return {
    type: "human",
    id: req.userId!,
    name: req.userName || "Unknown User",
  };
}

function createPathRewardService(req: AuthenticatedRequest): PathRewardService {
  return new PathRewardService(getOrgId(req));
}

function createProposalService(req: AuthenticatedRequest): ProposalService {
  return new ProposalService(getOrgId(req));
}

function normalizeLimit(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.min(Math.floor(parsed), 200);
}

function handlePathRewardError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const badRequestCodes = new Set([
    "INVALID_MONTH_FORMAT",
    "MEMBERS_REQUIRED",
    "NON_POSITIVE_PROFIT_AMOUNT",
    "INVALID_MEMBER_ID",
    "INVALID_MEMBER_NAME",
    "INVALID_WORK_DAYS",
    "INVALID_LEVEL",
    "INVALID_A_SCORE",
    "INVALID_R_SCORE",
    "INVALID_Q_SCORE",
    "BASE_WEIGHT_REQUIRED",
    "INVALID_WEIGHT_TOTAL",
    "INVALID_MONTHLY_POINT_TOTAL",
    "INVALID_MONEY_VALUE",
  ]);

  if (badRequestCodes.has(code)) {
    res.status(400).json({ error: code });
    return;
  }

  console.error("[PATH_REWARD] error:", error);
  res.status(500).json({ error: "Internal server error" });
}

router.post("/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const preview = createPathRewardService(req).calculatePreview(req.body);
    res.json(preview);
  } catch (error) {
    handlePathRewardError(res, error);
  }
});

router.post("/proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const rewardService = createPathRewardService(req);
    const preview = rewardService.calculatePreview(req.body);
    const proposalService = createProposalService(req);
    const description =
      typeof req.body?.description === "string" && req.body.description.trim().length > 0
        ? req.body.description.trim()
        : `${preview.month} PATH報酬計算`;

    const result = await proposalService.createAndSubmit({
      type: "reward.calculate",
      payload: rewardService.buildProposalPayload(preview),
      description,
      created_by: buildActorRef(req),
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      preview,
    });
  } catch (error) {
    handlePathRewardError(res, error);
  }
});

router.get("/calculations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const calculations = await createPathRewardService(req).listSnapshots({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      proposal_id: typeof req.query.proposal_id === "string" ? req.query.proposal_id : undefined,
      limit: normalizeLimit(req.query.limit),
    });

    res.json({ calculations });
  } catch (error) {
    handlePathRewardError(res, error);
  }
});

export default router;
