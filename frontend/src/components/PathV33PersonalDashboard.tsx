import { useCallback, useEffect, useState } from "react";
import { ArrowRight, HardHat } from "lucide-react";
import {
    fetchPathV33MonthlyPreview,
    type PathV33LevelDraft,
    type PathV33Level,
    type PathV33MonthlyPreview,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { LevelRevisionSheet } from "./LevelRevisionSheet";
import styles from "./PathV33PersonalDashboard.module.css";

const LEVEL_LABELS: Record<PathV33Level, string> = {
    L1: "見習い",
    L2: "補助主体",
    L3: "標準",
    L4: "中堅",
    L5: "熟練",
};

const TIER_LABELS: Record<number, string> = {
    1: "補助",
    2: "標準",
    3: "主導",
};

export interface PathV33PersonalDashboardProps {
    memberId: string;
    month: string;
}

export function PathV33PersonalDashboard({ memberId, month }: PathV33PersonalDashboardProps) {
    const [preview, setPreview] = useState<PathV33MonthlyPreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revisionTarget, setRevisionTarget] = useState<PathV33LevelDraft | null>(null);

    const reloadPreview = useCallback(async () => {
        if (!memberId || !month) {
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const result = await fetchPathV33MonthlyPreview(memberId, month);
            setPreview(result);
        } catch (err) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [memberId, month]);

    useEffect(() => {
        if (!memberId || !month) {
            return;
        }
        let cancelled = false;
        async function run() {
            setLoading(true);
            setError(null);
            try {
                const result = await fetchPathV33MonthlyPreview(memberId, month);
                if (!cancelled) setPreview(result);
            } catch (err) {
                if (!cancelled) setError(getErrorMessage(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void run();
        return () => {
            cancelled = true;
        };
    }, [memberId, month]);

    if (loading) {
        return <p className={styles.muted}>今月の見込みを読み込み中...</p>;
    }
    if (error) {
        return <p className={styles.error}>取得に失敗: {error}</p>;
    }
    if (!preview) {
        return <p className={styles.muted}>表示できる情報がありません。</p>;
    }

    const { current, prior_level, drafts } = preview;
    const levelChanged = prior_level && prior_level !== current.level;

    const sortedDrafts = [...drafts].sort((a, b) =>
        b.submitted_at.localeCompare(a.submitted_at),
    );

    return (
        <div className={styles.container}>
            <section className={styles.summaryCard}>
                <header className={styles.summaryHeader}>
                    <span className={styles.eyebrow}>{month} 見込み</span>
                    <p className={styles.disclaimer}>確定は月末 +8 日</p>
                </header>
                <div className={styles.levelRow}>
                    {prior_level && (
                        <>
                            <span className={styles.priorLevel}>
                                <span className={styles.priorLevelLabel}>前月</span>
                                <strong>
                                    {prior_level} {LEVEL_LABELS[prior_level]}
                                </strong>
                            </span>
                            <ArrowRight size={20} className={styles.arrow} aria-hidden />
                        </>
                    )}
                    <span className={`${styles.currentLevel} ${levelChanged ? styles.levelChanged : ""}`}>
                        <span className={styles.currentLevelLabel}>今月の見込み</span>
                        <strong>
                            {current.level} {LEVEL_LABELS[current.level]}
                        </strong>
                        <span className={styles.metaRow}>
                            <span>score {current.score.toFixed(2)}</span>
                            <span aria-hidden>·</span>
                            <span>重み {current.weight_milli}</span>
                            <span aria-hidden>·</span>
                            <span>出勤 {current.total_work_days} 日</span>
                        </span>
                    </span>
                </div>
            </section>

            <section className={styles.timelineCard}>
                <header className={styles.timelineHeader}>
                    <HardHat size={16} aria-hidden />
                    <h3>今月の申告履歴</h3>
                    <span className={styles.count}>{sortedDrafts.length}</span>
                </header>
                {sortedDrafts.length === 0 ? (
                    <p className={styles.muted}>まだ申告がありません。完了した現場のベル通知から申告できます。</p>
                ) : (
                    <ul className={styles.timeline}>
                        {sortedDrafts.map((draft) => (
                            <li key={draft.id} className={styles.timelineItem}>
                                <div className={styles.timelineRowMain}>
                                    <span className={styles.tierBadge}>{TIER_LABELS[draft.tier]}</span>
                                    <span className={styles.workDays}>{draft.work_days} 日</span>
                                    <span className={styles.timelineDate}>
                                        {formatTimelineDate(draft.submitted_at)}
                                    </span>
                                    {!draft.locked_at ? (
                                        <button
                                            type="button"
                                            className={styles.reviseButton}
                                            onClick={() => setRevisionTarget(draft)}
                                        >
                                            修正
                                        </button>
                                    ) : (
                                        <span className={styles.lockedBadge}>確定済</span>
                                    )}
                                </div>
                                {draft.self_comment && (
                                    <p className={styles.comment}>{draft.self_comment}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <LevelRevisionSheet
                open={revisionTarget !== null}
                onClose={() => setRevisionTarget(null)}
                draft={revisionTarget}
                memberId={memberId}
                onRevised={reloadPreview}
            />
        </div>
    );
}

function formatTimelineDate(iso: string): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
