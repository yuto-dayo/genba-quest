import { Award } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Link } from "react-router-dom";
import {
    PATH_CERTIFICATION_STATUS_OPTIONS,
    type LUQORewardCalculation,
    type PathCertificationStatus,
    type PathMonthlyEvaluationAiReview,
    type PathMonthlyEvaluationConfirmation,
} from "../../../lib/api";
import type {
    CertificationStatusLabelMap,
    LegacyRewardComparisonRow,
    PathCalculationRun,
} from "./types";

export function PathReviewNotesSection({
    styles,
    confirmations,
    review,
    memberId,
    toPlainText,
}: {
    styles: Record<string, string>;
    confirmations: PathMonthlyEvaluationConfirmation[];
    review?: PathMonthlyEvaluationAiReview;
    memberId: string;
    toPlainText: (value: Record<string, unknown> | string) => string;
}) {
    return (
        <details className={styles.advancedSection}>
            <summary className={styles.advancedSummary}>
                <div className={styles.advancedSummaryCopy}>
                    <span className={styles.infoLabel}>詳細</span>
                    <strong>プロフィールと確認メモ</strong>
                </div>
                <span className={styles.metaBadge}>任意</span>
            </summary>
            <div className={styles.advancedBody}>
                <div className={styles.card}>
                    <h4 className={styles.cardTitle}>確認メモ</h4>
                    {confirmations.length === 0 && (
                        <p className={styles.mutedText}>まだ確認メモはありません。</p>
                    )}
                    <div className={styles.logList}>
                        {confirmations.slice(0, 6).map((item) => (
                            <div key={item.id} className={styles.logItem}>
                                <div>
                                    <strong>{item.target_key}</strong>
                                    <span>{item.confirmation_status}</span>
                                </div>
                                <p>{item.comment || "コメントなし"}</p>
                            </div>
                        ))}
                    </div>
                </div>

                {review?.unknown_points?.length ? (
                    <div className={styles.card}>
                        <h4 className={styles.cardTitle}>未確認ポイント</h4>
                        <ul className={styles.bulletList}>
                            {review.unknown_points.map((item, index) => (
                                <li key={`${memberId}-unknown-${index}`}>{toPlainText(item)}</li>
                            ))}
                        </ul>
                    </div>
                ) : null}
            </div>
        </details>
    );
}

export function PathLegacyComparisonSection({
    styles,
    latestPathCalculation,
    latestLuqoCalculation,
    period,
    comparisonDeltaTotal,
    rows,
    formatCurrency,
    formatDateTime,
}: {
    styles: Record<string, string>;
    latestPathCalculation: PathCalculationRun | null;
    latestLuqoCalculation: LUQORewardCalculation | null;
    period: string;
    comparisonDeltaTotal: number;
    rows: LegacyRewardComparisonRow[];
    formatCurrency: (value: number) => string;
    formatDateTime: (value?: string | null) => string;
}) {
    return (
        <div className={styles.card}>
            <div className={styles.cardHeader}>
                <div>
                    <h4>LUQOとの差分確認</h4>
                    <p>同月の最新 PATH と LUQO の結果を並べて、差分を確認します。</p>
                </div>
                <span className={styles.metaBadge}>
                    {latestPathCalculation && latestLuqoCalculation ? "比較可能" : "比較待ち"}
                </span>
            </div>

            <div className={styles.comparisonMetaRow}>
                <div className={styles.comparisonMetaCard}>
                    <span>PATH 最新</span>
                    {latestPathCalculation ? (
                        <strong>
                            {formatDateTime(latestPathCalculation.finalized_at)} /{" "}
                            {latestPathCalculation.proposal_id.slice(0, 8)}
                        </strong>
                    ) : (
                        <strong>未確定</strong>
                    )}
                </div>
                <div className={styles.comparisonMetaCard}>
                    <span>LUQO 最新</span>
                    {latestLuqoCalculation ? (
                        <strong>
                            {formatDateTime(latestLuqoCalculation.created_at)} /{" "}
                            {(latestLuqoCalculation.proposal_id || "manual").slice(0, 8)}
                        </strong>
                    ) : (
                        <strong>未確定</strong>
                    )}
                </div>
                <div className={styles.comparisonMetaCard}>
                    <span>比較対象月</span>
                    <strong>{period}</strong>
                </div>
            </div>

            <div className={styles.comparisonSummaryGrid}>
                <div className={styles.comparisonSummaryCard}>
                    <span>PATH 合計</span>
                    <strong>{formatCurrency(latestPathCalculation?.total_amount || 0)}</strong>
                </div>
                <div className={styles.comparisonSummaryCard}>
                    <span>LUQO 合計</span>
                    <strong>{formatCurrency(latestLuqoCalculation?.distributable || 0)}</strong>
                </div>
                <div className={styles.comparisonSummaryCard}>
                    <span>差分</span>
                    <strong
                        className={
                            comparisonDeltaTotal > 0
                                ? styles.positiveDelta
                                : comparisonDeltaTotal < 0
                                  ? styles.negativeDelta
                                  : ""
                        }
                    >
                        {formatCurrency(comparisonDeltaTotal)}
                    </strong>
                </div>
            </div>

            {rows.length === 0 ? (
                <div className={styles.emptyCompareState}>
                    PATH snapshot または LUQO 報酬確定がまだないため、比較は保留です。
                </div>
            ) : (
                <div className={styles.comparisonTableWrap}>
                    <table className={styles.comparisonTable}>
                        <thead>
                            <tr>
                                <th>メンバー</th>
                                <th>PATH</th>
                                <th>LUQO</th>
                                <th>差分</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row) => (
                                <tr key={row.member_id}>
                                    <td>{row.name}</td>
                                    <td>{formatCurrency(row.pathAmount)}</td>
                                    <td>{formatCurrency(row.luqoAmount)}</td>
                                    <td
                                        className={
                                            row.delta > 0
                                                ? styles.positiveDelta
                                                : row.delta < 0
                                                  ? styles.negativeDelta
                                                  : ""
                                        }
                                    >
                                        {formatCurrency(row.delta)}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export function PathSkillCertificationSection({
    styles,
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
    submittingCertification,
    onSubmit,
    certificationStatusLabels,
    verifiedCertificationCount,
    reviewCertificationCount,
    certificationHighlights,
    formatSkillLabel,
}: {
    styles: Record<string, string>;
    skillKey: string;
    setSkillKey: Dispatch<SetStateAction<string>>;
    skillCategory: string;
    setSkillCategory: Dispatch<SetStateAction<string>>;
    skillStatus: PathCertificationStatus;
    setSkillStatus: Dispatch<SetStateAction<PathCertificationStatus>>;
    skillEvidenceCount: number;
    setSkillEvidenceCount: Dispatch<SetStateAction<number>>;
    skillNote: string;
    setSkillNote: Dispatch<SetStateAction<string>>;
    skillReviewRequired: boolean;
    setSkillReviewRequired: Dispatch<SetStateAction<boolean>>;
    submittingCertification: boolean;
    onSubmit: () => void;
    certificationStatusLabels: CertificationStatusLabelMap;
    verifiedCertificationCount: number;
    reviewCertificationCount: number;
    certificationHighlights: Array<{ id: string; skill_key: string }>;
    formatSkillLabel: (value: string) => string;
}) {
    return (
        <div className={styles.doubleColumn}>
            <div className={styles.card}>
                <h4 className={styles.cardTitle}>詳細技能の認定</h4>
                <div className={styles.inputGrid}>
                    <label className={styles.field}>
                        <span>技能キー</span>
                        <input
                            className={styles.input}
                            value={skillKey}
                            onChange={(event) => setSkillKey(event.target.value)}
                            placeholder="joint_finish"
                        />
                    </label>
                    <label className={styles.field}>
                        <span>カテゴリ</span>
                        <input
                            className={styles.input}
                            value={skillCategory}
                            onChange={(event) => setSkillCategory(event.target.value)}
                            placeholder="finish"
                        />
                    </label>
                    <label className={styles.field}>
                        <span>状態</span>
                        <select
                            className={styles.select}
                            value={skillStatus}
                            onChange={(event) => setSkillStatus(event.target.value as PathCertificationStatus)}
                        >
                            {PATH_CERTIFICATION_STATUS_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                    {certificationStatusLabels[option]}
                                </option>
                            ))}
                        </select>
                    </label>
                    <label className={styles.field}>
                        <span>根拠件数</span>
                        <input
                            className={styles.input}
                            type="number"
                            min={0}
                            value={skillEvidenceCount}
                            onChange={(event) => setSkillEvidenceCount(Number(event.target.value))}
                        />
                    </label>
                </div>

                <label className={styles.field}>
                    <span>メモ</span>
                    <textarea
                        className={styles.textarea}
                        value={skillNote}
                        onChange={(event) => setSkillNote(event.target.value)}
                        placeholder="認定根拠・差し戻し理由"
                    />
                </label>

                <label className={styles.checkbox}>
                    <input
                        type="checkbox"
                        checked={skillReviewRequired}
                        onChange={(event) => setSkillReviewRequired(event.target.checked)}
                    />
                    要レビューのまま保持する
                </label>

                <div className={styles.actionRow}>
                    <button
                        className={styles.primaryButton}
                        onClick={onSubmit}
                        disabled={submittingCertification}
                    >
                        <Award size={14} />
                        {submittingCertification ? "送信中..." : "技能認定を申請する"}
                    </button>
                </div>
            </div>

            <div className={styles.card}>
                <h4 className={styles.cardTitle}>認定履歴は設定で確認</h4>
                <p className={styles.mutedText}>
                    最近の認定や 6つの主評価項目は、本人プロフィールに寄せています。
                </p>
                <div className={styles.profileTransferGrid}>
                    <div className={styles.profileTransferStat}>
                        <span>認定済み</span>
                        <strong>{verifiedCertificationCount}件</strong>
                    </div>
                    <div className={styles.profileTransferStat}>
                        <span>要レビュー</span>
                        <strong>{reviewCertificationCount}件</strong>
                    </div>
                </div>
                {certificationHighlights.length > 0 && (
                    <div className={styles.badgeRow}>
                        {certificationHighlights.map((item) => (
                            <span key={item.id} className={styles.badge}>
                                {formatSkillLabel(item.skill_key)}
                            </span>
                        ))}
                    </div>
                )}
                <p className={styles.profileTransferHint}>
                    参照は `/settings` に集約し、PATH では今月の評価作業だけを進めます。
                </p>
                <Link to="/settings" className={styles.inlineLinkButton}>
                    設定で確認する
                </Link>
            </div>
        </div>
    );
}
