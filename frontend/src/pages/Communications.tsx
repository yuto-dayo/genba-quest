import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useSearchParams } from "react-router-dom";
import {
    AlertCircle,
    ArrowRight,
    Bot,
    ChevronRight,
    ClipboardPaste,
    Edit3,
    HardHat,
    Mail,
    MapPinned,
    MessageSquare,
    MoreHorizontal,
    Phone,
    Plus,
    RefreshCw,
    ScanLine,
    Search,
    SendHorizontal,
    Sparkles,
    UserCircle2,
    Users,
} from "lucide-react";
import {
    addCommunicationLog,
    approveProposal,
    createCommunicationConversation,
    executeProposal,
    fetchClients,
    fetchCommunicationContactDetail,
    fetchCommunicationContacts,
    instructProposal,
    rejectProposal,
    restoreClient,
    type Client,
    type CommunicationChannel,
    type CommunicationConversationStatus,
    type CommunicationContactRiskFlag,
    type CommunicationContactRecentLogRecord,
    type CommunicationContactStatus,
    type CommunicationContactStatusDetail,
    type CommunicationContactStatusRecord,
    type CreateClientRequest,
    type ProposalRecord,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { ClientSettingsModal } from "../components/ClientSettingsModal";
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

type MobileContactView = "talk" | "client";
type ClientDirectoryFilter = "all" | "active" | "candidate" | "deleted";
type ClientDirectoryItemKind = "active" | "candidate" | "deleted";

interface ClientDirectoryItem {
    key: string;
    kind: ClientDirectoryItemKind;
    name: string;
    subtitle: string;
    companyName?: string | null;
    personName?: string | null;
    statusLabel: string;
    client?: Client;
    contact?: CommunicationContactStatusRecord;
    initialClient?: Partial<CreateClientRequest>;
}

interface RecordSavedResult {
    contactKey: string | null;
    conversationId: string | null;
}

const CLIENT_DIRECTORY_FILTERS: Array<{ value: ClientDirectoryFilter; label: string }> = [
    { value: "all", label: "すべて" },
    { value: "active", label: "登録済み" },
    { value: "candidate", label: "登録候補" },
    { value: "deleted", label: "削除済み" },
];

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
    gmail: "Gmail",
    phone: "電話",
    line: "LINE",
    in_person: "対面",
    sms: "SMS",
    manual: "手動",
    system: "更新",
};

type CommunicationEvidenceType = "external_original" | "team_sent_copy" | "oral_note" | "user_entered_note";
type CommunicationEntryMode = "message" | "customer_paste" | "team_paste" | "phone_note" | "site_conversation";
type ChatComposeMode = "message" | "phone_note" | "site_conversation";
type ChatComposeSpeaker = "client" | "team";

const CHAT_COMPOSE_ACTIONS: Array<{
    mode: ChatComposeMode;
    label: string;
    ariaLabel: string;
    icon: typeof MessageSquare;
}> = [
    { mode: "message", label: "メッセージ", ariaLabel: "メッセージとして記録", icon: MessageSquare },
    { mode: "phone_note", label: "電話", ariaLabel: "電話として記録", icon: Phone },
    { mode: "site_conversation", label: "会話", ariaLabel: "会話として記録", icon: HardHat },
];

const CHAT_COMPOSE_SPEAKERS: Array<{ value: ChatComposeSpeaker; label: string; description: string }> = [
    { value: "client", label: "相手", description: "相手の発言として左側に記録" },
    { value: "team", label: "自分", description: "こちらの発言として右側に記録" },
];

function getComposeChannel(mode: ChatComposeMode, fallback?: CommunicationChannel | null): Exclude<CommunicationChannel, "system"> {
    if (mode === "phone_note") {
        return "phone";
    }
    if (mode === "site_conversation") {
        return "in_person";
    }
    if (fallback && fallback !== "system") {
        return fallback;
    }
    return "line";
}

function getStringMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
    const value = metadata?.[key];
    return typeof value === "string" ? value : null;
}

function getEvidenceType(log: CommunicationContactRecentLogRecord): CommunicationEvidenceType {
    const value = getStringMetadata(log.metadata, "evidence_type");
    if (value === "external_original" || value === "team_sent_copy" || value === "oral_note" || value === "user_entered_note") {
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
        value === "message" ||
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
    if (entryMode === "message") {
        return "メッセージ";
    }
    if (entryMode === "site_conversation") {
        return "会話";
    }
    if (entryMode === "phone_note") {
        return "電話";
    }
    const evidenceType = getEvidenceType(log);
    if (evidenceType === "team_sent_copy") {
        return "送信文";
    }
    if (evidenceType === "oral_note") {
        return log.channel === "in_person" ? "会話" : "電話";
    }
    if (evidenceType === "user_entered_note") {
        return "メッセージ";
    }
    return "メッセージ";
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

function formatTalkListTime(value?: string | null): string {
    if (!value) {
        return "";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString("ja-JP", {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    if (date.toDateString() === yesterday.toDateString()) {
        return "昨日";
    }

    return date.toLocaleDateString("ja-JP", {
        month: "numeric",
        day: "numeric",
    });
}

function normalizeMatchValue(value?: string | null): string {
    return (value || "").trim().toLowerCase();
}

function getInitials(value: string): string {
    return value.trim().slice(0, 2) || "取引";
}

function buildCandidateInitialClient(contact: CommunicationContactStatusRecord): Partial<CreateClientRequest> {
    const hasClientName = Boolean(contact.client_name?.trim());
    const name = contact.client_name?.trim() || contact.contact_name?.trim() || contact.contact_email?.trim() || "取引先未設定";

    return {
        name,
        contact_person: hasClientName ? contact.contact_name?.trim() || undefined : undefined,
        email: contact.contact_email?.trim() || undefined,
    };
}

function buildClientSubtitle(client: Client): string {
    return (
        client.contact_person ||
        client.email ||
        client.phone ||
        client.billing_name ||
        client.address ||
        "請求宛名未設定"
    );
}

function buildClientPersonName(client: Client): string {
    return client.contact_person || client.email || client.name;
}

function buildContactPersonName(contact: CommunicationContactStatusRecord, client?: Client): string {
    return contact.contact_name || contact.contact_email || client?.contact_person || contact.client_name || client?.name || "担当未設定";
}

function buildContactSubtitle(contact: CommunicationContactStatusRecord, client?: Client): string {
    const companyName = contact.client_name || client?.name;
    if (companyName && companyName !== contact.contact_name && companyName !== contact.contact_email) {
        return companyName;
    }
    return contact.contact_email || client?.email || "取引先未設定";
}

function buildClientTalkContactKey(clientId: string): string {
    return `client:${clientId}`;
}

function isClientTalkContactKey(contactKey: string): boolean {
    return contactKey.startsWith("client:");
}

function getClientIdFromTalkContactKey(contactKey: string): string {
    return contactKey.replace(/^client:/, "");
}

function buildClientTalkContact(client: Client): CommunicationContactStatusRecord {
    return {
        contact_key: buildClientTalkContactKey(client.id),
        client_id: client.id,
        client_name: client.name,
        contact_name: client.contact_person || client.email || client.name,
        contact_email: client.email || null,
        owner: null,
        status: "needs_review",
        risk_flags: [],
        waiting_on: "none",
        attention_score: 0,
        status_reason: "まだ会話はありません",
        status_reason_source: "none",
        evidence_excerpt: null,
        latest_activity_at: null,
        last_external_activity_at: null,
        days_since_latest_activity: null,
        last_inbound_at: null,
        last_outbound_at: null,
        days_since_client_response: null,
        next_action: null,
        next_action_due_date: null,
        has_next_action: false,
        relevant_conversation_id: null,
        site: null,
        conversation_count: 0,
        open_conversation_count: 0,
        in_flight_proposal_count: 0,
    };
}

function buildClientTalkDetail(client: Client): CommunicationContactStatusDetail {
    return {
        summary: buildClientTalkContact(client),
        why_now: [],
        related_proposals: [],
        conversations: [],
        recent_logs: [],
        default_conversation_id: null,
    };
}

function buildConversationTitleFromSummary(summary: CommunicationContactStatusRecord): string {
    const person = summary.contact_name || summary.contact_email || "担当未設定";
    const company = summary.client_name;
    if (company && company !== person) {
        return `${person} / ${company}`;
    }
    return person;
}

function buildClientAddress(client: Client): string {
    return client.address || [client.prefecture, client.city, client.address_line1, client.address_line2].filter(Boolean).join("") || "未設定";
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
                    メッセージ、電話、現場会話を担当者ごとの流れで残します。
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
    const displayName = contact.contact_name || contact.contact_email || "担当未設定";
    const initials = displayName.slice(0, 2);
    const previewText = contact.evidence_excerpt || contact.status_reason || contact.next_action || "まだ内容は整理されていません。";

    return (
        <button
            type="button"
            className={`${styles.contactRow} ${selected ? styles.contactRowSelected : ""}`}
            onClick={onSelect}
        >
            <div className={styles.contactRowTop}>
                <span className={styles.contactAvatar} aria-hidden="true">
                    {initials}
                </span>
                <div className={styles.contactIdentity}>
                    <p className={styles.contactCompany}>{contact.client_name || "会社名未設定"}</p>
                    <h3 className={styles.contactName}>{displayName}</h3>
                </div>
                <span className={styles.contactTime}>
                    <span className={styles.contactTimeDesktop}>{formatDateTime(contact.latest_activity_at)}</span>
                    <span className={styles.contactTimeMobile}>{formatTalkListTime(contact.latest_activity_at)}</span>
                </span>
            </div>

            <div className={styles.contactPreviewRow}>
                <p className={styles.reasonText}>{previewText}</p>
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

            <div className={styles.threadMetaGrid}>
                <span>
                    <UserCircle2 size={14} />
                    {contact.owner?.name || "担当未設定"}
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
                    {contact.in_flight_proposal_count > 0 && <span>提案 {contact.in_flight_proposal_count}件</span>}
                </div>
            </div>
        </button>
    );
}

function ClientDirectoryRow({
    item,
    selected,
    onSelect,
}: {
    item: ClientDirectoryItem;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            className={`${styles.clientDirectoryRow} ${selected ? styles.clientDirectoryRowSelected : ""}`}
            onClick={onSelect}
        >
            <span className={styles.clientDirectoryAvatar} data-kind={item.kind} aria-hidden="true">
                {getInitials(item.name)}
            </span>
            <span className={styles.clientDirectoryCopy}>
                <strong>{item.name}</strong>
                <span>{item.subtitle}</span>
            </span>
            <span className={styles.clientDirectoryStatusDot} data-kind={item.kind} aria-label={item.statusLabel} />
        </button>
    );
}

function ClientDetailField({ label, value }: { label: string; value?: string | null }) {
    return (
        <div className={styles.clientDetailField}>
            <span>{label}</span>
            <strong>{value?.trim() || "未設定"}</strong>
        </div>
    );
}

function ClientDirectoryDetail({
    item,
    restoring,
    onEdit,
    onRegister,
    onRestore,
    onClose,
}: {
    item: ClientDirectoryItem | null;
    restoring: boolean;
    onEdit: (client: Client) => void;
    onRegister: (initialClient: Partial<CreateClientRequest>) => void;
    onRestore: (client: Client) => void;
    onClose?: () => void;
}) {
    if (!item) {
        return (
            <section className={styles.clientDetailPanel}>
                <div className={styles.emptyPane}>
                    <UserCircle2 size={36} />
                    <strong>連絡相手を選ぶ</strong>
                    <span>一覧から選ぶと、担当者と取引先情報を確認できます。</span>
                </div>
            </section>
        );
    }

    const client = item.client;
    const initialClient = item.initialClient;
    const contact = item.contact;
    const companyName = client?.name || item.companyName || initialClient?.name;
    const personName = item.personName || contact?.contact_name || client?.contact_person || initialClient?.contact_person;
    const email = contact?.contact_email || client?.email || initialClient?.email;

    return (
        <section className={styles.clientDetailPanel}>
            <div className={styles.clientDetailHeader}>
                <span className={styles.clientDirectoryAvatar} data-kind={item.kind} aria-hidden="true">
                    {getInitials(item.name)}
                </span>
                <div>
                    <span className={styles.clientDetailStatus}>{item.statusLabel}</span>
                    <h2>{item.name}</h2>
                    <p>{item.subtitle}</p>
                </div>
                {onClose && (
                    <button type="button" className={styles.iconButton} onClick={onClose} aria-label="取引先詳細を閉じる">
                        <ChevronRight size={18} />
                    </button>
                )}
            </div>

            <div className={styles.clientDetailActions}>
                {item.kind === "candidate" && initialClient && (
                    <button type="button" className={styles.primaryButton} onClick={() => onRegister(initialClient)}>
                        <Plus size={16} />
                        登録
                    </button>
                )}
                {item.kind !== "candidate" && client && (
                    <>
                        <button type="button" className={styles.primaryButton} onClick={() => onEdit(client)}>
                            <Edit3 size={16} />
                            編集
                        </button>
                        {item.kind === "deleted" ? (
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={() => onRestore(client)}
                                disabled={restoring}
                            >
                                <RefreshCw size={16} />
                                {restoring ? "復元中..." : "復元"}
                            </button>
                        ) : (
                            <button type="button" className={styles.secondaryButton} onClick={() => onEdit(client)}>
                                削除
                            </button>
                        )}
                    </>
                )}
            </div>

            <div className={styles.clientDetailGrid}>
                <ClientDetailField label="取引先名" value={companyName} />
                <ClientDetailField label="担当者" value={personName} />
                <ClientDetailField label="メール" value={email} />
                <ClientDetailField label="電話" value={client?.phone} />
                <ClientDetailField label="住所" value={client ? buildClientAddress(client) : null} />
                <ClientDetailField label="請求宛名" value={client?.billing_name || initialClient?.billing_name || initialClient?.name} />
                <ClientDetailField label="支払条件" value={client?.payment_terms} />
                <ClientDetailField label="請求書備考" value={client?.invoice_notes_default} />
                <ClientDetailField label="登録状態" value={item.statusLabel} />
            </div>
        </section>
    );
}

function CommunicationTimelineLog({ log }: { log: CommunicationContactRecentLogRecord }) {
    const evidenceType = getEvidenceType(log);
    const entryMode = getEntryMode(log);
    const isOutbound = evidenceType === "team_sent_copy" || log.direction === "outbound";
    const isOral = evidenceType === "oral_note" || entryMode === "phone_note" || entryMode === "site_conversation";
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
            {!isOutbound && !isOral && (
                <span className={styles.messageAvatar} aria-hidden="true">
                    相
                </span>
            )}
            <div className={styles.timelineMessageStack}>
                <div className={styles.timelineBubble}>
                    <div className={styles.timelineMeta}>
                        <span className={styles.evidenceBadge}>
                            <Icon size={13} />
                            {getEvidenceLabel(log)}
                        </span>
                        <span>{CHANNEL_LABELS[log.channel]}</span>
                        <span>{formatDateTime(log.occurred_at)}</span>
                    </div>
                    <strong>{log.subject || log.conversation_title}</strong>
                    <p>{log.summary || log.body}</p>
                </div>
                <div className={styles.timelineAudit} aria-label="記録情報">
                    <span>記録 {log.created_by_name || log.created_by_type}</span>
                    <span>{formatDateTime(log.created_at)}</span>
                    <span>{getEvidenceLabel(log)}</span>
                </div>
            </div>
            {isOutbound && (
                <span className={styles.messageAvatar} aria-hidden="true">
                    自
                </span>
            )}
        </article>
    );
}

export function Communications() {
    const [searchParams] = useSearchParams();
    const proposalQuery = searchParams.get("proposal");
    const [contacts, setContacts] = useState<CommunicationContactStatusRecord[]>([]);
    const [clients, setClients] = useState<Client[]>([]);
    const [deletedClients, setDeletedClients] = useState<Client[]>([]);
    const [selectedContactKey, setSelectedContactKey] = useState<string | null>(null);
    const [selectedClientKey, setSelectedClientKey] = useState<string | null>(null);
    const [detail, setDetail] = useState<CommunicationContactStatusDetail | null>(null);
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    const [composeBody, setComposeBody] = useState("");
    const [composeSpeaker, setComposeSpeaker] = useState<ChatComposeSpeaker>("client");
    const [composeError, setComposeError] = useState<string | null>(null);
    const [composeSavingMode, setComposeSavingMode] = useState<ChatComposeMode | null>(null);
    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);
    const [proposalActing, setProposalActing] = useState(false);
    const [mobileContactView, setMobileContactView] = useState<MobileContactView>("talk");
    const [mobileChatOpen, setMobileChatOpen] = useState(false);
    const [clientFilter, setClientFilter] = useState<ClientDirectoryFilter>("all");
    const [clientDirectoryLoading, setClientDirectoryLoading] = useState(true);
    const [clientDirectoryError, setClientDirectoryError] = useState<string | null>(null);
    const [clientModalOpen, setClientModalOpen] = useState(false);
    const [editingClient, setEditingClient] = useState<Client | null>(null);
    const [initialClient, setInitialClient] = useState<Partial<CreateClientRequest> | null>(null);
    const [restoringClientId, setRestoringClientId] = useState<string | null>(null);

    const activeConversation = useMemo(
        () => detail?.conversations.find((conversation) => conversation.id === activeConversationId) || null,
        [activeConversationId, detail],
    );

    const activeClientItems = useMemo<ClientDirectoryItem[]>(() => {
        const clientById = new Map(clients.map((client) => [client.id, client]));
        const seenClientIds = new Set<string>();
        const items: ClientDirectoryItem[] = [];

        contacts.forEach((contact) => {
            if (!contact.client_id) {
                return;
            }
            const client = clientById.get(contact.client_id);
            seenClientIds.add(contact.client_id);
            const personName = buildContactPersonName(contact, client);
            items.push({
                key: `active-contact:${contact.contact_key}`,
                kind: "active",
                name: personName,
                subtitle: buildContactSubtitle(contact, client),
                companyName: contact.client_name || client?.name || null,
                personName,
                statusLabel: "登録済み",
                client,
                contact,
            });
        });

        clients.forEach((client) => {
            if (seenClientIds.has(client.id)) {
                return;
            }
            const personName = buildClientPersonName(client);
            items.push({
                key: `active-client:${client.id}`,
                kind: "active",
                name: personName,
                subtitle: client.contact_person ? client.name : buildClientSubtitle(client),
                companyName: client.name,
                personName: client.contact_person || null,
                statusLabel: "登録済み",
                client,
            });
        });

        return items;
    }, [clients, contacts]);
    const talkContacts = useMemo<CommunicationContactStatusRecord[]>(() => {
        const representedClientIds = new Set(contacts.map((contact) => contact.client_id).filter(Boolean));
        const representedEmails = new Set(contacts.map((contact) => normalizeMatchValue(contact.contact_email)).filter(Boolean));
        const representedNames = new Set(
            contacts
                .flatMap((contact) => [contact.contact_name, contact.client_name])
                .map((value) => normalizeMatchValue(value))
                .filter(Boolean),
        );
        const clientContacts = clients
            .filter((client) => {
                if (representedClientIds.has(client.id)) {
                    return false;
                }
                const email = normalizeMatchValue(client.email);
                if (email && representedEmails.has(email)) {
                    return false;
                }
                const person = normalizeMatchValue(client.contact_person);
                const name = normalizeMatchValue(client.name);
                return !(person && representedNames.has(person)) && !(name && representedNames.has(name));
            })
            .map(buildClientTalkContact);

        return [...contacts, ...clientContacts];
    }, [clients, contacts]);
    const deletedClientItems = useMemo<ClientDirectoryItem[]>(
        () =>
            deletedClients.map((client) => ({
                key: `deleted:${client.id}`,
                kind: "deleted",
                name: client.name,
                subtitle: client.deletion_reason || buildClientSubtitle(client),
                companyName: client.name,
                personName: client.contact_person || null,
                statusLabel: "削除済み",
                client,
            })),
        [deletedClients],
    );
    const candidateClientItems = useMemo<ClientDirectoryItem[]>(() => {
        const knownClientValues = new Set<string>();
        clients.forEach((client) => {
            [client.name, client.email, client.contact_person]
                .map((value) => normalizeMatchValue(value))
                .filter(Boolean)
                .forEach((value) => knownClientValues.add(value));
        });

        const seenCandidates = new Set<string>();
        const items: ClientDirectoryItem[] = [];
        contacts.forEach((contact) => {
            if (contact.client_id) {
                return;
            }
            const initial = buildCandidateInitialClient(contact);
            const candidateValues = [initial.name, initial.email, initial.contact_person]
                .map((value) => normalizeMatchValue(value))
                .filter(Boolean);
            const matchesKnownClient = candidateValues.some((value) => knownClientValues.has(value));
            if (matchesKnownClient) {
                return;
            }
            const candidateKey = candidateValues.join(":") || contact.contact_key;
            if (seenCandidates.has(candidateKey)) {
                return;
            }
            seenCandidates.add(candidateKey);
            const companyName = contact.client_name?.trim() || initial.name || null;
            const personName = contact.contact_name?.trim() || contact.contact_email?.trim() || initial.contact_person || initial.name || "担当未設定";
            items.push({
                key: `candidate:${contact.contact_key}`,
                kind: "candidate",
                name: personName,
                subtitle: contact.client_name || contact.contact_email || "登録候補",
                companyName,
                personName,
                statusLabel: "登録候補",
                contact,
                initialClient: initial,
            });
        });
        return items;
    }, [clients, contacts]);
    const clientDirectoryItems = useMemo(() => {
        if (clientFilter === "active") {
            return activeClientItems;
        }
        if (clientFilter === "candidate") {
            return candidateClientItems;
        }
        if (clientFilter === "deleted") {
            return deletedClientItems;
        }
        return [...activeClientItems, ...candidateClientItems];
    }, [activeClientItems, candidateClientItems, clientFilter, deletedClientItems]);
    const selectedClientItem = useMemo(() => {
        const allItems = [...activeClientItems, ...candidateClientItems, ...deletedClientItems];
        return allItems.find((item) => item.key === selectedClientKey) || null;
    }, [activeClientItems, candidateClientItems, deletedClientItems, selectedClientKey]);

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
            setSelectedContactKey((current) => {
                const candidate = keepSelectedKey ?? current;
                if (candidate && response.items.some((item) => item.contact_key === candidate)) {
                    return candidate;
                }
                return response.items[0]?.contact_key || null;
            });
        } catch (requestError: unknown) {
            setContacts([]);
            setSelectedContactKey(null);
            setError(getErrorMessage(requestError));
        } finally {
            setLoading(false);
        }
    }, []);

    const refreshClientDirectory = useCallback(async () => {
        try {
            setClientDirectoryLoading(true);
            setClientDirectoryError(null);
            const [activeClients, nextDeletedClients] = await Promise.all([
                fetchClients(),
                fetchClients({ status: "deleted" }),
            ]);
            setClients(activeClients);
            setDeletedClients(nextDeletedClients);
        } catch (requestError: unknown) {
            setClientDirectoryError(getErrorMessage(requestError));
        } finally {
            setClientDirectoryLoading(false);
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
        void refreshClientDirectory();
    }, [refreshClientDirectory]);

    useEffect(() => {
        setSelectedContactKey((current) => {
            if (current && talkContacts.some((contact) => contact.contact_key === current)) {
                return current;
            }
            return talkContacts[0]?.contact_key || null;
        });
    }, [talkContacts]);

    useEffect(() => {
        if (!selectedContactKey) {
            setDetail(null);
            setActiveConversationId(null);
            setMobileChatOpen(false);
            return;
        }
        if (isClientTalkContactKey(selectedContactKey)) {
            const client = clients.find((candidate) => candidate.id === getClientIdFromTalkContactKey(selectedContactKey));
            if (!client) {
                setDetail(null);
                setActiveConversationId(null);
                return;
            }
            setDetail(buildClientTalkDetail(client));
            setActiveConversationId(null);
            setDetailError(null);
            setDetailLoading(false);
            return;
        }
        void loadDetail(selectedContactKey);
    }, [clients, loadDetail, selectedContactKey]);

    useEffect(() => {
        setComposeBody("");
        setComposeError(null);
    }, [activeConversationId]);

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
        await Promise.all([refreshContacts(selectedContactKey), refreshClientDirectory()]);
        if (selectedContactKey && !isClientTalkContactKey(selectedContactKey)) {
            await loadDetail(selectedContactKey);
        }
    }

    const handleRecordSaved = useCallback(
        async ({ contactKey, conversationId }: RecordSavedResult) => {
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

    const handleInlineRecord = useCallback(
        async (mode: ChatComposeMode) => {
            if (!detail) {
                setComposeError("先に相手を選んでください。");
                return;
            }

            const body = composeBody.trim();
            if (!body) {
                setComposeError("記録する内容を入力してください。");
                return;
            }

            try {
                setComposeSavingMode(mode);
                setComposeError(null);
                const channel = getComposeChannel(mode, activeConversation?.last_channel);
                const direction = composeSpeaker === "team" ? "outbound" : "inbound";
                const logKind = mode === "message" ? "message" : "note";
                const metadata = {
                    entry_mode: mode,
                    speaker_role: composeSpeaker,
                    speaker_label: composeSpeaker === "team" ? "自分" : "相手",
                    capture_method: "typed_allowed",
                    evidence_type: "user_entered_note",
                    original_locked: false,
                    recorded_ui_version: "messenger_chat_v2",
                };

                if (!activeConversation) {
                    const created = await createCommunicationConversation({
                        title: buildConversationTitleFromSummary(detail.summary),
                        channel,
                        direction,
                        body,
                        participant_name: detail.summary.contact_name || detail.summary.client_name || null,
                        participant_email: detail.summary.contact_email || null,
                        log_kind: logKind,
                        metadata,
                    });
                    setComposeBody("");
                    await handleRecordSaved({
                        contactKey: detail.summary.contact_email || detail.summary.contact_key,
                        conversationId: created.conversation.id,
                    });
                    return;
                }

                await addCommunicationLog(activeConversation.id, {
                    channel,
                    direction: composeSpeaker === "team" ? "outbound" : "inbound",
                    body,
                    participant_name: detail?.summary.contact_name || null,
                    participant_email: detail?.summary.contact_email || null,
                    log_kind: logKind,
                    metadata,
                });
                setComposeBody("");
                await handleRecordSaved({
                    contactKey: detail?.summary.contact_key || selectedContactKey,
                    conversationId: activeConversation.id,
                });
            } catch (requestError: unknown) {
                setComposeError(getErrorMessage(requestError));
            } finally {
                setComposeSavingMode(null);
            }
        },
        [activeConversation, composeBody, composeSpeaker, detail, handleRecordSaved, selectedContactKey],
    );

    const openClientEditor = useCallback((client: Client) => {
        setEditingClient(client);
        setInitialClient(null);
        setClientModalOpen(true);
    }, []);

    const openClientCreator = useCallback((seed?: Partial<CreateClientRequest>) => {
        setEditingClient(null);
        setInitialClient(seed || null);
        setClientModalOpen(true);
    }, []);

    const closeClientModal = useCallback(() => {
        setClientModalOpen(false);
        setEditingClient(null);
        setInitialClient(null);
    }, []);

    const handleClientSaved = useCallback(
        async (savedClient: Client) => {
            setClientFilter("active");
            setSelectedClientKey(`active:${savedClient.id}`);
            await Promise.all([refreshClientDirectory(), refreshContacts(selectedContactKey)]);
            closeClientModal();
        },
        [closeClientModal, refreshClientDirectory, refreshContacts, selectedContactKey],
    );

    const handleClientDeleted = useCallback(
        async (clientId: string) => {
            setClientFilter("deleted");
            setSelectedClientKey(`deleted:${clientId}`);
            await Promise.all([refreshClientDirectory(), refreshContacts(selectedContactKey)]);
            closeClientModal();
        },
        [closeClientModal, refreshClientDirectory, refreshContacts, selectedContactKey],
    );

    const handleRestoreClient = useCallback(
        async (client: Client) => {
            try {
                setRestoringClientId(client.id);
                setClientDirectoryError(null);
                await restoreClient(client.id);
                setClientFilter("active");
                setSelectedClientKey(`active:${client.id}`);
                await Promise.all([refreshClientDirectory(), refreshContacts(selectedContactKey)]);
            } catch (requestError: unknown) {
                setClientDirectoryError(getErrorMessage(requestError));
            } finally {
                setRestoringClientId(null);
            }
        },
        [refreshClientDirectory, refreshContacts, selectedContactKey],
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
            <BoardHeader totalCount={talkContacts.length} onRefresh={handleRefresh} refreshing={loading || detailLoading} />

            {error && (
                <div className={styles.errorBanner}>
                    <AlertCircle size={14} />
                    {error}
                </div>
            )}

                    <div className={styles.boardLayout}>
                        <section className={styles.boardPane} aria-label="連絡先一覧">
                            <div className={styles.paneHeader}>
                                <div>
                                    <span>{mobileContactView === "client" ? "取引先" : "スレッド"}</span>
                                    <strong>{mobileContactView === "client" ? `${clientDirectoryItems.length}件` : `${talkContacts.length}件`}</strong>
                                </div>
                                <div className={styles.paneHeaderActions}>
                                    <div className={styles.desktopViewSwitch} role="tablist" aria-label="連絡の表示切替">
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={mobileContactView === "talk"}
                                            className={`${styles.desktopViewSwitchButton} ${
                                                mobileContactView === "talk" ? styles.desktopViewSwitchButtonActive : ""
                                            }`}
                                            onClick={() => {
                                                setMobileContactView("talk");
                                                setMobileChatOpen(false);
                                            }}
                                        >
                                            トーク
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={mobileContactView === "client"}
                                            className={`${styles.desktopViewSwitchButton} ${
                                                mobileContactView === "client" ? styles.desktopViewSwitchButtonActive : ""
                                            }`}
                                            onClick={() => {
                                                setMobileContactView("client");
                                                setMobileChatOpen(false);
                                            }}
                                        >
                                            取引先
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        className={styles.iconButton}
                                        onClick={() => openClientCreator()}
                                        aria-label={mobileContactView === "client" ? "取引先を追加" : "連絡相手を追加"}
                                    >
                                        <Plus size={18} />
                                    </button>
                                </div>
                            </div>
                            <div className={styles.mobileTalkHeader}>
                                <div className={styles.mobileTalkTop}>
                                    <div className={styles.mobileViewSwitch} role="tablist" aria-label="連絡の表示切替">
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={mobileContactView === "talk"}
                                            className={`${styles.mobileViewSwitchButton} ${
                                                mobileContactView === "talk" ? styles.mobileViewSwitchButtonActive : ""
                                            }`}
                                            onClick={() => {
                                                setMobileContactView("talk");
                                                setMobileChatOpen(false);
                                            }}
                                        >
                                            トーク
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={mobileContactView === "client"}
                                            className={`${styles.mobileViewSwitchButton} ${
                                                mobileContactView === "client" ? styles.mobileViewSwitchButtonActive : ""
                                            }`}
                                            onClick={() => {
                                                setMobileContactView("client");
                                                setMobileChatOpen(false);
                                            }}
                                        >
                                            取引先
                                        </button>
                                    </div>
                                    <div className={styles.mobileTalkActions}>
                                        <button
                                            type="button"
                                            className={styles.mobileTalkActionButton}
                                            onClick={() => openClientCreator()}
                                            aria-label={mobileContactView === "client" ? "取引先を追加" : "連絡相手を追加"}
                                        >
                                            <Plus size={25} />
                                        </button>
                                    </div>
                                </div>
                                {mobileContactView === "client" ? (
                                    <div className={styles.clientCategoryRail} aria-label="取引先カテゴリ">
                                        {CLIENT_DIRECTORY_FILTERS.map((filter) => (
                                            <button
                                                key={filter.value}
                                                type="button"
                                                className={`${styles.clientCategoryChip} ${
                                                    clientFilter === filter.value ? styles.clientCategoryChipActive : ""
                                                }`}
                                                onClick={() => setClientFilter(filter.value)}
                                            >
                                                {filter.label}
                                            </button>
                                        ))}
                                    </div>
                                ) : (
                                    <>
                                        <div className={styles.mobileSearchBar}>
                                            <Search size={18} />
                                            <span>検索</span>
                                            <ScanLine size={18} />
                                        </div>
                                    </>
                                )}
                            </div>
                            {mobileContactView === "client" ? (
                                <>
                                    {clientDirectoryError && (
                                        <div className={styles.errorBanner}>
                                            <AlertCircle size={14} />
                                            {clientDirectoryError}
                                        </div>
                                    )}
                                    {clientDirectoryLoading ? (
                                        <p className={styles.panelState}>取引先を読み込み中...</p>
                                    ) : clientDirectoryItems.length === 0 ? (
                                        <div className={styles.emptyPane}>
                                            <UserCircle2 size={36} />
                                            <strong>連絡相手がありません</strong>
                                            <span>追加すると、担当者ごとに連絡先を確認できます。</span>
                                            <button
                                                type="button"
                                                className={styles.primaryButton}
                                                onClick={() => openClientCreator()}
                                            >
                                                <Plus size={16} />
                                                取引先を追加
                                            </button>
                                        </div>
                                    ) : (
                                        <div className={styles.clientDirectoryList}>
                                            {clientDirectoryItems.map((item) => (
                                                <ClientDirectoryRow
                                                    key={item.key}
                                                    item={item}
                                                    selected={item.key === selectedClientKey}
                                                    onSelect={() => setSelectedClientKey(item.key)}
                                                />
                                            ))}
                                        </div>
                                    )}
                                    <AnimatePresence>
                                        {selectedClientItem && (
                                            <motion.div
                                                className={styles.clientDetailMobileOverlay}
                                                initial={{ opacity: 0, y: 16 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                exit={{ opacity: 0, y: 16 }}
                                            >
                                                <ClientDirectoryDetail
                                                    item={selectedClientItem}
                                                    restoring={restoringClientId === selectedClientItem.client?.id}
                                                    onEdit={openClientEditor}
                                                    onRegister={openClientCreator}
                                                    onRestore={handleRestoreClient}
                                                    onClose={() => setSelectedClientKey(null)}
                                                />
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </>
                            ) : loading ? (
                                <p className={styles.panelState}>連絡を読み込み中...</p>
                            ) : talkContacts.length === 0 ? (
                                null
                            ) : (
                                <>
                                    <div className={styles.contactList}>
                                        {talkContacts.map((contact) => (
                                            <CommunicationContactRow
                                                key={contact.contact_key}
                                                contact={contact}
                                                selected={contact.contact_key === selectedContactKey}
                                                onSelect={() => {
                                                    setSelectedContactKey(contact.contact_key);
                                                    setMobileChatOpen(true);
                                                }}
                                            />
                                        ))}
                                    </div>
                                </>
                            )}
                        </section>

                        <main className={`${styles.chatPane} ${mobileContactView === "talk" && mobileChatOpen ? styles.chatPaneMobileOpen : ""}`}>
                            {mobileContactView === "client" ? (
                                <ClientDirectoryDetail
                                    item={selectedClientItem}
                                    restoring={restoringClientId === selectedClientItem?.client?.id}
                                    onEdit={openClientEditor}
                                    onRegister={openClientCreator}
                                    onRestore={handleRestoreClient}
                                />
                            ) : (
                                <>
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
                                    <span>一覧から選ぶと、会話の流れを確認できます。</span>
                                </div>
                            )}

                            {detail && (
                                <>
                                    <section className={styles.chatHeaderBar}>
                                        <div className={styles.chatHeaderIdentity}>
                                            <button
                                                type="button"
                                                className={styles.mobileChatBackButton}
                                                onClick={() => setMobileChatOpen(false)}
                                                aria-label="連絡一覧に戻る"
                                            >
                                                <ChevronRight size={22} />
                                            </button>
                                            <span className={styles.chatAvatar} aria-hidden="true">
                                                {(detail.summary.contact_name || detail.summary.contact_email || "相手").slice(0, 2)}
                                            </span>
                                            <div>
                                                <p className={styles.contactCompany}>{detail.summary.client_name || "会社名未設定"}</p>
                                                <h2>{detail.summary.contact_name || detail.summary.contact_email || "担当未設定"}</h2>
                                                <span>
                                                    {detail.summary.site?.name || "現場未設定"} / {detail.summary.owner?.name || "担当未設定"}
                                                </span>
                                            </div>
                                        </div>
                                        <div className={styles.chatHeaderActions}>
                                            <span className={styles.statusPill}>{BOARD_STATUS_LABELS[detail.summary.status]}</span>
                                            <button type="button" className={styles.iconButton} aria-label="会話メニュー">
                                                <MoreHorizontal size={18} />
                                            </button>
                                        </div>
                                    </section>

                                    <section className={styles.nextActionStrip} aria-label="次アクション">
                                        <div>
                                            <span>次</span>
                                            <strong>{detail.summary.next_action || "未設定"}</strong>
                                        </div>
                                        <div>
                                            <span>期限</span>
                                            <strong>{formatDateOnly(detail.summary.next_action_due_date)}</strong>
                                        </div>
                                        <div>
                                            <span>最終接点</span>
                                            <strong>{formatDateTime(detail.summary.latest_activity_at)}</strong>
                                        </div>
                                    </section>

                                    <section className={styles.messageThread} aria-label="証跡タイムライン">
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

                                    <div className={styles.composeBar} aria-label="会話入力">
                                        <div className={styles.composeSpeakerRow}>
                                            <span>発言者</span>
                                            <div className={styles.composeSpeakerSwitch} role="radiogroup" aria-label="発言者">
                                                {CHAT_COMPOSE_SPEAKERS.map((speaker) => (
                                                    <button
                                                        key={speaker.value}
                                                        type="button"
                                                        role="radio"
                                                        aria-checked={composeSpeaker === speaker.value}
                                                        className={`${styles.composeSpeakerButton} ${
                                                            composeSpeaker === speaker.value ? styles.composeSpeakerButtonActive : ""
                                                        }`}
                                                        onClick={() => setComposeSpeaker(speaker.value)}
                                                        title={speaker.description}
                                                    >
                                                        {speaker.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <textarea
                                            className={styles.composeTextarea}
                                            value={composeBody}
                                            onChange={(event) => {
                                                setComposeBody(event.target.value);
                                                if (composeError) {
                                                    setComposeError(null);
                                                }
                                            }}
                                            placeholder={composeSpeaker === "team" ? "自分の発言を入力" : "相手の発言を入力"}
                                            rows={2}
                                        />
                                        <div className={styles.composeActions}>
                                            {CHAT_COMPOSE_ACTIONS.map((action) => {
                                                const Icon = action.icon;
                                                const saving = composeSavingMode === action.mode;
                                                return (
                                                    <button
                                                        key={action.mode}
                                                        type="button"
                                                        className={styles.composeSendButton}
                                                        onClick={() => void handleInlineRecord(action.mode)}
                                                        disabled={composeSavingMode !== null || !detail}
                                                        aria-label={action.ariaLabel}
                                                    >
                                                        <Icon size={16} />
                                                        {saving ? "保存中" : action.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                        {composeError && (
                                            <p className={styles.composeError} role="alert">
                                                {composeError}
                                            </p>
                                        )}
                                    </div>
                                </>
                            )}
                                </>
                            )}
                        </main>

                        <aside className={styles.detailPane}>
                            {mobileContactView !== "client" && detail && (
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

            <AnimatePresence>
                {clientModalOpen && (
                    <ClientSettingsModal
                        client={editingClient}
                        initialClient={initialClient}
                        onClose={closeClientModal}
                        onSaved={handleClientSaved}
                        onDeleted={handleClientDeleted}
                    />
                )}
            </AnimatePresence>
        </div>
    );
}
