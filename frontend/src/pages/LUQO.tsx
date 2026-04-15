import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Plus, Calculator, RefreshCw, ChevronRight, ShieldCheck } from "lucide-react";
import {
    fetchLUQOScores,
    previewLUQOReward,
    submitLUQORewardProposal,
    type LUQOPeriodScore,
    type LUQORewardPreview,
    type LUQORewardBreakdownItem,
} from "../lib/api";
import { PathTab } from "../components/luqo/PathTab";
import styles from "./LUQO.module.css";

// ============================================================
// Sub-components
// ============================================================

type Tab = "score" | "reward" | "path";

// ------ スコアタブ ------
function ScoreTab() {
    const [period, setPeriod] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const [scores, setScores] = useState<LUQOPeriodScore[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const res = await fetchLUQOScores({ period });
            setScores(res.scores);
        } catch (e) {
            setError(e instanceof Error ? e.message : "読み込みエラー");
        } finally {
            setLoading(false);
        }
    }, [period]);

    useEffect(() => {
        load();
    }, [load]);

    return (
        <div>
            <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>月次LUQOスコア</h3>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                        className={styles.formInput}
                        type="month"
                        value={period}
                        onChange={e => setPeriod(e.target.value)}
                        style={{ width: 140 }}
                    />
                    <button className={`${styles.btn} ${styles.btnOutline}`} onClick={load}>
                        <RefreshCw size={14} />
                    </button>
                </div>
            </div>

            {error && <div className={styles.error}>{error}</div>}
            {loading && <div className={styles.loading}>読み込み中...</div>}

            {!loading && scores.length === 0 && (
                <div className={styles.card}>
                    <p style={{ color: "var(--md-sys-color-on-surface-variant)", fontSize: 14, margin: 0 }}>
                        {period} のスコアデータはまだありません。
                    </p>
                </div>
            )}

            {scores.map(score => (
                <ScoreCard key={score.id} score={score} />
            ))}
        </div>
    );
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
                {score.finalized && (
                    <span className={`${styles.badge} ${styles.badgeTech}`}>確定済み</span>
                )}
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

// ------ 報酬計算タブ ------
function RewardTab() {
    const [period, setPeriod] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    });
    const [profit, setProfit] = useState<number | "">("");
    const [companyRate, setCompanyRate] = useState<number>(0);
    const [members, setMembers] = useState<Array<{
        member_id: string; name: string; days: number;
        tech_stars: number; speed_stars: number;
    }>>([{ member_id: "", name: "", days: 20, tech_stars: 0, speed_stars: 0 }]);
    const [preview, setPreview] = useState<LUQORewardPreview | null>(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);

    const handlePreview = async () => {
        if (!profit || members.some(m => !m.name)) {
            setError("利益と全メンバー情報を入力してください");
            return;
        }
        setLoading(true);
        setError(null);
        setPreview(null);
        try {
            const res = await previewLUQOReward({
                period,
                profit: Number(profit),
                company_rate: companyRate,
                members,
            });
            setPreview(res);
        } catch (e) {
            setError(e instanceof Error ? e.message : "計算エラー");
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async () => {
        if (!preview) return;
        setSubmitting(true);
        setError(null);
        try {
            await submitLUQORewardProposal({
                period: preview.period,
                profit: preview.profit,
                company_rate: preview.company_rate,
                breakdown: preview.members as LUQORewardBreakdownItem[],
            });
            setSuccess(`${period} の報酬計算を申請しました。承認後に確定されます。`);
            setPreview(null);
        } catch (e) {
            setError(e instanceof Error ? e.message : "申請エラー");
        } finally {
            setSubmitting(false);
        }
    };

    const addMember = () => {
        setMembers(prev => [...prev, { member_id: "", name: "", days: 20, tech_stars: 0, speed_stars: 0 }]);
    };

    const updateMember = (idx: number, field: string, value: string | number) => {
        setMembers(prev => prev.map((m, i) => i === idx ? { ...m, [field]: value } : m));
    };

    const removeMember = (idx: number) => {
        setMembers(prev => prev.filter((_, i) => i !== idx));
    };

    return (
        <div>
            <h3 className={styles.sectionTitle} style={{ marginBottom: 16 }}>月次報酬計算</h3>

            {error && <div className={styles.error} style={{ marginBottom: 12 }}>{error}</div>}
            {success && <div className={styles.success} style={{ marginBottom: 12 }}>{success}</div>}

            <div className={styles.form}>
                <div className={styles.formRow}>
                    <div className={styles.formField}>
                        <label className={styles.formLabel}>対象期間</label>
                        <input className={styles.formInput} type="month" value={period} onChange={e => setPeriod(e.target.value)} />
                    </div>
                    <div className={styles.formField}>
                        <label className={styles.formLabel}>会社取り分率 (%)</label>
                        <input
                            className={styles.formInput}
                            type="number"
                            min={0}
                            max={100}
                            value={companyRate}
                            onChange={e => setCompanyRate(Number(e.target.value))}
                        />
                    </div>
                </div>
                <div className={styles.formField}>
                    <label className={styles.formLabel}>現場純利益（円）</label>
                    <input
                        className={styles.formInput}
                        type="number"
                        min={0}
                        placeholder="例: 800000"
                        value={profit}
                        onChange={e => setProfit(e.target.value ? Number(e.target.value) : "")}
                    />
                </div>
            </div>

            <div className={styles.section} style={{ marginTop: 20 }}>
                <div className={styles.sectionHeader}>
                    <h3 className={styles.sectionTitle}>メンバー ({members.length}人)</h3>
                    <button className={`${styles.btn} ${styles.btnOutline}`} onClick={addMember}>
                        <Plus size={14} /> メンバー追加
                    </button>
                </div>

                {members.map((m, idx) => (
                    <div key={idx} className={styles.card} style={{ marginBottom: 8 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                            <div className={styles.formField}>
                                <label className={styles.formLabel}>名前</label>
                                <input className={styles.formInput} placeholder="山田" value={m.name} onChange={e => updateMember(idx, "name", e.target.value)} />
                            </div>
                            <div className={styles.formField}>
                                <label className={styles.formLabel}>稼働日数</label>
                                <input className={styles.formInput} type="number" min={0} value={m.days} onChange={e => updateMember(idx, "days", Number(e.target.value))} />
                            </div>
                            <div className={styles.formField}>
                                <label className={styles.formLabel}>技術スター (pt)</label>
                                <input className={styles.formInput} type="number" min={0} value={m.tech_stars} onChange={e => updateMember(idx, "tech_stars", Number(e.target.value))} />
                            </div>
                            <div className={styles.formField}>
                                <label className={styles.formLabel}>スピードスター (pt)</label>
                                <input className={styles.formInput} type="number" min={0} value={m.speed_stars} onChange={e => updateMember(idx, "speed_stars", Number(e.target.value))} />
                            </div>
                            <div style={{ display: "flex", alignItems: "flex-end" }}>
                                {members.length > 1 && (
                                    <button className={`${styles.btn} ${styles.btnOutline}`} onClick={() => removeMember(idx)} style={{ fontSize: 12 }}>
                                        削除
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button className={`${styles.btn} ${styles.btnPrimary}`} onClick={handlePreview} disabled={loading}>
                    <Calculator size={14} />
                    {loading ? "計算中..." : "プレビュー計算"}
                </button>
            </div>

            {preview && (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ marginTop: 20 }}>
                    <h3 className={styles.sectionTitle} style={{ marginBottom: 12 }}>計算結果プレビュー</h3>
                    <div className={styles.card} style={{ marginBottom: 12, display: "flex", gap: 16, flexWrap: "wrap" }}>
                        <span>分配対象: <strong>¥{preview.distributable.toLocaleString()}</strong></span>
                        <span>技術上限: <strong>{preview.tech_max}pt</strong></span>
                        <span>スピード上限: <strong>{preview.speed_max}pt</strong></span>
                        <span>合計確認: <strong>¥{preview.total_check.toLocaleString()}</strong></span>
                    </div>

                    <div className={styles.card} style={{ overflowX: "auto" }}>
                        <table className={styles.rewardTable}>
                            <thead>
                                <tr>
                                    <th>名前</th>
                                    <th>日数</th>
                                    <th>S(技術)</th>
                                    <th>V(速度)</th>
                                    <th>Combo</th>
                                    <th>比率</th>
                                    <th>支給額</th>
                                </tr>
                            </thead>
                            <tbody>
                                {preview.members.map((m, i) => (
                                    <tr key={i}>
                                        <td>{m.name}</td>
                                        <td>{m.days}</td>
                                        <td>{m.S.toFixed(1)}</td>
                                        <td>{m.V.toFixed(1)}</td>
                                        <td><strong>{m.combo.toFixed(1)}</strong></td>
                                        <td>{(m.ratio * 100).toFixed(1)}%</td>
                                        <td className={styles.amountCell}>¥{m.amount.toLocaleString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ marginTop: 16 }}>
                        <button
                            className={`${styles.btn} ${styles.btnPrimary}`}
                            onClick={handleSubmit}
                            disabled={submitting}
                        >
                            <ChevronRight size={14} />
                            {submitting ? "申請中..." : "この結果で承認申請する"}
                        </button>
                        <p style={{ fontSize: 12, color: "var(--md-sys-color-on-surface-variant)", marginTop: 8 }}>
                            承認後にデータが確定します（Proposal経由）
                        </p>
                    </div>
                </motion.div>
            )}
        </div>
    );
}

// ============================================================
// Main Page
// ============================================================

export default function LUQOPage() {
    const [activeTab, setActiveTab] = useState<Tab>("reward");

    const tabs: Array<{ id: Tab; label: string; icon: React.ReactNode }> = [
        { id: "reward", label: "報酬確認", icon: <Calculator size={14} /> },
        { id: "path", label: "今月の評価", icon: <ShieldCheck size={14} /> },
        { id: "score", label: "参考スコア", icon: <RefreshCw size={14} /> },
    ];

    return (
        <div className={styles.container}>
            <motion.div
                className={styles.hero}
                initial={{ opacity: 0, y: -12 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <h1 className={styles.heroTitle}>報酬と今月の評価</h1>
                <p className={styles.heroSubtitle}>
                    まずは今月の報酬と評価状況を確認する。LUQO の旧資産は比較用に残しつつ、日常の主導線は報酬確認と PATH に寄せる。
                </p>
            </motion.div>

            <div className={styles.tabs}>
                {tabs.map(tab => (
                    <button
                        key={tab.id}
                        className={`${styles.tab} ${activeTab === tab.id ? styles.tabActive : ""}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {activeTab === "reward" && <RewardTab />}
            {activeTab === "path" && <PathTab />}
            {activeTab === "score" && <ScoreTab />}
        </div>
    );
}
