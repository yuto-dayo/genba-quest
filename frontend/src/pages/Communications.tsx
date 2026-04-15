import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
    AlertCircle,
    ArrowRight,
    Bot,
    CalendarClock,
    ClipboardList,
    Mail,
    MapPinned,
    MessageSquare,
    Phone,
    Plus,
    RefreshCw,
    SendHorizontal,
    UserCircle2,
    Users,
} from "lucide-react";
import {
    addCommunicationLog,
    approveProposal,
    createCommunicationConversation,
    executeProposal,
    fetchCommunicationDetail,
    fetchCommunications,
    fetchMembers,
    fetchSites,
    instructProposal,
    rejectProposal,
    updateCommunicationConversation,
    type CommunicationChannel,
    type CommunicationConversationRecord,
    type CommunicationConversationStatus,
    type CommunicationDetailRecord,
    type CommunicationDirection,
    type CommunicationLogKind,
    type Member,
    type ProposalRecord,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import styles from "./Communications.module.css";

const STATUS_LABELS: Record<CommunicationConversationStatus, string> = {
    active: "対応中",
    waiting_internal: "社内対応待ち",
    waiting_client: "相手待ち",
    resolved: "完了",
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

const PRIORITY_LABELS: Record<string, string> = {
    urgent: "最優先",
    high: "高",
    medium: "中",
    low: "低",
};

type ConversationFormState = {
    title: string;
    status: CommunicationConversationStatus;
    assignee_user_id: string;
    site_id: string;
    next_action: string;
    next_action_due_date: string;
};

type LogFormState = {
    channel: Exclude<CommunicationChannel, "system">;
    direction: CommunicationDirection;
    log_kind: Exclude<CommunicationLogKind, "proposal_link">;
    subject: string;
    summary: string;
    body: string;
    occurred_at: string;
    participant_name: string;
    participant_email: string;
    participant_phone: string;
};

type ConversationComposerState = ConversationFormState &
    Omit<LogFormState, "log_kind"> & {
        participant_name: string;
        participant_email: string;
        participant_phone: string;
    };

function formatDateTime(value?: string | null): string {
    if (!value) {
        return "日時未設定";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("ja-JP", {
        year: "numeric",
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

function toDateTimeLocalInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoFromLocalInput(value: string): string | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }

    return parsed.toISOString();
}

function getPriorityLabel(value?: string | null): string {
    if (!value) {
        return "未設定";
    }
    return PRIORITY_LABELS[value] || value;
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

function getDefaultLogForm(): LogFormState {
    return {
        channel: "phone",
        direction: "internal",
        log_kind: "note",
        subject: "",
        summary: "",
        body: "",
        occurred_at: toDateTimeLocalInput(new Date()),
        participant_name: "",
        participant_email: "",
        participant_phone: "",
    };
}

function getDefaultComposer(): ConversationComposerState {
    return {
        title: "",
        status: "waiting_internal",
        assignee_user_id: "",
        site_id: "",
        next_action: "",
        next_action_due_date: "",
        channel: "phone",
        direction: "inbound",
        subject: "",
        summary: "",
        body: "",
        occurred_at: toDateTimeLocalInput(new Date()),
        participant_name: "",
        participant_email: "",
        participant_phone: "",
    };
}

function getConversationForm(conversation: CommunicationConversationRecord): ConversationFormState {
    return {
        title: conversation.title,
        status: conversation.status,
        assignee_user_id: conversation.assignee?.id || "",
        site_id: conversation.site?.id || "",
        next_action: conversation.next_action || "",
        next_action_due_date: conversation.next_action_due_date || "",
    };
}

export function Communications() {
    const [conversations, setConversations] = useState<CommunicationConversationRecord[]>([]);
    const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CommunicationDetailRecord | null>(null);
    const [members, setMembers] = useState<Member[]>([]);
    const [sites, setSites] = useState<Site[]>([]);
    const [conversationForm, setConversationForm] = useState<ConversationFormState | null>(null);
    const [logForm, setLogForm] = useState<LogFormState>(getDefaultLogForm());
    const [composer, setComposer] = useState<ConversationComposerState>(getDefaultComposer());
    const [showComposer, setShowComposer] = useState(false);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [savingMeta, setSavingMeta] = useState(false);
    const [savingLog, setSavingLog] = useState(false);
    const [savingConversation, setSavingConversation] = useState(false);
    const [proposalActing, setProposalActing] = useState(false);

    const selectedConversation =
        conversations.find((conversation) => conversation.id === selectedConversationId) || null;

    async function loadConversations(nextSelectedId?: string | null) {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchCommunications({ limit: 60 });
            setConversations(data);
            setSelectedConversationId((current) => {
                const candidate = nextSelectedId ?? current;
                if (candidate && data.some((conversation) => conversation.id === candidate)) {
                    return candidate;
                }
                return data[0]?.id || null;
            });
        } catch (err: unknown) {
            setConversations([]);
            setSelectedConversationId(null);
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }

    async function loadReferenceData() {
        try {
            const [memberData, siteData] = await Promise.all([fetchMembers(), fetchSites()]);
            setMembers(memberData);
            setSites(siteData);
        } catch (err) {
            console.error("Failed to load communications references:", err);
        }
    }

    async function loadDetail(conversationId: string) {
        try {
            setDetailLoading(true);
            setDetailError(null);
            const data = await fetchCommunicationDetail(conversationId);
            setDetail(data);
            setConversationForm(getConversationForm(data.conversation));
        } catch (err: unknown) {
            setDetail(null);
            setConversationForm(null);
            setDetailError(getErrorMessage(err));
        } finally {
            setDetailLoading(false);
        }
    }

    async function refreshSelectedConversation(conversationId: string, keepProposalId?: string | null) {
        const [listData, detailData] = await Promise.all([
            fetchCommunications({ limit: 60 }),
            fetchCommunicationDetail(conversationId),
        ]);
        setConversations(listData);
        setSelectedConversationId(conversationId);
        setDetail(detailData);
        setConversationForm(getConversationForm(detailData.conversation));
        if (keepProposalId) {
            setSelectedProposal(
                detailData.related_proposals.find((proposal) => proposal.id === keepProposalId) || null
            );
        }
    }

    useEffect(() => {
        void Promise.all([loadConversations(), loadReferenceData()]);
    }, []);

    useEffect(() => {
        if (!selectedConversationId) {
            setDetail(null);
            setConversationForm(null);
            return;
        }
        void loadDetail(selectedConversationId);
    }, [selectedConversationId]);

    async function handleRefresh() {
        await loadConversations(selectedConversationId);
        if (selectedConversationId) {
            await loadDetail(selectedConversationId);
        }
    }

    async function handleSaveConversation() {
        if (!selectedConversationId || !conversationForm) {
            return;
        }

        try {
            setSavingMeta(true);
            const updated = await updateCommunicationConversation(selectedConversationId, {
                title: conversationForm.title,
                status: conversationForm.status,
                assignee_user_id: conversationForm.assignee_user_id || null,
                site_id: conversationForm.site_id || null,
                next_action: conversationForm.next_action || null,
                next_action_due_date: conversationForm.next_action_due_date || null,
            });
            setDetail(updated);
            setConversationForm(getConversationForm(updated.conversation));
            await loadConversations(updated.conversation.id);
        } catch (err: unknown) {
            setDetailError(getErrorMessage(err));
        } finally {
            setSavingMeta(false);
        }
    }

    async function handleAddLog() {
        if (!selectedConversationId || !logForm.body.trim()) {
            return;
        }

        try {
            setSavingLog(true);
            const updated = await addCommunicationLog(selectedConversationId, {
                channel: logForm.channel,
                direction: logForm.direction,
                log_kind: logForm.log_kind,
                subject: logForm.subject || undefined,
                summary: logForm.summary || undefined,
                body: logForm.body,
                occurred_at: toIsoFromLocalInput(logForm.occurred_at),
                participant_name: logForm.participant_name || null,
                participant_email: logForm.participant_email || null,
                participant_phone: logForm.participant_phone || null,
            });
            setDetail(updated);
            setConversationForm(getConversationForm(updated.conversation));
            setLogForm(getDefaultLogForm());
            await loadConversations(updated.conversation.id);
        } catch (err: unknown) {
            setDetailError(getErrorMessage(err));
        } finally {
            setSavingLog(false);
        }
    }

    async function handleCreateConversation() {
        if (!composer.title.trim() || !composer.body.trim()) {
            return;
        }

        try {
            setSavingConversation(true);
            const created = await createCommunicationConversation({
                title: composer.title,
                channel: composer.channel,
                direction: composer.direction,
                subject: composer.subject || undefined,
                summary: composer.summary || undefined,
                body: composer.body,
                occurred_at: toIsoFromLocalInput(composer.occurred_at),
                status: composer.status,
                assignee_user_id: composer.assignee_user_id || null,
                site_id: composer.site_id || null,
                next_action: composer.next_action || null,
                next_action_due_date: composer.next_action_due_date || null,
                participant_name: composer.participant_name || null,
                participant_email: composer.participant_email || null,
                participant_phone: composer.participant_phone || null,
                log_kind: "message",
            });
            setShowComposer(false);
            setComposer(getDefaultComposer());
            setDetail(created);
            setConversationForm(getConversationForm(created.conversation));
            await loadConversations(created.conversation.id);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setSavingConversation(false);
        }
    }

    async function handleProposalMutation(
        proposalId: string,
        action: "approve" | "reject" | "instruct" | "execute",
        payload?: string
    ) {
        if (!selectedConversationId) {
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

            await refreshSelectedConversation(selectedConversationId, proposalId);
        } catch (err: unknown) {
            setDetailError(getErrorMessage(err));
        } finally {
            setProposalActing(false);
        }
    }

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>連絡ハブを読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <motion.header
                className={styles.header}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div>
                    <p className={styles.eyebrow}>Shared Conversation Hub</p>
                    <h1 className={styles.pageTitle}>連絡</h1>
                    <p className={styles.pageSubtitle}>
                        取引先との会話を会話単位で残し、担当・次アクション・Proposal まで一気通貫で追う。
                    </p>
                </div>

                <div className={styles.headerActions}>
                    <button
                        type="button"
                        className={styles.secondaryButton}
                        onClick={() => setShowComposer((current) => !current)}
                    >
                        <Plus size={16} />
                        新しい会話
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={handleRefresh}>
                        <RefreshCw size={16} />
                        更新
                    </button>
                </div>
            </motion.header>

            {error && (
                <div className={styles.errorBanner}>
                    <AlertCircle size={14} />
                    {error}
                </div>
            )}

            <div className={styles.layout}>
                <section className={styles.listPane}>
                    <div className={styles.paneHeader}>
                        <div>
                            <p className={styles.paneEyebrow}>会話一覧</p>
                            <h2 className={styles.paneTitle}>{conversations.length}件の会話</h2>
                        </div>
                    </div>

                    {conversations.length === 0 ? (
                        <div className={styles.emptyPane}>
                            <MessageSquare size={36} />
                            <strong>会話はまだありません</strong>
                            <span>Gmail 取込か手動追加で、取引先とのやり取りをここに集約します。</span>
                        </div>
                    ) : (
                        <div className={styles.conversationList}>
                            {conversations.map((conversation) => {
                                const isSelected = conversation.id === selectedConversationId;
                                return (
                                    <button
                                        key={conversation.id}
                                        type="button"
                                        className={`${styles.conversationCard} ${
                                            isSelected ? styles.conversationCardSelected : ""
                                        }`}
                                        onClick={() => {
                                            setShowComposer(false);
                                            setSelectedConversationId(conversation.id);
                                        }}
                                    >
                                        <div className={styles.cardTopRow}>
                                            <span className={styles.channelBadge}>
                                                {CHANNEL_LABELS[conversation.last_channel]}
                                            </span>
                                            <span className={styles.statusBadge}>
                                                {STATUS_LABELS[conversation.status]}
                                            </span>
                                        </div>

                                        <h3 className={styles.cardTitle}>{conversation.title}</h3>
                                        <p className={styles.cardParticipant}>{conversation.participant_summary}</p>
                                        <p className={styles.cardSummary}>
                                            {conversation.last_message_preview || conversation.ai_summary || "最新ログなし"}
                                        </p>

                                        <div className={styles.cardMeta}>
                                            <span>{formatDateTime(conversation.last_activity_at)}</span>
                                            <span>{conversation.related_proposal_count} Proposal</span>
                                        </div>

                                        <div className={styles.cardFooter}>
                                            <span>{conversation.assignee?.name || "担当未設定"}</span>
                                            <ArrowRight size={14} />
                                            <span>{conversation.next_action || "次アクション未設定"}</span>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </section>

                <section className={styles.timelinePane}>
                    {showComposer && (
                        <div className={styles.composeCard}>
                            <div className={styles.paneHeader}>
                                <div>
                                    <p className={styles.paneEyebrow}>新規会話</p>
                                    <h2 className={styles.paneTitle}>電話・LINE・対面の会話を起票</h2>
                                </div>
                            </div>

                            <div className={styles.formGrid}>
                                <label className={styles.field}>
                                    <span>会話タイトル</span>
                                    <input
                                        value={composer.title}
                                        onChange={(event) =>
                                            setComposer((current) => ({ ...current, title: event.target.value }))
                                        }
                                        placeholder="例: 工程変更の確認"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>取引先名</span>
                                    <input
                                        value={composer.participant_name}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                participant_name: event.target.value,
                                            }))
                                        }
                                        placeholder="例: 田中工務店"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>チャネル</span>
                                    <select
                                        value={composer.channel}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                channel: event.target.value as ConversationComposerState["channel"],
                                            }))
                                        }
                                    >
                                        <option value="phone">電話</option>
                                        <option value="line">LINE</option>
                                        <option value="in_person">対面</option>
                                        <option value="sms">SMS</option>
                                        <option value="manual">手動メモ</option>
                                        <option value="gmail">Gmail</option>
                                    </select>
                                </label>

                                <label className={styles.field}>
                                    <span>方向</span>
                                    <select
                                        value={composer.direction}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                direction: event.target.value as CommunicationDirection,
                                            }))
                                        }
                                    >
                                        <option value="inbound">受信</option>
                                        <option value="outbound">送信</option>
                                        <option value="internal">内部整理</option>
                                    </select>
                                </label>

                                <label className={styles.field}>
                                    <span>担当</span>
                                    <select
                                        value={composer.assignee_user_id}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                assignee_user_id: event.target.value,
                                            }))
                                        }
                                    >
                                        <option value="">未設定</option>
                                        {members.map((member) => (
                                            <option key={member.id} value={member.id}>
                                                {member.full_name || member.username || member.id}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className={styles.field}>
                                    <span>関連現場</span>
                                    <select
                                        value={composer.site_id}
                                        onChange={(event) =>
                                            setComposer((current) => ({ ...current, site_id: event.target.value }))
                                        }
                                    >
                                        <option value="">未設定</option>
                                        {sites.map((site) => (
                                            <option key={site.id} value={site.id}>
                                                {site.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <label className={styles.field}>
                                    <span>次アクション</span>
                                    <input
                                        value={composer.next_action}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                next_action: event.target.value,
                                            }))
                                        }
                                        placeholder="例: 見積条件を確認して折り返す"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>期限</span>
                                    <input
                                        type="date"
                                        value={composer.next_action_due_date}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                next_action_due_date: event.target.value,
                                            }))
                                        }
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>メールアドレス</span>
                                    <input
                                        value={composer.participant_email}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                participant_email: event.target.value,
                                            }))
                                        }
                                        placeholder="contact@example.com"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>電話番号</span>
                                    <input
                                        value={composer.participant_phone}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                participant_phone: event.target.value,
                                            }))
                                        }
                                        placeholder="090-xxxx-xxxx"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>件名 / トピック</span>
                                    <input
                                        value={composer.subject}
                                        onChange={(event) =>
                                            setComposer((current) => ({ ...current, subject: event.target.value }))
                                        }
                                        placeholder="任意"
                                    />
                                </label>

                                <label className={styles.field}>
                                    <span>記録時刻</span>
                                    <input
                                        type="datetime-local"
                                        value={composer.occurred_at}
                                        onChange={(event) =>
                                            setComposer((current) => ({
                                                ...current,
                                                occurred_at: event.target.value,
                                            }))
                                        }
                                    />
                                </label>

                                <label className={`${styles.field} ${styles.fieldFull}`}>
                                    <span>要約</span>
                                    <textarea
                                        value={composer.summary}
                                        onChange={(event) =>
                                            setComposer((current) => ({ ...current, summary: event.target.value }))
                                        }
                                        placeholder="短い要約"
                                        rows={2}
                                    />
                                </label>

                                <label className={`${styles.field} ${styles.fieldFull}`}>
                                    <span>会話内容</span>
                                    <textarea
                                        value={composer.body}
                                        onChange={(event) =>
                                            setComposer((current) => ({ ...current, body: event.target.value }))
                                        }
                                        placeholder="誰が何を言い、次に何をするかを書き残す"
                                        rows={6}
                                    />
                                </label>
                            </div>

                            <div className={styles.cardActions}>
                                <button
                                    type="button"
                                    className={styles.secondaryButton}
                                    onClick={() => {
                                        setComposer(getDefaultComposer());
                                        setShowComposer(false);
                                    }}
                                >
                                    閉じる
                                </button>
                                <button
                                    type="button"
                                    className={styles.primaryButton}
                                    onClick={handleCreateConversation}
                                    disabled={savingConversation}
                                >
                                    <SendHorizontal size={16} />
                                    {savingConversation ? "作成中..." : "会話を作成"}
                                </button>
                            </div>
                        </div>
                    )}

                    {!showComposer && !selectedConversation && (
                        <div className={styles.emptyPane}>
                            <ClipboardList size={36} />
                            <strong>会話を選択してください</strong>
                            <span>左の一覧から選ぶか、新しい会話を作成してください。</span>
                        </div>
                    )}

                    {!showComposer && selectedConversation && (
                        <>
                            <div className={styles.timelineHeader}>
                                <div>
                                    <p className={styles.paneEyebrow}>タイムライン</p>
                                    <h2 className={styles.timelineTitle}>{selectedConversation.title}</h2>
                                    <p className={styles.timelineSubtitle}>
                                        {selectedConversation.participant_summary} ・ 最終更新{" "}
                                        {formatDateTime(selectedConversation.last_activity_at)}
                                    </p>
                                </div>
                                <div className={styles.timelineHeaderMeta}>
                                    <span>{selectedConversation.assignee?.name || "担当未設定"}</span>
                                    <span>{selectedConversation.next_action || "次アクション未設定"}</span>
                                </div>
                            </div>

                            {detailLoading && <p className={styles.detailState}>会話詳細を読み込み中...</p>}

                            {detailError && (
                                <div className={styles.errorBanner}>
                                    <AlertCircle size={14} />
                                    {detailError}
                                </div>
                            )}

                            {detail && (
                                <>
                                    <div className={styles.timelineList}>
                                        {detail.logs.map((log) => (
                                            <article
                                                key={log.id}
                                                className={`${styles.logCard} ${
                                                    log.direction === "inbound"
                                                        ? styles.logInbound
                                                        : log.direction === "outbound"
                                                          ? styles.logOutbound
                                                          : styles.logInternal
                                                }`}
                                            >
                                                <div className={styles.logHeader}>
                                                    <div className={styles.logBadges}>
                                                        <span className={styles.channelBadge}>
                                                            {CHANNEL_LABELS[log.channel]}
                                                        </span>
                                                        <span className={styles.directionBadge}>
                                                            {DIRECTION_LABELS[log.direction]}
                                                        </span>
                                                        {log.log_kind !== "message" && (
                                                            <span className={styles.kindBadge}>{log.log_kind}</span>
                                                        )}
                                                    </div>
                                                    <span className={styles.logDate}>
                                                        {formatDateTime(log.occurred_at)}
                                                    </span>
                                                </div>

                                                {log.subject && <h3 className={styles.logSubject}>{log.subject}</h3>}
                                                {log.summary && <p className={styles.logSummary}>{log.summary}</p>}
                                                <pre className={styles.logBody}>{log.body}</pre>

                                                <div className={styles.logFooter}>
                                                    <span>{log.created_by_name || "記録者不明"}</span>
                                                    {log.external_source && <span>{log.external_source}</span>}
                                                </div>
                                            </article>
                                        ))}
                                    </div>

                                    <div className={styles.composeCard}>
                                        <div className={styles.paneHeader}>
                                            <div>
                                                <p className={styles.paneEyebrow}>手動ログ追加</p>
                                                <h2 className={styles.paneTitle}>電話・LINE・対面の内容を追記</h2>
                                            </div>
                                        </div>

                                        <div className={styles.formGrid}>
                                            <label className={styles.field}>
                                                <span>チャネル</span>
                                                <select
                                                    value={logForm.channel}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            channel: event.target.value as LogFormState["channel"],
                                                        }))
                                                    }
                                                >
                                                    <option value="phone">電話</option>
                                                    <option value="line">LINE</option>
                                                    <option value="in_person">対面</option>
                                                    <option value="sms">SMS</option>
                                                    <option value="manual">手動メモ</option>
                                                    <option value="gmail">Gmail</option>
                                                </select>
                                            </label>

                                            <label className={styles.field}>
                                                <span>方向</span>
                                                <select
                                                    value={logForm.direction}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            direction: event.target.value as CommunicationDirection,
                                                        }))
                                                    }
                                                >
                                                    <option value="inbound">受信</option>
                                                    <option value="outbound">送信</option>
                                                    <option value="internal">内部</option>
                                                </select>
                                            </label>

                                            <label className={styles.field}>
                                                <span>種別</span>
                                                <select
                                                    value={logForm.log_kind}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            log_kind: event.target.value as LogFormState["log_kind"],
                                                        }))
                                                    }
                                                >
                                                    <option value="message">会話</option>
                                                    <option value="note">メモ</option>
                                                    <option value="summary_update">整理メモ</option>
                                                </select>
                                            </label>

                                            <label className={styles.field}>
                                                <span>記録時刻</span>
                                                <input
                                                    type="datetime-local"
                                                    value={logForm.occurred_at}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            occurred_at: event.target.value,
                                                        }))
                                                    }
                                                />
                                            </label>

                                            <label className={styles.field}>
                                                <span>件名</span>
                                                <input
                                                    value={logForm.subject}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            subject: event.target.value,
                                                        }))
                                                    }
                                                    placeholder="任意"
                                                />
                                            </label>

                                            <label className={styles.field}>
                                                <span>要約</span>
                                                <input
                                                    value={logForm.summary}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            summary: event.target.value,
                                                        }))
                                                    }
                                                    placeholder="短い要約"
                                                />
                                            </label>

                                            <label className={styles.field}>
                                                <span>追加参加者</span>
                                                <input
                                                    value={logForm.participant_name}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            participant_name: event.target.value,
                                                        }))
                                                    }
                                                    placeholder="必要なら追加"
                                                />
                                            </label>

                                            <label className={styles.field}>
                                                <span>メール</span>
                                                <input
                                                    value={logForm.participant_email}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            participant_email: event.target.value,
                                                        }))
                                                    }
                                                />
                                            </label>

                                            <label className={`${styles.field} ${styles.fieldFull}`}>
                                                <span>会話内容</span>
                                                <textarea
                                                    value={logForm.body}
                                                    onChange={(event) =>
                                                        setLogForm((current) => ({
                                                            ...current,
                                                            body: event.target.value,
                                                        }))
                                                    }
                                                    placeholder="誰が何を言い、今どこまで進んだかを記録"
                                                    rows={5}
                                                />
                                            </label>
                                        </div>

                                        <div className={styles.cardActions}>
                                            <button
                                                type="button"
                                                className={styles.primaryButton}
                                                onClick={handleAddLog}
                                                disabled={savingLog}
                                            >
                                                <SendHorizontal size={16} />
                                                {savingLog ? "追加中..." : "ログを追加"}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            )}
                        </>
                    )}
                </section>

                <aside className={styles.sidebarPane}>
                    {!detail && !showComposer && (
                        <div className={styles.emptyPane}>
                            <Users size={36} />
                            <strong>会話メタデータ</strong>
                            <span>選択した会話の AI要約、担当、次アクションをここで管理します。</span>
                        </div>
                    )}

                    {detail && conversationForm && (
                        <>
                            <section className={styles.sidebarCard}>
                                <div className={styles.sidebarTitleRow}>
                                    <Bot size={16} />
                                    <h3>AI要約</h3>
                                </div>
                                <p className={styles.summaryHeadline}>
                                    {detail.conversation.ai_summary || "AI要約はまだありません。"}
                                </p>
                                <div className={styles.inlineMeta}>
                                    <span>優先度: {getPriorityLabel(detail.conversation.ai_priority)}</span>
                                    <span>最新チャネル: {CHANNEL_LABELS[detail.conversation.last_channel]}</span>
                                </div>
                            </section>

                            <section className={styles.sidebarCard}>
                                <div className={styles.sidebarTitleRow}>
                                    <ClipboardList size={16} />
                                    <h3>担当と次アクション</h3>
                                </div>

                                <div className={styles.sidebarForm}>
                                    <label className={styles.field}>
                                        <span>会話タイトル</span>
                                        <input
                                            value={conversationForm.title}
                                            onChange={(event) =>
                                                setConversationForm((current) =>
                                                    current
                                                        ? { ...current, title: event.target.value }
                                                        : current
                                                )
                                            }
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span>状態</span>
                                        <select
                                            value={conversationForm.status}
                                            onChange={(event) =>
                                                setConversationForm((current) =>
                                                    current
                                                        ? {
                                                              ...current,
                                                              status: event.target
                                                                  .value as CommunicationConversationStatus,
                                                          }
                                                        : current
                                                )
                                            }
                                        >
                                            {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                                <option key={value} value={value}>
                                                    {label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className={styles.field}>
                                        <span>担当</span>
                                        <select
                                            value={conversationForm.assignee_user_id}
                                            onChange={(event) =>
                                                setConversationForm((current) =>
                                                    current
                                                        ? {
                                                              ...current,
                                                              assignee_user_id: event.target.value,
                                                          }
                                                        : current
                                                )
                                            }
                                        >
                                            <option value="">未設定</option>
                                            {members.map((member) => (
                                                <option key={member.id} value={member.id}>
                                                    {member.full_name || member.username || member.id}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className={styles.field}>
                                        <span>関連現場</span>
                                        <select
                                            value={conversationForm.site_id}
                                            onChange={(event) =>
                                                setConversationForm((current) =>
                                                    current
                                                        ? { ...current, site_id: event.target.value }
                                                        : current
                                                )
                                            }
                                        >
                                            <option value="">未設定</option>
                                            {sites.map((site) => (
                                                <option key={site.id} value={site.id}>
                                                    {site.name}
                                                </option>
                                            ))}
                                        </select>
                                    </label>

                                    <label className={`${styles.field} ${styles.fieldFull}`}>
                                        <span>次アクション</span>
                                        <textarea
                                            value={conversationForm.next_action}
                                            onChange={(event) =>
                                                setConversationForm((current) =>
                                                    current
                                                        ? { ...current, next_action: event.target.value }
                                                        : current
                                                )
                                            }
                                            rows={3}
                                            placeholder="次に誰が何をするか"
                                        />
                                    </label>

                                    <label className={styles.field}>
                                        <span>期限</span>
                                        <input
                                            type="date"
                                            value={conversationForm.next_action_due_date}
                                            onChange={(event) =>
                                                setConversationForm((current) =>
                                                    current
                                                        ? {
                                                              ...current,
                                                              next_action_due_date: event.target.value,
                                                          }
                                                        : current
                                                )
                                            }
                                        />
                                    </label>
                                </div>

                                <div className={styles.cardActions}>
                                    <button
                                        type="button"
                                        className={styles.primaryButton}
                                        onClick={handleSaveConversation}
                                        disabled={savingMeta}
                                    >
                                        {savingMeta ? "保存中..." : "右パネルの内容を保存"}
                                    </button>
                                </div>
                            </section>

                            <section className={styles.sidebarCard}>
                                <div className={styles.sidebarTitleRow}>
                                    <Users size={16} />
                                    <h3>参加者</h3>
                                </div>

                                <div className={styles.participantList}>
                                    {detail.participants.length === 0 && (
                                        <p className={styles.smallMuted}>参加者はまだ登録されていません。</p>
                                    )}
                                    {detail.participants.map((participant) => (
                                        <div key={participant.id} className={styles.participantRow}>
                                            <div>
                                                <strong>{participant.display_name}</strong>
                                                <p>
                                                    {participant.participant_kind}
                                                    {participant.is_primary ? " ・ primary" : ""}
                                                </p>
                                            </div>
                                            <div className={styles.participantMeta}>
                                                {participant.email && <span>{participant.email}</span>}
                                                {participant.phone && <span>{participant.phone}</span>}
                                                {participant.profile && <span>{participant.profile.name}</span>}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section className={styles.sidebarCard}>
                                <div className={styles.sidebarTitleRow}>
                                    <MapPinned size={16} />
                                    <h3>関連情報</h3>
                                </div>

                                <div className={styles.infoList}>
                                    <div className={styles.infoRow}>
                                        <Mail size={14} />
                                        <span>{detail.conversation.client_email || "メールアドレス未設定"}</span>
                                    </div>
                                    <div className={styles.infoRow}>
                                        <UserCircle2 size={14} />
                                        <span>{detail.conversation.assignee?.name || "担当未設定"}</span>
                                    </div>
                                    <div className={styles.infoRow}>
                                        <CalendarClock size={14} />
                                        <span>
                                            期限 {formatDateOnly(detail.conversation.next_action_due_date)}
                                        </span>
                                    </div>
                                    <div className={styles.infoRow}>
                                        {detail.conversation.last_channel === "phone" ? (
                                            <Phone size={14} />
                                        ) : (
                                            <MessageSquare size={14} />
                                        )}
                                        <span>
                                            最終チャネル {CHANNEL_LABELS[detail.conversation.last_channel]}
                                        </span>
                                    </div>
                                    <div className={styles.infoRow}>
                                        <MapPinned size={14} />
                                        <span>{detail.conversation.site?.name || "現場未設定"}</span>
                                    </div>
                                </div>
                            </section>

                            <section className={styles.sidebarCard}>
                                <div className={styles.sidebarTitleRow}>
                                    <ClipboardList size={16} />
                                    <h3>関連Proposal</h3>
                                </div>

                                <div className={styles.proposalList}>
                                    {detail.related_proposals.length === 0 && (
                                        <p className={styles.smallMuted}>
                                            まだ Proposal は紐づいていません。Gmail 取込時は自動でここに接続されます。
                                        </p>
                                    )}
                                    {detail.related_proposals.map((proposal) => (
                                        <button
                                            key={proposal.id}
                                            type="button"
                                            className={styles.proposalCard}
                                            onClick={() => setSelectedProposal(proposal)}
                                        >
                                            <div className={styles.proposalCardHeader}>
                                                <strong>{proposal.type}</strong>
                                                <span>{getProposalStatusLabel(proposal.status)}</span>
                                            </div>
                                            <p>{proposal.description}</p>
                                        </button>
                                    ))}
                                </div>
                            </section>
                        </>
                    )}
                </aside>
            </div>

            <AnimatePresence>
                {selectedProposal && (
                    <ProposalDetailModal
                        proposal={selectedProposal}
                        onClose={() => setSelectedProposal(null)}
                        onApprove={(proposalId, reason) =>
                            handleProposalMutation(proposalId, "approve", reason)
                        }
                        onReject={(proposalId, reason) =>
                            handleProposalMutation(proposalId, "reject", reason)
                        }
                        onInstruct={(proposalId, instruction) =>
                            handleProposalMutation(proposalId, "instruct", instruction)
                        }
                        onExecute={(proposalId) => handleProposalMutation(proposalId, "execute")}
                        isActing={proposalActing}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
