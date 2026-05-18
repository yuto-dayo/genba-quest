import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { requireOrgMembership } from "../middleware/orgMembership";
import { ProposalService } from "../services/ProposalService";
import { ActorRef } from "../services/PolicyEngine";
import { getAIProvider, type AIProviderName } from "../services/aiClient";
import {
  normalizeMonthlyEvaluationAiReviewInput,
  PathEvaluationService,
} from "../services/PathEvaluationService";
import { assertV22WriteAllowed } from "../lib/pathV31Config";

const router = Router();
router.use(requireOrgMembership("member"));

function getOrgId(req: AuthenticatedRequest): string {
  if (!req.orgId) {
    throw new Error("ORG_CONTEXT_REQUIRED");
  }

  return req.orgId;
}

function getService(req: AuthenticatedRequest): PathEvaluationService {
  return new PathEvaluationService(getOrgId(req));
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

function parseBooleanQuery(value: unknown): boolean | undefined {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
}

function parseAiProvider(value: unknown): AIProviderName | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (value === "gemini" || value === "openai" || value === "anthropic") {
    return value;
  }

  throw new Error("INVALID_AI_PROVIDER");
}

function parseSkillProposalAction(value: unknown): "achieve" | "revoke" {
  if (value === "revoke") {
    return "revoke";
  }

  if (value === "achieve" || value === undefined) {
    return "achieve";
  }

  throw new Error("INVALID_SKILL_PROPOSAL_ACTION");
}

function buildHumanActor(req: AuthenticatedRequest): ActorRef {
  return {
    type: "human",
    id: req.userId!,
    name: req.userName || "Unknown User",
  };
}

function buildAiActor(provider: AIProviderName): ActorRef {
  return {
    type: "ai",
    id: `path-review-ai:${provider}`,
    name: `PATH Review AI (${provider})`,
  };
}

function extractJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("AI_REVIEW_INVALID_JSON");
  }

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error("AI_REVIEW_INVALID_JSON");
  }
}

function buildAiReviewPrompt(input: {
  month: string;
  memberId: string;
  form: unknown;
  profile: unknown;
  confirmations: unknown[];
  certifications: unknown[];
  existingReview: unknown | null;
}): string {
  return [
    "以下のPATH月次評価データから、AI整理結果をJSONのみで返してください。",
    "制約:",
    "- monthly_summary は日本語で2-4文",
    "- candidate_states は 6つの canonical key のうち根拠があるものだけ返す",
    "- state は unverified / assist_required / conditional / near_independent / stable_independent のみ",
    "- 根拠不足なら unverified に寄せ、review_required_flag を true にする",
    "- candidate_skill_tags は snake_case の短いタグ",
    "- profile_update_candidates / reasons / evidence_summary / unknown_points は簡潔に",
    "- JSON以外の文字を出さない",
    "",
    "返却JSONスキーマ:",
    JSON.stringify(
      {
        monthly_summary: "string",
        candidate_states: {
          cross_work: "unverified",
        },
        candidate_skill_tags: ["string"],
        profile_update_candidates: [{ type: "big_skill", key: "cross_work", status: "conditional" }],
        promotion_candidate_flag: false,
        reasons: ["string"],
        evidence_summary: ["string"],
        unknown_points: ["string"],
        review_required_flag: true,
      },
      null,
      2,
    ),
    "",
    "入力データ:",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

function handleError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
  const badRequestCodes = new Set([
    "INVALID_MONTH_FORMAT",
    "INVALID_MEMBER_ID",
    "INVALID_BIG_SKILL_STATES",
    "INVALID_CANDIDATE_STATES",
    "INVALID_REWORK_FLAG",
    "COMMENT_TOO_LONG",
    "MONTHLY_SUMMARY_REQUIRED",
    "INVALID_PROFILE_UPDATE_CANDIDATES",
    "INVALID_REASONS",
    "INVALID_EVIDENCE_SUMMARY",
    "INVALID_UNKNOWN_POINTS",
    "INVALID_CONFIRMATION_TARGET_TYPE",
    "INVALID_CONFIRMATION_TARGET_KEY",
    "INVALID_CONFIRMATION_STATUS",
    "INVALID_CONFIRMED_STATES",
    "CONFIRMED_STATES_REQUIRED",
    "INVALID_LEVEL",
    "INVALID_SKILL_KEY",
    "INVALID_SKILL_CATEGORY",
    "INVALID_CERTIFICATION_STATUS",
    "INVALID_EVIDENCE_COUNT",
    "INVALID_LAST_SITE_ID",
    "INVALID_SKILL_PROPOSAL_ACTION",
    "INVALID_WORK_DAYS",
    "INVALID_A_SCORE",
    "INVALID_R_SCORE",
    "INVALID_Q_SCORE",
    "INVALID_AI_PROVIDER",
    "AI_REVIEW_SOURCE_NOT_FOUND",
    "AI_REVIEW_INVALID_JSON",
  ]);

  if (badRequestCodes.has(code)) {
    res.status(400).json({ error: code });
    return;
  }

  if (code === "ORG_CONTEXT_REQUIRED") {
    res.status(403).json({ error: code });
    return;
  }

  if (code === "PATH_V31_CUTOVER_ENFORCED") {
    res.status(409).json({ error: code });
    return;
  }

  if (code === "AI_PROVIDER_NOT_CONFIGURED") {
    res.status(503).json({ error: code });
    return;
  }

  console.error("[PATH_EVALUATIONS] error:", error);
  res.status(500).json({ error: "Internal server error" });
}

router.get("/forms", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const forms = await getService(req).listMonthlyForms({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ forms });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/forms", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const form = await getService(req).upsertMonthlyForm(req.body);
    res.status(201).json({ form });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/ai-reviews", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const reviews = await getService(req).listAiReviews({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      review_required_flag: parseBooleanQuery(req.query.review_required_flag),
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ reviews });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/ai-reviews", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const review = await getService(req).upsertAiReview(req.body, buildHumanActor(req));
    res.status(201).json({ review });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/ai-reviews/generate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const month = typeof req.body?.month === "string" ? req.body.month : "";
    assertV22WriteAllowed({ month });
    const memberId = typeof req.body?.member_id === "string" ? req.body.member_id : "";
    const providerName = parseAiProvider(req.body?.provider);
    const service = getService(req);

    const [forms, profiles, confirmations, certifications, existingReviews] = await Promise.all([
      service.listMonthlyForms({ month, member_id: memberId, limit: 1 }),
      service.listSkillProfiles({ member_id: memberId, limit: 1 }),
      service.listConfirmations({ month, member_id: memberId, limit: 20 }),
      service.listSkillCertifications({ member_id: memberId, limit: 20 }),
      service.listAiReviews({ month, member_id: memberId, limit: 1 }),
    ]);

    const form = forms[0];
    if (!form) {
      throw new Error("AI_REVIEW_SOURCE_NOT_FOUND");
    }

    let provider;
    try {
      provider = getAIProvider(providerName);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI_PROVIDER_NOT_CONFIGURED";
      if (
        message === "GEMINI_API_KEY is not set" ||
        message === "OPENAI_API_KEY is not set" ||
        message === "ANTHROPIC_API_KEY is not set"
      ) {
        throw new Error("AI_PROVIDER_NOT_CONFIGURED");
      }
      throw error;
    }

    const raw = await provider.generateText(
      buildAiReviewPrompt({
        month,
        memberId,
        form,
        profile: profiles[0] || null,
        confirmations,
        certifications,
        existingReview: existingReviews[0] || null,
      }),
      {
        temperature: 0.2,
        maxTokens: 1400,
        systemPrompt:
          "あなたはGENBA QUESTのPATHレビュー整理AIです。必ず厳密なJSONだけを返し、根拠が弱い項目は安全側に倒してください。",
      },
    );

    const parsed = extractJsonObject(raw);
    const payload = normalizeMonthlyEvaluationAiReviewInput({
      month,
      member_id: memberId,
      monthly_summary:
        typeof parsed.monthly_summary === "string" ? parsed.monthly_summary : "",
      candidate_states:
        typeof parsed.candidate_states === "object" && parsed.candidate_states !== null
          ? parsed.candidate_states
          : {},
      candidate_skill_tags: Array.isArray(parsed.candidate_skill_tags)
        ? parsed.candidate_skill_tags
        : [],
      profile_update_candidates: Array.isArray(parsed.profile_update_candidates)
        ? parsed.profile_update_candidates
        : [],
      promotion_candidate_flag: Boolean(parsed.promotion_candidate_flag),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      evidence_summary: Array.isArray(parsed.evidence_summary) ? parsed.evidence_summary : [],
      unknown_points: Array.isArray(parsed.unknown_points) ? parsed.unknown_points : [],
      review_required_flag: Boolean(parsed.review_required_flag),
    });

    const review = await service.upsertAiReview(payload, buildAiActor(provider.name));
    res.status(201).json({ review, provider: provider.name });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/confirmations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const confirmations = await getService(req).listConfirmations({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      target_type:
        typeof req.query.target_type === "string"
          ? (req.query.target_type as "big_skill" | "skill_tag" | "level")
          : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ confirmations });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/confirmations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const confirmation = await getService(req).upsertConfirmation(req.body, buildHumanActor(req));
    res.status(201).json({ confirmation });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/profiles", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const profiles = await getService(req).listSkillProfiles({
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      current_level:
        typeof req.query.current_level === "string"
          ? (req.query.current_level as "L1" | "L2" | "L3" | "L4" | "L5")
          : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ profiles });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/finalizations", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const finalizations = await getService(req).listFinalizations({
      month: typeof req.query.month === "string" ? req.query.month : undefined,
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ finalizations });
  } catch (error) {
    handleError(res, error);
  }
});

router.get("/certifications", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const certifications = await getService(req).listSkillCertifications({
      member_id: typeof req.query.member_id === "string" ? req.query.member_id : undefined,
      skill_key: typeof req.query.skill_key === "string" ? req.query.skill_key : undefined,
      status:
        typeof req.query.status === "string"
          ? (req.query.status as "candidate" | "verified" | "review_required" | "revoked")
          : undefined,
      review_required_flag: parseBooleanQuery(req.query.review_required_flag),
      limit: normalizeLimit(req.query.limit),
    });
    res.json({ certifications });
  } catch (error) {
    handleError(res, error);
  }
});

router.post("/finalize-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const service = getService(req);
    const payload = service.buildFinalizeProposalPayload(req.body);
    if (typeof payload.month === "string") {
      assertV22WriteAllowed({ month: payload.month });
    }
    const month = typeof payload.month === "string" ? payload.month : "unknown";
    const description =
      typeof req.body?.description === "string" && req.body.description.trim().length > 0
        ? req.body.description.trim()
        : `${month} PATH評価確定`;

    const result = await getProposalService(req).createAndSubmit({
      type: "evaluation.finalize",
      payload,
      description,
      created_by: buildHumanActor(req),
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

router.post("/skill-proposals", async (req: AuthenticatedRequest, res: Response) => {
  try {
    if (typeof req.body?.month === "string") {
      assertV22WriteAllowed({ month: req.body.month });
    }
    const action = parseSkillProposalAction(req.body?.action);
    const service = getService(req);
    const payload = service.buildSkillCertificationProposalPayload({
      ...req.body,
      status: req.body?.status ?? (action === "revoke" ? "revoked" : "verified"),
    });
    const skillKey =
      typeof payload.skill_key === "string" && payload.skill_key.length > 0
        ? payload.skill_key
        : "skill";
    const description =
      typeof req.body?.description === "string" && req.body.description.trim().length > 0
        ? req.body.description.trim()
        : `${skillKey} ${action === "revoke" ? "認定取消" : "認定更新"}`;

    const result = await getProposalService(req).createAndSubmit({
      type: action === "revoke" ? "skill.revoke" : "skill.achieve",
      payload,
      description,
      created_by: buildHumanActor(req),
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

export default router;
