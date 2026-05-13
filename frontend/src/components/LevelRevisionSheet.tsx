import { useEffect, useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { HardHat, MapPin, X } from "lucide-react";
import {
    fetchSite,
    revisePathV33LevelDraft,
    type PathV33LevelDraft,
    type PathV33Tier,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { mapLevelDraftReviseErrorMessage } from "./levelDraftErrors";
import styles from "./LevelRevisionSheet.module.css";

const TIER_OPTIONS: Array<{ value: PathV33Tier; label: string; helper: string }> = [
    { value: 1, label: "補助", helper: "先輩の指示を受けて手を動かした" },
    { value: 2, label: "標準", helper: "自分の手で標準的に進めた" },
    { value: 3, label: "主導", helper: "段取り含めて自分が引っ張った" },
];

export interface LevelRevisionSheetProps {
    open: boolean;
    onClose: () => void;
    draft: PathV33LevelDraft | null;
    memberId: string;
    onRevised?: () => Promise<void> | void;
}

export function LevelRevisionSheet({
    open,
    onClose,
    draft,
    memberId,
    onRevised,
}: LevelRevisionSheetProps) {
    const [tier, setTier] = useState<PathV33Tier>(2);
    const [comment, setComment] = useState("");
    const [reason, setReason] = useState("");
    const [siteInfo, setSiteInfo] = useState<Pick<Site, "name" | "work_types" | "address"> | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || !draft) {
            setSiteInfo(null);
            return;
        }
        setTier(draft.tier);
        setComment(draft.self_comment ?? "");
        setReason("");
        setSubmitError(null);

        let cancelled = false;
        fetchSite(draft.site_id)
            .then((site) => {
                if (!cancelled) {
                    setSiteInfo({ name: site.name, work_types: site.work_types, address: site.address });
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
    }, [open, draft]);

    const headerWorkTypes = useMemo(
        () =>
            (siteInfo?.work_types ?? [])
                .map((entry) => String(entry).trim())
                .filter(Boolean),
        [siteInfo?.work_types],
    );
    const headerAddress = siteInfo?.address?.trim() || "";
    const headerName = siteInfo?.name || `現場 ${draft?.site_id ?? ""}`;

    const canSubmit = Boolean(draft && reason.trim().length > 0 && memberId);

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!draft) {
            return;
        }

        setSubmitting(true);
        setSubmitError(null);
        try {
            await revisePathV33LevelDraft({
                draft_id: draft.id,
                tier,
                self_comment: comment.trim(),
                reason: reason.trim(),
            });
            await onRevised?.();
            onClose();
        } catch (error) {
            setSubmitError(mapLevelDraftReviseErrorMessage(getErrorMessage(error)));
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <AnimatePresence>
            {open && draft && (
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
                        aria-labelledby="level-revision-sheet-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className={styles.header}>
                            <div className={styles.heading}>
                                <span className={styles.eyebrow}>
                                    <HardHat size={14} aria-hidden /> レベル申告の修正
                                </span>
                                <h2 id="level-revision-sheet-title">{headerName}</h2>
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
                                <p>月締め前なら自分の申告を修正できます。修正理由は必須です。</p>
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
                                    placeholder="例: 朝は補助、午後は段取りと指示まで担当した"
                                />
                            </label>

                            <label className={styles.fieldLabel}>
                                修正理由 (必須)
                                <textarea
                                    className={styles.textarea}
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    rows={3}
                                    maxLength={500}
                                    placeholder="なぜ修正するかを入力してください"
                                    required
                                />
                            </label>

                            {submitError && <p className={styles.submitError}>修正に失敗: {submitError}</p>}

                            <footer className={styles.footer}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={onClose}
                                    disabled={submitting}
                                >
                                    キャンセル
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={submitting || !canSubmit}
                                >
                                    {submitting ? "保存中..." : "変更を保存"}
                                </button>
                            </footer>
                        </form>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
