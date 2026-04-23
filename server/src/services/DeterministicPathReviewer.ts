import { PathSkillStatus, PathTradeFamily } from "./PathPolicyBundleService";

export interface DeterministicPathEvidence {
  id: string;
  evidence_class: string;
  trade_family?: string | null;
  summary?: string;
  metadata?: Record<string, unknown>;
}

export interface ReviewerAOutput {
  monthly_summary: string;
  candidate_states: Partial<Record<PathTradeFamily, PathSkillStatus>>;
  candidate_skill_tags: string[];
  profile_update_candidates: Array<Record<string, unknown>>;
  promotion_candidate_flag: boolean;
  evidence_summary: Array<Record<string, unknown> | string>;
  matched_evidence_classes: string[];
  reasons: Array<Record<string, unknown> | string>;
  supporting_evidence_ids: string[];
}

export interface ReviewerBOutput {
  missing_evidence: string[];
  contradiction_flags: string[];
  inconsistency_with_past_cases: string[];
  risk_note: string;
  review_required_flag: boolean;
  challenged_evidence_ids: string[];
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

function resolveCandidateState(
  tradeFamily: string,
  evidence: DeterministicPathEvidence[],
): PathSkillStatus {
  const byFamily = evidence.filter((item) => item.trade_family === tradeFamily);
  const classSet = new Set(byFamily.map((item) => item.evidence_class));
  const performanceCount = byFamily.filter((item) => item.evidence_class === "performance_evidence").length;
  const repeatabilityCount = byFamily.filter(
    (item) => item.evidence_class === "repeatability_evidence",
  ).length;
  const qualityCount = byFamily.filter((item) => item.evidence_class === "quality_evidence").length;
  const humanConfirmationCount = byFamily.filter(
    (item) => item.evidence_class === "human_confirmation",
  ).length;

  if (
    classSet.size >= 4 &&
    performanceCount >= 2 &&
    repeatabilityCount >= 1 &&
    qualityCount >= 1 &&
    humanConfirmationCount >= 1
  ) {
    return "stable_independent";
  }

  if (classSet.size >= 3 && performanceCount >= 1 && qualityCount >= 1) {
    return "near_independent";
  }

  if (classSet.size >= 2) {
    return "conditional";
  }

  if (classSet.size >= 1) {
    return "assist_required";
  }

  return "unverified";
}

export class DeterministicPathReviewer {
  reviewA(input: {
    month: string;
    member_id: string;
    trade_families: PathTradeFamily[];
    evidence: DeterministicPathEvidence[];
    monthly_form_comment?: string;
  }): ReviewerAOutput {
    const candidate_states = input.trade_families.reduce<
      Partial<Record<PathTradeFamily, PathSkillStatus>>
    >((acc, tradeFamily) => {
      const state = resolveCandidateState(tradeFamily, input.evidence);
      if (state !== "unverified") {
        acc[tradeFamily] = state;
      }
      return acc;
    }, {});

    const supporting_evidence_ids = input.evidence.map((item) => item.id);
    const matched_evidence_classes = dedupeStrings(
      input.evidence.map((item) => item.evidence_class),
    );
    const candidate_skill_tags = dedupeStrings(
      input.evidence
        .map((item) => (typeof item.trade_family === "string" ? `${item.trade_family}_observed` : ""))
        .filter(Boolean),
    );

    const profile_update_candidates = Object.entries(candidate_states).map(([trade_family, status]) => ({
      trade_family,
      skill_status: status,
    }));

    const promotion_candidate_flag = Object.values(candidate_states).some(
      (status) => status === "near_independent" || status === "stable_independent",
    );

    const evidence_summary = input.evidence.map((item) => ({
      evidence_id: item.id,
      evidence_class: item.evidence_class,
      trade_family: item.trade_family ?? null,
      summary: item.summary ?? "",
    }));

    const reasons = [
      `${input.month} の証拠 ${input.evidence.length} 件を集計`,
      input.monthly_form_comment?.trim() ? `本人コメント: ${input.monthly_form_comment.trim()}` : "",
    ].filter(Boolean);

    return {
      monthly_summary:
        input.evidence.length > 0
          ? `${input.month} の PATH 月次観測を整理しました。証拠クラスと工種別の一致が見える領域だけ候補化しています。`
          : `${input.month} は証拠不足のため、候補は安全側に倒しています。`,
      candidate_states,
      candidate_skill_tags,
      profile_update_candidates,
      promotion_candidate_flag,
      evidence_summary,
      matched_evidence_classes,
      reasons,
      supporting_evidence_ids,
    };
  }

  reviewB(input: {
    trade_families: PathTradeFamily[];
    evidence: DeterministicPathEvidence[];
    reviewerA: ReviewerAOutput;
  }): ReviewerBOutput {
    const missing_evidence: string[] = [];
    const contradiction_flags: string[] = [];

    for (const tradeFamily of input.trade_families) {
      const state = input.reviewerA.candidate_states[tradeFamily];
      if (!state) {
        continue;
      }

      const byFamily = input.evidence.filter((item) => item.trade_family === tradeFamily);
      const classSet = new Set(byFamily.map((item) => item.evidence_class));
      if ((state === "near_independent" || state === "stable_independent") && !classSet.has("quality_evidence")) {
        missing_evidence.push(`${tradeFamily}:quality_evidence`);
      }
      if (state === "stable_independent" && !classSet.has("human_confirmation")) {
        missing_evidence.push(`${tradeFamily}:human_confirmation`);
      }

      const hasMajorIssue = byFamily.some(
        (item) => item.metadata && item.metadata["quality_result"] === "major_fix",
      );
      if (hasMajorIssue && (state === "near_independent" || state === "stable_independent")) {
        contradiction_flags.push(`${tradeFamily}:quality_regression_detected`);
      }
    }

    return {
      missing_evidence,
      contradiction_flags,
      inconsistency_with_past_cases: [],
      risk_note:
        missing_evidence.length > 0 || contradiction_flags.length > 0
          ? "追加の human review を推奨"
          : "重大な矛盾は検知されず",
      review_required_flag: missing_evidence.length > 0 || contradiction_flags.length > 0,
      challenged_evidence_ids: input.evidence
        .filter((item) => item.metadata && item.metadata["quality_result"] === "major_fix")
        .map((item) => item.id),
    };
  }
}
