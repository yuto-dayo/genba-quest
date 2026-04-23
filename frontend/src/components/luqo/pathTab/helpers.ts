import {
  PATH_BIG_SKILL_KEYS,
  PATH_OPPORTUNITY_STATUS_OPTIONS,
  PATH_QUALITY_RESULT_OPTIONS,
  PATH_ROLE_TYPE_OPTIONS,
  PATH_TRADE_FAMILY_OPTIONS,
  type Member,
  type PathBigSkillKey,
  type PathBigSkillState,
  type PathDifficultyBand,
  type PathModuleEvidenceRecord,
  type PathModuleMonthCloseSummary,
  type PathModuleMonthlyCloseInput,
  type PathLevel,
  type PathModuleSiteItemProfitSnapshot,
  type PathMonthlyEvaluationAiReview,
  type PathMonthlyEvaluationFinalization,
  type PathMonthlyEvaluationForm,
  type PathMonthlyEvaluationFormInput,
  type PathOpportunityStatus,
  type PathQualityResult,
  type PathRewardCalculationSnapshot,
  type PathRewardProfitInputs,
  type PathRoleType,
  type PathSkillProfile,
  type PathTradeFamily,
} from "../../../lib/api";
import { derivePathLevelFromStates } from "../../../lib/pathEvaluation";
import {
  DIFFICULTY_BAND_SCORES,
  PATH_PENDING_PROPOSAL_LABELS,
  QUALITY_RESULT_SCORES,
} from "./constants";
import type {
  PathCalculationMember,
  PathCalculationRun,
  RewardSourceLineageCard,
  RewardMemberDraft,
  SelectedSiteSummary,
} from "./types";

// ---------- Date helpers ----------

export function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthValue(month: string) {
  const [yearValue, monthValue] = month
    .split("-")
    .map((value) => Number(value));
  if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) {
    return currentMonthValue();
  }

  const date = new Date(yearValue, monthValue - 1, 1);
  date.setMonth(date.getMonth() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonthValue(month: string) {
  const [yearValue, monthValue] = month
    .split("-")
    .map((value) => Number(value));
  if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) {
    return currentMonthValue();
  }

  const date = new Date(yearValue, monthValue - 1, 1);
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function getMonthDateRange(
  month: string,
): { dateFrom: string; dateTo: string } {
  const [yearValue, monthValue] = month.split("-").map((value) => Number(value));
  if (!Number.isFinite(yearValue) || !Number.isFinite(monthValue)) {
    return { dateFrom: month, dateTo: month };
  }

  const start = new Date(yearValue, monthValue - 1, 1);
  const end = new Date(yearValue, monthValue, 0);
  const formatDate = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

  return {
    dateFrom: formatDate(start),
    dateTo: formatDate(end),
  };
}

// ---------- Display / format ----------

export function displayMemberName(
  memberId: string,
  memberMap: Map<string, Member>,
  fallbackName?: string | null,
): string {
  const member = memberMap.get(memberId);
  const normalizedFallback =
    typeof fallbackName === "string" ? fallbackName.trim() : "";
  return (
    member?.full_name ||
    member?.username ||
    normalizedFallback ||
    `名前未設定 (${memberId.slice(0, 8)}...)`
  );
}

export function toPlainText(value: Record<string, unknown> | string): string {
  if (typeof value === "string") {
    return value;
  }

  const summary = Object.entries(value)
    .slice(0, 3)
    .map(([key, inner]) => `${key}: ${String(inner)}`);
  return summary.join(" / ");
}

export function formatProposalKind(type: string): string {
  return PATH_PENDING_PROPOSAL_LABELS[type] || type;
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "日時不明";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCurrency(value: number): string {
  return `¥${value.toLocaleString("ja-JP")}`;
}

export function formatSkillLabel(value: string): string {
  return value.replaceAll("_", " ");
}

// ---------- Type guards ----------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isTradeFamily(value: unknown): value is PathTradeFamily {
  return PATH_TRADE_FAMILY_OPTIONS.includes(value as PathTradeFamily);
}

export function isRoleType(value: unknown): value is PathRoleType {
  return PATH_ROLE_TYPE_OPTIONS.includes(value as PathRoleType);
}

export function isQualityResult(value: unknown): value is PathQualityResult {
  return PATH_QUALITY_RESULT_OPTIONS.includes(value as PathQualityResult);
}

export function isOpportunityStatus(
  value: unknown,
): value is PathOpportunityStatus {
  return PATH_OPPORTUNITY_STATUS_OPTIONS.includes(
    value as PathOpportunityStatus,
  );
}

// ---------- Converters ----------

export function toStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function toOptionalNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toFiniteNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

export function getRecordArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isRecord);
}

export function joinCsv(values: string[] | undefined): string {
  return (values || []).join(", ");
}

export function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function splitLines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function dedupeStrings(
  values: Array<string | undefined | null>,
): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter(Boolean),
    ),
  );
}

// ---------- Wizard ----------

export function normalizeWizardPrompt(
  point: Record<string, unknown> | string,
  index: number,
): { title: string; detail: string } {
  if (typeof point === "string") {
    return {
      title: `確認 ${index + 1}`,
      detail: point,
    };
  }

  const title =
    toStringValue(point.title) ||
    toStringValue(point.label) ||
    toStringValue(point.skill) ||
    `確認 ${index + 1}`;
  const detail =
    toStringValue(point.question) ||
    toStringValue(point.reason) ||
    toStringValue(point.note) ||
    toPlainText(point);

  return {
    title,
    detail: detail || "この項目を確認してから進めます。",
  };
}

// ---------- Builder / calculation ----------

export function getObservedTradeFamilies(
  monthlyCloseInput?: PathModuleMonthlyCloseInput | null,
  evidence: PathModuleEvidenceRecord[] = [],
): PathTradeFamily[] {
  const inputFamilies = isRecord(monthlyCloseInput?.trade_family_observations)
    ? Object.keys(monthlyCloseInput.trade_family_observations).filter(
        isTradeFamily,
      )
    : [];
  const evidenceFamilies = evidence
    .map((item) => item.trade_family)
    .filter(
      (value): value is PathTradeFamily =>
        Boolean(value) && isTradeFamily(value),
    );
  return Array.from(new Set([...inputFamilies, ...evidenceFamilies]));
}

export function buildInitialRewardProfitInputs(): PathRewardProfitInputs {
  return {
    sales: 0,
    outsourcing_cost: 0,
    materials_cost: 0,
    parking_cost: 0,
    transport_cost: 0,
    other_direct_cost: 0,
    common_cost: 0,
    reserve_amount: 0,
  };
}

function extractAutoProfitInputs(
  siteItem: PathModuleSiteItemProfitSnapshot,
): PathRewardProfitInputs | null {
  const metadata = isRecord(siteItem.metadata) ? siteItem.metadata : null;
  const autoInputs =
    metadata && isRecord(metadata.auto_profit_inputs)
      ? metadata.auto_profit_inputs
      : null;

  if (!autoInputs) {
    return null;
  }

  return {
    sales: toFiniteNumber(autoInputs.sales),
    outsourcing_cost: toFiniteNumber(autoInputs.outsourcing_cost),
    materials_cost: toFiniteNumber(autoInputs.materials_cost),
    parking_cost: toFiniteNumber(autoInputs.parking_cost),
    transport_cost: toFiniteNumber(autoInputs.transport_cost),
    other_direct_cost: toFiniteNumber(autoInputs.other_direct_cost),
    common_cost: toFiniteNumber(autoInputs.common_cost),
    reserve_amount: toFiniteNumber(autoInputs.reserve_amount),
  };
}

export function buildInitialRewardProfitInputsFromSiteItems(
  siteItems: PathModuleSiteItemProfitSnapshot[],
): PathRewardProfitInputs {
  return siteItems.reduce(
    (acc, item) => {
      const autoInputs = extractAutoProfitInputs(item);
      if (autoInputs) {
        return {
          sales: acc.sales + autoInputs.sales,
          outsourcing_cost:
            acc.outsourcing_cost + autoInputs.outsourcing_cost,
          materials_cost: acc.materials_cost + autoInputs.materials_cost,
          parking_cost: acc.parking_cost + autoInputs.parking_cost,
          transport_cost: acc.transport_cost + autoInputs.transport_cost,
          other_direct_cost:
            acc.other_direct_cost + autoInputs.other_direct_cost,
          common_cost: acc.common_cost + autoInputs.common_cost,
          reserve_amount: acc.reserve_amount + autoInputs.reserve_amount,
        };
      }

      return {
        ...acc,
        sales: acc.sales + toFiniteNumber(item.revenue),
        outsourcing_cost:
          acc.outsourcing_cost + toFiniteNumber(item.subcontract_cost),
        materials_cost: acc.materials_cost + toFiniteNumber(item.material_cost),
        other_direct_cost:
          acc.other_direct_cost + toFiniteNumber(item.direct_cost),
      };
    },
    buildInitialRewardProfitInputs(),
  );
}

export function buildInitialPriorAdjustments(
  rewardRuns: PathModuleMonthCloseSummary["reward_runs"],
): number {
  return rewardRuns.reduce((sum, run) => {
    if (run.run_type === "standard") {
      return sum;
    }

    const payload = isRecord(run.reward_payload) ? run.reward_payload : null;
    const memberAdjustments = payload
      ? getRecordArray(payload.member_adjustments)
      : [];
    if (memberAdjustments.length === 0) {
      return sum;
    }

    const adjustmentTotal = memberAdjustments.reduce((innerSum, item) => {
      const amount = toOptionalNumber(item.amount);
      return innerSum + (amount ?? 0);
    }, 0);

    return sum + adjustmentTotal;
  }, 0);
}

export function resolveQualityResultFromEvidence(
  evidence: PathModuleEvidenceRecord[],
  tradeFamily: PathTradeFamily,
): PathQualityResult {
  return evidence.reduce<PathQualityResult>((current, item) => {
    if (item.trade_family !== tradeFamily) {
      return current;
    }

    const metadataResult = isRecord(item.metadata)
      ? item.metadata.quality_result
      : null;
    if (!isQualityResult(metadataResult)) {
      return current;
    }

    return QUALITY_RESULT_SCORES[metadataResult] >
      QUALITY_RESULT_SCORES[current]
      ? metadataResult
      : current;
  }, "pass");
}

export function selectPrimaryOpportunityAudit(
  audits: import("../../../lib/api").PathModuleOpportunityAudit[],
): import("../../../lib/api").PathModuleOpportunityAudit | null {
  if (audits.length === 0) {
    return null;
  }

  return [...audits].sort((left, right) => {
    const scoreDiff =
      toFiniteNumber(right.opportunity_concentration_score) -
      toFiniteNumber(left.opportunity_concentration_score);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return (
      toFiniteNumber(right.eligible_but_unassigned_days) -
      toFiniteNumber(left.eligible_but_unassigned_days)
    );
  })[0]!;
}

export function buildInitialFinalizeStates(
  form?: PathMonthlyEvaluationForm,
  review?: PathMonthlyEvaluationAiReview,
  finalization?: PathMonthlyEvaluationFinalization,
  profile?: PathSkillProfile,
): Record<PathBigSkillKey, PathBigSkillState> {
  return PATH_BIG_SKILL_KEYS.reduce(
    (acc, key) => {
      const profileValue = profile?.[`${key}_status` as keyof PathSkillProfile];
      acc[key] =
        finalization?.confirmed_big_skill_states?.[key] ||
        form?.selected_big_skill_states?.[key] ||
        review?.candidate_states?.[key] ||
        (typeof profileValue === "string"
          ? (profileValue as PathBigSkillState)
          : "unverified");
      return acc;
    },
    {} as Record<PathBigSkillKey, PathBigSkillState>,
  );
}

export function getSuggestedSiteIdsFromSiteItems(
  siteItems: PathModuleSiteItemProfitSnapshot[],
): string[] {
  return dedupeStrings(
    siteItems.map((item) => {
      const metadata = isRecord(item.metadata) ? item.metadata : null;
      const sourceKind =
        typeof metadata?.source_kind === "string" ? metadata.source_kind : "";
      if (
        sourceKind !== "revenue_basis_income_create" ||
        toFiniteNumber(item.revenue) <= 0
      ) {
        return null;
      }

      return item.site_id;
    }),
  );
}

export function buildSelectedSiteSummary(params: {
  form?: PathMonthlyEvaluationForm;
  monthlyCloseInput?: PathModuleMonthlyCloseInput | null;
  selectedSiteIds?: string[];
  siteItems?: PathModuleSiteItemProfitSnapshot[];
}): SelectedSiteSummary {
  const selectedSiteIds =
    params.selectedSiteIds && params.selectedSiteIds.length > 0
      ? params.selectedSiteIds
      : params.monthlyCloseInput?.selected_site_ids &&
          params.monthlyCloseInput.selected_site_ids.length > 0
      ? params.monthlyCloseInput.selected_site_ids
      : params.form?.site_ids && params.form.site_ids.length > 0
        ? params.form.site_ids
        : getSuggestedSiteIdsFromSiteItems(params.siteItems || []);

  const sourceLabel =
    params.selectedSiteIds && params.selectedSiteIds.length > 0
      ? "報酬詳細"
      : params.monthlyCloseInput?.selected_site_ids &&
          params.monthlyCloseInput.selected_site_ids.length > 0
      ? "月締めに反映"
      : params.form?.site_ids && params.form.site_ids.length > 0
        ? "月末入力"
        : selectedSiteIds.length > 0
          ? "完了現場候補"
          : null;

  const canonicalSiteMap = new Map(
    (params.siteItems || [])
      .filter((item) => {
        const metadata = isRecord(item.metadata) ? item.metadata : null;
        return metadata?.source_kind === "revenue_basis_income_create";
      })
      .map((item) => [item.site_id, item.item_name] as const),
  );

  const labels = selectedSiteIds.map((siteId) => canonicalSiteMap.get(siteId) || siteId);

  return {
    siteIds: selectedSiteIds,
    labels,
    sourceLabel,
    helper:
      selectedSiteIds.length > 0
        ? `${selectedSiteIds.length}件の現場を今回の対象に使います。`
        : "まだ対象現場は決まっていません。",
  };
}

export function buildRewardSourceLineageCards(
  siteItems: PathModuleSiteItemProfitSnapshot[],
  selectedSiteIds: string[] = [],
): RewardSourceLineageCard[] {
  return siteItems.map((item) => {
    const metadata = isRecord(item.metadata) ? item.metadata : null;
    const sourceKind =
      typeof metadata?.source_kind === "string" ? metadata.source_kind : "";
    const isCanonicalRevenue = sourceKind === "revenue_basis_income_create";
    const isAccountingRollup = sourceKind === "accounting_transactions_rollup";
    const selected = isCanonicalRevenue && selectedSiteIds.includes(item.site_id);
    const revenue = toFiniteNumber(item.revenue);
    const materialCost = toFiniteNumber(item.material_cost);
    const subcontractCost = toFiniteNumber(item.subcontract_cost);
    const directCost = toFiniteNumber(item.direct_cost);

    return {
      id: item.id,
      siteId: isCanonicalRevenue ? item.site_id : null,
      title: item.item_name,
      badge: isCanonicalRevenue
        ? "完了現場売上"
        : isAccountingRollup
          ? "会計集計"
          : "会計コスト",
      highlightLabel: selected ? "今見ていた現場" : null,
      value: isCanonicalRevenue || isAccountingRollup
        ? formatCurrency(revenue)
        : formatCurrency(materialCost + subcontractCost + directCost),
      helper: isCanonicalRevenue
        ? selected
          ? `${item.site_id} / 今回の対象現場`
          : `${item.site_id} / 完了で売上化`
        : `材料 ${formatCurrency(materialCost)} / 外注 ${formatCurrency(subcontractCost)} / 直接 ${formatCurrency(directCost)}`,
      selected,
    };
  });
}

export function buildInitialFormInput(
  period: string,
  memberId: string,
  form?: PathMonthlyEvaluationForm,
  monthlyCloseInput?: PathModuleMonthlyCloseInput | null,
  siteItems: PathModuleSiteItemProfitSnapshot[] = [],
): PathMonthlyEvaluationFormInput {
  const selectedBigSkillStates = PATH_BIG_SKILL_KEYS.reduce(
    (acc, key) => {
      acc[key] = form?.selected_big_skill_states?.[key] || "unverified";
      return acc;
    },
    {} as Record<PathBigSkillKey, PathBigSkillState>,
  );
  const suggestedSiteIds = getSuggestedSiteIdsFromSiteItems(siteItems);
  const initialSiteIds =
    form?.site_ids && form.site_ids.length > 0
      ? form.site_ids
      : monthlyCloseInput?.selected_site_ids &&
          monthlyCloseInput.selected_site_ids.length > 0
        ? monthlyCloseInput.selected_site_ids
        : suggestedSiteIds;

  return {
    month: period,
    member_id: memberId,
    selected_big_skill_states: selectedBigSkillStates,
    work_days: form?.work_days || 0,
    A: form?.A ?? 1,
    R: form?.R ?? 1,
    Q: form?.Q ?? 1,
    current_level:
      form?.current_level || derivePathLevelFromStates(selectedBigSkillStates),
    selected_roles: form?.selected_roles || [],
    site_ids: initialSiteIds,
    photo_flag: form?.photo_flag || false,
    rework_flag: form?.rework_flag || "none",
    comment: form?.comment || "",
  };
}

export function buildRewardMemberDraft(
  memberId: string,
  memberMap: Map<string, Member>,
  finalizationMap: Map<string, PathMonthlyEvaluationFinalization>,
  profileMap: Map<string, PathSkillProfile>,
  period: string,
  monthlyCloseInput?: PathModuleMonthlyCloseInput | null,
  evidence: PathModuleEvidenceRecord[] = [],
  siteItems: PathModuleSiteItemProfitSnapshot[] = [],
  latestRewardPayout?: Record<string, unknown> | null,
): RewardMemberDraft {
  const member = memberMap.get(memberId);
  const finalization = finalizationMap.get(memberId);
  const profile = profileMap.get(memberId);
  const observedTradeFamilies = getObservedTradeFamilies(
    monthlyCloseInput,
    evidence,
  );
  const selectedSiteIds = monthlyCloseInput?.selected_site_ids || [];
  const siteScopedItems =
    selectedSiteIds.length > 0
      ? siteItems.filter((item) => selectedSiteIds.includes(item.site_id))
      : siteItems;
  const familyScopedItems =
    observedTradeFamilies.length > 0
      ? siteScopedItems.filter((item) =>
          observedTradeFamilies.includes(item.trade_family),
        )
      : siteScopedItems;
  const candidateItems =
    familyScopedItems.length > 0 ? familyScopedItems : siteScopedItems;
  const tradeFamilyScores = candidateItems.reduce(
    (acc, item) => {
      acc[item.trade_family] =
        (acc[item.trade_family] || 0) +
        toFiniteNumber(item.gross_profit || item.estimated_std_hours);
      return acc;
    },
    {} as Partial<Record<PathTradeFamily, number>>,
  );
  const dominantTradeFamily =
    Object.entries(tradeFamilyScores)
      .sort((left, right) => (right[1] || 0) - (left[1] || 0))
      .map(([tradeFamily]) => tradeFamily)
      .find(isTradeFamily) ||
    observedTradeFamilies[0] ||
    evidence.find(
      (item) => item.trade_family && isTradeFamily(item.trade_family),
    )?.trade_family ||
    "common_site_operations";
  const dominantItems = candidateItems.filter(
    (item) => item.trade_family === dominantTradeFamily,
  );
  const tradeFamilyObservation = isRecord(
    monthlyCloseInput?.trade_family_observations,
  )
    ? monthlyCloseInput?.trade_family_observations[dominantTradeFamily]
    : null;
  const difficultyBand =
    dominantItems.reduce<PathDifficultyBand>(
      (current, item) =>
        DIFFICULTY_BAND_SCORES[item.difficulty_band] >
        DIFFICULTY_BAND_SCORES[current]
          ? item.difficulty_band
          : current,
      "S1",
    ) || "S1";
  const stdHours = dominantItems.reduce(
    (sum, item) => sum + toFiniteNumber(item.estimated_std_hours),
    0,
  );
  const packageId =
    dominantItems.length === 1
      ? dominantItems[0]!.item_key
      : `auto:${period}:${memberId.slice(0, 8)}:${dominantTradeFamily}`;
  const guaranteedPay =
    toOptionalNumber(latestRewardPayout?.guaranteed_pay) ?? 0;

  return {
    member_id: memberId,
    name:
      member?.full_name ||
      member?.username ||
      displayMemberName(memberId, memberMap),
    credited_units: finalization?.work_days || 0,
    role_level: finalization?.current_level || profile?.current_level || "",
    A: finalization?.A ?? 1,
    R: finalization?.R ?? 1,
    Q: finalization?.Q ?? 1,
    guaranteed_pay: guaranteedPay,
    package_id: packageId,
    trade_family: dominantTradeFamily,
    std_hours:
      stdHours > 0 ? stdHours : Math.max(finalization?.work_days || 0, 0),
    difficulty_band: difficultyBand,
    responsibility_share: 1,
    role_type: isRoleType(tradeFamilyObservation)
      ? tradeFamilyObservation
      : "lead",
    quality_result: resolveQualityResultFromEvidence(
      evidence,
      dominantTradeFamily,
    ),
    rated_units: Math.max(finalization?.work_days || 0, 0),
  };
}

export function getAutoRewardCandidateIds(
  finalizations: PathMonthlyEvaluationFinalization[],
): string[] {
  return Array.from(
    new Set(
      finalizations
        .filter((item) => toFiniteNumber(item.work_days) > 0)
        .map((item) => item.member_id),
    ),
  );
}

export function buildPathRewardRunMembers(
  rewardMembers: RewardMemberDraft[],
  period: string,
): Array<Record<string, unknown>> {
  const activeMembers = rewardMembers.filter(
    (item) =>
      item.member_id ||
      item.name.trim().length > 0 ||
      item.credited_units > 0 ||
      item.role_level ||
      item.A !== 1 ||
      item.R !== 1 ||
      item.Q !== 1 ||
      item.std_hours > 0,
  );

  if (activeMembers.length === 0) {
    throw new Error("報酬計算の対象メンバーを追加してください");
  }

  const seenIds = new Set<string>();
  return activeMembers.map((item, index) => {
    if (!item.member_id) {
      throw new Error(`メンバー${index + 1}のIDを選択してください`);
    }
    if (seenIds.has(item.member_id)) {
      throw new Error("同じメンバーが重複しています");
    }
    seenIds.add(item.member_id);
    if (!item.name.trim()) {
      throw new Error(`メンバー${index + 1}の名前を入力してください`);
    }
    if (!item.role_level) {
      throw new Error(`メンバー${index + 1}のLevelを選択してください`);
    }

    const creditedUnits = Number(item.credited_units);
    if (!Number.isFinite(creditedUnits) || creditedUnits <= 0) {
      throw new Error(
        `メンバー${index + 1}の付与ユニットを1以上で入力してください`,
      );
    }

    return {
      member_id: item.member_id,
      name: item.name.trim(),
      role_level: item.role_level as PathLevel,
      credited_units: creditedUnits,
      guaranteed_pay: Number(item.guaranteed_pay) || 0,
      A: Number(item.A),
      R: Number(item.R),
      Q: Number(item.Q),
      package_contributions: [
        {
          package_id:
            item.package_id.trim() ||
            `${period}-${item.member_id.slice(0, 8)}-${index + 1}`,
          trade_family: item.trade_family,
          std_hours: Number(item.std_hours),
          difficulty_band: item.difficulty_band,
          responsibility_share: Number(item.responsibility_share),
          role_type: item.role_type,
          quality_result: item.quality_result,
          rated_units: Number(item.rated_units) || 0,
        },
      ],
    };
  });
}

export function buildEmptyRewardMember(): RewardMemberDraft {
  return {
    member_id: "",
    name: "",
    credited_units: 0,
    role_level: "",
    A: 1,
    R: 1,
    Q: 1,
    guaranteed_pay: 0,
    package_id: "",
    trade_family: "common_site_operations",
    std_hours: 0,
    difficulty_band: "S1",
    responsibility_share: 1,
    role_type: "lead",
    quality_result: "pass",
    rated_units: 0,
  };
}

export function buildPathCalculationRuns(
  calculations: PathRewardCalculationSnapshot[],
): PathCalculationRun[] {
  const runMap = new Map<string, PathCalculationRun>();

  for (const snapshot of calculations) {
    const input = snapshot.input_snapshot || {};
    const result = snapshot.result_snapshot || {};
    const existing = runMap.get(snapshot.proposal_id);
    const member: PathCalculationMember = {
      member_id: snapshot.member_id,
      name:
        typeof input.name === "string" && input.name.trim().length > 0
          ? input.name
          : `名前未設定 (${snapshot.member_id.slice(0, 8)}...)`,
      work_days: toFiniteNumber(input.work_days),
      level: typeof input.level === "string" ? input.level : "-",
      A: toFiniteNumber(input.A),
      R: toFiniteNumber(input.R),
      Q: toFiniteNumber(input.Q),
      monthly_point_total: toFiniteNumber(result.monthly_point_total),
      monthly_coefficient: toFiniteNumber(result.monthly_coefficient),
      base_reward: toFiniteNumber(result.base_reward),
      variable_reward: toFiniteNumber(result.variable_reward),
      total_reward: toFiniteNumber(result.total_reward),
    };

    if (!existing) {
      runMap.set(snapshot.proposal_id, {
        proposal_id: snapshot.proposal_id,
        month: snapshot.month,
        finalized_at: snapshot.finalized_at,
        calculation_version: snapshot.calculation_version,
        profit_amount: toFiniteNumber(result.profit_amount),
        base_pool_amount: toFiniteNumber(result.base_pool_amount),
        variable_pool_amount: toFiniteNumber(result.variable_pool_amount),
        total_amount: member.total_reward,
        members: [member],
      });
      continue;
    }

    existing.total_amount += member.total_reward;
    existing.members.push(member);
  }

  return Array.from(runMap.values())
    .map((run) => ({
      ...run,
      members: run.members.sort((a, b) => b.total_reward - a.total_reward),
    }))
    .sort(
      (a, b) =>
        new Date(b.finalized_at).getTime() - new Date(a.finalized_at).getTime(),
    );
}
