import { useCallback, useEffect, useMemo, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
  PATH_LEVEL_OPTIONS,
  approveProposal,
  createPathModuleMonthCloseProposal,
  createPathModuleRewardAdjustmentProposal,
  createPathModuleRewardRunProposal,
  createPathFinalizeProposal,
  createPathSkillProposal,
  fetchPathModuleAiAnnotations,
  fetchPathModuleEvidence,
  fetchPathModuleMonthCloseSummary,
  fetchPathModuleMonthlyCloseInputs,
  fetchPathModuleOpportunityAuditSummary,
  fetchPathModulePendingProposals,
  fetchPathModuleRewardExplanation,
  fetchPathModuleSiteItemProfitSummary,
  fetchLUQORewardCalculations,
  fetchMembers,
  fetchPathAiReviews,
  fetchPathCertifications,
  fetchPathConfirmations,
  fetchPathFinalizations,
  fetchPathForms,
  fetchPathProfiles,
  fetchPathRewardCalculations,
  fetchTransactions,
  previewPathModuleRewardRun,
  rejectProposal,
  savePathForm,
  type LUQORewardCalculation,
  type Member,
  type PathBigSkillKey,
  type PathBigSkillState,
  type PathCertificationStatus,
  type PathLevel,
  type PathModuleAiAnnotation,
  type PathModuleEvidenceRecord,
  type PathModuleMonthCloseSummary,
  type PathModuleMonthlyCloseInput,
  type PathModulePendingProposal,
  type PathModuleOpportunityAudit,
  type PathModuleRewardPreview,
  type PathModuleRewardExplanationSnapshot,
  type PathModuleSiteItemProfitSnapshot,
  type PathMonthlyEvaluationAiReview,
  type PathMonthlyEvaluationConfirmation,
  type PathMonthlyEvaluationFinalization,
  type PathMonthlyEvaluationForm,
  type PathMonthlyEvaluationFormInput,
  type PathOpportunityStatus,
  type PathRewardCalculationSnapshot,
  type PathRewardProfitInputs,
  type PathSkillCertification,
  type PathSkillProfile,
  type PathTradeFamily,
} from "../../../lib/api";
import { derivePathLevelFromStates } from "../../../lib/pathEvaluation";
import { getPathProposalContext } from "../../../lib/pathProposal";
import {
  buildEmptyRewardMember,
  getAutoRewardCandidateIds,
  buildInitialFinalizeStates,
  buildInitialFormInput,
  buildInitialRewardProfitInputs,
  buildInitialRewardProfitInputsFromSiteItems,
  buildInitialPriorAdjustments,
  buildPathCalculationRuns,
  buildRewardMemberDraft,
  currentMonthValue,
  dedupeStrings,
  displayMemberName,
  formatCurrency,
  formatDateTime,
  getMonthDateRange,
  getObservedTradeFamilies,
  getRecordArray,
  isOpportunityStatus,
  isRecord,
  joinCsv,
  nextMonthValue,
  normalizeWizardPrompt,
  selectPrimaryOpportunityAudit,
  splitCsv,
  splitLines,
  toFiniteNumber,
  toOptionalNumber,
  toPlainText,
  toStringArray,
  toStringValue,
} from "./helpers";
import type {
  MemberWorkflowSummary,
  RewardCardBreakdown,
  RewardMemberDraft,
} from "./types";

export interface PathTabProps {
  initialPeriod?: string;
  focusMemberId?: string | null;
  focusProposalId?: string | null;
  openRewardOnLoad?: boolean;
  focusSiteId?: string | null;
}

export function usePathTabState({
  initialPeriod,
  focusMemberId,
  focusProposalId,
}: PathTabProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const shouldReduceMotion = useReducedMotion();
  const [period, setPeriod] = useState(
    () => initialPeriod || currentMonthValue(),
  );
  const [members, setMembers] = useState<Member[]>([]);
  const [forms, setForms] = useState<PathMonthlyEvaluationForm[]>([]);
  const [reviews, setReviews] = useState<PathMonthlyEvaluationAiReview[]>([]);
  const [confirmations, setConfirmations] = useState<
    PathMonthlyEvaluationConfirmation[]
  >([]);
  const [finalizations, setFinalizations] = useState<
    PathMonthlyEvaluationFinalization[]
  >([]);
  const [profiles, setProfiles] = useState<PathSkillProfile[]>([]);
  const [certifications, setCertifications] = useState<
    PathSkillCertification[]
  >([]);
  const [pathCalculations, setPathCalculations] = useState<
    PathRewardCalculationSnapshot[]
  >([]);
  const [luqoCalculations, setLuqoCalculations] = useState<
    LUQORewardCalculation[]
  >([]);
  const [moduleCloseInputs, setModuleCloseInputs] = useState<
    PathModuleMonthlyCloseInput[]
  >([]);
  const [moduleEvidenceRecords, setModuleEvidenceRecords] = useState<
    PathModuleEvidenceRecord[]
  >([]);
  const [moduleAiAnnotations, setModuleAiAnnotations] = useState<
    PathModuleAiAnnotation[]
  >([]);
  const [moduleOpportunityAudits, setModuleOpportunityAudits] = useState<
    PathModuleOpportunityAudit[]
  >([]);
  const [modulePendingProposals, setModulePendingProposals] = useState<
    PathModulePendingProposal[]
  >([]);
  const [siteItemProfitSummary, setSiteItemProfitSummary] = useState<
    PathModuleSiteItemProfitSnapshot[]
  >([]);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [selectedRewardExplanation, setSelectedRewardExplanation] =
    useState<PathModuleRewardExplanationSnapshot | null>(null);
  const [selectedMemberExpenseAmount, setSelectedMemberExpenseAmount] =
    useState(0);
  const [selectedMemberExpenseLoading, setSelectedMemberExpenseLoading] =
    useState(false);
  const [formInput, setFormInput] = useState<PathMonthlyEvaluationFormInput>(
    () => buildInitialFormInput(currentMonthValue(), ""),
  );
  const [isMonthlyFormWizardOpen, setIsMonthlyFormWizardOpen] = useState(false);
  const [monthlyFormWizardStepIndex, setMonthlyFormWizardStepIndex] =
    useState(0);
  const [roleInput, setRoleInput] = useState("");
  const [siteInput, setSiteInput] = useState("");
  const [finalizeStates, setFinalizeStates] = useState<
    Record<PathBigSkillKey, PathBigSkillState>
  >(() => buildInitialFinalizeStates());
  const [finalizeLevel, setFinalizeLevel] = useState("");
  const [finalizeWorkDays, setFinalizeWorkDays] = useState(0);
  const [finalizeA, setFinalizeA] = useState(1);
  const [finalizeR, setFinalizeR] = useState(1);
  const [finalizeQ, setFinalizeQ] = useState(1);
  const [finalizeComment, setFinalizeComment] = useState("");
  const [skillKey, setSkillKey] = useState("");
  const [skillCategory, setSkillCategory] = useState("");
  const [skillStatus, setSkillStatus] =
    useState<PathCertificationStatus>("verified");
  const [skillEvidenceCount, setSkillEvidenceCount] = useState(1);
  const [skillNote, setSkillNote] = useState("");
  const [skillReviewRequired, setSkillReviewRequired] = useState(false);
  const [rewardProfitInputs, setRewardProfitInputs] =
    useState<PathRewardProfitInputs>(() => buildInitialRewardProfitInputs());
  const [rewardMembers, setRewardMembers] = useState<RewardMemberDraft[]>(
    () => [buildEmptyRewardMember()],
  );
  const [rewardPreview, setRewardPreview] =
    useState<PathModuleRewardPreview | null>(null);
  const [moduleSummary, setModuleSummary] =
    useState<PathModuleMonthCloseSummary | null>(null);
  const [closeEvidenceInput, setCloseEvidenceInput] = useState("");
  const [closeNeutralFlagsInput, setCloseNeutralFlagsInput] = useState("");
  const [closeCreditedUnits, setCloseCreditedUnits] = useState(0);
  const [closeOpportunityTradeFamily, setCloseOpportunityTradeFamily] =
    useState<PathTradeFamily>("common_site_operations");
  const [closeOpportunityStatus, setCloseOpportunityStatus] =
    useState<PathOpportunityStatus>("observed");
  const [closeOpportunityDays, setCloseOpportunityDays] = useState(0);
  const [closeOpportunityScore, setCloseOpportunityScore] = useState(0);
  const [closeProtectedChallengeCount, setCloseProtectedChallengeCount] =
    useState(0);
  const [closePromotionBlocked, setClosePromotionBlocked] = useState(false);
  const [closeReviewerSummary, setCloseReviewerSummary] = useState("");
  const [rewardPriorAdjustments, setRewardPriorAdjustments] = useState(0);
  const [correctionRewardRunId, setCorrectionRewardRunId] = useState("");
  const [correctionMonth, setCorrectionMonth] = useState(
    nextMonthValue(currentMonthValue()),
  );
  const [correctionMode, setCorrectionMode] = useState<
    "adjustment" | "reversal"
  >("reversal");
  const [correctionReasonCode, setCorrectionReasonCode] =
    useState("manual_review");
  const [correctionAmount, setCorrectionAmount] = useState(0);
  const [correctionNote, setCorrectionNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submittingForm, setSubmittingForm] = useState(false);
  const [submittingFinalize, setSubmittingFinalize] = useState(false);
  const [submittingCertification, setSubmittingCertification] = useState(false);
  const [submittingMonthClose, setSubmittingMonthClose] = useState(false);
  const [previewingReward, setPreviewingReward] = useState(false);
  const [submittingReward, setSubmittingReward] = useState(false);
  const [submittingCorrection, setSubmittingCorrection] = useState(false);
  const [reviewingProposalId, setReviewingProposalId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [reviewWizardOpen, setReviewWizardOpen] = useState(false);
  const [reviewWizardIndex, setReviewWizardIndex] = useState(0);
  const [reviewAnswers, setReviewAnswers] = useState<
    Record<string, "confirmed" | "needs_followup" | "adjust">
  >({});

  // ── period sync ──

  useEffect(() => {
    if (initialPeriod && initialPeriod !== period) {
      setPeriod(initialPeriod);
    }
  }, [initialPeriod, period]);

  // ── data load ──

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [
        membersRes,
        formsRes,
        reviewsRes,
        confirmationsRes,
        finalizationsRes,
        profilesRes,
        certificationsRes,
        pathCalculationsRes,
        luqoCalculationsRes,
        moduleCloseInputsRes,
        moduleEvidenceRes,
        moduleAiAnnotationsRes,
        moduleSummaryRes,
        siteItemProfitSummaryRes,
        moduleOpportunityAuditSummaryRes,
        modulePendingProposalRes,
      ] = await Promise.all([
        fetchMembers(),
        fetchPathForms({ month: period, limit: 200 }),
        fetchPathAiReviews({ month: period, limit: 200 }),
        fetchPathConfirmations({ month: period, limit: 200 }),
        fetchPathFinalizations({ month: period, limit: 200 }),
        fetchPathProfiles({ limit: 200 }),
        fetchPathCertifications({ limit: 200 }),
        fetchPathRewardCalculations({ month: period, limit: 200 }),
        fetchLUQORewardCalculations({ period }),
        fetchPathModuleMonthlyCloseInputs({ month: period, limit: 200 }),
        fetchPathModuleEvidence({ month: period, limit: 400 }),
        fetchPathModuleAiAnnotations({ month: period, limit: 400 }),
        fetchPathModuleMonthCloseSummary(period),
        fetchPathModuleSiteItemProfitSummary({ month: period, limit: 400 }),
        fetchPathModuleOpportunityAuditSummary(period),
        fetchPathModulePendingProposals(50),
      ]);

      setMembers(membersRes);
      setForms(formsRes.forms);
      setReviews(reviewsRes.reviews);
      setConfirmations(confirmationsRes.confirmations);
      setFinalizations(finalizationsRes.finalizations);
      setProfiles(profilesRes.profiles);
      setCertifications(certificationsRes.certifications);
      setPathCalculations(pathCalculationsRes.calculations);
      setLuqoCalculations(luqoCalculationsRes.calculations);
      setModuleCloseInputs(moduleCloseInputsRes.inputs);
      setModuleEvidenceRecords(moduleEvidenceRes.evidence);
      setModuleAiAnnotations(moduleAiAnnotationsRes.annotations);
      setModuleSummary(moduleSummaryRes);
      setSiteItemProfitSummary(siteItemProfitSummaryRes.summary);
      setModuleOpportunityAudits(moduleOpportunityAuditSummaryRes.summary);
      setModulePendingProposals(modulePendingProposalRes.proposals);

      const candidateIds = Array.from(
        new Set([
          ...membersRes.map((member) => member.id),
          ...formsRes.forms.map((item) => item.member_id),
          ...reviewsRes.reviews.map((item) => item.member_id),
          ...finalizationsRes.finalizations.map((item) => item.member_id),
          ...profilesRes.profiles.map((item) => item.member_id),
          ...certificationsRes.certifications.map((item) => item.member_id),
        ]),
      );

      setSelectedMemberId((current) =>
        current && candidateIds.includes(current)
          ? current
          : candidateIds[0] || "",
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "PATHデータの読み込みに失敗しました",
      );
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    void load();
  }, [load]);

  // ── derived maps ──

  const memberMap = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );
  const formMap = useMemo(
    () => new Map(forms.map((form) => [form.member_id, form])),
    [forms],
  );
  const reviewMap = useMemo(
    () => new Map(reviews.map((review) => [review.member_id, review])),
    [reviews],
  );
  const finalizationMap = useMemo(
    () =>
      new Map(
        finalizations.map((finalization) => [
          finalization.member_id,
          finalization,
        ]),
      ),
    [finalizations],
  );
  const profileMap = useMemo(
    () => new Map(profiles.map((profile) => [profile.member_id, profile])),
    [profiles],
  );
  const moduleCloseInputMap = useMemo(
    () => new Map(moduleCloseInputs.map((item) => [item.member_id, item])),
    [moduleCloseInputs],
  );
  const moduleEvidenceByMemberMap = useMemo(() => {
    const next = new Map<string, PathModuleEvidenceRecord[]>();
    for (const item of moduleEvidenceRecords) {
      const current = next.get(item.member_id) || [];
      current.push(item);
      next.set(item.member_id, current);
    }
    return next;
  }, [moduleEvidenceRecords]);
  const moduleAiAnnotationMap = useMemo(
    () =>
      new Map(
        moduleAiAnnotations.map(
          (item) => [`${item.member_id}:${item.reviewer_kind}`, item] as const,
        ),
      ),
    [moduleAiAnnotations],
  );
  const moduleOpportunityAuditMap = useMemo(() => {
    const grouped = new Map<string, PathModuleOpportunityAudit[]>();
    for (const item of moduleOpportunityAudits) {
      const current = grouped.get(item.member_id) || [];
      current.push(item);
      grouped.set(item.member_id, current);
    }

    return new Map(
      Array.from(grouped.entries()).map(([memberId, audits]) => [
        memberId,
        selectPrimaryOpportunityAudit(audits),
      ]),
    );
  }, [moduleOpportunityAudits]);

  const memberIds = useMemo(
    () =>
      Array.from(
        new Set([
          ...members.map((member) => member.id),
          ...forms.map((item) => item.member_id),
          ...reviews.map((item) => item.member_id),
          ...finalizations.map((item) => item.member_id),
          ...profiles.map((item) => item.member_id),
          ...certifications.map((item) => item.member_id),
        ]),
      ),
    [members, forms, reviews, finalizations, profiles, certifications],
  );
  const memberOptions = useMemo(
    () =>
      memberIds.map((memberId) => ({
        id: memberId,
        label: displayMemberName(memberId, memberMap),
      })),
    [memberIds, memberMap],
  );

  // ── focus member sync ──

  useEffect(() => {
    if (
      focusMemberId &&
      memberIds.includes(focusMemberId) &&
      focusMemberId !== selectedMemberId
    ) {
      setSelectedMemberId(focusMemberId);
    }
  }, [focusMemberId, memberIds, selectedMemberId]);

  const rewardCandidateIds = useMemo(
    () => getAutoRewardCandidateIds(finalizations),
    [finalizations],
  );

  // ── selected member derived state ──

  const selectedForm = forms.find(
    (item) => item.member_id === selectedMemberId,
  );
  const selectedReview = reviews.find(
    (item) => item.member_id === selectedMemberId,
  );
  const selectedFinalization = finalizations.find(
    (item) => item.member_id === selectedMemberId,
  );
  const selectedProfile = profiles.find(
    (item) => item.member_id === selectedMemberId,
  );
  const selectedConfirmations = useMemo(
    () => confirmations.filter((item) => item.member_id === selectedMemberId),
    [confirmations, selectedMemberId],
  );
  const selectedCertifications = useMemo(
    () => certifications.filter((item) => item.member_id === selectedMemberId),
    [certifications, selectedMemberId],
  );
  const selectedModuleCloseInput =
    moduleCloseInputMap.get(selectedMemberId) || null;
  const selectedModuleEvidence = useMemo(
    () => moduleEvidenceByMemberMap.get(selectedMemberId) || [],
    [moduleEvidenceByMemberMap, selectedMemberId],
  );
  const selectedModuleAnnotationA =
    moduleAiAnnotationMap.get(`${selectedMemberId}:A`) || null;
  const selectedModuleAnnotationB =
    moduleAiAnnotationMap.get(`${selectedMemberId}:B`) || null;
  const selectedAnnotationCount = [
    selectedModuleAnnotationA,
    selectedModuleAnnotationB,
  ].filter(Boolean).length;
  const selectedOpportunityAudit =
    moduleOpportunityAuditMap.get(selectedMemberId) || null;
  const selectedVerifiedCertifications = selectedCertifications.filter(
    (item) => item.status === "verified",
  );
  const selectedReviewCertificationCount = selectedCertifications.filter(
    (item) => item.review_required_flag,
  ).length;
  const selectedCertificationHighlights = selectedVerifiedCertifications.slice(
    0,
    3,
  );
  const reviewQueue = useMemo(
    () =>
      reviews.filter(
        (item) => item.review_required_flag || item.unknown_points.length > 0,
      ),
    [reviews],
  );
  const reviewQueueMemberIds = useMemo(
    () => reviewQueue.map((item) => item.member_id),
    [reviewQueue],
  );
  const selectedReviewQueueEntry = useMemo(
    () =>
      selectedMemberId
        ? reviewQueue.find((item) => item.member_id === selectedMemberId) || null
        : reviewQueue[0] || null,
    [reviewQueue, selectedMemberId],
  );
  const selectedReviewItems = useMemo(() => {
    if (!selectedReviewQueueEntry) {
      return [];
    }

    const items = selectedReviewQueueEntry.unknown_points.map((point, index) =>
      normalizeWizardPrompt(point, index),
    );

    if (selectedReviewQueueEntry.review_required_flag && items.length === 0) {
      items.push({
        title: "他者レビュー",
        detail: "このメンバーは他者レビューが必要です。確認が済んだら申請に進めます。",
      });
    }

    return items;
  }, [selectedReviewQueueEntry]);
  const activeReviewItem = selectedReviewItems[reviewWizardIndex] || null;

  // ── finalize state sync ──

  useEffect(() => {
    setFinalizeStates(
      buildInitialFinalizeStates(
        selectedForm,
        selectedReview,
        selectedFinalization,
        selectedProfile,
      ),
    );
    const moduleAqrInput =
      selectedModuleCloseInput &&
      typeof selectedModuleCloseInput.aqr_input === "object"
        ? (selectedModuleCloseInput.aqr_input as Record<string, unknown>)
        : null;
    setFinalizeLevel(
      selectedFinalization?.current_level ||
        selectedForm?.current_level ||
        selectedModuleCloseInput?.role_level ||
        selectedProfile?.current_level ||
        "",
    );
    setFinalizeWorkDays(selectedFinalization?.work_days ?? selectedForm?.work_days ?? 0);
    setFinalizeA(
      selectedFinalization?.A ??
        selectedForm?.A ??
        (toFiniteNumber(moduleAqrInput?.A) || 1),
    );
    setFinalizeR(
      selectedFinalization?.R ??
        selectedForm?.R ??
        (toFiniteNumber(moduleAqrInput?.R) || 1),
    );
    setFinalizeQ(
      selectedFinalization?.Q ??
        selectedForm?.Q ??
        (toFiniteNumber(moduleAqrInput?.Q) || 1),
    );
    setFinalizeComment(
      selectedFinalization?.comment || selectedConfirmations[0]?.comment || "",
    );
  }, [
    selectedForm,
    selectedMemberId,
    selectedReview,
    selectedFinalization,
    selectedProfile,
    selectedConfirmations,
    selectedModuleCloseInput,
  ]);

  // ── form input sync ──

  useEffect(() => {
    const nextForm = buildInitialFormInput(
      period,
      selectedMemberId,
      selectedForm,
      selectedModuleCloseInput,
      siteItemProfitSummary,
    );
    setFormInput(nextForm);
    setRoleInput(joinCsv(nextForm.selected_roles));
    setSiteInput(joinCsv(nextForm.site_ids));
  }, [
    period,
    selectedMemberId,
    selectedForm,
    selectedModuleCloseInput,
    siteItemProfitSummary,
  ]);

  useEffect(() => {
    const derivedLevel = derivePathLevelFromStates(formInput.selected_big_skill_states);
    if (formInput.current_level === derivedLevel) {
      return;
    }
    setFormInput((current) => ({
      ...current,
      current_level: derivePathLevelFromStates(current.selected_big_skill_states),
    }));
  }, [formInput.current_level, formInput.selected_big_skill_states]);

  useEffect(() => {
    setCorrectionMonth(nextMonthValue(period));
  }, [period]);

  // ── reward profit init ──

  useEffect(() => {
    setRewardProfitInputs(
      buildInitialRewardProfitInputsFromSiteItems(siteItemProfitSummary),
    );
    setRewardPriorAdjustments(
      buildInitialPriorAdjustments(moduleSummary?.reward_runs || []),
    );
  }, [moduleSummary, siteItemProfitSummary]);

  // ── close input derivation ──

  useEffect(() => {
    const selectedModuleClose =
      moduleSummary?.closes.find(
        (item) => item.member_id === selectedMemberId,
      ) || null;
    const closeExplanation = isRecord(selectedModuleClose?.explanation)
      ? selectedModuleClose.explanation
      : null;
    const annotationASummary = isRecord(selectedModuleAnnotationA?.annotation)
      ? toStringValue(selectedModuleAnnotationA.annotation.monthly_summary)
      : "";
    const annotationBRisk = isRecord(selectedModuleAnnotationB?.annotation)
      ? toStringValue(selectedModuleAnnotationB.annotation.risk_note)
      : "";
    const closeComment = toStringValue(selectedModuleCloseInput?.comment);
    const reviewerSummary = dedupeStrings([
      toStringValue(closeExplanation?.reviewer_summary),
      selectedReview?.monthly_summary,
      annotationASummary,
      annotationBRisk,
      closeComment,
    ]).join("\n");
    const annotationEvidenceIds = dedupeStrings([
      ...toStringArray(selectedModuleAnnotationA?.supporting_evidence_ids),
      ...toStringArray(selectedModuleAnnotationB?.supporting_evidence_ids),
      ...toStringArray(selectedModuleAnnotationB?.challenged_evidence_ids),
    ]);
    const closeEvidenceIds = dedupeStrings([
      ...toStringArray(selectedModuleClose?.evidence_ids),
      ...annotationEvidenceIds,
      ...selectedModuleEvidence.map((item) => item.id),
    ]);
    const observedTradeFamilies = getObservedTradeFamilies(
      selectedModuleCloseInput,
      selectedModuleEvidence,
    );
    const fallbackTradeFamily =
      selectedOpportunityAudit?.trade_family ||
      observedTradeFamilies[0] ||
      selectedModuleEvidence.find((item) => item.trade_family)?.trade_family ||
      "common_site_operations";
    const annotationBRecord = isRecord(selectedModuleAnnotationB?.annotation)
      ? selectedModuleAnnotationB.annotation
      : null;
    const missingEvidence = toStringArray(annotationBRecord?.missing_evidence);
    const contradictionFlags = toStringArray(
      annotationBRecord?.contradiction_flags,
    );
    const hasOpportunityConcern =
      missingEvidence.some((item) =>
        item.startsWith(`${fallbackTradeFamily}:`),
      ) ||
      contradictionFlags.some((item) =>
        item.startsWith(`${fallbackTradeFamily}:`),
      );
    const opportunityStatus =
      selectedOpportunityAudit?.opportunity_status ||
      (hasOpportunityConcern
        ? "recheck_required"
        : selectedModuleEvidence.some(
              (item) => item.trade_family === fallbackTradeFamily,
            )
          ? "observed"
          : observedTradeFamilies.includes(fallbackTradeFamily)
            ? "opportunity_not_granted"
            : "not_observed");
    const opportunityScore =
      selectedOpportunityAudit?.opportunity_concentration_score ||
      (selectedModuleEvidence.length > 0
        ? Number(
            (
              selectedModuleEvidence.filter(
                (item) => item.trade_family === fallbackTradeFamily,
              ).length / selectedModuleEvidence.length
            ).toFixed(2),
          )
        : 0);
    const protectedChallengeCount =
      selectedOpportunityAudit?.protected_challenge_count ||
      missingEvidence.filter((item) =>
        item.startsWith(`${fallbackTradeFamily}:`),
      ).length;
    const promotionBlocked =
      selectedOpportunityAudit?.promotion_blocked_by_opportunity ||
      (isRecord(selectedModuleAnnotationA?.annotation) &&
        selectedModuleAnnotationA.annotation.promotion_candidate_flag ===
          true &&
        hasOpportunityConcern);

    setCloseCreditedUnits(selectedFinalization?.work_days || 0);
    setCloseReviewerSummary(reviewerSummary);
    setCloseNeutralFlagsInput(
      joinCsv(toStringArray(selectedModuleClose?.neutral_flags)),
    );
    setCloseEvidenceInput(closeEvidenceIds.join("\n"));
    setCloseOpportunityTradeFamily(fallbackTradeFamily);
    setCloseOpportunityStatus(
      isOpportunityStatus(opportunityStatus) ? opportunityStatus : "observed",
    );
    setCloseOpportunityDays(
      toFiniteNumber(selectedOpportunityAudit?.eligible_but_unassigned_days) ||
        0,
    );
    setCloseOpportunityScore(opportunityScore);
    setCloseProtectedChallengeCount(protectedChallengeCount);
    setClosePromotionBlocked(Boolean(promotionBlocked));
  }, [
    moduleSummary,
    selectedFinalization,
    selectedMemberId,
    selectedModuleAnnotationA,
    selectedModuleAnnotationB,
    selectedModuleCloseInput,
    selectedModuleEvidence,
    selectedOpportunityAudit,
    selectedReview,
  ]);

  // ── reward member seeding ──

  useEffect(() => {
    const seedIds =
      rewardCandidateIds.length > 0
        ? rewardCandidateIds
        : selectedMemberId
          ? [selectedMemberId]
          : [];

    setRewardMembers((current) => {
      const currentById = new Map(
        current
          .filter((item) => item.member_id)
          .map((item) => [item.member_id, item] as const),
      );
      const seededRows = seedIds.map(
        (memberId) =>
          currentById.get(memberId) ||
          buildRewardMemberDraft(
            memberId,
            memberMap,
            finalizationMap,
            profileMap,
            period,
            moduleCloseInputMap.get(memberId),
            moduleEvidenceByMemberMap.get(memberId) || [],
            siteItemProfitSummary,
            null,
          ),
      );
      const manualRows = current.filter(
        (item) => item.member_id && !seedIds.includes(item.member_id),
      );

      if (seededRows.length === 0 && manualRows.length === 0) {
        return [buildEmptyRewardMember()];
      }

      return [...seededRows, ...manualRows];
    });
    setRewardPreview(null);
  }, [
    rewardCandidateIds,
    selectedMemberId,
    memberMap,
    finalizationMap,
    profileMap,
    period,
    moduleCloseInputMap,
    moduleEvidenceByMemberMap,
    siteItemProfitSummary,
  ]);

  useEffect(() => {
    setRewardPreview(null);
  }, [rewardMembers, rewardProfitInputs, rewardPriorAdjustments]);

  // ── calculation runs ──

  const pathCalculationRuns = useMemo(
    () => buildPathCalculationRuns(pathCalculations),
    [pathCalculations],
  );
  const currentMonthPathRun = useMemo(
    () => pathCalculationRuns.find((run) => run.month === period) || null,
    [pathCalculationRuns, period],
  );
  const latestEligibleModuleClose = moduleSummary?.eligible_closes?.[0] || null;
  const latestModuleCloseId =
    moduleSummary?.latest_eligible_month_close_id ||
    latestEligibleModuleClose?.id ||
    null;
  const latestModuleClose = latestModuleCloseId
    ? moduleSummary?.closes.find((item) => item.id === latestModuleCloseId) ||
      null
    : null;
  const latestModuleRewardRun = moduleSummary?.reward_runs?.[0] || null;
  const selectedCorrectionRun =
    moduleSummary?.reward_runs.find(
      (item) => item.id === correctionRewardRunId,
    ) ||
    latestModuleRewardRun ||
    null;
  const selectedRewardExplanationRecord = isRecord(
    selectedRewardExplanation?.explanation_json,
  )
    ? selectedRewardExplanation.explanation_json
    : null;
  const selectedRewardPayload = isRecord(selectedCorrectionRun?.reward_payload)
    ? selectedCorrectionRun.reward_payload
    : null;
  const selectedRewardPayout = selectedRewardPayload
    ? getRecordArray(selectedRewardPayload.member_payouts).find(
        (item) => item.member_id === selectedMemberId,
      ) || null
    : null;
  const selectedRewardExplanationMeta = isRecord(
    selectedRewardExplanationRecord?.explanations,
  )
    ? selectedRewardExplanationRecord.explanations
    : null;
  const latestModuleRewardPayload = isRecord(latestModuleRewardRun?.reward_payload)
    ? latestModuleRewardRun.reward_payload
    : null;
  const latestModuleRewardPayouts = useMemo(
    () =>
      latestModuleRewardPayload
        ? getRecordArray(latestModuleRewardPayload.member_payouts)
        : [],
    [latestModuleRewardPayload],
  );
  const selectedRewardReasonCodes = dedupeStrings(
    toStringArray(selectedRewardExplanationMeta?.["reason_codes"]),
  );
  const rewardExplanationMonthLabel =
    selectedRewardExplanation?.month || selectedCorrectionRun?.month || period;
  const rewardExplanationRenderedLabel = selectedRewardExplanation?.rendered_at
    ? formatDateTime(selectedRewardExplanation.rendered_at)
    : "rendered_at なし";
  const rewardExplanationSummary = selectedRewardExplanationRecord
    ? toPlainText(
        selectedRewardExplanationMeta || selectedRewardExplanationRecord,
      )
    : "";
  const currentMonthRewardMemberIds = useMemo(
    () =>
      new Set(
        latestModuleRewardPayouts
          .map((member) => toStringValue(member.member_id))
          .filter(Boolean),
      ),
    [latestModuleRewardPayouts],
  );
  const latestPathCalculation = pathCalculationRuns[0] || null;
  const latestLuqoCalculation = luqoCalculations[0] || null;

  // ── correction state ──

  useEffect(() => {
    if (latestModuleRewardRun?.id) {
      setCorrectionRewardRunId(latestModuleRewardRun.id);
    } else {
      setCorrectionRewardRunId("");
    }
  }, [latestModuleRewardRun]);

  // ── reward explanation fetching ──

  useEffect(() => {
    if (!selectedMemberId) {
      setSelectedRewardExplanation(null);
      return;
    }

    const explanationMonth = selectedCorrectionRun?.month || period;
    let cancelled = false;

    void fetchPathModuleRewardExplanation(selectedMemberId, explanationMonth)
      .then((response) => {
        if (!cancelled) {
          setSelectedRewardExplanation(response.explanation);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedRewardExplanation(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [period, selectedCorrectionRun, selectedMemberId]);

  // ── expense fetching ──

  useEffect(() => {
    if (!selectedMemberId) {
      setSelectedMemberExpenseAmount(0);
      setSelectedMemberExpenseLoading(false);
      return;
    }

    const { dateFrom, dateTo } = getMonthDateRange(period);
    let cancelled = false;

    setSelectedMemberExpenseLoading(true);
    void fetchTransactions({
      kind: "expense",
      created_by: selectedMemberId,
      date_from: dateFrom,
      date_to: dateTo,
      limit: 200,
    })
      .then((transactions) => {
        if (cancelled) {
          return;
        }

        const total = transactions.reduce((sum, transaction) => {
          if (
            transaction.status === "rejected" ||
            transaction.status === "voided"
          ) {
            return sum;
          }

          return sum + (Number(transaction.amount_total) || 0);
        }, 0);

        setSelectedMemberExpenseAmount(total);
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedMemberExpenseAmount(0);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSelectedMemberExpenseLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [period, selectedMemberId]);

  // ── correction note building ──

  useEffect(() => {
    const rewardPayload = isRecord(selectedCorrectionRun?.reward_payload)
      ? selectedCorrectionRun.reward_payload
      : null;
    const memberPayout = rewardPayload
      ? getRecordArray(rewardPayload.member_payouts).find(
          (item) => item.member_id === selectedMemberId,
        ) || null
      : null;
    const explanation = rewardPayload
      ? getRecordArray(rewardPayload.explanations).find(
          (item) => item.member_id === selectedMemberId,
        ) || null
      : null;
    const explanationSnapshot = isRecord(
      selectedRewardExplanation?.explanation_json,
    )
      ? selectedRewardExplanation.explanation_json
      : null;
    const explanationMeta = isRecord(explanationSnapshot?.explanations)
      ? explanationSnapshot.explanations
      : null;
    const explanationDetails =
      explanation && isRecord(explanation["explanations"])
        ? explanation["explanations"]
        : null;
    const reasonCodes = dedupeStrings([
      ...toStringArray(explanationDetails?.["reason_codes"]),
      ...toStringArray(explanationMeta?.["reason_codes"]),
    ]);
    const summary = dedupeStrings([
      selectedCorrectionRun
        ? `${selectedCorrectionRun.month} ${selectedCorrectionRun.run_type} run を基準に補正`
        : "",
      selectedMemberId
        ? `${displayMemberName(selectedMemberId, memberMap)} の見直し`
        : "",
      memberPayout && toOptionalNumber(memberPayout.final_pay) !== null
        ? `前回支給額 ${formatCurrency(toFiniteNumber(memberPayout.final_pay))}`
        : "",
      memberPayout && toStringValue(memberPayout.role_level)
        ? `Level ${toStringValue(memberPayout.role_level)}`
        : "",
      memberPayout &&
      [memberPayout.A, memberPayout.R, memberPayout.Q].every(
        (value) => toOptionalNumber(value) !== null,
      )
        ? `A/R/Q ${toFiniteNumber(memberPayout.A)}/${toFiniteNumber(memberPayout.R)}/${toFiniteNumber(memberPayout.Q)}`
        : "",
      explanationSnapshot &&
      toOptionalNumber(explanationSnapshot.final_pay) !== null
        ? `explanation支給額 ${formatCurrency(toFiniteNumber(explanationSnapshot.final_pay))}`
        : "",
      reasonCodes.length > 0 ? `根拠 ${reasonCodes.join(", ")}` : "",
    ]).join(" / ");

    setCorrectionNote(summary);
  }, [
    correctionRewardRunId,
    memberMap,
    selectedCorrectionRun,
    selectedMemberId,
    selectedRewardExplanation,
  ]);

  // ── workflow helper ──

  const getMemberWorkflow = useCallback(
    (memberId: string): MemberWorkflowSummary => {
      const form = formMap.get(memberId);
      const review = reviewMap.get(memberId);
      const finalization = finalizationMap.get(memberId);
      const rewardDone = currentMonthRewardMemberIds.has(memberId);

      if (rewardDone) {
        return {
          stage: "done",
          label: "報酬確認済み",
          tone: "good",
          nextAction: "完了",
          description: "今月の評価と報酬確認は完了しています。",
        };
      }

      if (finalization) {
        return {
          stage: "needs_reward",
          label: "評価確定済み",
          tone: "info",
          nextAction: "報酬確認",
          description: "評価は確定済みです。今月の報酬確認に進めます。",
        };
      }

      if (review?.review_required_flag) {
        return {
          stage: "needs_finalize",
          label: "確認待ち",
          tone: "warn",
          nextAction: "ベル確認",
          description:
            "AI下書きに未確認ポイントがあります。ベルからレビュー確認を開いて進めます。",
        };
      }

      if (review) {
        return {
          stage: "needs_finalize",
          label: "AI下書き済み",
          tone: "info",
          nextAction: "評価確定",
          description:
            "AIが下書きを整理済みです。内容を見て今月の評価を確定します。",
        };
      }

      if (form) {
        return {
          stage: "needs_ai",
          label: "入力済み",
          tone: "neutral",
          nextAction: "AI下書き",
          description:
            "今月の入力は保存済みです。AI整理を作ると確認が進めやすくなります。",
        };
      }

      return {
        stage: "missing_form",
        label: "未入力",
        tone: "warn",
        nextAction: "今月の入力",
        description: "まずは今月の作業内容を入力して、評価の土台を作ります。",
      };
    },
    [currentMonthRewardMemberIds, finalizationMap, formMap, reviewMap],
  );

  // ── comparison / derived ──

  const rewardComparisonRows = useMemo(() => {
    if (!latestPathCalculation && !latestLuqoCalculation) {
      return [];
    }

    const pathMemberMap = new Map(
      latestPathCalculation?.members.map(
        (member) => [member.member_id, member] as const,
      ) || [],
    );
    const luqoMemberMap = new Map(
      latestLuqoCalculation?.breakdown.map(
        (member) => [member.member_id, member] as const,
      ) || [],
    );
    const compMemberIds = Array.from(
      new Set([...pathMemberMap.keys(), ...luqoMemberMap.keys()]),
    );

    return compMemberIds
      .map((memberId) => {
        const pathMember = pathMemberMap.get(memberId);
        const luqoMember = luqoMemberMap.get(memberId);
        const memberName = displayMemberName(
          memberId,
          memberMap,
          pathMember?.name || luqoMember?.name || null,
        );
        const pathAmount = pathMember?.total_reward || 0;
        const luqoAmount = luqoMember?.amount || 0;

        return {
          member_id: memberId,
          name: memberName,
          pathAmount,
          luqoAmount,
          delta: pathAmount - luqoAmount,
        };
      })
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  }, [latestLuqoCalculation, latestPathCalculation, memberMap]);
  const comparisonDeltaTotal = useMemo(
    () => rewardComparisonRows.reduce((sum, row) => sum + row.delta, 0),
    [rewardComparisonRows],
  );
  const selectedMemberWorkflow = useMemo(
    () => (selectedMemberId ? getMemberWorkflow(selectedMemberId) : null),
    [getMemberWorkflow, selectedMemberId],
  );
  const selectedMemberCurrentReward = useMemo(() => {
    const explanationReward = toOptionalNumber(
      selectedRewardExplanationRecord?.final_pay,
    );
    if (explanationReward !== null) {
      return explanationReward;
    }

    const payoutReward = toOptionalNumber(selectedRewardPayout?.final_pay);
    if (payoutReward !== null) {
      return payoutReward;
    }

    const currentPathReward =
      currentMonthPathRun?.members.find(
        (member) => member.member_id === selectedMemberId,
      )?.total_reward ?? null;

    return typeof currentPathReward === "number" ? currentPathReward : null;
  }, [
    currentMonthPathRun,
    selectedMemberId,
    selectedRewardExplanationRecord,
    selectedRewardPayout,
  ]);
  const selectedMemberRewardDisplayKind = useMemo<
    "confirmed" | "estimate" | "pending"
  >(() => {
    const explanationReward = toOptionalNumber(
      selectedRewardExplanationRecord?.final_pay,
    );
    if (explanationReward !== null) {
      return "confirmed";
    }

    const payoutReward = toOptionalNumber(selectedRewardPayout?.final_pay);
    if (payoutReward !== null) {
      return "confirmed";
    }

    const currentPathReward =
      currentMonthPathRun?.members.find(
        (member) => member.member_id === selectedMemberId,
      )?.total_reward ?? null;

    return typeof currentPathReward === "number" ? "estimate" : "pending";
  }, [
    currentMonthPathRun,
    selectedMemberId,
    selectedRewardExplanationRecord,
    selectedRewardPayout,
  ]);
  const selectedRewardCardNote = useMemo(() => {
    const parts = dedupeStrings([
      selectedRewardExplanationRecord ? rewardExplanationRenderedLabel : "",
      selectedRewardReasonCodes.slice(0, 2).join(" / "),
    ]);

    return parts.join(" / ");
  }, [
    rewardExplanationRenderedLabel,
    selectedRewardExplanationRecord,
    selectedRewardReasonCodes,
  ]);
  const selectedRewardCardBreakdown = useMemo<RewardCardBreakdown | null>(() => {
    const explanationSource = isRecord(selectedRewardExplanationRecord)
      ? selectedRewardExplanationRecord
      : isRecord(selectedRewardPayout)
        ? selectedRewardPayout
        : null;
    const explanationMeta = isRecord(selectedRewardExplanationMeta)
      ? selectedRewardExplanationMeta
      : explanationSource && isRecord(explanationSource.explanations)
        ? explanationSource.explanations
        : null;

    if (!explanationSource) {
      return null;
    }

    const finalPay = toOptionalNumber(explanationSource.final_pay);
    const baseAmount = toOptionalNumber(explanationSource.base_amount);
    const variableAmount = toOptionalNumber(explanationSource.variable_amount);
    const calculatedPay = toOptionalNumber(explanationSource.calculated_pay);
    const guaranteedPay = toOptionalNumber(explanationSource.guaranteed_pay);
    const guaranteeAdjustment = toOptionalNumber(
      explanationSource.guarantee_adjustment,
    );
    const creditedUnits = toOptionalNumber(explanationSource.credited_units);
    const monthlyPointTotal = toOptionalNumber(
      explanationSource.monthly_point_total,
    );
    const monthlyCoefficient = toOptionalNumber(
      explanationSource.monthly_coefficient,
    );
    const packagePointsTotal = toOptionalNumber(
      explanationSource.package_points_total,
    );
    const baseWeight = toOptionalNumber(explanationSource.base_weight);
    const variableWeight = toOptionalNumber(explanationSource.variable_weight);
    const levelCoefficient = toOptionalNumber(explanationMeta?.level_coefficient);
    const level = toStringValue(explanationSource.role_level);
    const A = toOptionalNumber(explanationSource.A);
    const R = toOptionalNumber(explanationSource.R);
    const Q = toOptionalNumber(explanationSource.Q);

    if (finalPay === null || baseAmount === null || variableAmount === null) {
      return null;
    }

    const calculatedAmount = calculatedPay ?? baseAmount + variableAmount;
    const guaranteeApplied =
      (guaranteeAdjustment ?? 0) > 0 ||
      (guaranteedPay !== null && guaranteedPay > calculatedAmount);
    const formula =
      guaranteeApplied && guaranteedPay !== null
        ? `${formatCurrency(baseAmount)} + ${formatCurrency(variableAmount)} = ${formatCurrency(calculatedAmount)} → 最低保証で ${formatCurrency(finalPay)}`
        : `${formatCurrency(baseAmount)} + ${formatCurrency(variableAmount)} = ${formatCurrency(finalPay)}`;

    const inputs = [
      level
        ? {
            label: "Level",
            value: level,
            helper:
              levelCoefficient !== null
                ? `係数 ${levelCoefficient.toFixed(2)}`
                : undefined,
          }
        : null,
      A !== null && R !== null && Q !== null
        ? {
            label: "A/R/Q",
            value: `${A} / ${R} / ${Q}`,
            helper:
              monthlyPointTotal !== null
                ? `合計 ${monthlyPointTotal.toFixed(0)}`
                : undefined,
          }
        : null,
      monthlyCoefficient !== null
        ? {
            label: "月係数",
            value: monthlyCoefficient.toFixed(2),
            helper:
              variableWeight !== null
                ? `変動重み ${variableWeight.toFixed(2)}`
                : undefined,
          }
        : null,
      creditedUnits !== null
        ? {
            label: "稼働",
            value: `${creditedUnits.toFixed(1)} 日`,
            helper:
              baseWeight !== null
                ? `ベース重み ${baseWeight.toFixed(2)}`
                : undefined,
          }
        : null,
      packagePointsTotal !== null
        ? {
            label: "変動点",
            value: `${packagePointsTotal.toFixed(2)} pt`,
          }
        : null,
      guaranteedPay !== null
        ? {
            label: "最低保証",
            value: formatCurrency(guaranteedPay),
            helper: guaranteeApplied ? "今回適用" : "今回未適用",
          }
        : null,
    ].filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      formula,
      note: guaranteeApplied
        ? "ベースと変動の合計より最低保証が高いため、保証額を使っています。"
        : "ベース配分と変動配分の合計が今月の支給額です。",
      inputs,
    };
  }, [
    selectedRewardExplanationMeta,
    selectedRewardExplanationRecord,
    selectedRewardPayout,
  ]);
  const focusedPendingProposal = useMemo(
    () =>
      focusProposalId
        ? modulePendingProposals.find(
            (proposal) => proposal.id === focusProposalId,
          ) || null
        : null,
    [focusProposalId, modulePendingProposals],
  );

  // ── proposal focus ──

  useEffect(() => {
    if (!focusedPendingProposal) {
      return;
    }

    const context = getPathProposalContext(focusedPendingProposal);
    if (context?.month && context.month !== period) {
      setPeriod(context.month);
    }
    if (
      context?.memberId &&
      memberIds.includes(context.memberId) &&
      context.memberId !== selectedMemberId
    ) {
      setSelectedMemberId(context.memberId);
    }
  }, [focusedPendingProposal, memberIds, period, selectedMemberId]);

  // ── review wizard state ──

  useEffect(() => {
    if (!selectedReviewQueueEntry) {
      setReviewWizardIndex(0);
      setReviewAnswers({});
      return;
    }

    setReviewWizardIndex(0);
    setReviewAnswers({});
  }, [selectedReviewQueueEntry]);

  // ── URL params ──

  useEffect(() => {
    const shouldOpenReviewInbox = searchParams.get("review_inbox") === "1";
    const requestedMemberId = searchParams.get("member");

    if (!shouldOpenReviewInbox) {
      return;
    }

    if (
      requestedMemberId &&
      reviewQueueMemberIds.includes(requestedMemberId) &&
      requestedMemberId !== selectedMemberId
    ) {
      setSelectedMemberId(requestedMemberId);
    }

    if (reviewQueue.length > 0) {
      setReviewWizardOpen(true);
    }
  }, [reviewQueue, reviewQueueMemberIds, searchParams, selectedMemberId]);

  // ── motion props ──

  const motionProps = shouldReduceMotion
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  // ── event handlers ──

  const updateRewardMember = useCallback(
    (
      index: number,
      updater: (current: RewardMemberDraft) => RewardMemberDraft,
    ) => {
      setRewardPreview(null);
      setRewardMembers((current) =>
        current.map((item, itemIndex) =>
          itemIndex === index ? updater(item) : item,
        ),
      );
    },
    [],
  );
  const selectRewardMember = useCallback(
    (index: number, memberId: string) => {
      setRewardPreview(null);
      updateRewardMember(index, () =>
        memberId
          ? buildRewardMemberDraft(
              memberId,
              memberMap,
              finalizationMap,
              profileMap,
              period,
              moduleCloseInputMap.get(memberId),
              moduleEvidenceByMemberMap.get(memberId) || [],
              siteItemProfitSummary,
              null,
            )
          : buildEmptyRewardMember(),
      );
    },
    [
      finalizationMap,
      memberMap,
      moduleCloseInputMap,
      moduleEvidenceByMemberMap,
      period,
      profileMap,
      siteItemProfitSummary,
      updateRewardMember,
    ],
  );

  const addRewardMember = useCallback(() => {
    setRewardPreview(null);
    setRewardMembers((current) => [...current, buildEmptyRewardMember()]);
  }, []);

  const removeRewardMember = useCallback((index: number) => {
    setRewardPreview(null);
    setRewardMembers((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index);
      return next.length > 0 ? next : [buildEmptyRewardMember()];
    });
  }, []);

  const buildRewardRequest = useCallback(() => {
    return {
      month_close_id: latestModuleCloseId || "",
    };
  }, [
    latestModuleCloseId,
  ]);

  const handleFinalizeSubmit = async (memberId?: string | null) => {
    const targetMemberId = memberId || selectedMemberId;

    if (!targetMemberId) {
      setError("対象メンバーを選択してください");
      return;
    }

    setSubmittingFinalize(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await createPathFinalizeProposal({
        month: period,
        member_id: targetMemberId,
        confirmed_states: finalizeStates,
        work_days: finalizeWorkDays,
        A: finalizeA,
        R: finalizeR,
        Q: finalizeQ,
        current_level: finalizeLevel
          ? (finalizeLevel as (typeof PATH_LEVEL_OPTIONS)[number])
          : null,
        comment: finalizeComment.trim() || undefined,
      });

      setSuccess(
        `評価確定の申請を作成しました: ${result.proposal.id.slice(0, 8)}...`,
      );
      setReviewWizardOpen(false);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "���価確定の申請作成に失敗しました",
      );
    } finally {
      setSubmittingFinalize(false);
    }
  };

  const closeReviewWizard = useCallback(() => {
    setReviewWizardOpen(false);
    const next = new URLSearchParams(searchParams);
    next.delete("review_inbox");
    next.delete("member");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleFormSubmit = async () => {
    if (!selectedMemberId) {
      setError("対象メンバーを選択してください");
      return;
    }

    setSubmittingForm(true);
    setError(null);
    setSuccess(null);

    try {
      await savePathForm({
        ...formInput,
        month: period,
        member_id: selectedMemberId,
        selected_roles: splitCsv(roleInput),
        site_ids: splitCsv(siteInput),
      });

      setSuccess(
        `月末フォームを保存しました: ${displayMemberName(selectedMemberId, memberMap)}`,
      );
      setIsMonthlyFormWizardOpen(false);
      setMonthlyFormWizardStepIndex(0);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "月末フォームの保存に失敗しました",
      );
    } finally {
      setSubmittingForm(false);
    }
  };

  const handleCertificationSubmit = async () => {
    if (!selectedMemberId || !skillKey.trim() || !skillCategory.trim()) {
      setError("対象メンバー・技能キー・カテゴリを入力してください");
      return;
    }

    setSubmittingCertification(true);
    setError(null);
    setSuccess(null);

    try {
      const action = skillStatus === "revoked" ? "revoke" : "achieve";
      const result = await createPathSkillProposal({
        action,
        member_id: selectedMemberId,
        skill_key: skillKey.trim(),
        category: skillCategory.trim(),
        status: skillStatus,
        evidence_count: skillEvidenceCount,
        note: skillNote.trim() || undefined,
        review_required_flag: skillReviewRequired,
      });

      setSuccess(
        `技能認定の申請を作成しました: ${result.proposal.id.slice(0, 8)}...`,
      );
      setSkillKey("");
      setSkillCategory("");
      setSkillStatus("verified");
      setSkillEvidenceCount(1);
      setSkillNote("");
      setSkillReviewRequired(false);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "技能認定の申請作成に失敗しました",
      );
    } finally {
      setSubmittingCertification(false);
    }
  };

  const handleRewardPreview = async () => {
    if (!latestModuleCloseId) {
      setError("報酬化可能な fixed close がありません");
      return;
    }

    setPreviewingReward(true);
    setError(null);
    setSuccess(null);

    try {
      const preview = await previewPathModuleRewardRun(buildRewardRequest());
      setRewardPreview(preview);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "PATH報酬プレビューの取得に失敗しました",
      );
    } finally {
      setPreviewingReward(false);
    }
  };

  const handleRewardProposalSubmit = async () => {
    if (!latestModuleCloseId) {
      setError("報酬化可能な fixed close がありません");
      return;
    }

    setSubmittingReward(true);
    setError(null);
    setSuccess(null);

    try {
      const result =
        await createPathModuleRewardRunProposal(buildRewardRequest());
      setRewardPreview(result.preview);
      if (result.reused_existing) {
        const proposalLabel = result.proposal?.id
          ? result.proposal.id.slice(0, 8)
          : null;
        const rewardRunLabel = result.existing_reward_run?.id
          ? String(result.existing_reward_run.id).slice(0, 8)
          : null;
        setSuccess(
          proposalLabel
            ? `既存の報酬申請を再利用しました: ${proposalLabel}...`
            : rewardRunLabel
              ? `既存の支給 run を再利用しました: ${rewardRunLabel}...`
              : "既存の支給 run を再利用しました",
        );
      } else {
        setSuccess(
          result.proposal?.id
            ? `今月の報酬申請を作成しました: ${result.proposal.id.slice(0, 8)}...`
            : "今月の報酬申請を処理しました",
        );
      }
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "今月の報酬申請作成に失敗しました",
      );
    } finally {
      setSubmittingReward(false);
    }
  };

  const handleMonthCloseProposalSubmit = async () => {
    if (!selectedMemberId) {
      setError("対象メンバーを選択してください");
      return;
    }

    setSubmittingMonthClose(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await createPathModuleMonthCloseProposal({
        month: period,
        member_id: selectedMemberId,
        current_role_level: finalizeLevel ? (finalizeLevel as PathLevel) : null,
        A: finalizeA,
        R: finalizeR,
        Q: finalizeQ,
        selected_site_ids: splitCsv(siteInput),
        neutral_flags: splitCsv(closeNeutralFlagsInput),
        evidence_ids: splitLines(closeEvidenceInput),
        credited_units: [
          {
            member_id: selectedMemberId,
            unit_type: "work_day",
            units: Number(closeCreditedUnits) || 0,
            source_id: `path-tab:${period}:${selectedMemberId}`,
            metadata: { source: "path-tab" },
          },
        ],
        opportunity_audits: [
          {
            member_id: selectedMemberId,
            trade_family: closeOpportunityTradeFamily,
            opportunity_status: closeOpportunityStatus,
            eligible_but_unassigned_days: Number(closeOpportunityDays) || 0,
            opportunity_concentration_score: Number(closeOpportunityScore) || 0,
            promotion_blocked_by_opportunity: closePromotionBlocked,
            protected_challenge_count:
              Number(closeProtectedChallengeCount) || 0,
            summary: {
              note: closeReviewerSummary.trim() || "path-tab month close",
            },
          },
        ],
        explanation: {
          reviewer_summary: closeReviewerSummary.trim() || undefined,
        },
      });
      setSuccess(
        `月締め申請を作成しました: ${result.proposal.id.slice(0, 8)}...`,
      );
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "月締め申請の作成に失敗しました",
      );
    } finally {
      setSubmittingMonthClose(false);
    }
  };

  const handleRewardCorrectionSubmit = async () => {
    if (!selectedMemberId) {
      setError("対象メンバーを選択してください");
      return;
    }
    if (!correctionRewardRunId) {
      setError("対象の支給 run を選択してください");
      return;
    }

    setSubmittingCorrection(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await createPathModuleRewardAdjustmentProposal({
        reward_run_id: correctionRewardRunId,
        correction_month: correctionMonth,
        mode: correctionMode,
        reason_code: correctionReasonCode.trim() || "manual_review",
        member_adjustments: [
          {
            member_id: selectedMemberId,
            amount: Number(correctionAmount) || 0,
            explanation: {
              note: correctionNote.trim() || "path-tab correction",
            },
          },
        ],
        note: correctionNote.trim() || undefined,
      });
      setSuccess(
        `補正申請を作成しました: ${result.proposal.id.slice(0, 8)}...`,
      );
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "補正申請の作成に失敗しました",
      );
    } finally {
      setSubmittingCorrection(false);
    }
  };

  const handleApprovePendingProposal = async (
    proposal: PathModulePendingProposal,
  ) => {
    setReviewingProposalId(proposal.id);
    setError(null);
    setSuccess(null);

    try {
      await approveProposal(
        proposal.id,
        `PATH tab approval: ${proposal.description}`,
      );
      setSuccess(`承認しました: ${proposal.description}`);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "proposal の承認に失敗しました",
      );
    } finally {
      setReviewingProposalId(null);
    }
  };

  const handleRejectPendingProposal = async (
    proposal: PathModulePendingProposal,
  ) => {
    const reason = window.prompt(
      "却下理由を入力してください",
      "PATH tab reject",
    );
    if (!reason || !reason.trim()) {
      return;
    }

    setReviewingProposalId(proposal.id);
    setError(null);
    setSuccess(null);

    try {
      await rejectProposal(proposal.id, reason.trim());
      setSuccess(`却下しました: ${proposal.description}`);
      await load();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "proposal の却下に失敗しました",
      );
    } finally {
      setReviewingProposalId(null);
    }
  };

  return {
    // period
    period,
    setPeriod,
    // data
    members,
    memberMap,
    memberIds,
    memberOptions,
    // selected member
    selectedMemberId,
    setSelectedMemberId,
    selectedForm,
    selectedReview,
    selectedFinalization,
    selectedProfile,
    selectedConfirmations,
    selectedCertifications,
    selectedModuleCloseInput,
    selectedModuleEvidence,
    selectedModuleAnnotationA,
    selectedModuleAnnotationB,
    selectedAnnotationCount,
    selectedOpportunityAudit,
    selectedVerifiedCertifications,
    selectedReviewCertificationCount,
    selectedCertificationHighlights,
    selectedRewardExplanation,
    selectedRewardExplanationRecord,
    selectedRewardPayload,
    selectedRewardPayout,
    selectedRewardExplanationMeta,
    selectedRewardReasonCodes,
    selectedMemberExpenseAmount,
    selectedMemberExpenseLoading,
    selectedMemberWorkflow,
    selectedMemberCurrentReward,
    selectedMemberRewardDisplayKind,
    selectedRewardCardNote,
    selectedRewardCardBreakdown,
    selectedCorrectionRun,
    // forms
    formInput,
    setFormInput,
    roleInput,
    setRoleInput,
    siteInput,
    setSiteInput,
    isMonthlyFormWizardOpen,
    setIsMonthlyFormWizardOpen,
    monthlyFormWizardStepIndex,
    setMonthlyFormWizardStepIndex,
    // finalize
    finalizeStates,
    setFinalizeStates,
    finalizeLevel,
    setFinalizeLevel,
    finalizeWorkDays,
    setFinalizeWorkDays,
    finalizeA,
    setFinalizeA,
    finalizeR,
    setFinalizeR,
    finalizeQ,
    setFinalizeQ,
    finalizeComment,
    setFinalizeComment,
    // skill certification
    skillKey,
    setSkillKey,
    skillCategory,
    setSkillCategory,
    skillStatus,
    setSkillStatus,
    skillEvidenceCount,
    setSkillEvidenceCount,
    skillNote,
    setSkillNote,
    skillReviewRequired,
    setSkillReviewRequired,
    // reward
    rewardProfitInputs,
    setRewardProfitInputs,
    rewardMembers,
    rewardPreview,
    rewardPriorAdjustments,
    setRewardPriorAdjustments,
    rewardExplanationMonthLabel,
    rewardExplanationRenderedLabel,
    rewardExplanationSummary,
    rewardComparisonRows,
    comparisonDeltaTotal,
    // month close
    closeEvidenceInput,
    setCloseEvidenceInput,
    closeNeutralFlagsInput,
    setCloseNeutralFlagsInput,
    closeCreditedUnits,
    setCloseCreditedUnits,
    closeOpportunityTradeFamily,
    setCloseOpportunityTradeFamily,
    closeOpportunityStatus,
    setCloseOpportunityStatus,
    closeOpportunityDays,
    setCloseOpportunityDays,
    closeOpportunityScore,
    setCloseOpportunityScore,
    closeProtectedChallengeCount,
    setCloseProtectedChallengeCount,
    closePromotionBlocked,
    setClosePromotionBlocked,
    closeReviewerSummary,
    setCloseReviewerSummary,
    moduleSummary,
    // correction
    correctionRewardRunId,
    setCorrectionRewardRunId,
    correctionMonth,
    setCorrectionMonth,
    correctionMode,
    setCorrectionMode,
    correctionReasonCode,
    setCorrectionReasonCode,
    correctionAmount,
    setCorrectionAmount,
    correctionNote,
    setCorrectionNote,
    // calculations
    pathCalculationRuns,
    currentMonthPathRun,
    latestModuleClose,
    latestModuleCloseId,
    latestModuleRewardRun,
    latestPathCalculation,
    latestLuqoCalculation,
    luqoCalculations,
    // pending proposals
    modulePendingProposals,
    focusedPendingProposal,
    // review wizard
    reviewQueue,
    reviewQueueMemberIds,
    reviewWizardOpen,
    setReviewWizardOpen,
    reviewWizardIndex,
    setReviewWizardIndex,
    reviewAnswers,
    setReviewAnswers,
    selectedReviewQueueEntry,
    selectedReviewItems,
    activeReviewItem,
    // loading & submission
    loading,
    submittingForm,
    submittingFinalize,
    submittingCertification,
    submittingMonthClose,
    previewingReward,
    submittingReward,
    submittingCorrection,
    reviewingProposalId,
    error,
    success,
    // motion
    motionProps,
    // site item profit
    siteItemProfitSummary,
    // actions
    load,
    getMemberWorkflow,
    updateRewardMember,
    selectRewardMember,
    addRewardMember,
    removeRewardMember,
    buildRewardRequest,
    handleFinalizeSubmit,
    closeReviewWizard,
    handleFormSubmit,
    handleCertificationSubmit,
    handleRewardPreview,
    handleRewardProposalSubmit,
    handleMonthCloseProposalSubmit,
    handleRewardCorrectionSubmit,
    handleApprovePendingProposal,
    handleRejectPendingProposal,
  };
}
