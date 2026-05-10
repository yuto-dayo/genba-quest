import { useMemo, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertOctagon, X } from "lucide-react";
import type { PathV33TeamFeedTimelineEntry, PathV33Tier } from "../lib/api";
import styles from "./ObjectionSubmitSheet.module.css";

const TIER_OPTIONS: Array<{ value: PathV33Tier; label: string; helper: string }> = [
    { value: 1, label: "補助", helper: "実際は補助の働きだった" },
    { value: 2, label: "標準", helper: "実際は標準の働きだった" },
    { value: 3, label: "主導", helper: "実際は主導していた" },
];

const TIER_LABEL: Record<PathV33Tier, string> = {
    1: "補助",
    2: "標準",
    3: "主導",
};

export interface ObjectionSubmitSheetProps {
    open: boolean;
    target: PathV33TeamFeedTimelineEntry | null;
    submitting: boolean;
    error: string | null;
    onClose: () => void;
    onSubmit: (input: { proposed_tier: PathV33Tier; reason: string }) => void | Promise<void>;
}

export function ObjectionSubmitSheet({
    open,
    target,
    submitting,
    error,
    onClose,
    onSubmit,
}: ObjectionSubmitSheetProps) {
    // Default to a tier different from the current declaration. Recomputed when
    // a new target is opened. Using a derived key (target.draft_id) so the
    // controlled state resets without violating react-hooks/set-state-in-effect.
    const draftKey = open ? target?.draft_id ?? "" : "";
    const initialTier = useMemo<PathV33Tier>(() => {
        if (!target) return 2;
        return target.tier === 3 ? 2 : target.tier === 1 ? 2 : 3;
    }, [target]);
    const [proposedTier, setProposedTier] = useState<PathV33Tier>(initialTier);
    const [reason, setReason] = useState("");
    const [lastDraftKey, setLastDraftKey] = useState<string>("");
    if (draftKey !== lastDraftKey) {
        // Reset transient state when a new target opens. Doing this during
        // render (not in an effect) avoids the set-state-in-effect lint rule.
        setLastDraftKey(draftKey);
        setProposedTier(initialTier);
        setReason("");
    }

    function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!target || submitting) return;
        if (proposedTier === target.tier) return;
        if (!reason.trim()) return;
        void onSubmit({ proposed_tier: proposedTier, reason: reason.trim() });
    }

    const sameTier = target ? proposedTier === target.tier : false;
    const reasonEmpty = reason.trim().length === 0;
    const submitDisabled = submitting || sameTier || reasonEmpty;

    return (
        <AnimatePresence>
            {open && target && (
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
                        aria-labelledby="objection-sheet-title"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <header className={styles.header}>
                            <div className={styles.heading}>
                                <span className={styles.eyebrow}>
                                    <AlertOctagon size={14} aria-hidden /> 異議を出す
                                </span>
                                <h2 id="objection-sheet-title">
                                    {target.member_name}さんの「{target.site_name}」申告
                                </h2>
                                <p>
                                    現在: <strong>{TIER_LABEL[target.tier]}</strong> ({target.work_days} 日)。違うと思う tier を選んで、理由を書いてください。チーム全員に通知されます。
                                </p>
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
                                <legend className={styles.fieldLabel}>正しいと思う tier</legend>
                                <div className={styles.tierRow} role="radiogroup">
                                    {TIER_OPTIONS.map((option) => {
                                        const isCurrent = target.tier === option.value;
                                        return (
                                            <button
                                                type="button"
                                                key={option.value}
                                                role="radio"
                                                aria-checked={proposedTier === option.value}
                                                className={`${styles.tierButton} ${proposedTier === option.value ? styles.tierActive : ""} ${isCurrent ? styles.tierCurrent : ""}`}
                                                onClick={() => setProposedTier(option.value)}
                                                disabled={isCurrent}
                                                title={isCurrent ? "現在の申告と同じです" : undefined}
                                            >
                                                <span className={styles.tierLabel}>{option.label}</span>
                                                <span className={styles.tierHelper}>{option.helper}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </fieldset>

                            <label className={styles.fieldLabel}>
                                理由 (必須)
                                <textarea
                                    className={styles.textarea}
                                    value={reason}
                                    onChange={(event) => setReason(event.target.value)}
                                    rows={3}
                                    maxLength={500}
                                    placeholder="例: 当日現場にいたが、主導していたのは実際には田中さんだった"
                                />
                            </label>

                            {error && <p className={styles.error}>送信失敗: {error}</p>}
                            {sameTier && (
                                <p className={styles.warn}>
                                    現在と同じ tier では異議は出せません。
                                </p>
                            )}

                            <footer className={styles.footer}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={onClose}
                                    disabled={submitting}
                                >
                                    やめる
                                </button>
                                <button
                                    type="submit"
                                    className={styles.primaryButton}
                                    disabled={submitDisabled}
                                >
                                    {submitting ? "送信中..." : "異議を提出"}
                                </button>
                            </footer>
                        </form>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
