import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
    AlertCircle,
    ArrowRight,
    Bot,
    CalendarClock,
    ChevronRight,
    ClipboardPaste,
    HardHat,
    Mail,
    MapPinned,
    MessageSquare,
    Phone,
    Plus,
    RefreshCw,
    SendHorizontal,
    Sparkles,
    UserCircle2,
    Users,
} from "lucide-react";
import {
    approveProposal,
    executeProposal,
    fetchCommunicationContactDetail,
    fetchCommunicationContacts,
    fetchMembers,
    fetchSites,
    instructProposal,
    rejectProposal,
    type CommunicationChannel,
    type CommunicationConversationStatus,
    type CommunicationContactRiskFlag,
    type CommunicationContactRecentLogRecord,
    type CommunicationContactStatus,
    type CommunicationContactStatusDetail,
    type CommunicationContactStatusRecord,
    type CommunicationDirection,
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

type CommunicationEvidenceType = "external_original" | "team_sent_copy" | "oral_note";
type CommunicationEntryMode = "customer_paste" | "team_paste" | "phone_note" | "site_conversation";

function getStringMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = metadata?.[key];
    return typeof value === "string" ? value : null;
}

function getEvidenceType(log: CommunicationContactRecentLogRecord): CommunicationEvidenceType {
    const value = getStringMetadata(log.metadata, "evidence_type");
    if (value === "external_original" || value === "team_sent_copy" || value === "oral_note") {
        return value;
    }
    if (log.direction === "outbound") {
        return "team_sent_copy";
    }
    if (log.direction === "internal" || log.channel === "phone" || log.channel === "in_person") {
        return "oral_note";
    }
    return "external_original";
}

function getEntryMode(log: CommunicationContactRecentLogRecord): CommunicationEntryMode | null {
    const value = getStringMetadata(log.metadata, "entry_mode");
    if (
        value === "customer_paste" ||
        value === "team_paste" ||
        value === "phone_note" ||
        value === "site_conversation"
    ) {
        return value;
    }
    return null;
}

function getEvidenceLabel(log: CommunicationContactRecentLogRecord): string {
    const entryMode = getEntryMode(log);
    if (entryMode === "site_conversation") {
        return "現場会話";
    }
    if (entryMode === "phone_note") {
        return "聞き取り";
    }
    const evidenceType = getEvidenceType(log);
    if (evidenceType === "team_sent_copy") {
        return "送信文";
    }
    if (evidenceType === "oral_note") {
        return log.channel === "in_person" ? "現場会話" : "聞き取り";
    }
    return "コピペ原文";
}

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
                <p className={styles.eyebrow}>Messenger Ledger</p>
                <h1 className={styles.pageTitle}>連絡台帳</h1>
                <p className={styles.pageSubtitle}>
                    相手の原文、こちらの送信文、電話、現場会話を会話の流れで残します。
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
                    <span>{contact.next_action_due_date ? `期限 ${formatDateOnly(contact.next_action_due_date)}` : "期限なし"}</span>
                    <span>提案 {contact.in_flight_proposal_count}件</span>
                </div>
            </div>
        </button>
    );
}

function CommunicationTimelineLog({ log }: { log: CommunicationContactRecentLogRecord }) {
    const evidenceType = getEvidenceType(log);
    const entryMode = getEntryMode(log);
    const isOutbound = evidenceType === "team_sent_copy" || log.direction === "outbound";
    const isOral = evidenceType === "oral_note";
    const Icon =
        entryMode === "site_conversation"
            ? HardHat
            : entryMode === "phone_note" || log.channel === "phone"
              ? Phone
              : isOutbound
                ? SendHorizontal
                : ClipboardPaste;

    return (
        <article
            className={`${styles.timelineItem} ${
                isOral ? styles.timelineItemNote : isOutbound ? styles.timelineItemOutbound : styles.timelineItemInbound
            }`}
        >
            <div className={styles.timelineBubble}>
                <div className={styles.timelineMeta}>
                    <span className={styles.evidenceBadge}>
                        <Icon size={13} />
                        {getEvidenceLabel(log)}
                    </span>
                    <span>{CHANNEL_LABELS[log.channel]}</span>
                    <span>{DIRECTION_LABELS[log.direction]}</span>
                    <span>{formatDateTime(log.occurred_at)}</span>
                </div>
                <strong>{log.subject || log.conversation_title}</strong>
                <p>{log.summary || log.body}</p>
                <div className={styles.timelineAudit}>
                    <span>登録 {log.created_by_name || log.created_by_type}</span>
                    <span>{formatDateTime(log.created_at)}</span>
                </div>
            </div>
        </article>
    );
}

export function Communications() {
    const [searchParams] = useSearchParams();
    const proposalQuery = searchParams.get("proposal");
    const [contacts, setContacts] = useState<CommunicationContactStatusRecord[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [selectedContactKey, setSelectedContactKey] = useState<string | null>(null);
    const [detail, setDetail] = useState<CommunicationContactStatusDetail | null>(null);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [recordSheetOpen, setRecordSheetOpen] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
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
                includeResolved: false,
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
    }, []);

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

    async function handleRefresh() {
        await refreshContacts(selectedContactKey);
        if (selectedContactKey) {
            await loadDetail(selectedContactKey);
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

            await Promise.all([refreshContacts(selectedContactKey), loadDetail(selectedContactKey)]);
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

                    <div className={styles.boardLayout}>
                        <section className={styles.boardPane}>
                            {loading ? (
                                <p className={styles.panelState}>連絡を読み込み中...</p>
                            ) : contacts.length === 0 ? (
                                <div className={styles.emptyPane}>
                                    <MessageSquare size={36} />
                                    <strong>まだ記録がありません</strong>
                                    <span>相手の文章や電話メモを残すと、ここに会話として並びます。</span>
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
                                            <Bot size={16} />
                                            <h2>相手</h2>
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
                                            <Mail size={16} />
                                            <h2>証跡タイムライン</h2>
                                        </div>
                                        <div className={styles.timelineList}>
                                            {detail.recent_logs.length === 0 ? (
                                                <p className={styles.smallMuted}>まだ記録はありません。</p>
                                            ) : (
                                                detail.recent_logs.map((log) => <CommunicationTimelineLog key={log.id} log={log} />)
                                            )}
                                        </div>
                                    </section>

                                    <section className={styles.detailCard}>
                                        <div className={styles.sectionTitle}>
                                            <Sparkles size={16} />
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

                                </>
                            )}
                        </aside>
                    </div>

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
