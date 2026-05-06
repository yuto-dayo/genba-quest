import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    ArrowLeft,
    BadgeCheck,
    Building2,
    ChevronRight,
    FileText,
    Loader2,
    Plus,
    ReceiptText,
    Search,
    Sparkles,
    Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
    fetchClients,
    fetchInvoiceSettings,
    fetchMembers,
    fetchPathAiReviews,
    fetchPathCertifications,
    fetchPathFinalizations,
    fetchPathForms,
    fetchPathProfiles,
    PATH_BIG_SKILL_KEYS,
    restoreClient,
    type Client,
    type InvoiceSettings,
    type Member,
    type PathBigSkillKey,
    type PathBigSkillState,
    type PathMonthlyEvaluationAiReview,
    type PathMonthlyEvaluationFinalization,
    type PathMonthlyEvaluationForm,
    type PathSkillCertification,
    type PathSkillProfile,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { supabase } from "../lib/supabase";
import { InvoiceSettingsModal } from "../components/InvoiceSettingsModal";
import { ClientSettingsModal } from "../components/ClientSettingsModal";
import styles from "./Settings.module.css";

const statusMeta = {
    unregistered: {
        label: "未登録",
        helper: "通常請求",
    },
    applied: {
        label: "申請中",
        helper: "登録待ち",
    },
    registered: {
        label: "登録済み",
        helper: "発行可",
    },
} as const;

const bigSkillLabels: Record<PathBigSkillKey, string> = {
    cross_work: "クロス施工力",
    putty_foundation: "パテ・下地処理力",
    planning_preparation: "段取り・準備力",
    quality_stability: "品質安定力",
    site_trust: "現場信頼形成力",
    education_support: "教育・支援力",
};

const bigSkillStateLabels: Record<PathBigSkillState, string> = {
    unverified: "未確認",
    assist_required: "補助あり",
    conditional: "条件付き",
    near_independent: "ほぼ自走",
    stable_independent: "安定自走",
};

const certificationStatusLabels = {
    candidate: "候補",
    verified: "認定済み",
    review_required: "要レビュー",
    revoked: "取消",
} as const;

const skillFilterOptions = [
    { value: "all", label: "すべて" },
    { value: "verified", label: "認定済み" },
    { value: "review_required", label: "要レビュー" },
    { value: "candidate", label: "候補" },
] as const;

function currentMonthValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(value: string) {
    const [year, month] = value.split("-");
    if (!year || !month) {
        return value;
    }
    return `${year}/${month}`;
}

function formatDateLabel(value: string | null | undefined) {
    if (!value) {
        return "未記録";
    }
    return new Date(value).toLocaleDateString("ja-JP", {
        month: "numeric",
        day: "numeric",
    });
}

function toTimestamp(value: string | null | undefined) {
    if (!value) {
        return 0;
    }

    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
}

function truncateText(value: string | null | undefined, length: number) {
    const text = value?.trim() || "";
    if (text.length <= length) {
        return text;
    }
    return `${text.slice(0, length)}…`;
}

function buildMonthlyStatus(params: {
    form: PathMonthlyEvaluationForm | null;
    review: PathMonthlyEvaluationAiReview | null;
    finalization: PathMonthlyEvaluationFinalization | null;
}) {
    if (params.finalization) {
        return {
            label: "確定済み",
            helper: `${formatMonthLabel(params.finalization.month)} の評価は確定済みです`,
            tone: "complete" as const,
        };
    }

    if (params.review) {
        return {
            label: "確認待ち",
            helper: "AI下書きまで進んでいます。PATH で確認して確定します",
            tone: "progress" as const,
        };
    }

    if (params.form) {
        return {
            label: "入力済み",
            helper: "月末フォームは保存済みです。AI下書きの確認へ進めます",
            tone: "progress" as const,
        };
    }

    return {
        label: "未着手",
        helper: "今月の評価はまだ始まっていません",
        tone: "neutral" as const,
    };
}

function buildHistorySummary(
    item: PathMonthlyEvaluationFinalization,
    previous?: PathMonthlyEvaluationFinalization,
) {
    if (item.comment?.includes("再確認")) {
        return "再確認あり";
    }

    if (item.current_level && previous?.current_level && item.current_level !== previous.current_level) {
        return `Level ${previous.current_level} → ${item.current_level}`;
    }

    if (item.current_level) {
        return `Level ${item.current_level}`;
    }

    return item.comment?.trim() ? "コメント更新あり" : "評価を確定";
}

function formatSkillKeyLabel(value: string) {
    return value.replaceAll("_", " ");
}

type SettingPanel = "profile" | "invoice" | "clients";

export function Settings() {
    const [loading, setLoading] = useState(true);
    const [showInvoiceSettingsModal, setShowInvoiceSettingsModal] = useState(false);
    const [showClientModal, setShowClientModal] = useState(false);
    const [invoiceSettings, setInvoiceSettings] = useState<InvoiceSettings | null>(null);
    const [clients, setClients] = useState<Client[]>([]);
    const [deletedClients, setDeletedClients] = useState<Client[]>([]);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [pageError, setPageError] = useState<string | null>(null);
    const [restoringClientId, setRestoringClientId] = useState<string | null>(null);
    const [currentMember, setCurrentMember] = useState<Member | null>(null);
    const [currentProfile, setCurrentProfile] = useState<PathSkillProfile | null>(null);
    const [currentForm, setCurrentForm] = useState<PathMonthlyEvaluationForm | null>(null);
    const [currentReview, setCurrentReview] = useState<PathMonthlyEvaluationAiReview | null>(null);
    const [currentFinalization, setCurrentFinalization] = useState<PathMonthlyEvaluationFinalization | null>(null);
    const [currentCertifications, setCurrentCertifications] = useState<PathSkillCertification[]>([]);
    const [recentFinalizations, setRecentFinalizations] = useState<PathMonthlyEvaluationFinalization[]>([]);
    const [skillQuery, setSkillQuery] = useState("");
    const [skillFilter, setSkillFilter] = useState<(typeof skillFilterOptions)[number]["value"]>("all");
    const [isSkillFinderOpen, setIsSkillFinderOpen] = useState(false);
    const [settingsQuery, setSettingsQuery] = useState("");
    const [selectedSetting, setSelectedSetting] = useState<SettingPanel | null>(null);

    const loadPage = async () => {
        try {
            setLoading(true);
            setPageError(null);
            const {
                data: { session },
            } = await supabase.auth.getSession();
            const currentUserId = session?.user?.id || null;
            const currentMonth = currentMonthValue();

            const [settingsData, clientsData, deletedClientsData, membersData] = await Promise.all([
                fetchInvoiceSettings(),
                fetchClients(),
                fetchClients({ status: "deleted" }),
                fetchMembers(),
            ]);

            setInvoiceSettings(settingsData);
            setClients(clientsData);
            setDeletedClients(deletedClientsData);
            setCurrentMember(currentUserId ? membersData.find((member) => member.id === currentUserId) || null : null);

            if (!currentUserId) {
                setCurrentProfile(null);
                setCurrentForm(null);
                setCurrentReview(null);
                setCurrentFinalization(null);
                setCurrentCertifications([]);
                setRecentFinalizations([]);
                return;
            }

            const [profilesData, formsData, reviewsData, finalizationsData, historyData, certificationsData] =
                await Promise.all([
                    fetchPathProfiles({ member_id: currentUserId, limit: 1 }),
                    fetchPathForms({ month: currentMonth, member_id: currentUserId, limit: 1 }),
                    fetchPathAiReviews({ month: currentMonth, member_id: currentUserId, limit: 1 }),
                    fetchPathFinalizations({ month: currentMonth, member_id: currentUserId, limit: 1 }),
                    fetchPathFinalizations({ member_id: currentUserId, limit: 4 }),
                    fetchPathCertifications({ member_id: currentUserId, limit: 40 }),
                ]);

            setCurrentProfile(profilesData.profiles[0] || null);
            setCurrentForm(formsData.forms[0] || null);
            setCurrentReview(reviewsData.reviews[0] || null);
            setCurrentFinalization(finalizationsData.finalizations[0] || null);
            setRecentFinalizations(historyData.finalizations);
            setCurrentCertifications(certificationsData.certifications);
        } catch (err: unknown) {
            setPageError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void loadPage();
    }, []);

    const refreshClients = async () => {
        const [nextClients, nextDeletedClients] = await Promise.all([
            fetchClients(),
            fetchClients({ status: "deleted" }),
        ]);
        setClients(nextClients);
        setDeletedClients(nextDeletedClients);
    };

    const closeClientModal = () => {
        setShowClientModal(false);
        setEditingClient(null);
    };

    const handleRestoreClient = async (clientId: string) => {
        try {
            setRestoringClientId(clientId);
            setPageError(null);
            await restoreClient(clientId);
            await refreshClients();
        } catch (err: unknown) {
            setPageError(getErrorMessage(err));
        } finally {
            setRestoringClientId(null);
        }
    };

    const currentInvoiceStatus = invoiceSettings
        ? statusMeta[invoiceSettings.invoice_issuer_status]
        : statusMeta.unregistered;
    const displayName = currentMember?.full_name || currentMember?.username || "未設定";
    const currentMonth = currentMonthValue();
    const currentLevel = currentFinalization?.current_level || currentProfile?.current_level;
    const monthlyStatus = buildMonthlyStatus({
        form: currentForm,
        review: currentReview,
        finalization: currentFinalization,
    });
    const sortedCertifications = [...currentCertifications].sort(
        (a, b) => toTimestamp(b.verified_at || b.updated_at) - toTimestamp(a.verified_at || a.updated_at),
    );
    const verifiedCertifications = sortedCertifications.filter((item) => item.status === "verified");
    const certificationsNeedingReview = currentCertifications.filter((item) => item.review_required_flag);
    const filteredCertifications = sortedCertifications
        .filter((item) => (skillFilter === "all" ? true : item.status === skillFilter))
        .filter((item) => {
            if (!skillQuery.trim()) {
                return true;
            }

            const keyword = skillQuery.trim().toLowerCase();
            return [item.skill_key, item.category, item.note]
                .filter(Boolean)
                .some((value) => value.toLowerCase().includes(keyword));
        })
        .slice(0, skillQuery.trim() ? 8 : 6);
    const recentCertificationHighlights = verifiedCertifications.slice(0, 3);
    const recentHistory = [...recentFinalizations]
        .sort((a, b) => toTimestamp(b.finalized_at) - toTimestamp(a.finalized_at))
        .slice(0, 3);
    const shouldShowSkillFinder = isSkillFinderOpen || skillQuery.trim().length > 0 || skillFilter !== "all";
    const settingsSearch = settingsQuery.trim().toLowerCase();
    const allSettingItems = [
        {
            id: "profile" as const,
            group: "個人",
            title: "状態と評価",
            summary: `${currentMember ? displayName : "未設定"} / ${monthlyStatus.label}`,
            icon: <Users size={20} />,
        },
        {
            id: "invoice" as const,
            group: "組織",
            title: "請求書",
            summary: `${currentInvoiceStatus.label} / ${invoiceSettings?.issuer_name || "未設定"}`,
            icon: <FileText size={20} />,
        },
        {
            id: "clients" as const,
            group: "組織",
            title: "取引先",
            summary: `${clients.length}件`,
            icon: <Building2 size={20} />,
        },
    ];
    const settingItems = allSettingItems.filter((item) => {
        if (!settingsSearch) {
            return true;
        }

        return [item.group, item.title, item.summary].some((value) => value.toLowerCase().includes(settingsSearch));
    });

    const selectedSettingMeta = allSettingItems.find((item) => item.id === selectedSetting);

    if (loading) {
        return (
            <div className={styles.loadingState}>
                <Loader2 size={24} className={styles.spinner} />
                <p>設定を読み込み中...</p>
            </div>
        );
    }

    if (pageError) {
        return (
            <div className={styles.errorState}>
                <h2>設定の読み込みに失敗しました</h2>
                <p>{pageError}</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <AnimatePresence mode="wait">
                {!selectedSetting ? (
                    <motion.div
                        key="settings-list"
                        className={styles.settingsView}
                        initial={{ opacity: 0, x: -12 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -12 }}
                        transition={{ duration: 0.18 }}
                    >
                        <section className={styles.searchHero}>
                            <h1 className={styles.visuallyHidden}>設定</h1>
                            <label className={styles.settingsSearch}>
                                <Search size={18} />
                                <input
                                    type="search"
                                    value={settingsQuery}
                                    onChange={(event) => setSettingsQuery(event.target.value)}
                                    placeholder="設定を検索"
                                />
                            </label>
                        </section>

                        {settingItems.length === 0 ? (
                            <div className={styles.emptyList}>該当なし</div>
                        ) : (
                            <section className={styles.sectionGrid}>
                                {settingItems.map((item) => (
                                    <motion.article
                                        key={item.id}
                                        className={styles.settingCard}
                                        initial={{ opacity: 0, y: 12 }}
                                        animate={{ opacity: 1, y: 0 }}
                                    >
                                        <button
                                            type="button"
                                            className={styles.settingRow}
                                            onClick={() => setSelectedSetting(item.id)}
                                        >
                                            <span className={styles.settingIcon}>{item.icon}</span>
                                            <span className={styles.settingCopy}>
                                                <span className={styles.cardEyebrow}>{item.group}</span>
                                                <strong>{item.title}</strong>
                                                <span>{item.summary}</span>
                                            </span>
                                            <ChevronRight size={18} className={styles.settingChevron} />
                                        </button>
                                    </motion.article>
                                ))}
                            </section>
                        )}
                    </motion.div>
                ) : (
                    <motion.section
                        key={`settings-detail-${selectedSetting}`}
                        className={styles.detailPage}
                        initial={{ opacity: 0, x: 18 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 18 }}
                        transition={{ duration: 0.18 }}
                    >
                        <header className={styles.detailTopBar}>
                            <button
                                type="button"
                                className={styles.backButton}
                                onClick={() => setSelectedSetting(null)}
                                aria-label="設定一覧へ戻る"
                            >
                                <ArrowLeft size={20} />
                                戻る
                            </button>
                            <h1 className={styles.detailTitle}>{selectedSettingMeta?.title}</h1>
                        </header>

                        {selectedSetting === "profile" && (
                            <>
                                <div className={styles.detailActions}>
                                    <Link to="/path?tab=reward" className={styles.secondaryButton}>
                                        評価
                                        <ChevronRight size={16} />
                                    </Link>
                                </div>

                                <div className={styles.profileHero}>
                                    <div className={styles.identityBlock}>
                                        <span className={styles.identityEyebrow}>本人</span>
                                        <strong className={styles.identityName}>
                                            {currentMember ? displayName : "未設定"}
                                        </strong>
                                        <div className={styles.identityMeta}>
                                            <span className={styles.levelChip}>
                                                {currentLevel ? `Level ${currentLevel}` : "Level -"}
                                            </span>
                                            <span
                                                className={`${styles.progressChip} ${
                                                    monthlyStatus.tone === "complete"
                                                        ? styles.progressComplete
                                                        : monthlyStatus.tone === "progress"
                                                          ? styles.progressActive
                                                          : styles.progressNeutral
                                                }`}
                                            >
                                                評価: {monthlyStatus.label}
                                            </span>
                                        </div>
                                    </div>

                                    <div className={styles.progressPanel}>
                                        <span className={styles.infoLabel}>今月</span>
                                        <strong>{monthlyStatus.label}</strong>
                                        <div className={styles.progressMeta}>
                                            <span>月: {formatMonthLabel(currentMonth)}</span>
                                            <span>
                                                前回:{" "}
                                                {recentFinalizations[0]
                                                    ? `${formatMonthLabel(recentFinalizations[0].month)} / ${formatDateLabel(recentFinalizations[0].finalized_at)}`
                                                    : "なし"}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.profileGrid}>
                                    <div className={styles.infoCard}>
                                        <div className={styles.infoCardHeader}>
                                            <div>
                                                <h3 className={styles.infoCardTitle}>主評価</h3>
                                            </div>
                                            <Sparkles size={18} className={styles.infoCardIcon} />
                                        </div>

                                        <div className={styles.skillList}>
                                            {PATH_BIG_SKILL_KEYS.map((key) => {
                                                const profileValue =
                                                    currentProfile?.[`${key}_status` as keyof PathSkillProfile];
                                                const status =
                                                    typeof profileValue === "string"
                                                        ? (profileValue as PathBigSkillState)
                                                        : currentFinalization?.confirmed_big_skill_states?.[key] ||
                                                          "unverified";

                                                return (
                                                    <div key={key} className={styles.skillRow}>
                                                        <span>{bigSkillLabels[key]}</span>
                                                        <strong>{bigSkillStateLabels[status]}</strong>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    <div className={styles.infoCard}>
                                        <div className={styles.infoCardHeader}>
                                            <div>
                                                <h3 className={styles.infoCardTitle}>認定技能</h3>
                                            </div>
                                            <BadgeCheck size={18} className={styles.infoCardIcon} />
                                        </div>

                                        <div className={styles.summaryRow}>
                                            <div className={styles.summaryBlock}>
                                                <span>認定済み</span>
                                                <strong>{verifiedCertifications.length}件</strong>
                                            </div>
                                            <div className={styles.summaryBlock}>
                                                <span>要レビュー</span>
                                                <strong>{certificationsNeedingReview.length}件</strong>
                                            </div>
                                        </div>

                                        <div className={styles.certificationPreview}>
                                            {recentCertificationHighlights.map((item) => (
                                                <span key={item.id} className={styles.previewChip}>
                                                    {formatSkillKeyLabel(item.skill_key)}
                                                </span>
                                            ))}
                                            {verifiedCertifications.length === 0 && (
                                                <span className={styles.previewEmpty}>なし</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.finderHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>技能</h3>
                                        </div>
                                        <button
                                            type="button"
                                            className={styles.secondaryButton}
                                            onClick={() => setIsSkillFinderOpen((value) => !value)}
                                        >
                                            {shouldShowSkillFinder ? "閉じる" : "探す"}
                                        </button>
                                    </div>

                                    {shouldShowSkillFinder && (
                                        <>
                                            <div className={styles.filterRow}>
                                                {skillFilterOptions.map((option) => (
                                                    <button
                                                        key={option.value}
                                                        type="button"
                                                        className={`${styles.filterChip} ${
                                                            skillFilter === option.value ? styles.filterChipActive : ""
                                                        }`}
                                                        onClick={() => setSkillFilter(option.value)}
                                                    >
                                                        {option.label}
                                                    </button>
                                                ))}
                                            </div>

                                            <label className={styles.searchField}>
                                                <Search size={16} />
                                                <input
                                                    type="text"
                                                    value={skillQuery}
                                                    onChange={(event) => setSkillQuery(event.target.value)}
                                                    placeholder="技能名やカテゴリで探す"
                                                />
                                            </label>

                                            <p className={styles.finderHint}>
                                                {skillFilter === "all"
                                                    ? "表示: すべて"
                                                    : `${skillFilterOptions.find((option) => option.value === skillFilter)?.label || "技能"} を表示中`}
                                            </p>

                                            <div className={styles.certificationList}>
                                                {filteredCertifications.length === 0 ? (
                                                    <div className={styles.emptyList}>該当なし</div>
                                                ) : (
                                                    filteredCertifications.map((item) => (
                                                        <div key={item.id} className={styles.certificationItem}>
                                                            <div>
                                                                <strong>{formatSkillKeyLabel(item.skill_key)}</strong>
                                                                <span>
                                                                    {item.category} / 根拠 {item.evidence_count} 件
                                                                </span>
                                                            </div>
                                                            <span className={styles.certificationStatus}>
                                                                {certificationStatusLabels[item.status]}
                                                            </span>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>

                                <div className={styles.infoCard}>
                                    <div className={styles.infoCardHeader}>
                                        <div>
                                            <h3 className={styles.infoCardTitle}>評価履歴</h3>
                                        </div>
                                    </div>

                                    <div className={styles.historyList}>
                                        {recentHistory.length === 0 ? (
                                            <div className={styles.emptyList}>履歴なし</div>
                                        ) : (
                                            recentHistory.map((item, index) => (
                                                <div key={item.id} className={styles.historyItem}>
                                                    <div>
                                                        <strong>{formatMonthLabel(item.month)}</strong>
                                                        <span>確定 {formatDateLabel(item.finalized_at)}</span>
                                                    </div>
                                                    <div className={styles.historyMeta}>
                                                        <strong>{buildHistorySummary(item, recentHistory[index + 1])}</strong>
                                                        <span>
                                                            {truncateText(item.comment, 40) ||
                                                                `確定 ${formatDateLabel(item.finalized_at)}`}
                                                        </span>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </>
                        )}

                        {selectedSetting === "invoice" && (
                            <>
                                <div className={styles.detailHeader}>
                                    <div className={styles.invoiceStatus}>
                                        <span className={styles.statusChip}>{currentInvoiceStatus.label}</span>
                                        <p>{currentInvoiceStatus.helper}</p>
                                    </div>
                                    <button className={styles.primaryButton} onClick={() => setShowInvoiceSettingsModal(true)}>
                                        <FileText size={16} />
                                        編集
                                    </button>
                                </div>

                                <div className={styles.invoicePreview}>
                                    <div className={styles.previewRow}>
                                        <Building2 size={16} />
                                        <span>{invoiceSettings?.issuer_name || "発行者名未設定"}</span>
                                    </div>
                                    <div className={styles.previewRow}>
                                        <ReceiptText size={16} />
                                        <span>
                                            {invoiceSettings?.qualified_invoice_registration_number || "登録番号未設定"}
                                        </span>
                                    </div>
                                    <div className={styles.previewMeta}>
                                        <span>{invoiceSettings?.issuer_address || "住所未設定"}</span>
                                        <span>{invoiceSettings?.bank_account_text || "振込先未設定"}</span>
                                    </div>
                                </div>
                            </>
                        )}

                        {selectedSetting === "clients" && (
                            <>
                                <div className={styles.detailHeader}>
                                    <div className={styles.clientListSummary}>
                                        <Users size={16} />
                                        <span>{clients.length}件</span>
                                    </div>
                                    <button
                                        className={styles.secondaryButton}
                                        onClick={() => {
                                            setEditingClient(null);
                                            setShowClientModal(true);
                                        }}
                                    >
                                        <Plus size={16} />
                                        追加
                                    </button>
                                </div>
                                <div className={styles.clientList}>
                                    {clients.length === 0 ? (
                                        <div className={styles.emptyList}>取引先なし</div>
                                    ) : (
                                        <div className={styles.clientGrid}>
                                            {clients.map((client) => (
                                                <button
                                                    key={client.id}
                                                    className={styles.clientListItem}
                                                    onClick={() => {
                                                        setEditingClient(client);
                                                        setShowClientModal(true);
                                                    }}
                                                >
                                                    <strong>{client.name}</strong>
                                                    <span>{client.billing_name || "請求書の宛名未設定"}</span>
                                                    <span>{client.billing_address || client.address || "住所未設定"}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {deletedClients.length > 0 && (
                                        <div className={styles.deletedSection}>
                                            <div className={styles.deletedHeader}>
                                                <span className={styles.deletedTitle}>削除済み</span>
                                                <span>{deletedClients.length}件</span>
                                            </div>

                                            <div className={styles.deletedList}>
                                                {deletedClients.map((client) => (
                                                    <div key={client.id} className={styles.deletedItem}>
                                                        <div className={styles.deletedCopy}>
                                                            <strong>{client.name}</strong>
                                                            <span>{client.deletion_reason || "削除理由なし"}</span>
                                                        </div>
                                                        <button
                                                            className={styles.restoreButton}
                                                            onClick={() => void handleRestoreClient(client.id)}
                                                            disabled={restoringClientId === client.id}
                                                        >
                                                            {restoringClientId === client.id ? "復元中..." : "復元"}
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </motion.section>
                )}
            </AnimatePresence>

            <AnimatePresence>
                {showInvoiceSettingsModal && (
                    <InvoiceSettingsModal
                        onClose={() => setShowInvoiceSettingsModal(false)}
                        onSaved={(settings) => {
                            setInvoiceSettings(settings);
                            setShowInvoiceSettingsModal(false);
                        }}
                    />
                )}

                {showClientModal && (
                    <ClientSettingsModal
                        client={editingClient}
                        onClose={closeClientModal}
                        onSaved={async () => {
                            await refreshClients();
                            closeClientModal();
                        }}
                        onDeleted={async () => {
                            await refreshClients();
                            closeClientModal();
                        }}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
