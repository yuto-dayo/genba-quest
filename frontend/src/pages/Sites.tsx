import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Map, RefreshCw, Plus, Clock, Banknote, Ruler, CheckCircle2, AlertCircle } from "lucide-react";
import { fetchSites, completeSite, type Site } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./Sites.module.css";

type FilterStatus = "all" | "in_progress" | "completed";

export function Sites() {
    const [sites, setSites] = useState<Site[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterStatus>("all");

    const loadData = async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchSites();
            setSites(data);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    const handleComplete = async (siteId: string) => {
        try {
            await completeSite(siteId);
            await loadData();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        }
    };

    const filteredSites = sites.filter((site) => {
        if (filter === "all") return true;
        if (filter === "in_progress") return site.status === "in_progress";
        if (filter === "completed") return site.status === "completed";
        return true;
    });

    const stats = {
        total: sites.length,
        inProgress: sites.filter((s) => s.status === "in_progress").length,
        completed: sites.filter((s) => s.status === "completed").length,
        totalRevenue: sites.reduce((sum, s) => sum + (s.revenue || 0), 0),
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                >
                    <RefreshCw size={32} />
                </motion.div>
                <p>現場情報を読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.error}>
                <AlertCircle size={48} />
                <h3 className={styles.errorTitle}>読み込みに失敗しました</h3>
                <p className={styles.errorDescription}>
                    ネットワーク接続を確認して、再試行してください
                </p>
                <button onClick={loadData} className={styles.retryButton}>
                    再試行
                </button>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            {/* ヘッダー */}
            <motion.section
                className={styles.header}
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div className={styles.titleRow}>
                    <h1 className={styles.title}>
                        <Map className={styles.titleIcon} />
                        現場管理
                    </h1>
                    <button className={styles.addButton}>
                        <Plus size={18} />
                        新規現場
                    </button>
                </div>

                {/* 統計 */}
                <div className={styles.statsRow}>
                    <div className={styles.stat}>
                        <span className={styles.statValue}>{stats.total}</span>
                        <span className={styles.statLabel}>総現場数</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={`${styles.statValue} ${styles.inProgress}`}>
                            {stats.inProgress}
                        </span>
                        <span className={styles.statLabel}>進行中</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={`${styles.statValue} ${styles.completed}`}>
                            {stats.completed}
                        </span>
                        <span className={styles.statLabel}>完了</span>
                    </div>
                    <div className={styles.stat}>
                        <span className={`${styles.statValue} ${styles.revenue}`}>
                            ¥{stats.totalRevenue.toLocaleString()}
                        </span>
                        <span className={styles.statLabel}>総売上</span>
                    </div>
                </div>
            </motion.section>

            {/* フィルター */}
            <div className={styles.filters}>
                {(["all", "in_progress", "completed"] as FilterStatus[]).map((status) => (
                    <button
                        key={status}
                        className={`${styles.filterButton} ${filter === status ? styles.active : ""}`}
                        onClick={() => setFilter(status)}
                    >
                        {status === "all" && "すべて"}
                        {status === "in_progress" && "進行中"}
                        {status === "completed" && "完了"}
                    </button>
                ))}
            </div>

            {/* 現場リスト */}
            <section className={styles.sitesSection}>
                <AnimatePresence mode="popLayout">
                    {filteredSites.length === 0 ? (
                        <motion.div
                            className={styles.empty}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                        >
                            <Map size={48} />
                            <h3>現場がありません</h3>
                            <p>
                                {filter === "all"
                                    ? "新しい現場を追加して、プロジェクト管理を始めましょう"
                                    : filter === "in_progress"
                                    ? "進行中の現場はありません"
                                    : "完了した現場はありません"}
                            </p>
                            {filter === "all" && (
                                <button className={styles.emptyAddButton}>
                                    <Plus size={18} />
                                    最初の現場を追加
                                </button>
                            )}
                        </motion.div>
                    ) : (
                        <div className={styles.sitesGrid}>
                            {filteredSites.map((site, index) => (
                                <SiteCard
                                    key={site.id}
                                    site={site}
                                    index={index}
                                    onComplete={handleComplete}
                                />
                            ))}
                        </div>
                    )}
                </AnimatePresence>
            </section>
        </div>
    );
}

interface SiteCardProps {
    site: Site;
    index: number;
    onComplete: (id: string) => void;
}

function SiteCard({ site, index, onComplete }: SiteCardProps) {
    const isCompleted = site.status === "completed";
    const efficiency = site.estimated_hours && site.actual_hours
        ? Math.round((site.estimated_hours / site.actual_hours) * 100)
        : null;

    return (
        <motion.div
            className={`${styles.card} ${isCompleted ? styles.cardCompleted : ""}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: index * 0.05 }}
            layout
        >
            {/* ステータスバッジ */}
            <div className={`${styles.statusBadge} ${styles[site.status]}`}>
                {site.status === "in_progress" ? "進行中" : "完了"}
            </div>

            {/* ヘッダー */}
            <div className={styles.cardHeader}>
                <h3 className={styles.siteName}>{site.name}</h3>
                {site.client && (
                    <span className={styles.clientName}>{site.client.name}</span>
                )}
            </div>

            {/* 住所 */}
            {site.address && (
                <p className={styles.address}>{site.address}</p>
            )}

            {/* メトリクス */}
            <div className={styles.metrics}>
                {site.area_sqm && (
                    <div className={styles.metric}>
                        <Ruler size={14} />
                        <span>{site.area_sqm.toLocaleString()}㎡</span>
                    </div>
                )}
                {site.estimated_hours && (
                    <div className={styles.metric}>
                        <Clock size={14} />
                        <span>
                            {site.actual_hours || 0} / {site.estimated_hours}h
                        </span>
                    </div>
                )}
                {site.revenue && (
                    <div className={styles.metric}>
                        <Banknote size={14} />
                        <span>¥{site.revenue.toLocaleString()}</span>
                    </div>
                )}
            </div>

            {/* 効率バー */}
            {efficiency !== null && (
                <div className={styles.efficiencySection}>
                    <div className={styles.efficiencyHeader}>
                        <span>作業効率</span>
                        <span className={`${styles.efficiencyValue} ${efficiency >= 100 ? styles.good : styles.warning}`}>
                            {efficiency}%
                        </span>
                    </div>
                    <div className={styles.efficiencyBar}>
                        <motion.div
                            className={`${styles.efficiencyFill} ${efficiency >= 100 ? styles.good : styles.warning}`}
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(efficiency, 150)}%` }}
                            transition={{ duration: 0.5, delay: index * 0.05 + 0.2 }}
                        />
                    </div>
                </div>
            )}

            {/* アクション */}
            {!isCompleted && (
                <button
                    className={styles.completeButton}
                    onClick={() => onComplete(site.id)}
                >
                    <CheckCircle2 size={16} />
                    完了にする
                </button>
            )}

            {/* 完了日 */}
            {isCompleted && site.completed_at && (
                <div className={styles.completedDate}>
                    完了: {new Date(site.completed_at).toLocaleDateString("ja-JP")}
                </div>
            )}
        </motion.div>
    );
}
