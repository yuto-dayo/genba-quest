import { Request, Router, Response } from "express";
import { resolveActiveOrgMembership } from "../lib/orgAccess";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { validateReportingMonth } from "../lib/reportingMonth";
import { DeterministicPathReviewer } from "../services/DeterministicPathReviewer";
import { MonthCloseReminderService } from "../services/MonthCloseReminderService";
import { ProposalService } from "../services/ProposalService";
import { PathGovernedModuleService } from "../services/PathGovernedModuleService";
import {
  PATH_POLICY_BUNDLE_KEY,
  PathPolicyBundleService,
  PathTradeFamily,
} from "../services/PathPolicyBundleService";
import { ActorRef } from "../services/PolicyEngine";
import { PathV31Service } from "../services/PathV31Service";
import { PathV32SimpleRewardService } from "../services/PathV32SimpleRewardService";
import { PathV33RewardService } from "../services/PathV33RewardService";
import { PathV33ObjectionService } from "../services/PathV33ObjectionService";
import { PathV33MonthService } from "../services/PathV33MonthService";
import { assertV22WriteAllowed } from "../lib/pathV31Config";

const router = Router();
router.use(requireOrgMembership("member"));

const PATH_MODULE_ERROR_STATUS_MAP: Record<string, number> = {
  INVALID_MONTH_FORMAT: 400,
  INVALID_MEMBER_ID: 400,
  INVALID_LEVEL: 400,
  INVALID_A_SCORE: 400,
  INVALID_R_SCORE: 400,
  INVALID_Q_SCORE: 400,
  INVALID_MONEY_VALUE: 400,
  INVALID_RESPONSIBILITY_SHARE: 400,
  INVALID_STD_HOURS: 400,
  INVALID_WEIGHT_TOTAL: 400,
  INVALID_MONTHLY_POINT_TOTAL: 400,
  BASE_WEIGHT_REQUIRED: 400,
  MEMBERS_REQUIRED: 400,
  INVALID_TRADE_FAMILY: 400,
  INVALID_SKILL_STATUS: 400,
  REWARD_RUN_NOT_FOUND: 400,
  REWARD_RUN_MONTH_MISSING: 400,
  CLOSED_PERIOD_MUTATION_PROHIBITED: 400,
  REWARD_CALCULATE_MONTH_CLOSE_REQUIRED: 400,
  REWARD_ADJUST_MONTH_CLOSE_REQUIRED: 400,
  REWARD_ADJUST_REVENUE_BASIS_REQUIRED: 400,
  ORG_CONTEXT_REQUIRED: 403,
  ORG_ROLE_REQUIRED: 403,
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
  PATH_CANONICAL_PROJECTION_DIFF_HARD_FAIL: 409,
  PATH_V31_CUTOVER_ENFORCED: 409,
  SITE_CLOSE_REOPEN_REQUIRED: 409,
  DAY_LOG_LOCKED: 409,
  SITE_CLOSE_NOT_FOUND: 404,
  SITE_CLOSE_NOT_FINALIZED: 409,
  SITE_CLOSE_ACTIVE_PROPOSAL_EXISTS: 409,
  INVALID_SITE_CLOSE_ID: 400,
  INVALID_SITE_ID: 400,
  PATH_V33_INVALID_TIER: 400,
  PATH_V33_INVALID_TEAM_SIZE: 400,
  PATH_V33_HUMAN_ACTOR_REQUIRED: 403,
  PATH_V33_OBJECTION_REASON_REQUIRED: 400,
  PATH_V33_OBJECTION_NO_CHANGE: 400,
  PATH_V33_OBJECTION_LOCKED_DRAFT: 409,
  PATH_V33_OBJECTION_NOT_OPEN: 409,
  PATH_V33_OBJECTION_NOT_FOUND: 404,
  PATH_V33_TARGET_CANNOT_COSIGN: 403,
  PATH_V33_ALREADY_COSIGNED: 409,
  PATH_V33_NOT_TARGET_MEMBER: 403,
  PATH_V33_DRAFT_NOT_FOUND: 404,
  PATH_V33_DRAFT_LOCKED: 409,
  PATH_V33_DRAFT_DEADLINE_PASSED: 409,
  PATH_V33_REVISION_REASON_REQUIRED: 400,
  PATH_V33_REVISION_REASON_TOO_LONG: 400,
  PATH_V33_DRAFT_OWNER_MISMATCH: 403,
  PATH_V33_CANNOT_OBJECT_OWN_DRAFT: 403,
  INVALID_DRAFT_ID: 400,
  INVALID_OBJECTION_ID: 400,
  INVALID_OBJECTOR_ID: 400,
  INVALID_SIGNER_ID: 400,
  INVALID_RESPONDER_ID: 400,
  INVALID_DATE_FORMAT: 400,
  INVALID_CREDITED_UNIT: 400,
  INVALID_CREDITED_UNIT_INCREMENT: 400,
  INVALID_PARTICIPATION_UNITS: 400,
  INVALID_RESPONSIBILITY_LEVEL: 400,
  INVALID_REWARD_INPUT_ID: 400,
  INVALID_ROLE_PLAN_ID: 400,
  INVALID_ROLE_SHARES: 400,
  INVALID_REWORK_UNITS: 400,
  INVALID_FIXED_TEMPLATE_KEY: 400,
  INVALID_FIXED_TEMPLATE_RATIO_TOTAL: 400,
  FIXED_TEMPLATE_MEMBERS_REQUIRED: 400,
  FIXED_TEMPLATE_MEMBER_COUNT_MISMATCH: 400,
  DAY_LOGS_REQUIRED: 400,
  DAY_LOGS_NOT_FOUND: 404,
  DAY_LOG_MEMBER_FORBIDDEN: 403,
  SITE_NOT_FOUND: 404,
  SITE_COMPLETED_DAY_LOG_IMMUTABLE: 409,
  DAY_LOG_SITE_MISMATCH: 400,
  INVALID_SITE_CLOSE_STATUS: 400,
  CANDIDATES_REQUIRED: 400,
  NO_ELIGIBLE_CANDIDATES: 409,
  PATH_V32_ZERO_TOTAL_WEIGHT: 409,
  PATH_LEVEL_UPDATE_FIXED_MONTH_REJECTED: 409,
};

function getOrgId(req: AuthenticatedRequest): string {
  if (!req.orgId) {
    throw new Error("ORG_CONTEXT_REQUIRED");
  }

  return req.orgId;
}

function buildHumanActor(req: AuthenticatedRequest): ActorRef {
  return {
    type: "human",
    id: req.userId!,
    name: req.userName || "Unknown User",
  };
}

function getPathModuleService(req: AuthenticatedRequest): PathGovernedModuleService {
  return new PathGovernedModuleService(getOrgId(req));
}

function resolveSelfRewardMemberId(
  members: Array<{ member_id: string }>,
  membershipId?: string | null,
  userId?: string | null,
): string | null {
  if (membershipId && members.some((member) => member.member_id === membershipId)) {
    return membershipId;
  }

  if (userId && members.some((member) => member.member_id === userId)) {
    return userId;
  }

  return membershipId ?? userId ?? null;
}

function getPathV31Service(req: AuthenticatedRequest): PathV31Service {
  return new PathV31Service(getOrgId(req));
}

function getPathV32SimpleRewardService(req: AuthenticatedRequest): PathV32SimpleRewardService {
  return new PathV32SimpleRewardService(getOrgId(req));
}

function getPathV33RewardService(req: AuthenticatedRequest): PathV33RewardService {
  return new PathV33RewardService(getOrgId(req));
}

function getPathV33ObjectionService(req: AuthenticatedRequest): PathV33ObjectionService {
  return new PathV33ObjectionService(getOrgId(req));
}

function getPathV33MonthService(req: AuthenticatedRequest): PathV33MonthService {
  return new PathV33MonthService(getOrgId(req));
}

function getPolicyService(req: AuthenticatedRequest): PathPolicyBundleService {
  return new PathPolicyBundleService(getOrgId(req));
}

function getProposalService(req: AuthenticatedRequest): ProposalService {
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

function getRouteParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function findMappedErrorCode(message: string): string | null {
  if (message in PATH_MODULE_ERROR_STATUS_MAP) {
    return message;
  }

  return Object.keys(PATH_MODULE_ERROR_STATUS_MAP).find((code) => message.includes(code)) ?? null;
}

function handleError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const mappedCode = findMappedErrorCode(code);

  if (mappedCode) {
    res.status(PATH_MODULE_ERROR_STATUS_MAP[mappedCode]).json({
      error: mappedCode,
      code: mappedCode,
      message: mappedCode,
    });
    return;
  }

  console.error("[PATH_MODULE] error:", error);
  res.status(500).json({ error: "Internal server error" });
}

export async function handleMonthCloseReminder(req: Request, res: Response): Promise<void> {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await new MonthCloseReminderService().remindClose({
      month: typeof body.month === "string" ? body.month : undefined,
      force: body.force === true,
    });
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
}

router.get("/policy-bundles", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const bundles = await getPolicyService(req).listBundles({
      activeOnly: req.query.active_only === "true",
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ bundles, bundle_key: PATH_POLICY_BUNDLE_KEY });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/policy-bundles/proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const payload = getPolicyService(req).buildPublishPayload(req.body, actor);
    const effectiveFrom =
      typeof payload.effective_from === "string" ? payload.effective_from : "unknown";
    const result = await getProposalService(req).createAndSubmit({
      type: "policy.update",
      description: `${effectiveFrom} PATH policy publish`,
      payload,
      created_by: actor,
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/monthly-close-inputs", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const inputs = await getPathModuleService(req).listMonthlyCloseInputs({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ inputs });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/monthly-close-inputs", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const input = await getPathModuleService(req).upsertMonthlyCloseInput(
      req.body,
      buildHumanActor(req),
    );
    res.status(201).json({ input });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/evidence", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const evidence = await getPathModuleService(req).listEvidence({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      trade_family:
        typeof req.query.trade_family === "string"
          ? (req.query.trade_family as PathTradeFamily)
          : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ evidence });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/evidence", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const evidence = await getPathModuleService(req).recordEvidence(req.body, buildHumanActor(req));
    res.status(201).json({ evidence });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/ai-annotations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const annotations = await getPathModuleService(req).listAiAnnotations({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      reviewer_kind:
        req.query.reviewer_kind === "A" || req.query.reviewer_kind === "B"
          ? req.query.reviewer_kind
          : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ annotations });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/ai-annotations/generate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    assertV22WriteAllowed({ month });
    const member_id = typeof req.body?.member_id === "string" ? req.body.member_id : "";
    const reviewer = req.body?.reviewer_kind === "B" ? "B" : "A";
    const service = getPathModuleService(req);
    const deterministicReviewer = new DeterministicPathReviewer();

    const [inputs, evidence] = await Promise.all([
      service.listMonthlyCloseInputs({ month, member_id, limit: 1 }),
      service.listEvidence({ month, member_id, limit: 200 }),
    ]);

    const monthlyInput = inputs[0] || null;
    const tradeFamilies = Object.keys(monthlyInput?.trade_family_observations ?? {}) as PathTradeFamily[];
    const reviewerA =
      reviewer === "B"
        ? deterministicReviewer.reviewA({
            month,
            member_id,
            trade_families: tradeFamilies,
            evidence,
            monthly_form_comment: monthlyInput?.comment,
          })
        : null;

    const annotation =
      reviewer === "A"
        ? deterministicReviewer.reviewA({
            month,
            member_id,
            trade_families: tradeFamilies,
            evidence,
            monthly_form_comment: monthlyInput?.comment,
          })
        : deterministicReviewer.reviewB({
            trade_families: tradeFamilies,
            evidence,
            reviewerA: reviewerA!,
          });

    const annotationRecord = annotation as unknown as Record<string, unknown>;
    const saved = await service.upsertAiAnnotation(
      {
        month,
        member_id,
        reviewer_kind: reviewer,
        adapter_key: "deterministic-fixture",
        annotation: annotationRecord,
        supporting_evidence_ids:
          reviewer === "A"
            ? (annotationRecord.supporting_evidence_ids as string[] | undefined)
            : [],
        challenged_evidence_ids:
          reviewer === "B"
            ? (annotationRecord.challenged_evidence_ids as string[] | undefined)
            : [],
      },
      {
        type: "ai",
        id: `path-reviewer-${reviewer.toLowerCase()}`,
        name: `PATH Reviewer ${reviewer} (deterministic)`,
      },
    );

    res.status(201).json({ annotation: saved });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/month-close-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const payload = await getPathModuleService(req).buildMonthlyCloseProposalPayload(req.body);
    const month = typeof payload.month === "string" ? payload.month : "unknown";
    const result = await getProposalService(req).createAndSubmit({
      type: "evaluation.finalize",
      description: `${month} PATH month close`,
      payload,
      created_by: actor,
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/reward-run/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const monthCloseId = typeof req.body?.month_close_id === "string" ? req.body.month_close_id : "";
    const result = await getPathModuleService(req).previewRewardRunByMonthCloseId(monthCloseId);
    res.json({
      preview: result.preview,
      existing_reward_run: result.existing_reward_run,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/reward-run/proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const monthCloseId = typeof req.body?.month_close_id === "string" ? req.body.month_close_id : "";
    if (!monthCloseId) {
      throw new Error("REWARD_CALCULATE_MONTH_CLOSE_REQUIRED");
    }
    const actor = buildHumanActor(req);
    const prepared = await getPathModuleService(req).prepareRewardRunProposalByMonthCloseId(
      monthCloseId,
      actor,
    );
    if (typeof prepared.preview?.month === "string") {
      assertV22WriteAllowed({ month: prepared.preview.month });
    }

    if (prepared.existing_proposal || prepared.existing_reward_run) {
      res.status(200).json({
        proposal: prepared.existing_proposal,
        auto_approved: prepared.existing_proposal?.status === "approved",
        auto_executed: prepared.existing_proposal?.status === "executed",
        preview: prepared.preview,
        existing_reward_run: prepared.existing_reward_run,
        reused_existing: true,
      });
      return;
    }

    const result = await getProposalService(req).createAndSubmit({
      type: "reward.calculate",
      description: `${prepared.preview.month} PATH reward run`,
      payload: prepared.payload,
      created_by: actor,
      idempotency_key: prepared.idempotency_key,
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      preview: prepared.preview,
      existing_reward_run: null,
      reused_existing: false,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/trade-endorsement-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    if (month) {
      assertV22WriteAllowed({ month });
    }
    const actor = buildHumanActor(req);
    const payload = await getPathModuleService(req).buildTradeEndorsementProposalPayload(req.body);
    const description =
      typeof payload.trade_family === "string"
        ? `${payload.trade_family} endorsement ${payload.skill_status}`
        : "PATH trade endorsement";
    const result = await getProposalService(req).createAndSubmit({
      type: req.body?.action === "revoke" ? "skill.revoke" : "skill.achieve",
      description,
      payload,
      created_by: actor,
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/reward-adjustment-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const payload = await getPathModuleService(req).buildRewardAdjustmentProposalPayload(
      req.body,
      actor,
    );
    const result = await getProposalService(req).createAndSubmit({
      type: "reward.adjust",
      description: `${payload.target_month} PATH ${payload.run_type}`,
      payload,
      created_by: actor,
    });

    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/day-logs", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await getPathV31Service(req).listDayLogs({
      site_id: typeof req.query.site_id === "string" ? req.query.site_id : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      from: typeof req.query.from === "string" ? req.query.from : undefined,
      to: typeof req.query.to === "string" ? req.query.to : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ logs });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/day-logs", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const log = await getPathV31Service(req).upsertDayLog(req.body, buildHumanActor(req));
    res.status(200).json({ log });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/site-closes", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const site_closes = await getPathV31Service(req).listSiteCloses({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      site_id: typeof req.query.site_id === "string" ? req.query.site_id : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ site_closes });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/site-closes", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const membership = await resolveActiveOrgMembership(req, "admin");
    const actor = buildHumanActor(req);
    const service = new PathV31Service(membership.org_id);
    const payload = await service.buildSiteCloseProposalPayload(req.body, actor);
    const result = await new ProposalService(membership.org_id).createAndSubmit({
      type: "site.close.finalize",
      description: `PATH site close ${String(payload.site_id ?? "").slice(0, 8)}`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      preview: payload.calculation_snapshot,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/site-close-reopen-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const payload = await getPathV31Service(req).buildSiteCloseReopenProposalPayload(req.body, actor);
    const result = await getProposalService(req).createAndSubmit({
      type: "site.close.reopen",
      description: `PATH site close reopen ${String(payload.site_close_id ?? "").slice(0, 8)}`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/monthly-distribution/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    const preview = await getPathV31Service(req).previewMonthlyDistribution(month);
    res.json({ preview });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/monthly-distribution/proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    const payload = await getPathV31Service(req).buildMonthlyDistributionProposalPayload(month, actor);
    const result = await getProposalService(req).createAndSubmit({
      type: "reward.calculate",
      description: `${month} PATH monthly distribution`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      preview: payload.calculation_snapshot,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/monthly-distribution-v32/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    const preview = await getPathV32SimpleRewardService(req).previewMonthlyDistribution(month);
    res.json({ preview });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/monthly-distribution-v32/proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    const payload = await getPathV32SimpleRewardService(req).buildMonthlyDistributionProposalPayload(month, actor);
    const result = await getProposalService(req).createAndSubmit({
      type: "reward.calculate",
      description: `${month} PATH V3.2 Simple monthly distribution`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      preview: payload.calculation_snapshot,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/reward-pool-adjustment-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const payload = getPathV32SimpleRewardService(req).buildPoolAdjustmentProposalPayload(req.body, actor);
    const result = await getProposalService(req).createAndSubmit({
      type: "reward.pool.adjust",
      description: `${payload.month} PATH pool adjustment`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/reward-member-adjustment-v32-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const payload = getPathV32SimpleRewardService(req).buildMemberAdjustmentProposalPayload(req.body, actor);
    const result = await getProposalService(req).createAndSubmit({
      type: "reward.adjust",
      description: `${payload.target_month} PATH member correction`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/level-update-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const payload = await getPathV32SimpleRewardService(req).buildLevelUpdateProposalPayload(req.body, actor);
    const result = await getProposalService(req).createAndSubmit({
      type: "path.level.update",
      description: `${payload.effective_month} PATH level update`,
      payload,
      created_by: actor,
    });
    res.status(201).json({
      proposal: result.proposal,
      auto_approved: result.autoApproved,
      auto_executed: result.autoExecuted,
      payload,
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/members/:memberId/experience", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const experience = await getPathV31Service(req).getMemberExperience(
      getRouteParam(req.params.memberId as string | string[] | undefined),
    );
    res.json({ experience });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/lead-assignments/recommendation", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const result = await getPathV31Service(req).recommendLeadAssignment(req.body, buildHumanActor(req));
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/members/:memberId/reward-explanation", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const explanation = await getPathModuleService(req).getMemberRewardExplanation(
      getRouteParam(req.params.memberId as string | string[] | undefined),
      month,
    );
    res.json({ explanation });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/reward-confirmation", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const memberId = typeof req.query.member_id === "string" ? req.query.member_id : "";
    const summary = await getPathModuleService(req).getRewardConfirmationSummary(month, memberId);
    res.json({ summary });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/team-reward-summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const monthValidation = validateReportingMonth(req.query.month);
    if (!monthValidation.ok) {
      res.status(monthValidation.status).json({ error: monthValidation.error });
      return;
    }

    const membership = await resolveActiveOrgMembership(req, "member");
    req.orgId = membership.org_id;
    req.orgMembershipId = membership.id ?? null;
    const summary = await getPathModuleService(req).getTeamRewardSummary(monthValidation.month);
    res.json({
      ...summary,
      self_member_id: resolveSelfRewardMemberId(
        summary.members,
        membership.id ?? null,
        membership.user_id ?? req.userId ?? null,
      ),
    });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/reward-confirmation/qa", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const answer = await getPathModuleService(req).answerRewardConfirmationQuestion({
      month: typeof req.body?.month === "string" ? req.body.month : "",
      member_id: typeof req.body?.member_id === "string" ? req.body.member_id : "",
      site_id: typeof req.body?.site_id === "string" ? req.body.site_id : null,
      question: typeof req.body?.question === "string" ? req.body.question : "",
    });
    res.json({ answer });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/members/:memberId/profile", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profile = await getPathModuleService(req).getMemberCurrentProfile(
      getRouteParam(req.params.memberId as string | string[] | undefined),
    );
    res.json(profile);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/pending-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const proposals = await getPathModuleService(req).listPendingProposalQueue(
      normalizeLimit(req.query.limit) ?? 50,
    );
    res.json({ proposals });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/audit-trail", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const events = await getPathModuleService(req).listAuditTrail(
      normalizeLimit(req.query.limit) ?? 100,
    );
    res.json({ events });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/month-close-summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const summary = await getPathModuleService(req).getMonthCloseSummary(month);
    res.json(summary);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/site-item-profit-summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const summary = await getPathModuleService(req).listSiteItemProfitSummary({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      site_id: typeof req.query.site_id === "string" ? req.query.site_id : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ summary });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/opportunity-audit-summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const summary = await getPathModuleService(req).getOpportunityAuditSummary(month);
    res.json({ summary });
  } catch (error) {
    handleError(res, error);
  }
});

// ─── PATH V3.3 transparent governance ──────────────────────────────────────
// Spec: docs/REWARD_SYSTEM_V33.md §5,7
//
// V3.3 self-declared per-site tier is NOT a proposal — peer review (Phase 4)
// is the governance, not approval. Drafts are upserted directly by the
// submitting member; work_days is computed server-side from site_day_logs.

router.post("/v33/level-drafts", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const rawTier = Number(req.body?.tier);
    const tier = rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : 0;
    const result = await getPathV33RewardService(req).submitLevelDraft(
      {
        site_id: typeof req.body?.site_id === "string" ? req.body.site_id : "",
        tier: tier as 1 | 2 | 3,
        self_comment:
          typeof req.body?.self_comment === "string" ? req.body.self_comment : "",
      },
      actor,
    );
    res.status(201).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/v33/level-drafts/revise", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const rawTier = Number(req.body?.tier);
    const tier = rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : 0;
    const result = await getPathV33RewardService(req).reviseLevelDraft(
      {
        draft_id: typeof req.body?.draft_id === "string" ? req.body.draft_id : "",
        tier: tier as 1 | 2 | 3,
        self_comment:
          typeof req.body?.self_comment === "string" ? req.body.self_comment : "",
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
      },
      actor,
    );
    res.status(200).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/v33/me/responsibility-lock", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const memberId = req.userId ?? "";
    const targets = await getPathV33RewardService(req).fetchResponsibilityLockTargets(memberId);
    res.json({ targets });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/v33/level-drafts/preview", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const memberId =
      typeof req.query.member_id === "string" && req.query.member_id
        ? req.query.member_id
        : req.userId ?? "";
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const preview = await getPathV33RewardService(req).getMonthlyPreview(memberId, month);
    res.json({ preview });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/v33/team-feed", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.query.month === "string" ? req.query.month : "";
    const feed = await getPathV33RewardService(req).getTeamFeed(month);
    res.json({ feed });
  } catch (error) {
    handleError(res, error);
  }
});

// ─── V3.3 Objection + Co-sign (Phase 4) ───────────────────────────────────
// Spec §6. Peer-review replaces 番頭 single-approver gating.

router.get("/v33/objections", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const objections = await getPathV33ObjectionService(req).listOpen();
    res.json({ objections });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/v33/objections/:objectionId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const objection = await getPathV33ObjectionService(req).getById(
      getRouteParam(req.params.objectionId as string | string[] | undefined),
    );
    res.json({ objection });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/v33/objections", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const actor = buildHumanActor(req);
    const rawTier = Number(req.body?.proposed_tier);
    const tier = rawTier === 1 || rawTier === 2 || rawTier === 3 ? rawTier : 0;
    const objection = await getPathV33ObjectionService(req).submit(
      {
        target_draft_id:
          typeof req.body?.target_draft_id === "string" ? req.body.target_draft_id : "",
        proposed_tier: tier as 1 | 2 | 3,
        reason: typeof req.body?.reason === "string" ? req.body.reason : "",
        evidence:
          req.body?.evidence && typeof req.body.evidence === "object"
            ? (req.body.evidence as Record<string, unknown>)
            : undefined,
      },
      actor,
    );
    res.status(201).json({ objection });
  } catch (error) {
    handleError(res, error);
  }
});

router.post(
  "/v33/objections/:objectionId/co-sign",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const actor = buildHumanActor(req);
      const objection = await getPathV33ObjectionService(req).coSign(
        getRouteParam(req.params.objectionId as string | string[] | undefined),
        { comment: typeof req.body?.comment === "string" ? req.body.comment : "" },
        actor,
      );
      res.json({ objection });
    } catch (error) {
      handleError(res, error);
    }
  },
);

router.post(
  "/v33/objections/:objectionId/target-response",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const actor = buildHumanActor(req);
      const objection = await getPathV33ObjectionService(req).targetRespond(
        getRouteParam(req.params.objectionId as string | string[] | undefined),
        {
          agreed: Boolean(req.body?.agreed),
          comment: typeof req.body?.comment === "string" ? req.body.comment : "",
        },
        actor,
      );
      res.json({ objection });
    } catch (error) {
      handleError(res, error);
    }
  },
);

// V3.3 month-end admin endpoints (Phase 5). Manually triggered via the
// finalization modal; an external cron can call these on the spec timeline
// (月末 +3 / +8) without further code changes.

router.post("/v33/month/:month/lock-drafts", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = getRouteParam(req.params.month as string | string[] | undefined);
    const result = await getPathV33MonthService(req).lockDrafts(month);
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

router.post(
  "/v33/month/:month/expire-objections",
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const month = getRouteParam(req.params.month as string | string[] | undefined);
      const result = await getPathV33MonthService(req).expireOpenObjections(month);
      res.json(result);
    } catch (error) {
      handleError(res, error);
    }
  },
);

router.post("/v33/month/:month/finalize", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = getRouteParam(req.params.month as string | string[] | undefined);
    const result = await getPathV33MonthService(req).finalizeMonth(month);
    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

export default router;
