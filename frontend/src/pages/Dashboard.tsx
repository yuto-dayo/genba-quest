import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Users, TrendingUp, Zap, RefreshCw } from "lucide-react";
import { PartyMemberCard } from "../components/PartyMemberCard";
import { fetchPartyStatus, type PartyStatus } from "../lib/api";
import styles from "./Dashboard.module.css";

export function Dashboard() {
    const [partyStatus, setPartyStatus] = useState<PartyStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchPartyStatus();
            setPartyStatus(data);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    if (loading) {
        return (
            <div className={styles.loading}>
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                    <RefreshCw size={32} />
                </motion.div>
                <p>パーティ情報を読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.error}>
                <p>エラー: {error}</p>
                <button onClick={loadData} className={styles.retryButton}>
                    再試行
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* ギルドサマリー */}
            <motion.section
                className={styles.summary}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <h1 className={styles.title}>🏗️ PATH. Guild</h1>

                <div className={styles.statsGrid}>
                    <div className={styles.statCard}>
                        <Users className={styles.statIcon} />
                        <div className={styles.statContent}>
                            <span className={styles.statValue}>
                                {partyStatus?.guildSummary.totalMembers || 0}
                            </span>
                            <span className={styles.statLabel}>冒険者</span>
                        </div>
                    </div>

                    <div className={styles.statCard}>
                        <TrendingUp className={styles.statIcon} />
                        <div className={styles.statContent}>
                            <span className={styles.statValue}>
                                ¥{(partyStatus?.guildSummary.totalSales || 0).toLocaleString()}
                            </span>
                            <span className={styles.statLabel}>総売上</span>
                        </div>
                    </div>

                    <div className={styles.statCard}>
                        <Zap className={styles.statIcon} />
                        <div className={styles.statContent}>
                            <span className={styles.statValue}>
                                {partyStatus?.guildSummary.avgStamina || 0}%
                            </span>
                            <span className={styles.statLabel}>平均スタミナ</span>
                        </div>
                    </div>
                </div>
            </motion.section>

            {/* パーティメンバー */}
            <section className={styles.members}>
                <h2 className={styles.sectionTitle}>パーティメンバー</h2>
                <div className={styles.membersGrid}>
                    {partyStatus?.members.map((member, index) => (
                        <PartyMemberCard key={member.id} member={member} index={index} />
                    ))}
                </div>
            </section>
        </div>
    );
}
