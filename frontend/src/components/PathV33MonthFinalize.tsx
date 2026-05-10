import { useEffect, useState } from "react";
import { Calendar, CheckCheck, Hourglass, Lock } from "lucide-react";
import {
    expirePathV33MonthObjections,
    fetchPathV33TeamFeed,
    finalizePathV33Month,
    lockPathV33MonthDrafts,
    type PathV33ExpireResult,
    type PathV33FinalizeResult,
    type PathV33LockResult,
    type PathV33Objection,
    type PathV33TeamFeed,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./PathV33MonthFinalize.module.css";

const LEVEL_LABELS: Record<string, string> = {
    L1: "見習い",
    L2: "補助主体",
    L3: "標準",
    L4: "中堅",
    L5: "熟練",
};

export interface PathV33MonthFinalizeProps {
    month: string;
}

type BannerKind = "success" | "error";

interface Banner {
    kind: BannerKind;
    message: string;
}

export function PathV33MonthFinalize({ month }: PathV33MonthFinalizeProps) {
    const [feed, setFeed] = useState<PathV33TeamFeed | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [banner, setBanner] = useState<Banner | null>(null);
    const [actionBusy, setActionBusy] = useState<"lock" | "expire" | "finalize" | null>(null);
    const [reloadCount, setReloadCount] = useState(0);

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
    }, [month, reloadCount]);

    function reload() {
        setReloadCount((current) => current + 1);
    }

    async function handleLock() {
        if (!window.confirm(`${month} の全申告をロックします。本人もこれ以降 tier を変更できません。よろしいですか?`)) {
            return;
        }
        setActionBusy("lock");
        setBanner(null);
        try {
            const result: PathV33LockResult = await lockPathV33MonthDrafts(month);
            setBanner({
                kind: "success",
                message: `${result.locked_draft_count} 件の申告をロック。${result.recounted_drafts} 件で出勤日数を再スナップショット。`,
            });
            reload();
        } catch (err) {
            setBanner({ kind: "error", message: getErrorMessage(err) });
        } finally {
            setActionBusy(null);
        }
    }

    async function handleExpire() {
        if (!window.confirm(`${month} の未決着の異議を強制的に「期限切れ」にします。よろしいですか?`)) {
            return;
        }
        setActionBusy("expire");
        setBanner(null);
        try {
            const result: PathV33ExpireResult = await expirePathV33MonthObjections(month);
            setBanner({
                kind: "success",
                message: `${result.expired_objection_count} 件の異議を期限切れに移行しました。`,
            });
            reload();
            window.dispatchEvent(new Event("pending-proposals-updated"));
        } catch (err) {
            setBanner({ kind: "error", message: getErrorMessage(err) });
        } finally {
            setActionBusy(null);
        }
    }

    async function handleFinalize() {
        if (!window.confirm(`${month} のレベルを確定します。各メンバーの月次レベルが path_member_level_history に書き込まれ、V3.2 reward 計算に反映されます。よろしいですか?`)) {
            return;
        }
        setActionBusy("finalize");
        setBanner(null);
        try {
            const result: PathV33FinalizeResult = await finalizePathV33Month(month);
            setBanner({
                kind: "success",
                message: `${result.members.length} 名のレベルを確定しました。報酬計算は V3.2 経路で実行できます。`,
            });
            reload();
        } catch (err) {
            setBanner({ kind: "error", message: getErrorMessage(err) });
        } finally {
            setActionBusy(null);
        }
    }

    const openObjections: PathV33Objection[] = [];
    // (team-feed endpoint doesn't currently return objections — Phase 5
    // surface uses the same fetch but the badge count comes from elsewhere)

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <Calendar size={18} aria-hidden />
                <h2>{month} 確定操作</h2>
            </header>

            {banner && (
                <div
                    className={`${styles.banner} ${
                        banner.kind === "success" ? styles.bannerSuccess : styles.bannerError
                    }`}
                    role={banner.kind === "error" ? "alert" : "status"}
                >
                    {banner.message}
                </div>
            )}

            <section className={styles.actionRow}>
                <button
                    type="button"
                    className={styles.actionButton}
                    onClick={handleLock}
                    disabled={actionBusy !== null}
                >
                    <Lock size={16} aria-hidden />
                    <span>申告ロック (月末 +3 日)</span>
                </button>
                <button
                    type="button"
                    className={styles.actionButton}
                    onClick={handleExpire}
                    disabled={actionBusy !== null}
                >
                    <Hourglass size={16} aria-hidden />
                    <span>異議締切 (月末 +8 日)</span>
                </button>
                <button
                    type="button"
                    className={`${styles.actionButton} ${styles.actionPrimary}`}
                    onClick={handleFinalize}
                    disabled={actionBusy !== null}
                >
                    <CheckCheck size={16} aria-hidden />
                    <span>月確定 → reward_run 連携</span>
                </button>
            </section>

            <p className={styles.disclaimer}>
                通常は月末カレンダーに沿って順に実行: 月末 +3 で <strong>申告ロック</strong>、+7 まで異議受付、+8 で <strong>異議締切</strong> → <strong>月確定</strong>。確定後は path_member_level_history に書き込まれ、V3.2 の reward_run はこの値を参照します。
            </p>

            {loading && <p className={styles.muted}>状況を読み込み中...</p>}
            {error && <p className={styles.error}>取得失敗: {error}</p>}

            {feed && (
                <section className={styles.previewCard}>
                    <h3>確定見込み</h3>
                    {feed.members.length === 0 ? (
                        <p className={styles.muted}>申告のあるメンバーがいません。</p>
                    ) : (
                        <ul className={styles.memberList}>
                            {feed.members.map((member) => (
                                <li key={member.member_id} className={styles.memberRow}>
                                    <span className={styles.memberName}>{member.member_name}</span>
                                    <span className={styles.memberLevel}>
                                        <strong>
                                            {member.current.level}{" "}
                                            {LEVEL_LABELS[member.current.level] ?? ""}
                                        </strong>
                                        <span className={styles.memberMeta}>
                                            score {member.current.score.toFixed(2)} · 出勤{" "}
                                            {member.current.total_work_days} 日 ·{" "}
                                            {member.current.draft_count} 件
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            )}

            {openObjections.length > 0 && (
                <section className={styles.openObjections}>
                    <h3>未決着の異議</h3>
                    <ul>
                        {openObjections.map((obj) => (
                            <li key={obj.id}>
                                {obj.target_member_id} → tier {obj.proposed_tier} (Co-sign{" "}
                                {obj.co_signs.length}/{obj.required_co_signs})
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
