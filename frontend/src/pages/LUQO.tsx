import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import {
    fetchLUQORewardCalculations,
    fetchLUQOScores,
    type LUQOPeriodScore,
    type LUQORewardCalculation,
} from "../lib/api";
import { RewardConfirmationExperience } from "../components/luqo/rewardConfirmation/RewardConfirmationExperience";
import styles from "./LUQO.module.css";

function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatCurrency(value: number) {
    return `¥${value.toLocaleString("ja-JP")}`;
}

function ScoreCard({ score }: { score: LUQOPeriodScore }) {
    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
                <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--md-sys-color-on-surface)" }}>
                        期間: {score.period}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--md-sys-color-on-surface-variant)" }}>
                        メンバーID: {score.member_id.slice(0, 8)}...
                    </div>
                </div>
                {score.finalized && <span className={`${styles.badge} ${styles.badgeTech}`}>確定済み</span>}
            </div>

            <div className={styles.scoreGrid}>
                <div className={styles.scoreItem}>
                    <div className={styles.scoreLabel}>LU（学習）</div>
                    <div className={styles.scoreValue}>{score.lu_score ?? "-"}</div>
                    <div className={styles.scoreUnit}>/ 100</div>
                </div>
                <div className={styles.scoreItem}>
                    <div className={styles.scoreLabel}>Q（貢献）</div>
                    <div className={styles.scoreValue}>{score.q_score ?? "-"}</div>
                    <div className={styles.scoreUnit}>/ 100</div>
                </div>
                <div className={styles.scoreItem}>
                    <div className={styles.scoreLabel}>O（革新）</div>
                    <div className={styles.scoreValue}>{score.o_score ?? "-"}</div>
                    <div className={styles.scoreUnit}>/ 100</div>
                </div>
            </div>

            <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13 }}>
                    LUQO合成: <strong>{score.luqo_score ?? "-"}</strong>
                </span>
                <span style={{ fontSize: 13 }}>
                    技術スター: <strong>{score.tech_stars}pt</strong>
                </span>
                <span style={{ fontSize: 13 }}>
                    スピードスター: <strong>{score.speed_stars}pt</strong>
                </span>
                {score.combo !== null && (
                    <span style={{ fontSize: 13 }}>
                        Combo: <strong style={{ color: "var(--md-sys-color-primary)" }}>{score.combo}</strong>
                    </span>
                )}
            </div>
        </motion.div>
    );
}

export function LegacyReadOnlyTab() {
    const [period, setPeriod] = useState(currentMonthValue);
    const [scores, setScores] = useState<LUQOPeriodScore[]>([]);
    const [calculations, setCalculations] = useState<LUQORewardCalculation[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const [scoresResponse, calculationsResponse] = await Promise.all([
                fetchLUQOScores({ period }),
                fetchLUQORewardCalculations({ period }),
            ]);
            setScores(scoresResponse.scores);
            setCalculations(calculationsResponse.calculations);
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : "legacy LUQO の読み込みに失敗しました");
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div>
            <div className={styles.card} style={{ marginBottom: 16 }}>
                <h3 className={styles.sectionTitle} style={{ marginBottom: 8 }}>
                    旧 LUQO 互換レイヤー
                </h3>
                <p style={{ margin: 0, color: "var(--md-sys-color-on-surface-variant)", fontSize: 14 }}>
                    旧 LUQO は比較と履歴参照だけを残しています。`luqo.reward.calculate` の write path はこの画面の主導線から外し、PATH v2 の月次評価と報酬確認を優先します。
                </p>
            </div>

            <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>legacy 参照データ</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                        className={styles.formInput}
                        type="month"
                        value={period}
                        onChange={(event) => setPeriod(event.target.value)}
                        style={{ width: 140 }}
                    />
                    <button className={`${styles.btn} ${styles.btnOutline}`} onClick={() => void load()}>
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}
            {loading && <div className={styles.loading}>読み込み中...</div>}

            {!loading && calculations.length === 0 && scores.length === 0 && (
                <div className={styles.card}>
                    <p style={{ margin: 0, color: "var(--md-sys-color-on-surface-variant)", fontSize: 14 }}>
                        {period} の legacy LUQO データはまだありません。
                    </p>
                </div>
            )}

            {calculations.length > 0 && (
                <section className={styles.section}>
                    <h3 className={styles.sectionTitle} style={{ marginBottom: 12 }}>
                        legacy 報酬履歴
                    </h3>
                    {calculations.map((calculation) => (
                        <div key={calculation.id} className={styles.card} style={{ marginBottom: 12 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                                <div>
                                    <strong>{calculation.period} legacy reward</strong>
                                    <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--md-sys-color-on-surface-variant)" }}>
                                        created {new Date(calculation.created_at).toLocaleString("ja-JP")}
                                    </p>
                                </div>
                                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 13 }}>
                                    <span>利益 {formatCurrency(calculation.profit)}</span>
                                    <span>分配対象 {formatCurrency(calculation.distributable)}</span>
                                    <span>{calculation.finalized ? "確定済み" : "未確定"}</span>
                                </div>
                            </div>
                            <div className={styles.card} style={{ marginTop: 12, overflowX: "auto" }}>
                                <table className={styles.rewardTable}>
                                    <thead>
                                        <tr>
                                            <th>メンバー</th>
                                            <th>日数</th>
                                            <th>技術</th>
                                            <th>速度</th>
                                            <th>Combo</th>
                                            <th>支給額</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {calculation.breakdown.map((item) => (
                                            <tr key={`${calculation.id}-${item.member_id || item.name}`}>
                                                <td>{item.name}</td>
                                                <td>{item.days}</td>
                                                <td>{item.tech_stars}</td>
                                                <td>{item.speed_stars}</td>
                                                <td>{item.combo}</td>
                                                <td className={styles.amountCell}>{formatCurrency(item.amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {scores.length > 0 && (
                <section className={styles.section}>
                    <h3 className={styles.sectionTitle} style={{ marginBottom: 12 }}>
                        月次 LUQO スコア
                    </h3>
                    {scores.map((score) => (
                        <ScoreCard key={score.id} score={score} />
                    ))}
                </section>
            )}
        </div>
    );
}

export default function LUQOPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const period = searchParams.get("period");
    const siteId = searchParams.get("site");
    const memberId = searchParams.get("member");

    useEffect(() => {
        const next = new URLSearchParams(searchParams);
        next.delete("reward");
        if (next.toString() !== searchParams.toString()) {
            setSearchParams(next, { replace: true });
        }
    }, [searchParams, setSearchParams]);

    return (
        <div className={styles.container}>
            <RewardConfirmationExperience
                initialPeriod={period}
                focusSiteId={siteId}
                focusMemberId={memberId}
            />
            <div style={{ marginTop: 24 }}>
                <LegacyReadOnlyTab />
            </div>
        </div>
    );
}
