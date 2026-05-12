import { useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, HardHat, MapPin, X } from "lucide-react";
import {
    fetchSite,
    fetchPathV33MonthlyPreview,
    submitPathV33LevelDraft,
    type PathV33Level,
    type PathV33MonthlyPreview,
    type PathV33Tier,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./LevelDraftSheet.module.css";

const TIER_OPTIONS: Array<{ value: PathV33Tier; label: string; helper: string }> = [
    { value: 1, label: "補助", helper: "先輩の指示を受けて手を動かした" },
    { value: 2, label: "標準", helper: "自分の手で標準的に進めた" },
    { value: 3, label: "主導", helper: "段取り含めて自分が引っ張った" },
];

const LEVEL_LABELS: Record<PathV33Level, string> = {
    L1: "見習い",
    L2: "補助主体",
    L3: "標準",
    L4: "中堅",
    L5: "熟練",
};

const LEVEL_WEIGHT_MILLI: Record<PathV33Level, number> = {
    L1: 410,
    L2: 512,
    L3: 640,
    L4: 800,
    L5: 1000,
};

export interface LevelDraftSheetProps {
    open: boolean;
    onClose: () => void;
    siteId: string;
    siteName: string;
    memberId: string;
    onSubmitted?: () => void;
}

export function LevelDraftSheet({
    open,
    onClose,
    siteId,
    siteName,
    memberId,
    onSubmitted,
}: LevelDraftSheetProps) {
    const [tier, setTier] = useState<PathV33Tier>(2);
    const [comment, setComment] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [loadingPreview, setLoadingPreview] = useState(false);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const [preview, setPreview] = useState<PathV33MonthlyPreview | null>(null);
    const [forecast, setForecast] = useState<PathV33MonthlyPreview | null>(null);
    const [postSubmitBanner, setPostSubmitBanner] = useState<string | null>(null);
    const [siteInfo, setSiteInfo] = useState<Pick<Site, "work_types" | "address"> | null>(null);

    useEffect(() => {
        if (!open || !siteId) {
            setSiteInfo(null);
            return;
        }
        let cancelled = false;
        setSiteInfo(null);
        fetchSite(siteId)
            .then((site) => {
                if (!cancelled) {
                    setSiteInfo({ work_types: site.work_types, address: site.address });
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setSiteInfo(null);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [open, siteId]);

    useEffect(() => {
        if (!open || !memberId) {
            return;
        }
        const month = new Date().toISOString().slice(0, 7);
        let cancelled = false;
        setLoadingPreview(true);
        setPreviewError(null);
        fetchPathV33MonthlyPreview(memberId, month)
            .then((result) => {
                if (cancelled) return;
                setPreview(result);
                // Seed selection from any existing draft for this site
                const existing = result.drafts.find((d) => d.site_id === siteId);
                if (existing) {
                    setTier(existing.tier);
                    setComment(existing.self_comment);
                }
            })
            .catch((err) => {
                if (!cancelled) setPreviewError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setLoadingPreview(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, memberId, siteId]);

    // Recompute forecast locally as the user changes the tier picker — no extra
    // round-trip. Replaces the draft for the current site with the picked tier
    // (using the existing work_days from the loaded draft, or estimating 1).
    useEffect(() => {
        if (!preview) {
            setForecast(null);
            return;
        }
        const existing = preview.drafts.find((d) => d.site_id === siteId);
        const otherDrafts = preview.drafts
            .filter((d) => d.site_id !== siteId)
            .map((d) => ({ site_id: d.site_id, tier: d.tier, work_days: d.work_days }));
        const projectedWorkDays = existing?.work_days ?? 1;
        const projected = [
            ...otherDrafts,
            { site_id: siteId, tier, work_days: projectedWorkDays },
        ];
        let totalDays = 0;
        let weighted = 0;
        for (const d of projected) {
            totalDays += d.work_days;
            weighted += d.tier * d.work_days;
        }
        const score = totalDays > 0 ? Math.round((weighted / totalDays) * 100) / 100 : 0;
        const level: PathV33Level =
            score >= 2.7 ? "L5" : score >= 2.2 ? "L4" : score >= 1.8 ? "L3" : score >= 1.3 ? "L2" : "L1";
        setForecast({
            ...preview,
            current: {
                level,
                weight_milli: LEVEL_WEIGHT_MILLI[level],
                score,
                total_work_days: totalDays,
                draft_count: projected.length,
                drafts: projected,
            },
        });
    }, [preview, siteId, tier]);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!siteId) return;
        setSubmitting(true);
        setSubmitError(null);
        setPostSubmitBanner(null);
        try {
            const result = await submitPathV33LevelDraft({
                site_id: siteId,
                tier,
                self_comment: comment.trim() || undefined,
            });
            // Audit #9: surface the server-recomputed level. If it differs
            // from the local forecast (e.g. work_days drifted since load),
            // show the actual before closing so the user isn't surprised.
            const actualLevel = result.preview.current.level;
            const forecastLevel = forecast?.current.level ?? null;
            setPreview(result.preview);
            onSubmitted?.();
            if (forecastLevel && actualLevel !== forecastLevel) {
                setPostSubmitBanner(
                    `申告を保存しました。実際の月見込みは ${actualLevel} (出勤日数の差で予想 ${forecastLevel} とズレ)。`,
                );
            } else {
                setPostSubmitBanner(`申告を保存しました。今月の見込み: ${actualLevel}`);
            }
            // Auto-close after 1.5s so the user sees the confirmation.
            window.setTimeout(() => {
                onClose();
            }, 1500);
        } catch (err) {
            setSubmitError(getErrorMessage(err));
        } finally {
            setSubmitting(false);
        }
    }

    const currentLevel = preview?.current.level ?? null;
    const forecastLevel = forecast?.current.level ?? null;
    const existingDraft = preview?.drafts.find((d) => d.site_id === siteId);
    const workDaysHint = existingDraft?.work_days ?? null;
    const headerWorkTypes = (siteInfo?.work_types ?? []).map((entry) => String(entry).trim()).filter(Boolean);
    const headerAddress = siteInfo?.address?.trim() || "";

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    className={styles.overlay}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={onClose}
                >
                    <motion.section
                        className={styles.sheet}
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 18 }}
                        transition={{ duration: 0.18, ease: "easeOut" }}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="level-draft-sheet-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className={styles.header}>
                            <div className={styles.heading}>
                                <span className={styles.eyebrow}>
                                    <HardHat size={14} aria-hidden /> 現場レベル申告
                                </span>
                                <h2 id="level-draft-sheet-title">{siteName || "完了現場"}</h2>
                                {(headerWorkTypes.length > 0 || headerAddress) && (
                                    <div className={styles.siteContext}>
                                        {headerWorkTypes.length > 0 && (
                                            <div className={styles.workTypeChips}>
                                                {headerWorkTypes.map((workType) => (
                                                    <span key={workType} className={styles.workTypeChip}>
                                                        {workType}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {headerAddress && (
                                            <p className={styles.siteAddress}>
                                                <MapPin size={12} aria-hidden="true" />
                                                <span>{headerAddress}</span>
                                            </p>
                                        )}
                                    </div>
                                )}
                                <p>この現場での自分の働き方を 3 段階で残してください。月末に加重平均で評価レベルが決まります。</p>
                            </div>
                            <button
                                type="button"
                                className={styles.closeButton}
                                onClick={onClose}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </header>

                        <form className={styles.form} onSubmit={handleSubmit}>
                            <fieldset className={styles.tierGroup}>
                                <legend className={styles.fieldLabel}>この現場での役割</legend>
                                <div className={styles.tierRow} role="radiogroup">
                                    {TIER_OPTIONS.map((option) => (
                                        <button
                                            type="button"
                                            key={option.value}
                                            role="radio"
                                            aria-checked={tier === option.value}
                                            className={`${styles.tierButton} ${tier === option.value ? styles.tierActive : ""}`}
                                            onClick={() => setTier(option.value)}
                                        >
                                            <span className={styles.tierLabel}>{option.label}</span>
                                            <span className={styles.tierHelper}>{option.helper}</span>
                                        </button>
                                    ))}
                                </div>
                            </fieldset>

                            <label className={styles.fieldLabel}>
                                自由コメント (任意)
                                <textarea
                                    className={styles.textarea}
                                    value={comment}
                                    onChange={(event) => setComment(event.target.value)}
                                    rows={3}
                                    maxLength={500}
                                    placeholder="例: パテと仕上げを担当。最終日は応援も入れた。"
                                />
                            </label>

                            <section className={styles.previewCard}>
                                <header className={styles.previewHeader}>
                                    <span>申告プレビュー</span>
                                    {workDaysHint !== null && (
                                        <span className={styles.previewMeta}>この現場の出勤 {workDaysHint} 日</span>
                                    )}
                                </header>
                                {loadingPreview && (
                                    <p className={styles.previewMuted}>今月の状況を読み込み中...</p>
                                )}
                                {previewError && (
                                    <p className={styles.previewError}>プレビュー取得失敗: {previewError}</p>
                                )}
                                {!loadingPreview && !previewError && currentLevel && forecastLevel && (
                                    <div className={styles.previewLine}>
                                        <span className={styles.previewLevelBlock}>
                                            <span className={styles.previewLevelLabel}>今</span>
                                            <strong>
                                                {currentLevel} {LEVEL_LABELS[currentLevel]}
                                            </strong>
                                            <span className={styles.previewLevelMeta}>
                                                score {preview?.current.score.toFixed(2)} / 重み {preview?.current.weight_milli}
                                            </span>
                                        </span>
                                        <ArrowRight size={20} aria-hidden className={styles.previewArrow} />
                                        <span
                                            className={`${styles.previewLevelBlock} ${
                                                forecastLevel !== currentLevel ? styles.previewLevelChanged : ""
                                            }`}
                                        >
                                            <span className={styles.previewLevelLabel}>申告後</span>
                                            <strong>
                                                {forecastLevel} {LEVEL_LABELS[forecastLevel]}
                                            </strong>
                                            <span className={styles.previewLevelMeta}>
                                                score {forecast?.current.score.toFixed(2)} / 重み {forecast?.current.weight_milli}
                                            </span>
                                        </span>
                                    </div>
                                )}
                                {!loadingPreview && !previewError && !currentLevel && (
                                    <p className={styles.previewMuted}>今月はまだ申告がありません。初回申告です。</p>
                                )}
                            </section>

                            {submitError && (
                                <p className={styles.submitError}>申告に失敗: {submitError}</p>
                            )}
                            {postSubmitBanner && (
                                <p className={styles.postSubmitBanner}>{postSubmitBanner}</p>
                            )}

                            <footer className={styles.footer}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={onClose}
                                    disabled={submitting}
                                >
                                    あとで
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={submitting || !siteId}
                                >
                                    {submitting ? "申告中..." : "この内容で申告する"}
                                </button>
                            </footer>
                        </form>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
