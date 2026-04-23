import { motion, type HTMLMotionProps } from "framer-motion";
import { Calculator, Send } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
    PATH_DIFFICULTY_BAND_OPTIONS,
    PATH_LEVEL_OPTIONS,
    PATH_QUALITY_RESULT_OPTIONS,
    PATH_ROLE_TYPE_OPTIONS,
    PATH_TRADE_FAMILY_OPTIONS,
    type PathDifficultyBand,
    type PathModuleMonthCloseSummary,
    type PathModuleRewardPreview,
    type PathOpportunityStatus,
    type PathQualityResult,
    type PathRewardProfitInputs,
    type PathRoleType,
    type PathTradeFamily,
} from "../../../lib/api";
import type { RewardMemberDraft, SelectedSiteSummary } from "./types";

type PathRewardOperationsSectionProps = {
    styles: Record<string, string>;
    latestModuleClose: PathModuleMonthCloseSummary["closes"][number] | null;
    latestModuleCloseSiteSummary: SelectedSiteSummary | null;
    latestModuleRewardRun: PathModuleMonthCloseSummary["reward_runs"][number] | null;
    moduleSummary: PathModuleMonthCloseSummary | null;
    buildSiteDetailHref?: (siteId: string) => string;
    correctionMonth: string;
    rewardProfitInputs: PathRewardProfitInputs;
    setRewardProfitInputs: Dispatch<SetStateAction<PathRewardProfitInputs>>;
    rewardPriorAdjustments: number;
    setRewardPriorAdjustments: Dispatch<SetStateAction<number>>;
    siteItemProfitCount: number;
    rewardMembers: RewardMemberDraft[];
    memberOptions: Array<{ id: string; label: string }>;
    onSelectRewardMember: (index: number, memberId: string) => void;
    onUpdateRewardMember: (
        index: number,
        updater: (current: RewardMemberDraft) => RewardMemberDraft,
    ) => void;
    onRemoveRewardMember: (index: number) => void;
    onAddRewardMember: () => void;
    previewingReward: boolean;
    submittingReward: boolean;
    onPreviewReward: () => void;
    onSubmitReward: () => void;
    rewardPreview: PathModuleRewardPreview | null;
    motionProps: HTMLMotionProps<"div">;
    tradeFamilyLabels: Record<PathTradeFamily, string>;
    roleTypeLabels: Record<PathRoleType, string>;
    qualityResultLabels: Record<PathQualityResult, string>;
    opportunityStatusLabels: Record<PathOpportunityStatus, string>;
    closeCreditedUnits: number;
    setCloseCreditedUnits: Dispatch<SetStateAction<number>>;
    closeNeutralFlagsInput: string;
    setCloseNeutralFlagsInput: Dispatch<SetStateAction<string>>;
    closeEvidenceInput: string;
    setCloseEvidenceInput: Dispatch<SetStateAction<string>>;
    selectedModuleEvidenceCount: number;
    selectedAnnotationCount: number;
    closeOpportunityTradeFamily: PathTradeFamily;
    setCloseOpportunityTradeFamily: Dispatch<SetStateAction<PathTradeFamily>>;
    closeOpportunityStatus: PathOpportunityStatus;
    setCloseOpportunityStatus: Dispatch<SetStateAction<PathOpportunityStatus>>;
    closeOpportunityDays: number;
    setCloseOpportunityDays: Dispatch<SetStateAction<number>>;
    closeOpportunityScore: number;
    setCloseOpportunityScore: Dispatch<SetStateAction<number>>;
    closeProtectedChallengeCount: number;
    setCloseProtectedChallengeCount: Dispatch<SetStateAction<number>>;
    closePromotionBlocked: boolean;
    setClosePromotionBlocked: Dispatch<SetStateAction<boolean>>;
    closeReviewerSummary: string;
    setCloseReviewerSummary: Dispatch<SetStateAction<string>>;
    submittingMonthClose: boolean;
    onSubmitMonthClose: () => void;
    correctionRewardRunId: string;
    setCorrectionRewardRunId: Dispatch<SetStateAction<string>>;
    setCorrectionMonth: Dispatch<SetStateAction<string>>;
    correctionMode: "adjustment" | "reversal";
    setCorrectionMode: Dispatch<SetStateAction<"adjustment" | "reversal">>;
    correctionReasonCode: string;
    setCorrectionReasonCode: Dispatch<SetStateAction<string>>;
    correctionAmount: number;
    setCorrectionAmount: Dispatch<SetStateAction<number>>;
    correctionNote: string;
    setCorrectionNote: Dispatch<SetStateAction<string>>;
    explanationMonthLabel: string;
    explanationRenderedLabel: string;
    explanationSummary: string;
    explanationReasonCodes: string[];
    showExplanation: boolean;
    submittingCorrection: boolean;
    onSubmitCorrection: () => void;
    formatCurrency: (value: number) => string;
};

export function PathRewardOperationsSection(props: PathRewardOperationsSectionProps) {
    const {
        styles,
        latestModuleClose,
        latestModuleCloseSiteSummary,
        latestModuleRewardRun,
        moduleSummary,
        buildSiteDetailHref,
        correctionMonth,
        rewardProfitInputs,
        setRewardProfitInputs,
        rewardPriorAdjustments,
        setRewardPriorAdjustments,
        siteItemProfitCount,
        rewardMembers,
        memberOptions,
        onSelectRewardMember,
        onUpdateRewardMember,
        onRemoveRewardMember,
        onAddRewardMember,
        previewingReward,
        submittingReward,
        onPreviewReward,
        onSubmitReward,
        rewardPreview,
        motionProps,
        tradeFamilyLabels,
        roleTypeLabels,
        qualityResultLabels,
        opportunityStatusLabels,
        closeCreditedUnits,
        setCloseCreditedUnits,
        closeNeutralFlagsInput,
        setCloseNeutralFlagsInput,
        closeEvidenceInput,
        setCloseEvidenceInput,
        selectedModuleEvidenceCount,
        selectedAnnotationCount,
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
        submittingMonthClose,
        onSubmitMonthClose,
        correctionRewardRunId,
        setCorrectionRewardRunId,
        setCorrectionMonth,
        correctionMode,
        setCorrectionMode,
        correctionReasonCode,
        setCorrectionReasonCode,
        correctionAmount,
        setCorrectionAmount,
        correctionNote,
        setCorrectionNote,
        explanationMonthLabel,
        explanationRenderedLabel,
        explanationSummary,
        explanationReasonCodes,
        showExplanation,
        submittingCorrection,
        onSubmitCorrection,
        formatCurrency,
    } = props;

    const [manualProfitOverride, setManualProfitOverride] = useState(false);
    const [manualMemberOverride, setManualMemberOverride] = useState(false);
    const autoSeededMemberCount = rewardMembers.filter((item) => item.member_id).length;
    const rewardRuns = moduleSummary?.reward_runs ?? [];

    return (
        <>
            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div>
                        <h4>3. 月締めを固める</h4>
                        <p>close input に判断根拠を残してから、報酬 run へ進めます。</p>
                    </div>
                    <span className={styles.metaBadge}>close input</span>
                </div>

                <div className={styles.readOnlyGrid}>
                    <div className={styles.readOnlyCard}>
                        <span>証跡レコード</span>
                        <strong>{selectedModuleEvidenceCount} 件</strong>
                    </div>
                    <div className={styles.readOnlyCard}>
                        <span>AI annotation</span>
                        <strong>{selectedAnnotationCount} 件</strong>
                    </div>
                    <div className={styles.readOnlyCard}>
                        <span>前回 close</span>
                        <strong>
                            {latestModuleClose ? latestModuleClose.id.slice(0, 8) : "未作成"}
                        </strong>
                    </div>
                </div>

                {latestModuleCloseSiteSummary &&
                latestModuleCloseSiteSummary.siteIds.length > 0 ? (
                    <div className={styles.rewardSourceFormula}>
                        <span>前回 close の対象現場</span>
                        <div className={styles.moduleStatusSiteLinks}>
                            {latestModuleCloseSiteSummary.labels.map((label, index) => (
                                <Link
                                    key={`${latestModuleCloseSiteSummary.siteIds[index] || label}-${index}`}
                                    className={styles.moduleStatusSiteLink}
                                    to={
                                        buildSiteDetailHref
                                            ? buildSiteDetailHref(
                                                  latestModuleCloseSiteSummary.siteIds[index] || "",
                                              )
                                            : `/sites?site=${encodeURIComponent(
                                                  latestModuleCloseSiteSummary.siteIds[index] || "",
                                              )}`
                                    }
                                >
                                    {label}
                                </Link>
                            ))}
                        </div>
                        <p>今月も同じ現場集合なら、そのまま月締め申請を作れます。</p>
                    </div>
                ) : null}

                <div className={styles.inputGridThree}>
                    <label className={styles.field}>
                        <span>付与ユニット</span>
                        <input
                            className={styles.input}
                            type="number"
                            min={0}
                            value={closeCreditedUnits}
                            onChange={(event) =>
                                setCloseCreditedUnits(Number(event.target.value) || 0)
                            }
                        />
                    </label>

                    <label className={styles.field}>
                        <span>neutral flags</span>
                        <input
                            className={styles.input}
                            value={closeNeutralFlagsInput}
                            onChange={(event) => setCloseNeutralFlagsInput(event.target.value)}
                            placeholder="late_start, weather"
                        />
                    </label>

                    <label className={styles.field}>
                        <span>evidence IDs</span>
                        <input
                            className={styles.input}
                            value={closeEvidenceInput}
                            onChange={(event) => setCloseEvidenceInput(event.target.value)}
                            placeholder="ev-1, ev-2"
                        />
                    </label>
                </div>

                <div className={styles.selectGrid}>
                    <label className={styles.field}>
                        <span>機会工種</span>
                        <select
                            className={styles.select}
                            value={closeOpportunityTradeFamily}
                            onChange={(event) =>
                                setCloseOpportunityTradeFamily(
                                    event.target.value as PathTradeFamily,
                                )
                            }
                        >
                            {PATH_TRADE_FAMILY_OPTIONS.map((family) => (
                                <option key={family} value={family}>
                                    {tradeFamilyLabels[family]}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span>機会状態</span>
                        <select
                            className={styles.select}
                            value={closeOpportunityStatus}
                            onChange={(event) =>
                                setCloseOpportunityStatus(
                                    event.target.value as PathOpportunityStatus,
                                )
                            }
                        >
                            {Object.entries(opportunityStatusLabels).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span>未配属日数</span>
                        <input
                            className={styles.input}
                            type="number"
                            min={0}
                            value={closeOpportunityDays}
                            onChange={(event) =>
                                setCloseOpportunityDays(Number(event.target.value) || 0)
                            }
                        />
                    </label>

                    <label className={styles.field}>
                        <span>機会スコア</span>
                        <input
                            className={styles.input}
                            type="number"
                            min={0}
                            step={0.1}
                            value={closeOpportunityScore}
                            onChange={(event) =>
                                setCloseOpportunityScore(Number(event.target.value) || 0)
                            }
                        />
                    </label>

                    <label className={styles.field}>
                        <span>保護チャレンジ数</span>
                        <input
                            className={styles.input}
                            type="number"
                            min={0}
                            value={closeProtectedChallengeCount}
                            onChange={(event) =>
                                setCloseProtectedChallengeCount(
                                    Number(event.target.value) || 0,
                                )
                            }
                        />
                    </label>
                </div>

                <label className={styles.checkbox}>
                    <input
                        type="checkbox"
                        checked={closePromotionBlocked}
                        onChange={(event) =>
                            setClosePromotionBlocked(event.target.checked)
                        }
                    />
                    機会不足で昇格保留
                </label>

                <label className={styles.field}>
                    <span>レビュー要約</span>
                    <textarea
                        className={styles.textarea}
                        value={closeReviewerSummary}
                        onChange={(event) => setCloseReviewerSummary(event.target.value)}
                        placeholder="今月の判断メモを短く残します。"
                    />
                </label>

                <div className={styles.rewardActions}>
                    <div className={styles.actionRowCompact}>
                        <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={onSubmitMonthClose}
                            disabled={submittingMonthClose}
                        >
                            {submittingMonthClose ? "送信中..." : "月締め申請を作る"}
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div>
                        <h4>4. 報酬を確認</h4>
                        <p>評価確定後の内容を見て、今月の支給内容を確認します。</p>
                    </div>
                    <span className={styles.metaBadge}>module route</span>
                </div>

                <div className={styles.moduleStatusGrid}>
                    <div className={styles.moduleStatusCard}>
                        <span>今月の close</span>
                        <strong>
                            {latestModuleClose ? latestModuleClose.id.slice(0, 8) : "未作成"}
                        </strong>
                        <p>
                            {latestModuleClose?.policy_fingerprint
                                ? `fingerprint ${String(latestModuleClose.policy_fingerprint).slice(0, 8)}...`
                                : "まず月締め申請を作成"}
                        </p>
                        {latestModuleCloseSiteSummary &&
                        latestModuleCloseSiteSummary.siteIds.length > 0 ? (
                            <div className={styles.moduleStatusSiteRow}>
                                <span className={styles.metaBadge}>
                                    対象 {latestModuleCloseSiteSummary.siteIds.length}件
                                </span>
                                <div className={styles.moduleStatusSiteLinks}>
                                    {latestModuleCloseSiteSummary.labels.map((label, index) => (
                                        <Link
                                            key={`${latestModuleCloseSiteSummary.siteIds[index] || label}-${index}`}
                                            className={styles.moduleStatusSiteLink}
                                            to={
                                                buildSiteDetailHref
                                                    ? buildSiteDetailHref(
                                                          latestModuleCloseSiteSummary.siteIds[index] || "",
                                                      )
                                                    : `/sites?site=${encodeURIComponent(
                                                          latestModuleCloseSiteSummary.siteIds[index] || "",
                                                      )}`
                                            }
                                        >
                                            {label}
                                        </Link>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                    <div className={styles.moduleStatusCard}>
                        <span>今月の run</span>
                        <strong>
                            {latestModuleRewardRun
                                ? `${latestModuleRewardRun.run_type} / ${latestModuleRewardRun.id.slice(0, 8)}`
                                : "未作成"}
                        </strong>
                        <p>
                            {moduleSummary?.reward_runs.length
                                ? `${moduleSummary.reward_runs.length}件の run を確認`
                                : "支給申請はまだありません"}
                        </p>
                    </div>
                    <div className={styles.moduleStatusCard}>
                        <span>補正月</span>
                        <strong>{correctionMonth}</strong>
                        <p>閉じた月は翌月に補正します。</p>
                    </div>
                </div>

                <div className={styles.rewardHint}>
                    <p>
                        会計連動がある前提では、ここは基本的に手入力しません。評価確定、site item 利益 {siteItemProfitCount} 件、
                        close input をもとに初期値を自動で入れています。
                    </p>
                    <p>未連携データの補完や例外対応が必要なときだけ、詳細を開いて上書きします。</p>
                </div>

                <div className={styles.rewardActions}>
                    <div className={styles.actionRowCompact}>
                        <button
                            className={styles.ghostButton}
                            type="button"
                            onClick={onPreviewReward}
                            disabled={previewingReward}
                        >
                            <Calculator size={14} />
                            {previewingReward ? "計算中..." : "PATH報酬を試算"}
                        </button>
                        <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={onSubmitReward}
                            disabled={submittingReward}
                        >
                            <Send size={14} />
                            {submittingReward ? "送信中..." : "支給申請を作る"}
                        </button>
                    </div>
                </div>

                {rewardPreview && (
                    <motion.div className={styles.rewardPreview} {...motionProps}>
                        <div className={styles.rewardSummaryGrid}>
                            <div className={styles.rewardSummaryCard}>
                                <span>配分額</span>
                                <strong>{formatCurrency(rewardPreview.closed_profit)}</strong>
                            </div>
                            <div className={styles.rewardSummaryCard}>
                                <span>PATH pool</span>
                                <strong>{formatCurrency(rewardPreview.path_pool_amount)}</strong>
                            </div>
                            <div className={styles.rewardSummaryCard}>
                                <span>固定配分</span>
                                <strong>{formatCurrency(rewardPreview.base_pool_amount)}</strong>
                            </div>
                            <div className={styles.rewardSummaryCard}>
                                <span>変動配分</span>
                                <strong>{formatCurrency(rewardPreview.variable_pool_amount)}</strong>
                            </div>
                        </div>

                        <div className={styles.rewardTableWrap}>
                            <table className={styles.rewardTable}>
                                <thead>
                                    <tr>
                                        <th>メンバー</th>
                                        <th>unit</th>
                                        <th>Level</th>
                                        <th>A/R/Q</th>
                                        <th>月次pt</th>
                                        <th>固定</th>
                                        <th>変動</th>
                                        <th>支給額</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rewardPreview.members.map((item) => (
                                        <tr key={item.member_id}>
                                            <td>{item.name}</td>
                                            <td>{item.credited_units}</td>
                                            <td>{item.role_level}</td>
                                            <td>{`${item.A}/${item.R}/${item.Q}`}</td>
                                            <td>{item.monthly_point_total}</td>
                                            <td>{formatCurrency(item.base_amount)}</td>
                                            <td>{formatCurrency(item.variable_amount)}</td>
                                            <td className={styles.amountCell}>{formatCurrency(item.final_pay)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </motion.div>
                )}

                <details className={styles.advancedSection}>
                    <summary className={styles.advancedSummary}>
                        <div className={styles.advancedSummaryCopy}>
                            <span className={styles.infoLabel}>詳細</span>
                            <strong>自動取得値を確認して、例外だけ上書きする</strong>
                        </div>
                        <span className={styles.metaBadge}>任意</span>
                    </summary>
                    <div className={styles.advancedBody}>
                        <div className={styles.overridePanel}>
                            <div>
                                <span className={styles.infoLabel}>金額ソース</span>
                                <strong>
                                    {siteItemProfitCount > 0
                                        ? `site item / 会計由来の ${siteItemProfitCount} 件を使用`
                                        : "自動連動データがまだありません"}
                                </strong>
                                <p>
                                    売上・原価・補正は自動取得値を使います。未連携の月や例外修正だけ手動で上書きします。
                                </p>
                            </div>
                            <button
                                className={styles.inlineGhostButton}
                                type="button"
                                onClick={() => setManualProfitOverride((current) => !current)}
                            >
                                {manualProfitOverride ? "自動取得に戻す" : "金額を手動で上書き"}
                            </button>
                        </div>

                        {manualProfitOverride ? (
                            <div className={styles.profitGrid}>
                                {[
                                    ["sales", "売上"],
                                    ["outsourcing_cost", "外注費"],
                                    ["materials_cost", "材料費"],
                                    ["parking_cost", "駐車場代"],
                                    ["transport_cost", "交通費"],
                                    ["other_direct_cost", "その他直接費"],
                                    ["common_cost", "共通原価"],
                                    ["reserve_amount", "積立"],
                                ].map(([key, label]) => (
                                    <label key={key} className={styles.field}>
                                        <span>{label}</span>
                                        <input
                                            className={styles.input}
                                            type="number"
                                            min={0}
                                            value={rewardProfitInputs[key as keyof PathRewardProfitInputs]}
                                            onChange={(event) =>
                                                setRewardProfitInputs((current) => ({
                                                    ...current,
                                                    [key]: Number(event.target.value) || 0,
                                                }))
                                            }
                                        />
                                    </label>
                                ))}
                                <label className={styles.field}>
                                    <span>前月補正</span>
                                    <input
                                        className={styles.input}
                                        type="number"
                                        value={rewardPriorAdjustments}
                                        onChange={(event) =>
                                            setRewardPriorAdjustments(
                                                Number(event.target.value) || 0,
                                            )
                                        }
                                    />
                                </label>
                            </div>
                        ) : (
                            <div className={styles.readOnlyGrid}>
                                {[
                                    ["売上", rewardProfitInputs.sales],
                                    ["外注費", rewardProfitInputs.outsourcing_cost],
                                    ["材料費", rewardProfitInputs.materials_cost],
                                    ["その他直接費", rewardProfitInputs.other_direct_cost],
                                    ["前月補正", rewardPriorAdjustments],
                                ].map(([label, value]) => (
                                    <div key={String(label)} className={styles.readOnlyCard}>
                                        <span>{label}</span>
                                        <strong>{formatCurrency(Number(value) || 0)}</strong>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className={styles.overridePanel}>
                            <div>
                                <span className={styles.infoLabel}>支給対象</span>
                                <strong>
                                    {autoSeededMemberCount > 0
                                        ? `${autoSeededMemberCount} 名を月締め・評価データから自動選定`
                                        : "自動選定できるメンバーがまだありません"}
                                </strong>
                                <p>
                                    通常は評価確定済みメンバーをそのまま使います。支給対象の追加や除外が必要なケースだけ上書きします。
                                </p>
                            </div>
                            <button
                                className={styles.inlineGhostButton}
                                type="button"
                                onClick={() => setManualMemberOverride((current) => !current)}
                            >
                                {manualMemberOverride ? "自動選定に戻す" : "対象を手動で上書き"}
                            </button>
                        </div>

                        {manualMemberOverride ? (
                            <>
                                <div className={styles.rewardActions}>
                                    <button className={styles.ghostButton} type="button" onClick={onAddRewardMember}>
                                        <Calculator size={14} />
                                        メンバー行を追加
                                    </button>
                                </div>

                                <div className={styles.rewardMemberList}>
                                    {rewardMembers.map((item, index) => (
                                        <div key={`${item.member_id || "new"}-${index}`} className={styles.rewardMemberCard}>
                                            <div className={styles.rewardMemberHeader}>
                                                <strong>対象 {index + 1}</strong>
                                                <button
                                                    className={styles.inlineGhostButton}
                                                    type="button"
                                                    onClick={() => onRemoveRewardMember(index)}
                                                    disabled={rewardMembers.length === 1}
                                                >
                                                    削除
                                                </button>
                                            </div>

                                            <div className={styles.moduleMemberGrid}>
                                                <label className={styles.field}>
                                                    <span>メンバー</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.member_id}
                                                        onChange={(event) =>
                                                            onSelectRewardMember(index, event.target.value)
                                                        }
                                                    >
                                                        <option value="">選択してください</option>
                                                        {memberOptions.map((member) => (
                                                            <option key={member.id} value={member.id}>
                                                                {member.label}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>表示名</span>
                                                    <input
                                                        className={styles.input}
                                                        value={item.name}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                name: event.target.value,
                                                            }))
                                                        }
                                                        placeholder="山田 太郎"
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>付与ユニット</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        value={item.credited_units}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                credited_units: Number(event.target.value) || 0,
                                                            }))
                                                        }
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>Level</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.role_level}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                role_level: event.target.value as RewardMemberDraft["role_level"],
                                                            }))
                                                        }
                                                    >
                                                        <option value="">選択してください</option>
                                                        {PATH_LEVEL_OPTIONS.map((level) => (
                                                            <option key={`${item.member_id}-${level}`} value={level}>
                                                                {level}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>最低保証</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        value={item.guaranteed_pay}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                guaranteed_pay: Number(event.target.value) || 0,
                                                            }))
                                                        }
                                                    />
                                                </label>

                                                {(["A", "R", "Q"] as const).map((field) => (
                                                    <label key={field} className={styles.field}>
                                                        <span>{field}</span>
                                                        <select
                                                            className={styles.select}
                                                            value={item[field]}
                                                            onChange={(event) =>
                                                                onUpdateRewardMember(index, (current) => ({
                                                                    ...current,
                                                                    [field]: Number(event.target.value),
                                                                }))
                                                            }
                                                        >
                                                            {[0, 1, 2].map((score) => (
                                                                <option key={`${field}-${score}`} value={score}>
                                                                    {score}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </label>
                                                ))}

                                                <label className={styles.field}>
                                                    <span>作業ID</span>
                                                    <input
                                                        className={styles.input}
                                                        value={item.package_id}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                package_id: event.target.value,
                                                            }))
                                                        }
                                                        placeholder="pkg-wall-01"
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>工種</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.trade_family}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                trade_family: event.target.value as PathTradeFamily,
                                                            }))
                                                        }
                                                    >
                                                        {PATH_TRADE_FAMILY_OPTIONS.map((family) => (
                                                            <option key={family} value={family}>
                                                                {tradeFamilyLabels[family]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>標準時間</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        value={item.std_hours}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                std_hours: Number(event.target.value) || 0,
                                                            }))
                                                        }
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>難易度</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.difficulty_band}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                difficulty_band: event.target.value as PathDifficultyBand,
                                                            }))
                                                        }
                                                    >
                                                        {PATH_DIFFICULTY_BAND_OPTIONS.map((band) => (
                                                            <option key={band} value={band}>
                                                                {band}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>責任割合</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        step={0.1}
                                                        value={item.responsibility_share}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                responsibility_share: Number(event.target.value) || 0,
                                                            }))
                                                        }
                                                    />
                                                </label>

                                                <label className={styles.field}>
                                                    <span>役割</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.role_type}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                role_type: event.target.value as PathRoleType,
                                                            }))
                                                        }
                                                    >
                                                        {PATH_ROLE_TYPE_OPTIONS.map((roleType) => (
                                                            <option key={roleType} value={roleType}>
                                                                {roleTypeLabels[roleType]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>品質結果</span>
                                                    <select
                                                        className={styles.select}
                                                        value={item.quality_result}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                quality_result: event.target.value as PathQualityResult,
                                                            }))
                                                        }
                                                    >
                                                        {PATH_QUALITY_RESULT_OPTIONS.map((result) => (
                                                            <option key={result} value={result}>
                                                                {qualityResultLabels[result]}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </label>

                                                <label className={styles.field}>
                                                    <span>rated units</span>
                                                    <input
                                                        className={styles.input}
                                                        type="number"
                                                        min={0}
                                                        step={0.1}
                                                        value={item.rated_units}
                                                        onChange={(event) =>
                                                            onUpdateRewardMember(index, (current) => ({
                                                                ...current,
                                                                rated_units: Number(event.target.value) || 0,
                                                            }))
                                                        }
                                                    />
                                                </label>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className={styles.readOnlyGrid}>
                                <div className={styles.readOnlyCard}>
                                    <span>自動選定メンバー</span>
                                    <strong>{autoSeededMemberCount} 名</strong>
                                </div>
                                <div className={styles.readOnlyCard}>
                                    <span>現在の補正月</span>
                                    <strong>{correctionMonth}</strong>
                                </div>
                            </div>
                        )}
                    </div>
                </details>
            </div>

            <div className={styles.card}>
                <div className={styles.cardHeader}>
                    <div>
                        <h4>5. 補正を申請</h4>
                        <p>既存 run の説明を見ながら、翌月に調整または取消を出します。</p>
                    </div>
                    <span className={styles.metaBadge}>reward.adjust</span>
                </div>

                {showExplanation ? (
                    <div className={styles.rewardSourceSection}>
                        <div className={styles.rewardSourceHeader}>
                            <div>
                                <h4>説明スナップショット</h4>
                                <p>
                                    {explanationMonthLabel} / {explanationRenderedLabel}
                                </p>
                            </div>
                            <span className={styles.metaBadge}>
                                {explanationReasonCodes.length} codes
                            </span>
                        </div>
                        <div className={styles.rewardSourceFormula}>
                            <span>summary</span>
                            <strong>{explanationSummary}</strong>
                            {explanationReasonCodes.length > 0 ? (
                                <p>reason codes: {explanationReasonCodes.join(", ")}</p>
                            ) : null}
                        </div>
                    </div>
                ) : (
                    <div className={styles.rewardSourceEmpty}>
                        先に対象メンバーを選ぶと、直近 run の説明スナップショットをここに表示します。
                    </div>
                )}

                <div className={styles.selectGrid}>
                    <label className={styles.field}>
                        <span>対象 run</span>
                        <select
                            className={styles.select}
                            value={correctionRewardRunId}
                            onChange={(event) => setCorrectionRewardRunId(event.target.value)}
                        >
                            <option value="">選択してください</option>
                            {rewardRuns.map((run) => (
                                <option key={run.id} value={run.id}>
                                    {`${run.month} / ${run.run_type} / ${String(run.status || "unknown")}`}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span>補正月</span>
                        <input
                            className={styles.input}
                            type="month"
                            value={correctionMonth}
                            onChange={(event) => setCorrectionMonth(event.target.value)}
                        />
                    </label>

                    <label className={styles.field}>
                        <span>補正モード</span>
                        <select
                            className={styles.select}
                            value={correctionMode}
                            onChange={(event) =>
                                setCorrectionMode(
                                    event.target.value as "adjustment" | "reversal",
                                )
                            }
                        >
                            <option value="reversal">reversal</option>
                            <option value="adjustment">adjustment</option>
                        </select>
                    </label>

                    <label className={styles.field}>
                        <span>理由コード</span>
                        <input
                            className={styles.input}
                            value={correctionReasonCode}
                            onChange={(event) => setCorrectionReasonCode(event.target.value)}
                            placeholder="manual_review"
                        />
                    </label>

                    <label className={styles.field}>
                        <span>補正額</span>
                        <input
                            className={styles.input}
                            type="number"
                            value={correctionAmount}
                            onChange={(event) =>
                                setCorrectionAmount(Number(event.target.value) || 0)
                            }
                        />
                    </label>
                </div>

                <label className={styles.field}>
                    <span>補正メモ</span>
                    <textarea
                        className={styles.textarea}
                        value={correctionNote}
                        onChange={(event) => setCorrectionNote(event.target.value)}
                        placeholder="取消か差額調整か、判断根拠を残します。"
                    />
                </label>

                <div className={styles.rewardHint}>
                    <p>reversal は元 run を取り消す前提、adjustment は差額だけ追加します。</p>
                    <p>現在の run 候補: {rewardRuns.length} 件 / 最新補正月 {correctionMonth}</p>
                </div>

                <div className={styles.rewardActions}>
                    <div className={styles.actionRowCompact}>
                        <button
                            className={styles.primaryButton}
                            type="button"
                            onClick={onSubmitCorrection}
                            disabled={submittingCorrection || rewardRuns.length === 0}
                        >
                            {submittingCorrection ? "送信中..." : "補正申請を作る"}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
