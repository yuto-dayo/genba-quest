import type {
  PathBigSkillKey,
  PathBigSkillState,
  PathCertificationStatus,
  PathDifficultyBand,
  PathMonthlyEvaluationForm,
  PathOpportunityStatus,
  PathQualityResult,
  PathRoleType,
  PathTradeFamily,
} from "../../../lib/api";

export const BIG_SKILL_LABELS: Record<PathBigSkillKey, string> = {
  cross_work: "クロス施工力",
  putty_foundation: "パテ・下地処理力",
  planning_preparation: "段取り・準備力",
  quality_stability: "品質安定力",
  site_trust: "現場信頼形成力",
  education_support: "教育・支援力",
};

export const BIG_SKILL_STATE_LABELS: Record<PathBigSkillState, string> = {
  unverified: "未確認",
  assist_required: "補助あり",
  conditional: "条件付き",
  near_independent: "ほぼ自走",
  stable_independent: "安定自走",
};

export const CERTIFICATION_STATUS_LABELS: Record<
  PathCertificationStatus,
  string
> = {
  candidate: "候補",
  verified: "認定",
  review_required: "要レビュー",
  revoked: "取消",
};

export const TRADE_FAMILY_LABELS: Record<PathTradeFamily, string> = {
  wall_finish: "壁仕上げ",
  floor_finish: "床仕上げ",
  substrate_preparation: "下地づくり",
  decorative_sheet_or_film: "シート・フィルム",
  common_site_operations: "共通現場作業",
};

export const ROLE_TYPE_LABELS: Record<PathRoleType, string> = {
  lead: "主担当",
  support: "応援",
  teaching: "育成",
};

export const QUALITY_RESULT_LABELS: Record<PathQualityResult, string> = {
  pass: "問題なし",
  minor_fix: "軽い手直し",
  major_fix: "大きな手直し",
};

export const OPPORTUNITY_STATUS_LABELS: Record<
  PathOpportunityStatus,
  string
> = {
  not_observed: "未観測",
  opportunity_not_granted: "機会なし",
  recheck_required: "再確認",
  observed: "確認済み",
};

export const REWORK_FLAG_LABELS: Record<
  NonNullable<PathMonthlyEvaluationForm["rework_flag"]>,
  string
> = {
  none: "なし",
  minor: "軽微",
  major: "重大",
};

export const PATH_PENDING_PROPOSAL_LABELS: Record<string, string> = {
  "policy.update": "PATH policy publish",
  "evaluation.finalize": "月締め",
  "reward.calculate": "報酬 run",
  "reward.adjust": "補正 / reversal",
  "skill.achieve": "技能認定",
  "skill.revoke": "技能取消",
};

export const DIFFICULTY_BAND_SCORES: Record<PathDifficultyBand, number> = {
  S1: 1,
  S2: 2,
  S3: 3,
};

export const QUALITY_RESULT_SCORES: Record<PathQualityResult, number> = {
  pass: 0,
  minor_fix: 1,
  major_fix: 2,
};
