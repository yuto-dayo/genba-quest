import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
    Activity,
    AlertCircle,
    ArrowRight,
    BarChart3,
    Bot,
    CalendarClock,
    ChevronRight,
    ClipboardList,
    Filter,
    Mail,
    MapPinned,
    MessageSquare,
    Plus,
    RefreshCw,
    Search,
    Sparkles,
    UserCircle2,
    Users,
} from "lucide-react";
import {
    approveProposal,
    executeProposal,
    fetchCommunicationContactDetail,
    fetchCommunicationContacts,
    fetchCommunicationInsightsSummary,
    fetchMembers,
    fetchSites,
    instructProposal,
    rejectProposal,
    type CommunicationChannel,
    type CommunicationContactRiskFlag,
    type CommunicationContactStatus,
    type CommunicationContactStatusDetail,
    type CommunicationContactStatusRecord,
    type CommunicationInsightsSummary,
    type Member,
    type ProposalRecord,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { CommunicationRecordSheet, type CommunicationRecordSheetSaveResult } from "../components/CommunicationRecordSheet";
import { FloatingActionButton } from "../components/FloatingActionButton";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import styles from "./Communications.module.css";

const BOARD_STATUS_LABELS: Record<CommunicationContactStatus, string> = {
    overdue: "対応遅れ",
    waiting_internal: "こちら対応待ち",
    waiting_client: "返答待ち",
    resolved: "完了",
    needs_review: "確認中",
};

const CONVERSATION_STATUS_LABELS: Record<CommunicationConversationStatus, string> = {
    active: "対応中",
    waiting_internal: "社内対応待ち",
    waiting_client: "相手待ち",
    resolved: "完了",
};

const RISK_LABELS: Record<CommunicationContactRiskFlag, string> = {
    overdue_next_action: "期限超過",
    no_next_action: "次なし",
    stale_7d: "7日停滞",
    pending_proposal_stale: "提案停滞",
    no_owner: "担当なし",
};

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
    gmail: "Gmail",
    phone: "電話",
    line: "LINE",
    in_person: "対面",
    sms: "SMS",
    manual: "手動",
    system: "更新",
};

const DIRECTION_LABELS: Record<CommunicationDirection, string> = {
    inbound: "受信",
    outbound: "送信",
    internal: "内部",
};

type TabId = "board" | "analyze";

function formatDateTime(value?: string | null): string {
    if (!value) {
        return "未記録";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDateOnly(value?: string | null): string {
    if (!value) {
        return "未設定";
    }

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleDateString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
    });
}

function formatPercent(value: number): string {
    return `${Math.round(value * 100)}%`;
}

function getProposalStatusLabel(value: ProposalRecord["status"]): string {
    const labels: Record<ProposalRecord["status"], string> = {
        draft: "下書き",
        pending: "承認待ち",
        approved: "承認済み",
        rejected: "却下",
        executed: "実行済み",
    };
    return labels[value] || value;
}

function BoardHeader({
    totalCount,
    onRefresh,
    refreshing,
}: {
    totalCount: number;
    onRefresh: () => void;
    refreshing: boolean;
}) {
    return (
        <motion.header
            className={styles.header}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
        >
            <div>
                <p className={styles.eyebrow}>Relationship Operations</p>
                <h1 className={styles.pageTitle}>連絡</h1>
                <p className={styles.pageSubtitle}>
                    今どこで止まっているかを共有して、次に何をやるかを決める。
                    会話ログは根拠として残し、一覧は判断に必要な情報だけを先に出す。
                </p>
            </div>

            <div className={styles.headerActions}>
                <div className={styles.headerStat}>
                    <span>表示中</span>
                    <strong>{totalCount}件</strong>
                </div>
                <button type="button" className={styles.secondaryButton} onClick={onRefresh} disabled={refreshing}>
                    <RefreshCw size={16} />
                    {refreshing ? "更新中..." : "更新"}
                </button>
            </div>
        </motion.header>
    );
}

function CommunicationKpiStrip({ contacts }: { contacts: CommunicationContactStatusRecord[] }) {
    const metrics = useMemo(() => {
        const openContacts = contacts.filter((contact) => contact.status !== "resolved");
        return [
            {
                id: "attention",
                label: "要対応",
                value: openContacts.length,
                tone: "default",
            },
            {
                id: "overdue",
                label: "期限超過",
                value: openContacts.filter((contact) => contact.status === "overdue").length,
                tone: "danger",
            },
            {
                id: "missing-action",
                label: "次なし",
                value: openContacts.filter((contact) => contact.risk_flags.includes("no_next_action")).length,
                tone: "warning",
            },
            {
                id: "proposal-stale",
                label: "提案停滞",
                value: openContacts.filter((contact) => contact.risk_flags.includes("pending_proposal_stale")).length,
                tone: "danger",
            },
            {
                id: "no-owner",
                label: "担当なし",
                value: openContacts.filter((contact) => contact.risk_flags.includes("no_owner")).length,
                tone: "warning",
            },
        ];
    }, [contacts]);

    return (
        <section className={styles.kpiStrip}>
            {metrics.map((metric) => (
                <article
                    key={metric.id}
                    className={`${styles.kpiCard} ${
                        metric.tone === "danger"
                            ? styles.kpiCardDanger
                            : metric.tone === "warning"
                              ? styles.kpiCardWarning
                              : ""
                    }`}
                >
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                </article>
            ))}
        </section>
    );
}

function CommunicationContactFilters({
    query,
    onQueryChange,
    statusFilters,
    toggleStatus,
    riskFilters,
    toggleRisk,
    ownerFilter,
    setOwnerFilter,
    includeResolved,
    setIncludeResolved,
    members,
}: {
    query: string;
    onQueryChange: (value: string) => void;
    statusFilters: CommunicationContactStatus[];
    toggleStatus: (status: CommunicationContactStatus) => void;
    riskFilters: CommunicationContactRiskFlag[];
    toggleRisk: (risk: CommunicationContactRiskFlag) => void;
    ownerFilter: string;
    setOwnerFilter: (value: string) => void;
    includeResolved: boolean;
    setIncludeResolved: (value: boolean) => void;
    members: Member[];
}) {
    return (
        <section className={styles.filterCard}>
            <div className={styles.searchRow}>
                <label className={styles.searchField}>
                    <Search size={16} />
                    <input
                        value={query}
                        onChange={(event) => onQueryChange(event.target.value)}
                        placeholder="会社名・相手・担当で探す"
                    />
                </label>
                <label className={styles.ownerSelect}>
                    <Filter size={16} />
                    <select value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}>
                        <option value="">担当すべて</option>
                        {members.map((member) => (
                            <option key={member.id} value={member.id}>
                                {member.full_name || member.username || member.id}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            <div className={styles.filterGroup}>
                <span>状態</span>
                <div className={styles.chipRow}>
                    {(Object.keys(BOARD_STATUS_LABELS) as CommunicationContactStatus[]).map((status) => (
                        <button
                            key={status}
                            type="button"
                            className={`${styles.filterChip} ${
                                statusFilters.includes(status) ? styles.filterChipActive : ""
                            }`}
                            onClick={() => toggleStatus(status)}
                        >
                            {BOARD_STATUS_LABELS[status]}
                        </button>
                    ))}
                </div>
            </div>

            <div className={styles.filterGroup}>
                <span>リスク</span>
                <div className={styles.chipRow}>
                    {(Object.keys(RISK_LABELS) as CommunicationContactRiskFlag[]).map((risk) => (
                        <button
                            key={risk}
                            type="button"
                            className={`${styles.filterChip} ${
                                riskFilters.includes(risk) ? styles.filterChipActive : ""
                            }`}
                            onClick={() => toggleRisk(risk)}
                        >
                            {RISK_LABELS[risk]}
                        </button>
                    ))}
                </div>
            </div>

            <label className={styles.checkboxRow}>
                <input
                    type="checkbox"
                    checked={includeResolved}
                    onChange={(event) => setIncludeResolved(event.target.checked)}
                />
                完了も見る
            </label>
        </section>
    );
}

function CommunicationContactRow({
    contact,
    selected,
    onSelect,
}: {
    contact: CommunicationContactStatusRecord;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className={`${styles.contactRow} ${selected ? styles.contactRowSelected : ""}`}
            onClick={onSelect}
        >
            <div className={styles.contactRowTop}>
                <div>
                    <p className={styles.contactCompany}>{contact.client_name || "会社名未設定"}</p>
                    <h3 className={styles.contactName}>{contact.contact_name || contact.contact_email || "担当未設定"}</h3>
                </div>
                <span
                    className={`${styles.statusPill} ${
                        contact.status === "overdue"
                            ? styles.statusPillDanger
                            : contact.status === "waiting_internal"
                              ? styles.statusPillWarning
                              : ""
                    }`}
                >
                    {BOARD_STATUS_LABELS[contact.status]}
                </span>
            </div>

            <p className={styles.reasonText}>{contact.status_reason || "理由はまだ整理されていません。"}</p>

            <div className={styles.metaGrid}>
                <span>
                    <UserCircle2 size={14} />
                    {contact.owner?.name || "担当未設定"}
                </span>
                <span>
                    <CalendarClock size={14} />
                    {formatDateTime(contact.latest_activity_at)}
                </span>
                <span>
                    <ArrowRight size={14} />
                    {contact.next_action || "次アクション未設定"}
                </span>
                <span>
                    <MapPinned size={14} />
                    {contact.site?.name || "現場未設定"}
                </span>
            </div>

            <div className={styles.contactRowFooter}>
                <div className={styles.riskRow}>
                    {contact.risk_flags.length === 0 ? (
                        <span className={styles.riskBadgeMuted}>リスクなし</span>
                    ) : (
                        contact.risk_flags.map((risk) => (
                            <span key={risk} className={styles.riskBadge}>
                                {RISK_LABELS[risk]}
                            </span>
                        ))
                    )}
                </div>
                <div className={styles.countMeta}>
                    <span>期限 {formatDateOnly(contact.next_action_due_date)}</span>
                    <span>提案 {contact.in_flight_proposal_count}件</span>
                </div>
            </div>
        </button>
    );
}

function AnalyzeTab({
    insights,
    loading,
    error,
}: {
    insights: CommunicationInsightsSummary | null;
    loading: boolean;
    error: string | null;
}) {
    if (loading) {
        return <p className={styles.panelState}>分析を読み込み中...</p>;
    }

    if (error) {
        return (
            <div className={styles.errorBanner}>
                <AlertCircle size={14} />
                {error}
            </div>
        );
    }

    if (!insights) {
        return <p className={styles.panelState}>分析データがまだありません。</p>;
    }

    return (
        <div className={styles.analyzeLayout}>
            <section className={styles.analysisCard}>
                <div className={styles.analysisTitle}>
                    <Activity size={16} />
                    <h2>運用衛生</h2>
                </div>
                <div className={styles.analysisMetricGrid}>
                    <div>
                        <span>open contacts</span>
                        <strong>{insights.hygiene.open_contacts}</strong>
                    </div>
                    <div>
                        <span>owner あり率</span>
                        <strong>{formatPercent(insights.hygiene.owner_coverage_rate)}</strong>
                    </div>
                    <div>
                        <span>next_action あり率</span>
                        <strong>{formatPercent(insights.hygiene.next_action_coverage_rate)}</strong>
                    </div>
                    <div>
                        <span>overdue 率</span>
                        <strong>{formatPercent(insights.hygiene.overdue_rate)}</strong>
                    </div>
                </div>
            </section>

            <section className={styles.analysisCard}>
                <div className={styles.analysisTitle}>
                    <Sparkles size={16} />
                    <h2>停滞</h2>
                </div>
                <div className={styles.analysisMetricGrid}>
                    <div>
                        <span>7日停滞</span>
                        <strong>{insights.stagnation.stale_7d_count}</strong>
                    </div>
                    <div>
                        <span>提案停滞</span>
                        <strong>{insights.proposal_health.in_flight_stale_count}</strong>
                    </div>
                    <div>
                        <span>follow-up なし</span>
                        <strong>{insights.proposal_health.follow_up_missing_after_link_count}</strong>
                    </div>
                </div>
                <div className={styles.analysisList}>
                    {insights.stagnation.by_status.map((item) => (
                        <div key={item.status} className={styles.analysisRow}>
                            <span>{BOARD_STATUS_LABELS[item.status]}</span>
                            <strong>{item.count}</strong>
                        </div>
                    ))}
                </div>
            </section>

            <section className={styles.analysisCard}>
                <div className={styles.analysisTitle}>
                    <Users size={16} />
                    <h2>担当負荷</h2>
                </div>
                <div className={styles.analysisList}>
                    {insights.owner_workload.map((item) => (
                        <div key={item.owner_id || item.owner_name} className={styles.analysisRow}>
                            <div>
                                <strong>{item.owner_name}</strong>
                                <p>open {item.open_contacts} / overdue {item.overdue_count}</p>
                            </div>
                            <span>未担当 {item.unowned_count}</span>
                        </div>
                    ))}
                </div>
            </section>

            <section className={styles.analysisCard}>
                <div className={styles.analysisTitle}>
                    <BarChart3 size={16} />
                    <h2>停滞理由</h2>
                </div>
                <div className={styles.analysisList}>
                    {insights.reason_clusters.map((item) => (
                        <div key={item.key} className={styles.analysisRow}>
                            <span>{item.label}</span>
                            <strong>{item.count}</strong>
                        </div>
                    ))}
                </div>
            </section>

            <section className={`${styles.analysisCard} ${styles.analysisCardWide}`}>
                <div className={styles.analysisTitle}>
                    <MessageSquare size={16} />
                    <h2>会社単位の俯瞰</h2>
                </div>
                <div className={styles.analysisList}>
                    {insights.client_health.map((item) => (
                        <div key={item.rollup_key} className={styles.analysisRow}>
                            <div>
                                <strong>{item.client_name}</strong>
                                <p>{item.sites.join(" / ") || "現場情報なし"}</p>
                            </div>
                            <div className={styles.clientHealthMeta}>
                                <span>open {item.open_contacts}</span>
                                <span>overdue {item.overdue_count}</span>
                                <span>提案 {item.in_flight_proposal_count}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
    );
}

export function Communications() {
    const [searchParams] = useSearchParams();
    const proposalQuery = searchParams.get("proposal");
    const [tab, setTab] = useState<TabId>("board");
    const [contacts, setContacts] = useState<CommunicationContactStatusRecord[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedContactKey, setSelectedContactKey] = useState<string | null>(null);
    const [detail, setDetail] = useState<CommunicationContactStatusDetail | null>(null);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [insights, setInsights] = useState<CommunicationInsightsSummary | null>(null);
    const [query, setQuery] = useState("");
    const [statusFilters, setStatusFilters] = useState<CommunicationContactStatus[]>([]);
    const [riskFilters, setRiskFilters] = useState<CommunicationContactRiskFlag[]>([]);
    const [ownerFilter, setOwnerFilter] = useState("");
    const [includeResolved, setIncludeResolved] = useState(false);
    const [recordSheetOpen, setRecordSheetOpen] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [insightsLoading, setInsightsLoading] = useState(false);
    const [insightsError, setInsightsError] = useState<string | null>(null);
    const [proposalActing, setProposalActing] = useState(false);

    const activeConversation = useMemo(
        () => detail?.conversations.find((conversation) => conversation.id === activeConversationId) || null,
        [activeConversationId, detail],
    );

    const refreshContacts = useCallback(async (keepSelectedKey?: string | null) => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetchCommunicationContacts({
                q: query || undefined,
                status: statusFilters,
                ownerUserId: ownerFilter ? [ownerFilter] : undefined,
                risk: riskFilters,
                includeResolved,
                sort: "attention",
                page: 1,
                pageSize: 200,
            });
            setContacts(response.items);
            setTotalCount(response.total_count);
            setSelectedContactKey((current) => {
                const candidate = keepSelectedKey ?? current;
                if (candidate && response.items.some((item) => item.contact_key === candidate)) {
                    return candidate;
                }
                return response.items[0]?.contact_key || null;
            });
        } catch (requestError: unknown) {
            setContacts([]);
            setTotalCount(0);
            setSelectedContactKey(null);
            setError(getErrorMessage(requestError));
        } finally {
            setLoading(false);
        }
    }, [includeResolved, ownerFilter, query, riskFilters, statusFilters]);

    const loadDetail = useCallback(async (contactKey: string) => {
        try {
            setDetailLoading(true);
            setDetailError(null);
            const data = await fetchCommunicationContactDetail(contactKey);
            setDetail(data);
            setActiveConversationId((current) => {
                if (current && data.conversations.some((conversation) => conversation.id === current)) {
                    return current;
                }
                return data.default_conversation_id || data.conversations[0]?.id || null;
            });
        } catch (requestError: unknown) {
            setDetail(null);
            setActiveConversationId(null);
            setDetailError(getErrorMessage(requestError));
        } finally {
            setDetailLoading(false);
        }
    }, []);

    const loadInsights = useCallback(async () => {
        try {
            setInsightsLoading(true);
            setInsightsError(null);
            setInsights(await fetchCommunicationInsightsSummary());
        } catch (requestError: unknown) {
            setInsightsError(getErrorMessage(requestError));
        } finally {
            setInsightsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refreshContacts();
    }, [refreshContacts]);

    useEffect(() => {
        void Promise.all([fetchMembers(), fetchSites()])
            .then(([memberData, siteData]) => {
                setMembers(memberData);
                setSites(siteData);
            })
            .catch((requestError) => {
                console.error("failed to load communication references:", requestError);
            });
    }, []);

    useEffect(() => {
        if (!selectedContactKey) {
            setDetail(null);
            setActiveConversationId(null);
            return;
        }
        void loadDetail(selectedContactKey);
    }, [loadDetail, selectedContactKey]);

    useEffect(() => {
        if (tab === "analyze" && !insights && !insightsLoading) {
            void loadInsights();
        }
    }, [insights, insightsLoading, loadInsights, tab]);

    useEffect(() => {
        if (!proposalQuery || contacts.length === 0 || selectedProposal) {
            return;
        }

        let cancelled = false;
        void Promise.all(
            contacts.slice(0, 50).map((contact) =>
                fetchCommunicationContactDetail(contact.contact_key)
                    .then((candidate) =>
                        candidate.related_proposals.some((proposal) => proposal.id === proposalQuery)
                            ? candidate
                            : null,
                    )
                    .catch(() => null),
            ),
        ).then((results) => {
            if (cancelled) {
                return;
            }
            const matched = results.find((candidate) => candidate?.related_proposals.some((proposal) => proposal.id === proposalQuery));
            if (matched) {
                setSelectedContactKey(matched.summary.contact_key);
                const linkedProposal = matched.related_proposals.find((proposal) => proposal.id === proposalQuery) || null;
                setSelectedProposal(linkedProposal);
            }
        });

        return () => {
            cancelled = true;
        };
    }, [contacts, proposalQuery, selectedProposal]);

    function toggleStatus(status: CommunicationContactStatus) {
        setStatusFilters((current) =>
            current.includes(status) ? current.filter((value) => value !== status) : [...current, status],
        );
    }

    function toggleRisk(risk: CommunicationContactRiskFlag) {
        setRiskFilters((current) =>
            current.includes(risk) ? current.filter((value) => value !== risk) : [...current, risk],
        );
    }

    async function handleRefresh() {
        await refreshContacts(selectedContactKey);
        if (selectedContactKey) {
            await loadDetail(selectedContactKey);
        }
        if (tab === "analyze") {
            await loadInsights();
        }
    }

    const handleRecordSaved = useCallback(
        async ({ contactKey, conversationId }: CommunicationRecordSheetSaveResult) => {
            const nextContactKey = contactKey || selectedContactKey;

            try {
                await refreshContacts(nextContactKey);
                if (nextContactKey) {
                    setSelectedContactKey(nextContactKey);
                    await loadDetail(nextContactKey);
                }
                if (conversationId) {
                    setActiveConversationId(conversationId);
                }
            } catch (requestError) {
                console.error("failed to refresh communication board after save:", requestError);
            }
        },
        [loadDetail, refreshContacts, selectedContactKey],
    );

    async function handleProposalMutation(
        proposalId: string,
        action: "approve" | "reject" | "instruct" | "execute",
        payload?: string,
    ) {
        if (!selectedContactKey) {
            return;
        }

        try {
            setProposalActing(true);
            if (action === "approve") {
                await approveProposal(proposalId, payload);
            } else if (action === "reject") {
                await rejectProposal(proposalId, payload || "");
            } else if (action === "instruct") {
                await instructProposal(proposalId, payload || "");
            } else {
                await executeProposal(proposalId);
            }

            await Promise.all([refreshContacts(selectedContactKey), loadDetail(selectedContactKey), loadInsights()]);
        } catch (requestError: unknown) {
            setDetailError(getErrorMessage(requestError));
        } finally {
            setProposalActing(false);
        }
    }

    return (
        <div className={styles.container}>
            <BoardHeader totalCount={totalCount} onRefresh={handleRefresh} refreshing={loading || detailLoading} />

            {error && (
                <div className={styles.errorBanner}>
                    <AlertCircle size={14} />
                    {error}
                </div>
            )}

            <div className={styles.tabRail}>
                <button
                    type="button"
                    className={`${styles.tabButton} ${tab === "board" ? styles.tabButtonActive : ""}`}
                    onClick={() => setTab("board")}
                >
                    <ClipboardList size={16} />
                    Board
                </button>
                <button
                    type="button"
                    className={`${styles.tabButton} ${tab === "analyze" ? styles.tabButtonActive : ""}`}
                    onClick={() => setTab("analyze")}
                >
                    <BarChart3 size={16} />
                    Analyze
                </button>
            </div>

            {tab === "board" ? (
                <>
                    <CommunicationKpiStrip contacts={contacts} />
                    <CommunicationContactFilters
                        query={query}
                        onQueryChange={setQuery}
                        statusFilters={statusFilters}
                        toggleStatus={toggleStatus}
                        riskFilters={riskFilters}
                        toggleRisk={toggleRisk}
                        ownerFilter={ownerFilter}
                        setOwnerFilter={setOwnerFilter}
                        includeResolved={includeResolved}
                        setIncludeResolved={setIncludeResolved}
                        members={members}
                    />

                    <div className={styles.boardLayout}>
                        <section className={styles.boardPane}>
                            {loading ? (
                                <p className={styles.panelState}>連絡ボードを読み込み中...</p>
                            ) : contacts.length === 0 ? (
                                <div className={styles.emptyPane}>
                                    <MessageSquare size={36} />
                                    <strong>該当する連絡先はありません</strong>
                                    <span>絞り込みを戻すか、新しい会話を追加してください。</span>
                                    <button
                                        type="button"
                                        className={styles.primaryButton}
                                        onClick={() => setRecordSheetOpen(true)}
                                    >
                                        <Plus size={16} />
                                        連絡を記録
                                    </button>
                                </div>
                            ) : (
                                <div className={styles.contactList}>
                                    {contacts.map((contact) => (
                                        <CommunicationContactRow
                                            key={contact.contact_key}
                                            contact={contact}
                                            selected={contact.contact_key === selectedContactKey}
                                            onSelect={() => setSelectedContactKey(contact.contact_key)}
                                        />
                                    ))}
                                </div>
                            )}
                        </section>

                        <aside className={styles.detailPane}>
                            {detailLoading && <p className={styles.panelState}>詳細を読み込み中...</p>}

                            {detailError && (
                                <div className={styles.errorBanner}>
                                    <AlertCircle size={14} />
                                    {detailError}
                                </div>
                            )}

                            {!detailLoading && !detail && (
                                <div className={styles.emptyPane}>
                                    <Users size={36} />
                                    <strong>相手を選ぶ</strong>
                                    <span>一覧から選ぶと、根拠・会話・提案・次アクションをここで確認できます。</span>
                                </div>
                            )}

                            {detail && (
                                <>
                                    <section className={styles.detailCard}>
                                        <div className={styles.sectionTitle}>
                                            <Sparkles size={16} />
                                            <h2>Why now?</h2>
                                        </div>
                                        <div className={styles.whyNowList}>
                                            {detail.why_now.map((item) => (
                                                <article key={`${item.code}-${item.title}`} className={styles.whyNowItem}>
                                                    <strong>{item.title}</strong>
                                                    <p>{item.description}</p>
                                                </article>
                                            ))}
                                        </div>
                                    </section>

                                    <section className={styles.detailCard}>
                                        <div className={styles.sectionTitle}>
                                            <Bot size={16} />
                                            <h2>集約サマリ</h2>
                                        </div>
                                        <div className={styles.summaryHero}>
                                            <div>
                                                <p className={styles.contactCompany}>{detail.summary.client_name || "会社名未設定"}</p>
                                                <h3 className={styles.contactName}>
                                                    {detail.summary.contact_name || detail.summary.contact_email || "担当未設定"}
                                                </h3>
                                            </div>
                                            <span className={styles.statusPill}>{BOARD_STATUS_LABELS[detail.summary.status]}</span>
                                        </div>
                                        <div className={styles.summaryGrid}>
                                            <div>
                                                <span>社内担当</span>
                                                <strong>{detail.summary.owner?.name || "担当未設定"}</strong>
                                            </div>
                                            <div>
                                                <span>最終接点</span>
                                                <strong>{formatDateTime(detail.summary.latest_activity_at)}</strong>
                                            </div>
                                            <div>
                                                <span>次アクション</span>
                                                <strong>{detail.summary.next_action || "未設定"}</strong>
                                            </div>
                                            <div>
                                                <span>期限</span>
                                                <strong>{formatDateOnly(detail.summary.next_action_due_date)}</strong>
                                            </div>
                                        </div>
                                    </section>

                                    <section className={styles.detailCard}>
                                        <div className={styles.sectionTitle}>
                                            <ClipboardList size={16} />
                                            <h2>関連 Proposal</h2>
                                        </div>
                                        <div className={styles.listStack}>
                                            {detail.related_proposals.length === 0 ? (
                                                <p className={styles.smallMuted}>関連 Proposal はまだありません。</p>
                                            ) : (
                                                detail.related_proposals.map((proposal) => (
                                                    <button
                                                        key={proposal.id}
                                                        type="button"
                                                        className={styles.inlineCardButton}
                                                        onClick={() => setSelectedProposal(proposal)}
                                                    >
                                                        <div>
                                                            <strong>{proposal.type}</strong>
                                                            <p>{proposal.description}</p>
                                                        </div>
                                                        <span>{getProposalStatusLabel(proposal.status)}</span>
                                                    </button>
                                                ))
                                            )}
                                        </div>
                                    </section>

                                    <section className={styles.detailCard}>
                                        <div className={styles.sectionTitle}>
                                            <MessageSquare size={16} />
                                            <h2>紐づく会話</h2>
                                        </div>
                                        <div className={styles.listStack}>
                                            {detail.conversations.map((conversation) => (
                                                <button
                                                    key={conversation.id}
                                                    type="button"
                                                    className={`${styles.inlineCardButton} ${
                                                        activeConversationId === conversation.id ? styles.inlineCardButtonActive : ""
                                                    }`}
                                                    onClick={() => setActiveConversationId(conversation.id)}
                                                >
                                                    <div>
                                                        <strong>{conversation.title}</strong>
                                                        <p>{conversation.participant_summary}</p>
                                                    </div>
                                                    <div className={styles.inlineCardMeta}>
                                                        <span>{CONVERSATION_STATUS_LABELS[conversation.status]}</span>
                                                        <ChevronRight size={14} />
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </section>

                                    <section className={styles.detailCard}>
                                        <div className={styles.sectionTitle}>
                                            <Mail size={16} />
                                            <h2>直近 5 件ログ</h2>
                                        </div>
                                        <div className={styles.logList}>
                                            {detail.recent_logs.map((log) => (
                                                <article key={log.id} className={styles.logItem}>
                                                    <div className={styles.logItemHeader}>
                                                        <div className={styles.logBadges}>
                                                            <span className={styles.channelBadge}>
                                                                {CHANNEL_LABELS[log.channel]}
                                                            </span>
                                                            <span className={styles.directionBadge}>
                                                                {DIRECTION_LABELS[log.direction]}
                                                            </span>
                                                        </div>
                                                        <span>{formatDateTime(log.occurred_at)}</span>
                                                    </div>
                                                    <strong>{log.subject || log.conversation_title}</strong>
                                                    <p>{log.summary || log.body}</p>
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                </>
                            )}
                        </aside>
                    </div>
                </>
            ) : (
                <AnalyzeTab insights={insights} loading={insightsLoading} error={insightsError} />
            )}

            <FloatingActionButton
                behavior="draggable"
                openLabel="連絡の操作メニューを開く"
                closeLabel="連絡の操作メニューを閉じる"
                items={[
                    {
                        id: "communication-record",
                        label: "連絡を記録",
                        icon: <Plus size={18} />,
                        onClick: () => setRecordSheetOpen(true),
                    },
                ]}
            />

            <AnimatePresence>
                {selectedProposal && (
                    <ProposalDetailModal
                        proposal={selectedProposal}
                        onClose={() => setSelectedProposal(null)}
                        onApprove={(proposalId, reason) => handleProposalMutation(proposalId, "approve", reason)}
                        onReject={(proposalId, reason) => handleProposalMutation(proposalId, "reject", reason)}
                        onInstruct={(proposalId, instruction) =>
                            handleProposalMutation(proposalId, "instruct", instruction)
                        }
                        onExecute={(proposalId) => handleProposalMutation(proposalId, "execute")}
                        isActing={proposalActing}
                    />
                )}
            </AnimatePresence>

            <CommunicationRecordSheet
                open={recordSheetOpen}
                onClose={() => setRecordSheetOpen(false)}
                initialTargetKind={activeConversation ? "follow_up" : "new_topic"}
                activeConversationSummary={activeConversation}
                contactSeed={
                    detail
                        ? {
                              partnerName: detail.summary.contact_name,
                              partnerEmail: detail.summary.contact_email,
                              clientName: detail.summary.client_name,
                          }
                        : undefined
                }
                availableMembers={members}
                availableSites={sites}
                onSaved={handleRecordSaved}
                onRequestPickContext={() => setRecordSheetOpen(false)}
            />
        </div>
    );
}
