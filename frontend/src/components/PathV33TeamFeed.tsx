import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import {
    fetchPathV33TeamFeed,
    type PathV33Level,
    type PathV33TeamFeed,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./PathV33TeamFeed.module.css";

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

export interface PathV33TeamFeedProps {
    month: string;
}

export function PathV33TeamFeedView({ month }: PathV33TeamFeedProps) {
    const [feed, setFeed] = useState<PathV33TeamFeed | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [memberFilter, setMemberFilter] = useState<string>("");

    useEffect(() => {
        if (!month) return;
        let cancelled = false;
        async function run() {
            setLoading(true);
            setError(null);
            try {
                const result = await fetchPathV33TeamFeed(month);
                if (!cancelled) setFeed(result);
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
    }, [month]);

    const filteredTimeline = useMemo(() => {
        if (!feed) return [];
        if (!memberFilter) return feed.timeline;
        return feed.timeline.filter((entry) => entry.member_id === memberFilter);
    }, [feed, memberFilter]);

    if (loading) return <p className={styles.muted}>チーム状況を読み込み中...</p>;
    if (error) return <p className={styles.error}>取得に失敗: {error}</p>;
    if (!feed) return <p className={styles.muted}>表示できる情報がありません。</p>;

    return (
        <div className={styles.container}>
            <section className={styles.membersCard}>
                <header className={styles.cardHeader}>
                    <Users size={16} aria-hidden />
                    <h3>メンバーの今月見込み</h3>
                    <span className={styles.count}>{feed.members.length} 名</span>
                </header>
                {feed.members.length === 0 ? (
                    <p className={styles.muted}>メンバーが見つかりませんでした。</p>
                ) : (
                    <ul className={styles.memberList}>
                        {feed.members.map((member) => (
                            <li key={member.member_id} className={styles.memberRow}>
                                <button
                                    type="button"
                                    className={`${styles.memberButton} ${memberFilter === member.member_id ? styles.memberActive : ""}`}
                                    onClick={() =>
                                        setMemberFilter((current) =>
                                            current === member.member_id ? "" : member.member_id,
                                        )
                                    }
                                >
                                    <span className={styles.memberName}>{member.member_name}</span>
                                    <span className={styles.memberLevel}>
                                        <strong>
                                            {member.current.level} {LEVEL_LABELS[member.current.level]}
                                        </strong>
                                        <span className={styles.memberMeta}>
                                            score {member.current.score.toFixed(2)} · {member.current.draft_count} 件 · {member.current.total_work_days} 日
                                        </span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            <section className={styles.timelineCard}>
                <header className={styles.cardHeader}>
                    <h3>申告タイムライン</h3>
                    {memberFilter && (
                        <button
                            type="button"
                            className={styles.clearFilter}
                            onClick={() => setMemberFilter("")}
                        >
                            フィルタ解除
                        </button>
                    )}
                    <span className={styles.count}>{filteredTimeline.length} 件</span>
                </header>
                {filteredTimeline.length === 0 ? (
                    <p className={styles.muted}>該当する申告はありません。</p>
                ) : (
                    <ul className={styles.timeline}>
                        {filteredTimeline.map((entry) => (
                            <li key={entry.draft_id} className={styles.timelineItem}>
                                <div className={styles.timelineMain}>
                                    <span className={styles.tierBadge}>{TIER_LABELS[entry.tier]}</span>
                                    <span className={styles.memberInline}>{entry.member_name}</span>
                                    <span className={styles.siteName}>{entry.site_name}</span>
                                    <span className={styles.workInline}>{entry.work_days} 日</span>
                                    <span className={styles.dateInline}>
                                        {formatTimelineDate(entry.submitted_at)}
                                    </span>
                                </div>
                                {entry.self_comment && (
                                    <p className={styles.comment}>{entry.self_comment}</p>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}

function formatTimelineDate(iso: string): string {
    if (!iso) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
