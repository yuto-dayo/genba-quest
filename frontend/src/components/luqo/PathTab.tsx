import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  BIG_SKILL_LABELS,
  BIG_SKILL_STATE_LABELS,
  OPPORTUNITY_STATUS_LABELS,
  QUALITY_RESULT_LABELS,
  REWORK_FLAG_LABELS,
  ROLE_TYPE_LABELS,
  TRADE_FAMILY_LABELS,
} from "./pathTab/constants";
import {
  buildRewardSourceLineageCards,
  buildSelectedSiteSummary,
  displayMemberName,
  formatCurrency,
  formatDateTime,
  formatProposalKind,
  toFiniteNumber,
  previousMonthValue,
  nextMonthValue,
} from "./pathTab/helpers";
import { usePathTabState } from "./pathTab/usePathTabState";
import type { PathTabProps } from "./pathTab/usePathTabState";
import { getPathProposalContext } from "../../lib/pathProposal";
import { ReviewWizardModal } from "./pathTab/ReviewWizardModal";
import {
  PathMonthlyFormSection,
  PathOverviewSection,
} from "./pathTab/PathWorkflowSections";
import { PathRewardOperationsSection } from "./pathTab/PathRewardSections";
import styles from "./PathTab.module.css";

export function PathTab(props: PathTabProps) {
  const state = usePathTabState(props);
  const [rewardModalOpen, setRewardModalOpen] = useState(
    () => Boolean(props.openRewardOnLoad),
  );
  const [dismissedAutoOpenKey, setDismissedAutoOpenKey] = useState<
    string | null
  >(null);

  const {
    period,
    setPeriod,
    memberMap,
    memberIds,
    selectedMemberId,
    setSelectedMemberId,
    selectedForm,
    selectedReview,
    selectedFinalization,
    selectedProfile,
    selectedModuleCloseInput,
    selectedMemberExpenseAmount,
    selectedMemberExpenseLoading,
    selectedMemberWorkflow,
    selectedMemberCurrentReward,
    selectedMemberRewardDisplayKind,
    selectedRewardExplanation,
    selectedRewardCardNote,
    selectedRewardCardBreakdown,
    selectedRewardReasonCodes,
    formInput,
    setFormInput,
    roleInput,
    setRoleInput,
    siteInput,
    setSiteInput,
    rewardProfitInputs,
    setRewardProfitInputs,
    rewardMembers,
    rewardPreview,
    rewardPriorAdjustments,
    setRewardPriorAdjustments,
    rewardExplanationMonthLabel,
    rewardExplanationRenderedLabel,
    rewardExplanationSummary,
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
    memberOptions,
    latestModuleClose,
    latestModuleRewardRun,
    modulePendingProposals,
    focusedPendingProposal,
    isMonthlyFormWizardOpen,
    setIsMonthlyFormWizardOpen,
    monthlyFormWizardStepIndex,
    setMonthlyFormWizardStepIndex,
    submittingForm,
    submittingFinalize,
    submittingMonthClose,
    previewingReward,
    submittingReward,
    submittingCorrection,
    reviewingProposalId,
    reviewWizardOpen,
    reviewWizardIndex,
    setReviewWizardIndex,
    reviewAnswers,
    setReviewAnswers,
    selectedReviewQueueEntry,
    selectedReviewItems,
    activeReviewItem,
    loading,
    error,
    success,
    motionProps,
    selectedModuleEvidence,
    selectedAnnotationCount,
    siteItemProfitSummary,
    load,
    getMemberWorkflow,
    updateRewardMember,
    selectRewardMember,
    addRewardMember,
    removeRewardMember,
    handleFormSubmit,
    handleFinalizeSubmit,
    handleRewardPreview,
    handleRewardProposalSubmit,
    handleMonthCloseProposalSubmit,
    handleRewardCorrectionSubmit,
    handleApprovePendingProposal,
    handleRejectPendingProposal,
    closeReviewWizard,
  } = state;

  const selectedMemberLabel = selectedMemberId
    ? displayMemberName(selectedMemberId, memberMap)
    : "選択中メンバー";
  const directCostTotal =
    (Number(rewardProfitInputs.outsourcing_cost) || 0) +
    (Number(rewardProfitInputs.materials_cost) || 0) +
    (Number(rewardProfitInputs.parking_cost) || 0) +
    (Number(rewardProfitInputs.transport_cost) || 0) +
    (Number(rewardProfitInputs.other_direct_cost) || 0);
  const rewardEvaluationSources = selectedRewardCardBreakdown?.inputs || [];
  const selectedSiteSummary = useMemo(
    () =>
      buildSelectedSiteSummary({
        form: selectedForm,
        monthlyCloseInput: selectedModuleCloseInput,
        siteItems: siteItemProfitSummary,
      }),
    [selectedForm, selectedModuleCloseInput, siteItemProfitSummary],
  );
  const buildSiteDetailHref = useCallback(
    (siteId: string) => {
      const next = new URLSearchParams();
      next.set("site", siteId);
      next.set("return", "luqo");
      next.set("period", period);
      next.set("reward", "1");
      if (selectedMemberId) {
        next.set("member", selectedMemberId);
      }
      return `/sites?${next.toString()}`;
    },
    [period, selectedMemberId],
  );
  const highlightedRewardSiteIds = useMemo(() => {
    const ids = [...selectedSiteSummary.siteIds];
    if (props.focusSiteId && !ids.includes(props.focusSiteId)) {
      ids.push(props.focusSiteId);
    }
    return ids;
  }, [props.focusSiteId, selectedSiteSummary.siteIds]);
  const rewardMoneySources = useMemo(
    () => [
      {
        label: "売上",
        value: formatCurrency(Number(rewardProfitInputs.sales) || 0),
        helper: "今月の認識売上",
      },
      {
        label: "直接費",
        value: formatCurrency(directCostTotal),
        helper: "外注・材料・経費の合計",
      },
      {
        label: "共通原価",
        value: formatCurrency(Number(rewardProfitInputs.common_cost) || 0),
        helper: "現場共通で配る原価",
      },
      {
        label: "積立",
        value: formatCurrency(Number(rewardProfitInputs.reserve_amount) || 0),
        helper: "ルール上の控除",
      },
      {
        label: "前月補正",
        value: formatCurrency(Number(rewardPriorAdjustments) || 0),
        helper: "前月からの調整額",
      },
    ],
    [directCostTotal, rewardPriorAdjustments, rewardProfitInputs],
  );
  const latestModuleCloseSiteSummary = useMemo(
    () =>
      latestModuleClose
        ? buildSelectedSiteSummary({
            selectedSiteIds: latestModuleClose.selected_site_ids || [],
            siteItems: siteItemProfitSummary,
          })
        : null,
    [latestModuleClose, siteItemProfitSummary],
  );
  const rewardExplanationSiteSummary = buildSelectedSiteSummary({
    selectedSiteIds: selectedRewardExplanation?.selected_site_ids ?? [],
    siteItems: siteItemProfitSummary,
  });
  const rewardExplanationSiteAllocations =
    selectedRewardExplanation?.site_allocations ?? [];
  const rewardSourceLineageCards = useMemo(
    () =>
      buildRewardSourceLineageCards(
        siteItemProfitSummary,
        highlightedRewardSiteIds,
      ),
    [highlightedRewardSiteIds, siteItemProfitSummary],
  );
  const rewardPendingProposals = useMemo(
    () =>
      modulePendingProposals.filter((proposal) => {
        if (focusedPendingProposal?.id === proposal.id) {
          return true;
        }

        const context = getPathProposalContext(proposal);
        if (context?.month && context.month !== period) {
          return false;
        }
        if (
          selectedMemberId &&
          context?.memberId &&
          context.memberId !== selectedMemberId
        ) {
          return false;
        }

        return true;
      }),
    [focusedPendingProposal?.id, modulePendingProposals, period, selectedMemberId],
  );
  const autoOpenRewardModalKey =
    focusedPendingProposal?.id || (props.openRewardOnLoad ? "reward" : null);
  const rewardModalVisible =
    rewardModalOpen ||
    (autoOpenRewardModalKey !== null &&
      autoOpenRewardModalKey !== dismissedAutoOpenKey);
  const handleOpenRewardSection = useCallback(() => {
    setDismissedAutoOpenKey(null);
    setRewardModalOpen(true);
  }, []);
  const handleCloseRewardModal = useCallback(() => {
    if (autoOpenRewardModalKey) {
      setDismissedAutoOpenKey(autoOpenRewardModalKey);
    }
    setRewardModalOpen(false);
  }, [autoOpenRewardModalKey]);

  useEffect(() => {
    if (!rewardModalVisible) {
      return undefined;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleCloseRewardModal();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleCloseRewardModal, rewardModalVisible]);

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarActions}>
          <button
            type="button"
            className={styles.monthNavButton}
            onClick={() => setPeriod((current) => previousMonthValue(current))}
            aria-label="前の月へ"
            title="前の月へ"
          >
            <ChevronLeft size={16} />
          </button>
          <input
            className={styles.monthInput}
            type="month"
            value={period}
            onChange={(event) => setPeriod(event.target.value)}
            aria-label="対象月"
          />
          <button
            type="button"
            className={styles.monthNavButton}
            onClick={() => setPeriod((current) => nextMonthValue(current))}
            aria-label="次の月へ"
            title="次の月へ"
          >
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            className={styles.ghostButton}
            onClick={() => void load()}
            disabled={loading}
            aria-label="最新状態に更新"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}
      {success && <div className={styles.success}>{success}</div>}

      <div
        className={styles.memberFilterScroller}
        aria-label="今月の対象メンバー"
      >
        {loading && (
          <div className={styles.memberFilterEmpty}>読み込み中...</div>
        )}
        {!loading && memberIds.length === 0 && (
          <div className={styles.memberFilterEmpty}>
            PATH データがまだありません。
          </div>
        )}
        {!loading &&
          memberIds.map((memberId) => {
            const workflow = getMemberWorkflow(memberId);

            return (
              <button
                key={memberId}
                type="button"
                className={`${styles.filterChip} ${selectedMemberId === memberId ? styles.filterChipActive : ""}`}
                onClick={() => setSelectedMemberId(memberId)}
                aria-pressed={selectedMemberId === memberId}
              >
                <span className={styles.filterChipLabel}>
                  {displayMemberName(memberId, memberMap)}
                </span>
                {workflow.label && (
                  <span
                    className={`${styles.filterChipStatus} ${styles[`status${workflow.tone[0].toUpperCase()}${workflow.tone.slice(1)}`]}`}
                  >
                    {workflow.label}
                  </span>
                )}
              </button>
            );
          })}
      </div>

      <section className={styles.workspace}>
        {!selectedMemberId && !loading && (
          <div className={styles.emptyState}>
            上のチップからメンバーを選ぶと、今月の評価を始められます。
          </div>
        )}

        {selectedMemberId && (
          <>
            <PathOverviewSection
              styles={styles}
              period={period}
              bigSkillLabels={BIG_SKILL_LABELS}
              bigSkillStateLabels={BIG_SKILL_STATE_LABELS}
              currentLevel={selectedProfile?.current_level}
              currentReward={selectedMemberCurrentReward}
              rewardDisplayKind={selectedMemberRewardDisplayKind}
              currentExpenseAmount={selectedMemberExpenseAmount}
              expenseAmountLoading={selectedMemberExpenseLoading}
              rewardStatusLabel={selectedMemberWorkflow?.label || null}
              rewardStatusNote={selectedRewardCardNote || null}
              rewardBreakdown={selectedRewardCardBreakdown}
              selectedSiteSummary={selectedSiteSummary}
              buildSiteDetailHref={buildSiteDetailHref}
              onOpenRewardSection={handleOpenRewardSection}
              workflow={selectedMemberWorkflow}
              review={selectedReview}
              form={selectedForm}
              finalization={selectedFinalization}
              profile={selectedProfile}
              onOpenMonthlyInput={() => {
                setMonthlyFormWizardStepIndex(0);
                setIsMonthlyFormWizardOpen(true);
              }}
              motionProps={motionProps}
            />

            <PathMonthlyFormSection
              styles={styles}
              bigSkillLabels={BIG_SKILL_LABELS}
              bigSkillStateLabels={BIG_SKILL_STATE_LABELS}
              reworkFlagLabels={REWORK_FLAG_LABELS}
              formInput={formInput}
              setFormInput={setFormInput}
              roleInput={roleInput}
              setRoleInput={setRoleInput}
              siteInput={siteInput}
              setSiteInput={setSiteInput}
              submittingForm={submittingForm}
              onSubmit={() => void handleFormSubmit()}
              wizardOpen={isMonthlyFormWizardOpen}
              setWizardOpen={setIsMonthlyFormWizardOpen}
              wizardStepIndex={monthlyFormWizardStepIndex}
              setWizardStepIndex={setMonthlyFormWizardStepIndex}
            />

          </>
        )}
      </section>

      {rewardModalVisible && (
        <div
          className={styles.rewardModalOverlay}
          onClick={handleCloseRewardModal}
          role="presentation"
        >
          <div
            className={styles.rewardModal}
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="報酬確認"
          >
            <div className={styles.rewardModalTopBar}>
              <button
                type="button"
                className={styles.closeIconButton}
                onClick={handleCloseRewardModal}
                aria-label="閉じる"
              >
                <X size={16} />
              </button>
            </div>

            <div className={styles.rewardModalHeader}>
              <div>
                <p className={styles.wizardEyebrow}>報酬確認</p>
                <h3 className={styles.wizardTitle}>金額の元と評価の元</h3>
                <p className={styles.wizardSubtitle}>
                  先に元データを見てから、下で試算と申請を進めます。
                </p>
              </div>
            </div>

            {rewardPendingProposals.length > 0 && (
              <div className={styles.rewardSourceSection}>
                <div className={styles.rewardSourceHeader}>
                  <div>
                    <h4>承認待ち queue</h4>
                    <p>
                      PATH proposal をこの画面で確認して、そのまま承認か却下まで進めます。
                    </p>
                  </div>
                  <span className={styles.metaBadge}>
                    {rewardPendingProposals.length}件
                  </span>
                </div>
                <div className={styles.rewardMemberList}>
                  {rewardPendingProposals.map((proposal) => {
                    const proposalContext = getPathProposalContext(proposal);
                    const isFocused = focusedPendingProposal?.id === proposal.id;
                    const isReviewing = reviewingProposalId === proposal.id;

                    return (
                      <div
                        key={proposal.id}
                        className={`${styles.queueItem} ${isFocused ? styles.queueItemFocused : ""}`}
                      >
                        <div className={styles.queueHeader}>
                          <strong>{formatProposalKind(proposal.type)}</strong>
                          <span className={styles.metaBadge}>
                            {proposalContext?.month || period}
                          </span>
                        </div>
                        <p className={styles.queueDescription}>
                          {proposal.description}
                        </p>
                        <div className={styles.queueMeta}>
                          <span>
                            作成者: {proposal.created_by?.name || "unknown"}
                          </span>
                          <span>{formatDateTime(proposal.created_at)}</span>
                        </div>
                        <div className={styles.queueMeta}>
                          <span>
                            対象:{" "}
                            {proposalContext?.memberId
                              ? displayMemberName(proposalContext.memberId, memberMap)
                              : "全体"}
                          </span>
                          <span>
                            承認: {proposal.required_approvals}名
                          </span>
                        </div>
                        {proposalContext?.note && (
                          <p className={styles.profileTransferHint}>
                            {proposalContext.note}
                          </p>
                        )}
                        <div className={styles.rewardActions}>
                          <div className={styles.actionRowCompact}>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() =>
                                void handleRejectPendingProposal(proposal)
                              }
                              disabled={Boolean(reviewingProposalId)}
                            >
                              {isReviewing ? "処理中..." : "却下"}
                            </button>
                            <button
                              type="button"
                              className={styles.primaryButton}
                              onClick={() =>
                                void handleApprovePendingProposal(proposal)
                              }
                              disabled={Boolean(reviewingProposalId)}
                            >
                              {isReviewing ? "処理中..." : "承認"}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className={styles.rewardSourceSection}>
              <div className={styles.rewardSourceHeader}>
                <div>
                  <h4>金額の元</h4>
                  <p>今月の原資を作る数字です。</p>
                </div>
                <span className={styles.metaBadge}>{period}</span>
              </div>
              <div className={styles.rewardSourceGrid}>
                {rewardMoneySources.map((item) => (
                  <div key={item.label} className={styles.rewardSourceCard}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <p>{item.helper}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.rewardSourceSection}>
              <div className={styles.rewardSourceHeader}>
                <div>
                  <h4>現場の元</h4>
                  <p>
                    完了で売上化した現場と、会計コストを分けて見ます。
                  </p>
                </div>
                <span className={styles.metaBadge}>
                  {selectedSiteSummary.sourceLabel || "対象待ち"}
                </span>
              </div>
              {props.focusSiteId && (
                <div className={styles.rewardFocusNotice}>
                  直前に見ていた現場をハイライトしています。
                </div>
              )}
              {rewardSourceLineageCards.length > 0 ? (
                <div className={styles.rewardSourceGrid}>
                  {rewardSourceLineageCards.map((item) => (
                    <div
                      key={item.id}
                      className={`${styles.rewardSourceCard} ${item.selected ? styles.rewardSourceCardSelected : ""}`}
                    >
                      <span>{item.badge}</span>
                      {item.highlightLabel && (
                        <span className={styles.rewardSourceHighlight}>
                          {item.highlightLabel}
                        </span>
                      )}
                      {item.siteId ? (
                        <Link
                          className={styles.rewardSourceLink}
                          to={buildSiteDetailHref(item.siteId || "")}
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <strong>{item.title}</strong>
                      )}
                      <p>{item.helper}</p>
                      <strong className={styles.rewardSourceValue}>
                        {item.value}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.rewardSourceEmpty}>
                  まだ完了現場の売上や会計コストがありません。
                </div>
              )}
            </div>

            <div className={styles.rewardSourceSection}>
              <div className={styles.rewardSourceHeader}>
                <div>
                  <h4>評価の元</h4>
                  <p>{selectedMemberLabel} の評価と稼働です。</p>
                </div>
                <span className={styles.metaBadge}>
                  {selectedProfile?.current_level || "Level未設定"}
                </span>
              </div>
              {rewardExplanationSiteSummary.siteIds.length > 0 && (
                <div className={styles.rewardSourceFormula}>
                  <span>対象現場</span>
                  <div className={styles.rewardSourceLinkRow}>
                    {rewardExplanationSiteSummary.labels.map((label, index) => (
                      <Link
                        key={`${rewardExplanationSiteSummary.siteIds[index] || label}-${index}`}
                        className={styles.rewardSourceLink}
                        to={buildSiteDetailHref(
                          rewardExplanationSiteSummary.siteIds[index] || "",
                        )}
                      >
                        {label}
                      </Link>
                    ))}
                  </div>
                  <p>
                    {rewardExplanationSiteSummary.sourceLabel || "報酬詳細"} /{" "}
                    {rewardExplanationSiteSummary.helper}
                  </p>
                </div>
              )}
              {rewardExplanationSiteAllocations.length > 0 && (
                <>
                  <div className={styles.rewardSourceFormula}>
                    <span>現場別の variable 配賦</span>
                    <strong>base 分は全体報酬として保持し、現場配賦は variable 分のみ表示します。</strong>
                    <p>
                      {selectedRewardExplanation?.allocation_basis ||
                        "package_points.variable_only"}
                    </p>
                  </div>
                  <div className={styles.rewardSourceGrid}>
                    {rewardExplanationSiteAllocations.map((allocation) => (
                      <div
                        key={`${allocation.site_id || "unmatched"}:${allocation.package_ids.join(",")}`}
                        className={`${styles.rewardSourceCard} ${allocation.site_selected ? styles.rewardSourceCardSelected : ""}`}
                      >
                        <span>
                          {allocation.site_selected
                            ? "対象現場"
                            : allocation.site_id
                              ? "現場配賦"
                              : "未紐付け"}
                        </span>
                        {allocation.site_id ? (
                          <Link
                            className={styles.rewardSourceLink}
                            to={buildSiteDetailHref(allocation.site_id)}
                          >
                            {allocation.site_name}
                          </Link>
                        ) : (
                          <strong>{allocation.site_name}</strong>
                        )}
                        <p>
                          {`${Math.round(
                            toFiniteNumber(allocation.member_point_share) * 100,
                          )}% / ${allocation.package_count}件の package / 標準${toFiniteNumber(
                            allocation.std_hours_total,
                          ).toLocaleString("ja-JP")}h`}
                        </p>
                        <strong className={styles.rewardSourceValue}>
                          {formatCurrency(
                            toFiniteNumber(allocation.variable_amount_allocated),
                          )}
                        </strong>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {selectedRewardCardBreakdown ? (
                <>
                  <div className={styles.rewardSourceFormula}>
                    <span>式</span>
                    <strong>{selectedRewardCardBreakdown.formula}</strong>
                    {selectedRewardCardBreakdown.note && (
                      <p>{selectedRewardCardBreakdown.note}</p>
                    )}
                  </div>
                  <div className={styles.rewardSourceGrid}>
                    {rewardEvaluationSources.map((item) => (
                      <div key={item.label} className={styles.rewardSourceCard}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                        <p>{item.helper || "今回の計算に使用"}</p>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className={styles.rewardSourceEmpty}>
                  評価の元データは、試算後または説明データ取得後にここへ表示されます。
                </div>
              )}
            </div>

            <PathRewardOperationsSection
              styles={styles}
              latestModuleClose={latestModuleClose}
              latestModuleCloseSiteSummary={latestModuleCloseSiteSummary}
              latestModuleRewardRun={latestModuleRewardRun}
              moduleSummary={moduleSummary}
              buildSiteDetailHref={buildSiteDetailHref}
              correctionMonth={correctionMonth}
              rewardProfitInputs={rewardProfitInputs}
              setRewardProfitInputs={setRewardProfitInputs}
              rewardPriorAdjustments={rewardPriorAdjustments}
              setRewardPriorAdjustments={setRewardPriorAdjustments}
              siteItemProfitCount={siteItemProfitSummary.length}
              rewardMembers={rewardMembers}
              memberOptions={memberOptions}
              onSelectRewardMember={selectRewardMember}
              onUpdateRewardMember={updateRewardMember}
              onRemoveRewardMember={removeRewardMember}
              onAddRewardMember={addRewardMember}
              previewingReward={previewingReward}
              submittingReward={submittingReward}
              onPreviewReward={() => void handleRewardPreview()}
              onSubmitReward={() => void handleRewardProposalSubmit()}
              rewardPreview={rewardPreview}
              motionProps={motionProps}
              tradeFamilyLabels={TRADE_FAMILY_LABELS}
              roleTypeLabels={ROLE_TYPE_LABELS}
              qualityResultLabels={QUALITY_RESULT_LABELS}
              opportunityStatusLabels={OPPORTUNITY_STATUS_LABELS}
              closeCreditedUnits={closeCreditedUnits}
              setCloseCreditedUnits={setCloseCreditedUnits}
              closeNeutralFlagsInput={closeNeutralFlagsInput}
              setCloseNeutralFlagsInput={setCloseNeutralFlagsInput}
              closeEvidenceInput={closeEvidenceInput}
              setCloseEvidenceInput={setCloseEvidenceInput}
              selectedModuleEvidenceCount={selectedModuleEvidence.length}
              selectedAnnotationCount={selectedAnnotationCount}
              closeOpportunityTradeFamily={closeOpportunityTradeFamily}
              setCloseOpportunityTradeFamily={setCloseOpportunityTradeFamily}
              closeOpportunityStatus={closeOpportunityStatus}
              setCloseOpportunityStatus={setCloseOpportunityStatus}
              closeOpportunityDays={closeOpportunityDays}
              setCloseOpportunityDays={setCloseOpportunityDays}
              closeOpportunityScore={closeOpportunityScore}
              setCloseOpportunityScore={setCloseOpportunityScore}
              closeProtectedChallengeCount={closeProtectedChallengeCount}
              setCloseProtectedChallengeCount={setCloseProtectedChallengeCount}
              closePromotionBlocked={closePromotionBlocked}
              setClosePromotionBlocked={setClosePromotionBlocked}
              closeReviewerSummary={closeReviewerSummary}
              setCloseReviewerSummary={setCloseReviewerSummary}
              submittingMonthClose={submittingMonthClose}
              onSubmitMonthClose={() => void handleMonthCloseProposalSubmit()}
              correctionRewardRunId={correctionRewardRunId}
              setCorrectionRewardRunId={setCorrectionRewardRunId}
              setCorrectionMonth={setCorrectionMonth}
              correctionMode={correctionMode}
              setCorrectionMode={setCorrectionMode}
              correctionReasonCode={correctionReasonCode}
              setCorrectionReasonCode={setCorrectionReasonCode}
              correctionAmount={correctionAmount}
              setCorrectionAmount={setCorrectionAmount}
              correctionNote={correctionNote}
              setCorrectionNote={setCorrectionNote}
              explanationMonthLabel={rewardExplanationMonthLabel}
              explanationRenderedLabel={rewardExplanationRenderedLabel}
              explanationSummary={rewardExplanationSummary}
              explanationReasonCodes={selectedRewardReasonCodes}
              showExplanation={Boolean(rewardExplanationSummary)}
              submittingCorrection={submittingCorrection}
              onSubmitCorrection={() => void handleRewardCorrectionSubmit()}
              formatCurrency={formatCurrency}
            />
          </div>
        </div>
      )}

      {reviewWizardOpen && (
        <ReviewWizardModal
          styles={styles}
          memberMap={memberMap}
          selectedReviewQueueEntry={selectedReviewQueueEntry}
          selectedReviewItems={selectedReviewItems}
          activeReviewItem={activeReviewItem}
          reviewWizardIndex={reviewWizardIndex}
          setReviewWizardIndex={setReviewWizardIndex}
          reviewAnswers={reviewAnswers}
          setReviewAnswers={setReviewAnswers}
          submittingFinalize={submittingFinalize}
          onFinalizeSubmit={(memberId) => void handleFinalizeSubmit(memberId)}
          onClose={closeReviewWizard}
        />
      )}
    </div>
  );
}
