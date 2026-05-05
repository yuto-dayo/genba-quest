import { getAIProvider, getAvailableProviders, getDefaultProviderName } from "./aiClient";
import type {
  PathRewardEvidenceRef,
  PathRewardQaAdjustment,
  PathRewardQaAmountBreakdown,
  PathRewardQaConfidence,
  PathRewardQaResponse,
} from "./PathGovernedModuleService";

export interface RewardAnalysisSafeEvidenceRef {
  evidence_key: string;
  kind: PathRewardEvidenceRef["kind"];
  label: string;
  anchor?: string | null;
}

export interface RewardAnalysisSiteBreakdown {
  label: string;
  amount: number;
  reflected_ratio: number;
  correction_state: "なし" | "あり";
  reason_summary: string;
  own_contribution: {
    floor_amount: number;
    result_amount: number;
    correction_amount: number;
    credited_units: number;
    reason_lines: string[];
  };
  anonymous_relative_position: {
    participant_count: number;
    self_band: "top" | "upper" | "middle" | "lower" | "solo";
  };
  evidence_keys: string[];
}

export interface RewardAnalysisCorrection {
  status: string;
  reason: string;
  amount: number;
  correction_month: string | null;
  target_month: string | null;
  mode: "adjustment" | "reversal" | "unknown";
  evidence_keys: string[];
}

export interface RewardAnalysisContext {
  estimated_amount: number;
  delta_amount: number | null;
  site_breakdown: RewardAnalysisSiteBreakdown[];
  corrections: {
    total_amount: number;
    applied_amount: number;
    count: number;
    has_corrections: boolean;
    items: RewardAnalysisCorrection[];
  };
  rule_version: string | null;
  evidence_refs: RewardAnalysisSafeEvidenceRef[];
}

export interface RewardAnalysisContextBundle {
  context: RewardAnalysisContext;
  evidenceMap: Map<string, PathRewardEvidenceRef>;
}

interface RawAmountBreakdown {
  label: unknown;
  amount: unknown;
  detail: unknown;
  evidence_keys?: unknown;
}

interface RawAdjustment {
  label: unknown;
  amount?: unknown;
  detail: unknown;
  evidence_keys?: unknown;
}

interface RawAnalysisResponse {
  conclusion?: unknown;
  amount_breakdown?: unknown;
  why_changed?: unknown;
  adjustments?: unknown;
  evidence_keys?: unknown;
  next_action?: unknown;
  confidence?: unknown;
}

const CONFIDENCE_VALUES = new Set<PathRewardQaConfidence>(["low", "medium", "high"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(raw: string): RawAnalysisResponse | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1]?.trim();
  const candidate = fenced || trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return isRecord(parsed) ? parsed : null;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const items = value.map(nonEmptyString);
  if (items.some((item) => item === null)) {
    return null;
  }
  return items as string[];
}

function collectAllowedAmounts(context: RewardAnalysisContext): Set<number> {
  const values = new Set<number>();
  const add = (value: number | null | undefined) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      values.add(value);
    }
  };

  add(context.estimated_amount);
  add(context.delta_amount);
  add(context.corrections.total_amount);
  add(context.corrections.applied_amount);
  for (const site of context.site_breakdown) {
    add(site.amount);
    add(site.own_contribution.floor_amount);
    add(site.own_contribution.result_amount);
    add(site.own_contribution.correction_amount);
  }
  for (const correction of context.corrections.items) {
    add(correction.amount);
  }
  return values;
}

function evidenceKeysFrom(value: unknown): string[] | null {
  const keys = stringArray(value);
  if (!keys || keys.length === 0) {
    return null;
  }
  return Array.from(new Set(keys));
}

function mapEvidence(keys: string[], evidenceMap: Map<string, PathRewardEvidenceRef>): PathRewardEvidenceRef[] | null {
  const refs = keys.map((key) => evidenceMap.get(key));
  if (refs.some((ref) => !ref)) {
    return null;
  }
  return refs as PathRewardEvidenceRef[];
}

function validateAmountBreakdown(
  value: unknown,
  allowedAmounts: Set<number>,
  evidenceMap: Map<string, PathRewardEvidenceRef>,
): PathRewardQaAmountBreakdown[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const items: PathRewardQaAmountBreakdown[] = [];
  for (const rawItem of value as RawAmountBreakdown[]) {
    if (!isRecord(rawItem)) {
      return null;
    }
    const label = nonEmptyString(rawItem.label);
    const detail = nonEmptyString(rawItem.detail);
    const amount = typeof rawItem.amount === "number" && Number.isFinite(rawItem.amount) ? rawItem.amount : null;
    if (!label || !detail || amount === null || !allowedAmounts.has(amount)) {
      return null;
    }
    const keys = Array.isArray(rawItem.evidence_keys) ? stringArray(rawItem.evidence_keys) : [];
    if (keys === null) {
      return null;
    }
    const evidenceRefs = keys.length > 0 ? mapEvidence(keys, evidenceMap) : [];
    if (!evidenceRefs) {
      return null;
    }
    items.push({
      label,
      amount,
      detail,
      evidence_refs: evidenceRefs,
    });
  }
  return items;
}

function validateAdjustments(
  value: unknown,
  allowedAmounts: Set<number>,
  evidenceMap: Map<string, PathRewardEvidenceRef>,
): PathRewardQaAdjustment[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items: PathRewardQaAdjustment[] = [];
  for (const rawItem of value as RawAdjustment[]) {
    if (!isRecord(rawItem)) {
      return null;
    }
    const label = nonEmptyString(rawItem.label);
    const detail = nonEmptyString(rawItem.detail);
    const amount =
      rawItem.amount === null || rawItem.amount === undefined
        ? null
        : typeof rawItem.amount === "number" && Number.isFinite(rawItem.amount)
          ? rawItem.amount
          : undefined;
    if (!label || !detail || amount === undefined || (amount !== null && !allowedAmounts.has(amount))) {
      return null;
    }
    const keys = Array.isArray(rawItem.evidence_keys) ? stringArray(rawItem.evidence_keys) : [];
    if (keys === null) {
      return null;
    }
    const evidenceRefs = keys.length > 0 ? mapEvidence(keys, evidenceMap) : [];
    if (!evidenceRefs) {
      return null;
    }
    items.push({
      label,
      amount,
      detail,
      evidence_refs: evidenceRefs,
    });
  }
  return items;
}

function validateAnalysisResponse(
  raw: RawAnalysisResponse,
  bundle: RewardAnalysisContextBundle,
): PathRewardQaResponse | null {
  const conclusion = nonEmptyString(raw.conclusion);
  const whyChanged = stringArray(raw.why_changed);
  const evidenceKeys = evidenceKeysFrom(raw.evidence_keys);
  const confidence =
    typeof raw.confidence === "string" && CONFIDENCE_VALUES.has(raw.confidence as PathRewardQaConfidence)
      ? (raw.confidence as PathRewardQaConfidence)
      : null;

  if (!conclusion || !whyChanged || whyChanged.length === 0 || !evidenceKeys || !confidence) {
    return null;
  }

  const allowedAmounts = collectAllowedAmounts(bundle.context);
  const amountBreakdown = validateAmountBreakdown(raw.amount_breakdown, allowedAmounts, bundle.evidenceMap);
  const adjustments = validateAdjustments(raw.adjustments, allowedAmounts, bundle.evidenceMap);
  const evidenceRefs = mapEvidence(evidenceKeys, bundle.evidenceMap);
  if (!amountBreakdown || !adjustments || !evidenceRefs || evidenceRefs.length === 0) {
    return null;
  }

  const nextAction = raw.next_action === null ? null : nonEmptyString(raw.next_action);
  if (raw.next_action !== null && raw.next_action !== undefined && !nextAction) {
    return null;
  }

  return {
    conclusion,
    amount_breakdown: amountBreakdown,
    why_changed: whyChanged,
    adjustments,
    evidence_refs: evidenceRefs,
    next_action: nextAction,
    confidence,
  };
}

function buildPrompt(context: RewardAnalysisContext, question: string) {
  return [
    "以下のPATH精算分析コンテキストだけを使って、職人本人向けに金額理由を分析してください。",
    "DB、raw payload、他メンバーの実名や金額は見えません。見えていない情報を推測しないでください。",
    "金額はcontext内の数値だけを使ってください。根拠は evidence_refs の evidence_key だけを指定してください。",
    "JSON以外の文章、Markdown、コードフェンスは返さないでください。",
    "",
    "返却JSON schema:",
    JSON.stringify(
      {
        conclusion: "string",
        amount_breakdown: [
          {
            label: "string",
            amount: 0,
            detail: "string",
            evidence_keys: ["ev_1"],
          },
        ],
        why_changed: ["string"],
        adjustments: [
          {
            label: "string",
            amount: 0,
            detail: "string",
            evidence_keys: ["ev_1"],
          },
        ],
        evidence_keys: ["ev_1"],
        next_action: "string|null",
        confidence: "low|medium|high",
      },
      null,
      2,
    ),
    "",
    `質問: ${question}`,
    "",
    "context:",
    JSON.stringify(context, null, 2),
  ].join("\n");
}

export class PathRewardAnalysisService {
  async analyzeRewardConfirmation(
    bundle: RewardAnalysisContextBundle,
    question: string,
    fallback: () => PathRewardQaResponse | Promise<PathRewardQaResponse>,
  ): Promise<PathRewardQaResponse> {
    const providerName = getDefaultProviderName();
    if (!getAvailableProviders().includes(providerName)) {
      return fallback();
    }

    try {
      const provider = getAIProvider(providerName);
      const raw = await provider.generateText(buildPrompt(bundle.context, question), {
        maxTokens: 1600,
        temperature: 0,
        systemPrompt:
          "You are a payroll explanation analyst. Return valid JSON only. Do not invent amounts or evidence.",
      });
      const parsed = parseJsonObject(raw);
      if (!parsed) {
        return fallback();
      }
      return validateAnalysisResponse(parsed, bundle) ?? fallback();
    } catch (error) {
      console.log("[PATH_REWARD_ANALYSIS] fallback:", error instanceof Error ? error.message : error);
      return fallback();
    }
  }
}
