import { motion, type HTMLMotionProps } from "framer-motion";
import { ChevronLeft, ChevronRight, ClipboardCheck, X } from "lucide-react";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
    PATH_BIG_SKILL_KEYS,
    PATH_BIG_SKILL_STATE_OPTIONS,
    type PathBigSkillKey,
    type PathBigSkillState,
    type PathMonthlyEvaluationAiReview,
    type PathMonthlyEvaluationFinalization,
    type PathMonthlyEvaluationForm,
    type PathMonthlyEvaluationFormInput,
    type PathSkillProfile,
} from "../../../lib/api";
import type {
    MemberWorkflowSummary,
    RewardCardBreakdown,
    SelectedSiteSummary,
} from "./types";

type ReworkFlagLabelMap = Record<NonNullable<PathMonthlyEvaluationForm["rework_flag"]>, string>;

const MONTHLY_SCORE_META = {
    A: {
        shortLabel: "動きやすさ",
        title: "今月の動きやすさは？",
        description: "段取り、報連相、まわりとの連携をふり返って選びます。",
    },
    R: {
        shortLabel: "任され具合",
        title: "今月の任され具合は？",
        description: "ひとりで進められた範囲や、安心して任せてもらえた場面をふり返ります。",
    },
    Q: {
        shortLabel: "仕上がりの安定",
        title: "今月の仕上がりの安定感は？",
        description: "やり直しの少なさや、仕上がりの安定感をふり返って選びます。",
    },
} as const satisfies Record<"A" | "R" | "Q", { shortLabel: string; title: string; description: string }>;

const MONTHLY_SCORE_OPTION_LABELS = {
    A: {
        0: "0: まだ不安がある",
        1: "1: ふつうにできた",
        2: "2: 安心して任せてもらえた",
    },
    R: {
        0: "0: まだ助けが必要だった",
        1: "1: ふつうに任せてもらえた",
        2: "2: ひとりで任せてもらえる場面が多かった",
    },
    Q: {
        0: "0: ムラや手直しがあった",
        1: "1: ふつうに収まった",
        2: "2: 仕上がりが安定していた",
    },
} as const satisfies Record<"A" | "R" | "Q", Record<0 | 1 | 2, string>>;

const PROFILE_STATUS_FIELDS = {
    cross_work: "cross_work_status",
    putty_foundation: "putty_foundation_status",
    planning_preparation: "planning_preparation_status",
    quality_stability: "quality_stability_status",
    site_trust: "site_trust_status",
    education_support: "education_support_status",
} as const satisfies Record<PathBigSkillKey, keyof PathSkillProfile>;

function formatDateLabel(value?: string | null) {
    if (!value) {
        return "未反映";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return "未反映";
    }

    return parsed.toLocaleDateString("ja-JP");
}

function buildSkillSnapshot({
    form,
    finalization,
    profile,
}: {
    form?: PathMonthlyEvaluationForm;
    finalization?: PathMonthlyEvaluationFinalization | null;
    profile?: PathSkillProfile | null;
}) {
    return PATH_BIG_SKILL_KEYS.map((key) => {
        const finalizationState = finalization?.confirmed_big_skill_states?.[key];
        const formState = form?.selected_big_skill_states?.[key];
        const profileState = profile?.[PROFILE_STATUS_FIELDS[key]];

        return {
            key,
            state: finalizationState || formState || profileState || "unverified",
            source: finalizationState
                ? "確定値"
                : formState
                  ? "今月入力"
                  : profileState
                    ? "現在プロフィール"
                    : "未入力",
        };
    });
}

export function PathOverviewSection({
    styles,
    period,
    bigSkillLabels,
    bigSkillStateLabels,
    currentLevel,
    currentReward,
    rewardDisplayKind = "pending",
    currentExpenseAmount,
    expenseAmountLoading,
    rewardStatusLabel,
    rewardStatusNote,
    rewardBreakdown,
    selectedSiteSummary,
    buildSiteDetailHref,
    onOpenRewardSection,
    workflow,
    review,
    form,
    finalization,
    profile,
    onOpenMonthlyInput,
    motionProps,
}: {
    styles: Record<string, string>;
    period: string;
    bigSkillLabels: Record<PathBigSkillKey, string>;
    bigSkillStateLabels: Record<PathBigSkillState, string>;
    currentLevel?: string | null;
    currentReward?: number | null;
    rewardDisplayKind?: "confirmed" | "estimate" | "pending";
    currentExpenseAmount?: number | null;
    expenseAmountLoading: boolean;
    rewardStatusLabel?: string | null;
    rewardStatusNote?: string | null;
    rewardBreakdown?: RewardCardBreakdown | null;
    selectedSiteSummary?: SelectedSiteSummary | null;
    buildSiteDetailHref?: (siteId: string) => string;
    onOpenRewardSection?: () => void;
    workflow: MemberWorkflowSummary | null;
    review?: PathMonthlyEvaluationAiReview;
    form?: PathMonthlyEvaluationForm;
    finalization?: PathMonthlyEvaluationFinalization | null;
    profile?: PathSkillProfile | null;
    onOpenMonthlyInput?: () => void;
    motionProps: HTMLMotionProps<"div">;
}) {
    const [isLevelDetailOpen, setIsLevelDetailOpen] = useState(false);
    const rewardTitle =
        rewardDisplayKind === "estimate" ? "今月の報酬見込み" : "今月の報酬";
    const rewardLabel = typeof currentReward === "number" ? `¥${currentReward.toLocaleString("ja-JP")}` : "未確定";
    const levelLabel = currentLevel ? `L${String(currentLevel).replace(/^L/i, "")}` : "未設定";
    const expenseLabel = expenseAmountLoading
        ? "集計中..."
        : `¥${(currentExpenseAmount || 0).toLocaleString("ja-JP")}`;
    const rewardHint =
        rewardDisplayKind === "confirmed"
            ? "確定した支給額です"
            : rewardDisplayKind === "estimate"
              ? "評価確定前の試算です"
              : "今月の支給は確認待ち";
    const levelHint = workflow ? `次: ${workflow.nextAction}` : "タップで詳細";
    const expenseHint = expenseAmountLoading ? "経費を集計しています" : "今月登録した経費合計";
    const monthlyInputStatus = form ? "入力済み" : "未入力";
    const levelSource = finalization
        ? "評価確定"
        : form
          ? "現場入力"
          : profile?.current_level
            ? "現在プロフィール"
            : "未設定";
    const levelUpdatedAt = finalization?.finalized_at || profile?.current_level_since || form?.submitted_at || null;
    const skillSnapshot = buildSkillSnapshot({ form, finalization, profile });
    const siteSummary = selectedSiteSummary || null;

    useEffect(() => {
        if (!isLevelDetailOpen) {
            return undefined;
        }

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setIsLevelDetailOpen(false);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [isLevelDetailOpen]);

    return (
        <>
            <motion.div className={`${styles.card} ${styles.memberHeroCard}`} {...motionProps}>
                <div className={`${styles.memberMetricCard} ${styles.memberMetricPrimary}`}>
                    <span className={styles.memberMetricLabel}>{rewardTitle}</span>
                    <strong className={styles.memberMetricValue}>{rewardLabel}</strong>
                    <p className={styles.memberMetricHint}>{rewardHint}</p>
                    {(rewardStatusLabel || rewardStatusNote) && (
                        <div className={styles.memberMetricMeta}>
                            {rewardDisplayKind === "estimate" && <span className={styles.metaBadge}>試算</span>}
                            {rewardStatusLabel && <span className={styles.metaBadge}>{rewardStatusLabel}</span>}
                            {rewardStatusNote && (
                                <span className={styles.memberMetricMetaText}>{rewardStatusNote}</span>
                            )}
                        </div>
                    )}
                    {rewardBreakdown && (
                        <div className={styles.memberRewardBreakdown}>
                            <div className={styles.memberRewardFormula}>
                                <span className={styles.memberRewardSectionLabel}>計算式</span>
                                <strong className={styles.memberRewardFormulaText}>{rewardBreakdown.formula}</strong>
                                {rewardBreakdown.note && (
                                    <p className={styles.memberRewardFormulaNote}>{rewardBreakdown.note}</p>
                                )}
                            </div>
                            <div className={styles.memberRewardInputGrid}>
                                {rewardBreakdown.inputs.map((item) => (
                                    <div key={item.label} className={styles.memberRewardInputCard}>
                                        <span className={styles.memberRewardInputLabel}>{item.label}</span>
                                        <strong className={styles.memberRewardInputValue}>{item.value}</strong>
                                        {item.helper && (
                                            <span className={styles.memberRewardInputHelper}>{item.helper}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    <div className={styles.memberSiteSummary}>
                        <div className={styles.memberSiteSummaryHeader}>
                            <span className={styles.memberRewardSectionLabel}>今回の対象現場</span>
                            {siteSummary?.sourceLabel && (
                                <span className={styles.metaBadge}>{siteSummary.sourceLabel}</span>
                            )}
                        </div>
                        {siteSummary && siteSummary.siteIds.length > 0 ? (
                            <>
                                <div className={styles.memberSiteChipRow}>
                                    {siteSummary.labels.map((label, index) => (
                                        <Link
                                            key={`${siteSummary.siteIds[index] || label}-${index}`}
                                            className={styles.memberSiteChip}
                                            to={buildSiteDetailHref
                                                ? buildSiteDetailHref(siteSummary.siteIds[index] || "")
                                                : `/sites?site=${encodeURIComponent(siteSummary.siteIds[index] || "")}`}
                                        >
                                            {label}
                                        </Link>
                                    ))}
                                </div>
                                <p className={styles.memberSiteHelper}>{siteSummary.helper}</p>
                            </>
                        ) : (
                            <p className={styles.memberSiteHelper}>まだ対象現場は決まっていません。</p>
                        )}
                    </div>
                    {workflow &&
                        (onOpenRewardSection ? (
                            <button
                                type="button"
                                className={`${styles.memberWorkflowCta} ${styles.memberWorkflowCtaButton}`}
                                onClick={onOpenRewardSection}
                            >
                                <span className={styles.memberWorkflowCtaAction}>{workflow.nextAction}</span>
                                <span className={styles.memberWorkflowCtaDesc}>{workflow.description}</span>
                            </button>
                        ) : (
                            <div className={styles.memberWorkflowCta}>
                                <span className={styles.memberWorkflowCtaAction}>{workflow.nextAction}</span>
                                <span className={styles.memberWorkflowCtaDesc}>{workflow.description}</span>
                            </div>
                        ))}
                </div>

                <div className={styles.memberMetricGrid}>
                    <button
                        type="button"
                        className={`${styles.memberMetricCard} ${styles.memberMetricButton}`}
                        onClick={() => setIsLevelDetailOpen(true)}
                        aria-haspopup="dialog"
                        aria-expanded={isLevelDetailOpen}
                    >
                        <span className={styles.memberMetricLabel}>現在 Level</span>
                        <strong className={styles.memberMetricValue}>{levelLabel}</strong>
                        <p className={styles.memberMetricHint}>{levelHint}</p>
                        <span className={styles.memberMetricAction}>タップで詳細</span>
                    </button>
                    <div className={styles.memberMetricCard}>
                        <span className={styles.memberMetricLabel}>立替経費</span>
                        <strong className={styles.memberMetricValue}>{expenseLabel}</strong>
                        <p className={styles.memberMetricHint}>{expenseHint}</p>
                    </div>
                </div>

                {review && (
                    <>
                        <p className={styles.narrative}>{review.monthly_summary}</p>
                        <div className={styles.badgeRow}>
                            {review.review_required_flag && (
                                <span className={`${styles.badge} ${styles.badgeWarm}`}>要レビュー</span>
                            )}
                            {review.promotion_candidate_flag && (
                                <span className={`${styles.badge} ${styles.badgeGood}`}>昇格候補</span>
                            )}
                            {review.candidate_skill_tags.map((tag) => (
                                <span key={tag} className={styles.badge}>
                                    {tag}
                                </span>
                            ))}
                        </div>
                    </>
                )}

                {form && (
                    <div className={styles.infoGrid}>
                        <div>
                            <span className={styles.infoLabel}>役割</span>
                            <strong>{form.selected_roles.join(" / ") || "-"}</strong>
                        </div>
                        <div>
                            <span className={styles.infoLabel}>現場ID</span>
                            <strong>{form.site_ids.join(", ") || "-"}</strong>
                        </div>
                        <div>
                            <span className={styles.infoLabel}>写真提出</span>
                            <strong>{form.photo_flag ? "あり" : "なし"}</strong>
                        </div>
                        <div>
                            <span className={styles.infoLabel}>手直し</span>
                            <strong>{form.rework_flag}</strong>
                        </div>
                    </div>
                )}
            </motion.div>

            {isLevelDetailOpen && (
                <div
                    className={styles.levelDetailOverlay}
                    onClick={() => setIsLevelDetailOpen(false)}
                    role="presentation"
                >
                    <div
                        className={styles.levelDetailModal}
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        aria-modal="true"
                        aria-label={`${levelLabel} の詳細`}
                    >
                        <div className={styles.levelDetailTopBar}>
                            <button
                                type="button"
                                className={styles.closeIconButton}
                                onClick={() => setIsLevelDetailOpen(false)}
                                aria-label="閉じる"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className={styles.levelDetailHero}>
                            <div>
                                <span className={styles.infoLabel}>現在 Level</span>
                                <strong>{levelLabel}</strong>
                                <p>{workflow?.description || "現在の評価状況をまとめています。"}</p>
                            </div>
                            <span className={styles.levelBadge}>{levelSource}</span>
                        </div>

                        <div className={styles.levelDetailMetaGrid}>
                            <div className={styles.levelDetailMetaCard}>
                                <span className={styles.infoLabel}>対象月</span>
                                <strong>{period}</strong>
                            </div>
                            <div className={styles.levelDetailMetaCard}>
                                <span className={styles.infoLabel}>更新日</span>
                                <strong>{formatDateLabel(levelUpdatedAt)}</strong>
                            </div>
                            <div className={styles.levelDetailMetaCard}>
                                <span className={styles.infoLabel}>現場入力</span>
                                <strong>{monthlyInputStatus}</strong>
                            </div>
                            <div className={styles.levelDetailMetaCard}>
                                <span className={styles.infoLabel}>月末スコア</span>
                                <strong>{form ? `${form.A}/${form.R}/${form.Q}` : "-"}</strong>
                            </div>
                        </div>

                        <div className={styles.levelDetailSection}>
                            <div className={styles.levelDetailSectionHeader}>
                                <h4>6項目の状態</h4>
                                <span className={styles.metaBadge}>{levelSource}</span>
                            </div>
                            <div className={styles.levelDetailSkillGrid}>
                                {skillSnapshot.map((item) => (
                                    <div key={item.key} className={styles.levelDetailSkillCard}>
                                        <span className={styles.infoLabel}>{bigSkillLabels[item.key]}</span>
                                        <strong>{bigSkillStateLabels[item.state]}</strong>
                                        <p>{item.source}</p>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className={styles.levelDetailSection}>
                            <div className={styles.levelDetailSectionHeader}>
                                <h4>現場入力メモ</h4>
                                <span className={styles.metaBadge}>{monthlyInputStatus}</span>
                            </div>
                            {form ? (
                                <div className={styles.infoGrid}>
                                    <div>
                                        <span className={styles.infoLabel}>稼働日数</span>
                                        <strong>{form.work_days}日</strong>
                                    </div>
                                    <div>
                                        <span className={styles.infoLabel}>役割</span>
                                        <strong>{form.selected_roles.join(" / ") || "-"}</strong>
                                    </div>
                                    <div>
                                        <span className={styles.infoLabel}>現場ID</span>
                                        <strong>{form.site_ids.join(", ") || "-"}</strong>
                                    </div>
                                    <div>
                                        <span className={styles.infoLabel}>コメント</span>
                                        <strong>{form.comment || "未記入"}</strong>
                                    </div>
                                </div>
                            ) : (
                                <div className={styles.emptyCompareState}>
                                    まだ現場入力はありません。完了した現場の詳細から入力できます。
                                </div>
                            )}
                        </div>

                        {review?.monthly_summary && (
                            <div className={styles.levelDetailSection}>
                                <div className={styles.levelDetailSectionHeader}>
                                    <h4>AIメモ</h4>
                                </div>
                                <p className={styles.narrative}>{review.monthly_summary}</p>
                            </div>
                        )}

                        <div className={styles.levelDetailFooter}>
                            <button
                                type="button"
                                className={styles.ghostButton}
                                onClick={() => setIsLevelDetailOpen(false)}
                            >
                                閉じる
                            </button>
                            {onOpenMonthlyInput && (
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={() => {
                                        setIsLevelDetailOpen(false);
                                        onOpenMonthlyInput();
                                    }}
                                >
                                    <ClipboardCheck size={14} />
                                    {form ? "入力を見直す" : "入力をはじめる"}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}

export function PathMonthlyFormSection({
    styles,
    bigSkillStateLabels,
    reworkFlagLabels,
    formInput,
    setFormInput,
    roleInput,
    setRoleInput,
    siteInput,
    setSiteInput,
    submittingForm,
    onSubmit,
    wizardOpen,
    setWizardOpen,
    wizardStepIndex,
    setWizardStepIndex,
}: {
    styles: Record<string, string>;
    bigSkillLabels: Record<PathBigSkillKey, string>;
    bigSkillStateLabels: Record<PathBigSkillState, string>;
    reworkFlagLabels: ReworkFlagLabelMap;
    formInput: PathMonthlyEvaluationFormInput;
    setFormInput: Dispatch<SetStateAction<PathMonthlyEvaluationFormInput>>;
    roleInput: string;
    setRoleInput: Dispatch<SetStateAction<string>>;
    siteInput: string;
    setSiteInput: Dispatch<SetStateAction<string>>;
    submittingForm: boolean;
    onSubmit: () => void;
    wizardOpen: boolean;
    setWizardOpen: Dispatch<SetStateAction<boolean>>;
    wizardStepIndex: number;
    setWizardStepIndex: Dispatch<SetStateAction<number>>;
}) {
    return (
        <>
            {wizardOpen && (
                <PathMonthlyFormWizardModal
                    styles={styles}
                    stepIndex={wizardStepIndex}
                    setStepIndex={setWizardStepIndex}
                    bigSkillStateLabels={bigSkillStateLabels}
                    reworkFlagLabels={reworkFlagLabels}
                    formInput={formInput}
                    setFormInput={setFormInput}
                    roleInput={roleInput}
                    setRoleInput={setRoleInput}
                    siteInput={siteInput}
                    setSiteInput={setSiteInput}
                    submittingForm={submittingForm}
                    onClose={() => setWizardOpen(false)}
                    onSubmit={onSubmit}
                />
            )}
        </>
    );
}

function PathMonthlyFormWizardModal({
    styles,
    stepIndex,
    setStepIndex,
    bigSkillStateLabels,
    reworkFlagLabels,
    formInput,
    setFormInput,
    roleInput,
    setRoleInput,
    siteInput,
    setSiteInput,
    submittingForm,
    onClose,
    onSubmit,
}: {
    styles: Record<string, string>;
    stepIndex: number;
    setStepIndex: Dispatch<SetStateAction<number>>;
    bigSkillStateLabels: Record<PathBigSkillState, string>;
    reworkFlagLabels: ReworkFlagLabelMap;
    formInput: PathMonthlyEvaluationFormInput;
    setFormInput: Dispatch<SetStateAction<PathMonthlyEvaluationFormInput>>;
    roleInput: string;
    setRoleInput: Dispatch<SetStateAction<string>>;
    siteInput: string;
    setSiteInput: Dispatch<SetStateAction<string>>;
    submittingForm: boolean;
    onClose: () => void;
    onSubmit: () => void;
}) {
    const steps = [
        { kind: "skill", key: "cross_work", eyebrow: "Step 1", title: "クロス施工力は？", description: "今月いちばん近い状態を選びます。" },
        { kind: "skill", key: "putty_foundation", eyebrow: "Step 2", title: "パテ・下地処理力は？", description: "今月いちばん近い状態を選びます。" },
        { kind: "skill", key: "planning_preparation", eyebrow: "Step 3", title: "段取り・準備力は？", description: "今月いちばん近い状態を選びます。" },
        { kind: "skill", key: "quality_stability", eyebrow: "Step 4", title: "品質安定力は？", description: "今月いちばん近い状態を選びます。" },
        { kind: "skill", key: "site_trust", eyebrow: "Step 5", title: "現場信頼形成力は？", description: "今月いちばん近い状態を選びます。" },
        { kind: "skill", key: "education_support", eyebrow: "Step 6", title: "教育・支援力は？", description: "今月いちばん近い状態を選びます。" },
        { kind: "number", field: "work_days", eyebrow: "Step 7", title: "今月の稼働日数は？", description: "ざっくりではなく、月末時点の数字を入れます。" },
        { kind: "score", field: "A", eyebrow: "Step 8", title: MONTHLY_SCORE_META.A.title, description: MONTHLY_SCORE_META.A.description },
        { kind: "score", field: "R", eyebrow: "Step 9", title: MONTHLY_SCORE_META.R.title, description: MONTHLY_SCORE_META.R.description },
        { kind: "score", field: "Q", eyebrow: "Step 10", title: MONTHLY_SCORE_META.Q.title, description: MONTHLY_SCORE_META.Q.description },
        { kind: "text", field: "role", eyebrow: "Step 11", title: "担当ロールは？", description: "複数あるときはカンマ区切りで入れます。" },
        { kind: "text", field: "site", eyebrow: "Step 12", title: "現場IDは？", description: "未入力なら完了現場から候補が入ります。複数あるときはカンマ区切りで入れます。" },
        { kind: "boolean", field: "photo_flag", eyebrow: "Step 13", title: "写真を提出した？", description: "今月の提出有無を選びます。" },
        { kind: "rework", field: "rework_flag", eyebrow: "Step 14", title: "手直しはあった？", description: "なければ「なし」で進めます。" },
        { kind: "textarea", field: "comment", eyebrow: "Step 15", title: "月末コメントを残す", description: "今月できたことや次月に見てほしい点を残します。" },
    ] as const;
    const isLastStep = stepIndex === steps.length - 1;
    const currentStep = steps[stepIndex];

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose]);

    return (
        <div className={styles.wizardOverlay} onClick={onClose}>
            <div
                className={styles.wizardModal}
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="path-monthly-form-title"
            >
                <div className={styles.wizardProgress}>
                    <div className={styles.wizardProgressTrack}>
                        <span
                            className={styles.wizardProgressValue}
                            style={{ width: `${((stepIndex + 1) / steps.length) * 100}%` }}
                        />
                    </div>
                    <span className={styles.metaBadge}>{stepIndex + 1} / {steps.length}</span>
                    <button type="button" className={styles.closeIconButton} onClick={onClose} aria-label="閉じる">
                        <X size={16} />
                    </button>
                </div>

                <h3 id="path-monthly-form-title" className={styles.wizardTitle}>
                    {currentStep.title}
                </h3>
                <p className={styles.wizardSubtitle}>{currentStep.description}</p>

                <div className={styles.wizardBody}>
                    {currentStep.kind === "skill" && (
                        <label className={styles.field}>
                            <span>今月いちばん近い状態を選んでください</span>
                            <select
                                className={styles.select}
                                value={formInput.selected_big_skill_states?.[currentStep.key] || "unverified"}
                                onChange={(event) =>
                                    setFormInput((current) => ({
                                        ...current,
                                        selected_big_skill_states: {
                                            ...current.selected_big_skill_states,
                                            [currentStep.key]: event.target.value as PathBigSkillState,
                                        },
                                    }))
                                }
                            >
                                {PATH_BIG_SKILL_STATE_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                        {bigSkillStateLabels[option]}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {currentStep.kind === "number" && (
                        <label className={styles.field}>
                            <span>日数を入力</span>
                            <input
                                className={styles.input}
                                type="number"
                                min={0}
                                value={formInput.work_days ?? 0}
                                onChange={(event) =>
                                    setFormInput((current) => ({
                                        ...current,
                                        work_days: Number(event.target.value) || 0,
                                    }))
                                }
                            />
                        </label>
                    )}

                    {currentStep.kind === "score" && (
                        <label className={styles.field}>
                            <span>{MONTHLY_SCORE_META[currentStep.field].shortLabel}</span>
                            <select
                                className={styles.select}
                                value={formInput[currentStep.field] ?? 1}
                                onChange={(event) =>
                                    setFormInput((current) => ({
                                        ...current,
                                        [currentStep.field]: Number(event.target.value),
                                    }))
                                }
                            >
                                {[0, 1, 2].map((score) => (
                                    <option key={`${currentStep.field}-${score}`} value={score}>
                                        {MONTHLY_SCORE_OPTION_LABELS[currentStep.field][score as 0 | 1 | 2]}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {currentStep.kind === "text" && currentStep.field === "role" && (
                        <label className={styles.field}>
                            <span>担当ロール</span>
                            <input
                                className={styles.input}
                                value={roleInput}
                                onChange={(event) => setRoleInput(event.target.value)}
                                placeholder="主担当, 段取り, 応援"
                            />
                        </label>
                    )}

                    {currentStep.kind === "text" && currentStep.field === "site" && (
                        <label className={styles.field}>
                            <span>現場ID</span>
                            <input
                                className={styles.input}
                                value={siteInput}
                                onChange={(event) => setSiteInput(event.target.value)}
                                placeholder="site-001, site-002（完了現場から自動候補）"
                            />
                        </label>
                    )}

                    {currentStep.kind === "boolean" && (
                        <label className={styles.checkboxCard}>
                            <input
                                type="checkbox"
                                checked={Boolean(formInput.photo_flag)}
                                onChange={(event) =>
                                    setFormInput((current) => ({
                                        ...current,
                                        photo_flag: event.target.checked,
                                    }))
                                }
                            />
                            <span>写真を提出した</span>
                        </label>
                    )}

                    {currentStep.kind === "rework" && (
                        <label className={styles.field}>
                            <span>手直し</span>
                            <select
                                className={styles.select}
                                value={formInput.rework_flag || "none"}
                                onChange={(event) =>
                                    setFormInput((current) => ({
                                        ...current,
                                        rework_flag: event.target.value as NonNullable<PathMonthlyEvaluationForm["rework_flag"]>,
                                    }))
                                }
                            >
                                {Object.entries(reworkFlagLabels).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                    )}

                    {currentStep.kind === "textarea" && (
                        <label className={styles.field}>
                            <span>月末コメント</span>
                            <textarea
                                className={styles.textarea}
                                value={formInput.comment || ""}
                                onChange={(event) =>
                                    setFormInput((current) => ({
                                        ...current,
                                        comment: event.target.value,
                                    }))
                                }
                                placeholder="今月できたこと、未確認のこと、次月に見てほしい点"
                            />
                        </label>
                    )}
                </div>

                <div className={styles.wizardFooter}>
                    <button
                        type="button"
                        className={styles.ghostButton}
                        onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
                        disabled={stepIndex === 0}
                    >
                        <ChevronLeft size={14} />
                        戻る
                    </button>
                    {isLastStep ? (
                        <button type="button" className={styles.primaryButton} onClick={onSubmit} disabled={submittingForm}>
                            <ClipboardCheck size={14} />
                            {submittingForm ? "保存中..." : "保存する"}
                        </button>
                    ) : (
                        <button
                            type="button"
                            className={styles.primaryButton}
                            onClick={() => setStepIndex((current) => Math.min(steps.length - 1, current + 1))}
                        >
                            次へ
                            <ChevronRight size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
