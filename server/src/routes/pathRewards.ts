import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { ProposalService } from "../services/ProposalService";
import { ActorRef } from "../services/PolicyEngine";
import { PathRewardService } from "../services/PathRewardService";

const router = Router();

const PATH_REWARD_ERROR_STATUS_MAP: Record<string, number> = {
  INVALID_MONTH_FORMAT: 400,
  MEMBERS_REQUIRED: 400,
  NON_POSITIVE_PROFIT_AMOUNT: 400,
  INVALID_MEMBER_ID: 400,
  INVALID_MEMBER_NAME: 400,
  INVALID_WORK_DAYS: 400,
  INVALID_LEVEL: 400,
  INVALID_A_SCORE: 400,
  INVALID_R_SCORE: 400,
  INVALID_Q_SCORE: 400,
  BASE_WEIGHT_REQUIRED: 400,
  INVALID_WEIGHT_TOTAL: 400,
  INVALID_MONTHLY_POINT_TOTAL: 400,
  INVALID_MONEY_VALUE: 400,
  REWARD_CALCULATE_MONTH_CLOSE_REQUIRED: 400,
  REWARD_ADJUST_MONTH_CLOSE_REQUIRED: 400,
  REWARD_ADJUST_REVENUE_BASIS_REQUIRED: 400,
  ORG_CONTEXT_REQUIRED: 403,
  MONTH_CLOSE_NOT_FOUND: 404,
  REVENUE_BASIS_NOT_FOUND: 404,
  REWARD_CALCULATE_PATH_V22_REQUIRED: 409,
  REWARD_ADJUST_PATH_V22_REQUIRED: 409,
  REWARD_CALCULATE_REQUIRES_FIXED_MONTH_CLOSE: 409,
  REWARD_ADJUST_REQUIRES_FIXED_MONTH_CLOSE: 409,
  FIXED_MONTH_CLOSE_IMMUTABLE: 409,
  FIXED_MONTH_CLOSE_LINES_IMMUTABLE: 409,
  FIXED_REWARD_RUN_IMMUTABLE: 409,
  FIXED_REWARD_RUN_LINES_IMMUTABLE: 409,
  LEGACY_WRITE_FROZEN: 409,
};

function getOrgId(req: AuthenticatedRequest): string {
  if (!req.orgId) {
    throw new Error("ORG_CONTEXT_REQUIRED");
  }

  return req.orgId;
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

function findMappedErrorCode(message: string): string | null {
  if (message in PATH_REWARD_ERROR_STATUS_MAP) {
    return message;
  }

  return Object.keys(PATH_REWARD_ERROR_STATUS_MAP).find((code) => message.includes(code)) ?? null;
}

function handlePathRewardError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const mappedCode = findMappedErrorCode(code);

  if (mappedCode) {
    res.status(PATH_REWARD_ERROR_STATUS_MAP[mappedCode]).json({ error: mappedCode });
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
    res.status(409).json({
      error: "LEGACY_WRITE_FROZEN",
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
