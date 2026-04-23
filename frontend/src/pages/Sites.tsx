import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Map, RefreshCw, Plus, Building2, AlertTriangle, AlertCircle, Users, Calendar, CheckCircle2, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchSites, fetchSite, type Site } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { formatSiteDateRange, formatSiteSchedulePattern } from "../lib/siteSchedule";
import { FloatingActionButton } from "../components/FloatingActionButton";
import { SiteDetailModal } from "../components/SiteDetailModal";
import { SiteFormModal } from "../components/SiteFormModal";
import { ClientSettingsModal } from "../components/ClientSettingsModal";
import styles from "./Sites.module.css";

type FilterStatus = "active" | "completed";

export function Sites() {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const [sites, setSites] = useState<Site[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [filter, setFilter] = useState<FilterStatus>("active");
    const [selectedSite, setSelectedSite] = useState<Site | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [showClientModal, setShowClientModal] = useState(false);
    const requestedSiteId = searchParams.get("site");

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

    useEffect(() => {
        if (!requestedSiteId) {
            return;
        }

        let cancelled = false;

        void fetchSite(requestedSiteId)
            .then((site) => {
                if (cancelled) {
                    return;
                }
                setSelectedSite(site);
                setFilter(site.status === "completed" ? "completed" : "active");
            })
            .catch(() => {
                if (cancelled) {
                    return;
                }
                setError("現場が見つかりませんでした");
            });

        return () => {
            cancelled = true;
        };
    }, [requestedSiteId]);

    const clearSiteQuery = () => {
        if (!requestedSiteId) {
            return;
        }

        const next = new URLSearchParams(searchParams);
        next.delete("site");
        setSearchParams(next, { replace: true });
    };

    const closeSiteDetail = () => {
        setSelectedSite(null);

        const returnHref = buildReturnHref(searchParams);
        if (returnHref) {
            navigate(returnHref, { replace: true });
            return;
        }

        clearSiteQuery();
    };

    const openSiteDetail = async (siteId: string) => {
        const next = new URLSearchParams(searchParams);
        next.set("site", siteId);
        setSearchParams(next, { replace: true });

        try {
            const full = await fetchSite(siteId);
            setSelectedSite(full);
            setFilter(full.status === "completed" ? "completed" : "active");
        } catch {
            setError("現場の詳細を開けませんでした");
        }
    };

    const handleSiteUpdated = (result?: { site?: Site; message?: string }) => {
        setSelectedSite(null);
        clearSiteQuery();
        if (result?.message) {
            setSuccess(result.message);
        }
        loadData();
    };

    const handleCreateSuccess = useCallback(async (created?: Site) => {
        setShowCreateModal(false);
        await loadData();
        if (created?.id) {
            // Fetch full site with client relation for the detail modal
            try {
                const full = await fetchSite(created.id);
                setSelectedSite(full);
                const next = new URLSearchParams(searchParams);
                next.set("site", created.id);
                setSearchParams(next, { replace: true });
            } catch {
                // If fetch fails, just show the list
            }
        }
    }, [searchParams, setSearchParams]);

    const handleClientSaved = async () => {
        setShowClientModal(false);
    };

    const openSiteCreate = () => {
        setShowCreateModal(true);
    };

    const openClientCreate = () => {
        setShowClientModal(true);
    };

    const filteredSites = sites.filter((site) => {
        if (filter === "active") return site.status === "active";
        return site.status === "completed";
    });

    const activeCount = sites.filter((s) => s.status === "active").length;
    const completedCount = sites.filter((s) => s.status === "completed").length;

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
                <h1 className={styles.title}>
                    <Map className={styles.titleIcon} />
                    現場管理
                </h1>
            </motion.section>

            <AnimatePresence>
                {success && (
                    <motion.div
                        className={styles.successBanner}
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -12 }}
                    >
                        <div className={styles.successContent}>
                            <CheckCircle2 size={18} />
                            <span>{success}</span>
                        </div>
                        <button
                            type="button"
                            className={styles.successDismiss}
                            onClick={() => setSuccess(null)}
                            aria-label="完了メッセージを閉じる"
                        >
                            <X size={16} />
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* フィルター */}
            <div className={styles.filters}>
                <button
                    className={`${styles.filterButton} ${filter === "active" ? styles.active : ""}`}
                    onClick={() => setFilter("active")}
                >
                    進行中
                    {activeCount > 0 && (
                        <span className={styles.filterCount}>{activeCount}</span>
                    )}
                </button>
                <button
                    className={`${styles.filterButton} ${filter === "completed" ? styles.active : ""}`}
                    onClick={() => setFilter("completed")}
                >
                    完了
                    {completedCount > 0 && (
                        <span className={styles.filterCount}>{completedCount}</span>
                    )}
                </button>
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
                            <h3>
                                {filter === "active"
                                    ? "進行中の現場はありません"
                                    : "完了した現場はありません"}
                            </h3>
                            {filter === "active" && (
                                <button
                                    className={styles.emptyAddButton}
                                    onClick={() => setShowCreateModal(true)}
                                >
                                    <Plus size={18} />
                                    最初の現場を追加
                                </button>
                            )}
                        </motion.div>
                    ) : (
                        <div className={styles.sitesList}>
                            {filteredSites.map((site, index) => (
                                <SiteCard
                                    key={site.id}
                                    site={site}
                                    index={index}
                                    onTap={() => void openSiteDetail(site.id)}
                                />
                            ))}
                        </div>
                    )}
                </AnimatePresence>
            </section>

            <FloatingActionButton
                behavior="draggable"
                openLabel="現場登録メニューを開く"
                closeLabel="現場登録メニューを閉じる"
                items={[
                    { id: "site", label: "新規現場", icon: <Map size={18} />, onClick: openSiteCreate },
                    { id: "client", label: "取引先追加", icon: <Building2 size={18} />, onClick: openClientCreate },
                ]}
            />

            {/* 詳細モーダル */}
            <AnimatePresence>
                {selectedSite && (
                    <SiteDetailModal
                        site={selectedSite}
                        onClose={closeSiteDetail}
                        onUpdated={handleSiteUpdated}
                    />
                )}
            </AnimatePresence>

            {/* 作成モーダル */}
            <AnimatePresence>
                {showCreateModal && (
                    <SiteFormModal
                        onClose={() => setShowCreateModal(false)}
                        onSuccess={handleCreateSuccess}
                    />
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showClientModal && (
                    <ClientSettingsModal
                        onClose={() => setShowClientModal(false)}
                        onSaved={handleClientSaved}
                        onDeleted={async () => {
                            setShowClientModal(false);
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}

function buildReturnHref(searchParams: URLSearchParams): string | null {
    if (searchParams.get("return") !== "luqo") {
        return null;
    }

    const next = new URLSearchParams();

    const period = searchParams.get("period");
    if (period) {
        next.set("period", period);
    }

    if (searchParams.get("reward") === "1") {
        next.set("reward", "1");
    }

    const member = searchParams.get("member");
    if (member) {
        next.set("member", member);
    }

    const proposal = searchParams.get("proposal");
    if (proposal) {
        next.set("proposal", proposal);
    }

    const query = next.toString();
    return `/luqo${query ? `?${query}` : ""}`;
}

interface SiteCardProps {
    site: Site;
    index: number;
    onTap: () => void;
}

function SiteCard({ site, index, onTap }: SiteCardProps) {
    const isCompleted = site.status === "completed";
    const hasCautions = !!site.cautions;
    const hasAssigned = site.assigned_users && site.assigned_users.length > 0;
    const hasSchedule = site.started_at || site.expected_completion_at;
    const schedulePattern = formatSiteSchedulePattern(site);
    const hasScheduleMeta = hasSchedule || Boolean(schedulePattern);

    return (
        <motion.div
            className={`${styles.card} ${isCompleted ? styles.cardCompleted : ""}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ delay: index * 0.04 }}
            layout
            onClick={onTap}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter") onTap(); }}
        >
            <div className={styles.cardContent}>
                <div className={styles.cardHeader}>
                    <h3 className={styles.siteName}>
                        {hasCautions && (
                            <AlertTriangle
                                size={16}
                                className={styles.cautionIcon}
                            />
                        )}
                        {site.name}
                    </h3>
                    {site.client && (
                        <span className={styles.clientName}>{site.client.name}</span>
                    )}
                </div>
                {site.description && (
                    <p className={styles.descriptionSnippet}>
                        {site.description}
                    </p>
                )}
                {/* メタ情報行 */}
                {(hasAssigned || hasScheduleMeta) && (
                    <div className={styles.cardMeta}>
                        {hasAssigned && (
                            <span className={styles.metaItem}>
                                <Users size={13} />
                                {site.assigned_users!.length}人
                            </span>
                        )}
                        {hasSchedule && (
                            <span className={styles.metaItem}>
                                <Calendar size={13} />
                                {formatSiteDateRange(site.started_at, site.expected_completion_at)}
                            </span>
                        )}
                        {schedulePattern && (
                            <span className={styles.metaItem}>
                                <Calendar size={13} />
                                {schedulePattern}
                            </span>
                        )}
                    </div>
                )}
            </div>

            {isCompleted && site.completed_at && (
                <span className={styles.completedDate}>
                    {new Date(site.completed_at).toLocaleDateString("ja-JP")}
                </span>
            )}
        </motion.div>
    );
}
