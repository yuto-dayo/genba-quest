import { supabaseAdmin } from "../lib/supabaseAdmin";

type ConversationStatus = "active" | "waiting_internal" | "waiting_client" | "resolved";
type CommunicationChannel = "gmail" | "phone" | "line" | "in_person" | "sms" | "manual" | "system";
type CommunicationDirection = "inbound" | "outbound" | "internal";
type CommunicationLogKind =
  | "message"
  | "note"
  | "status_change"
  | "assignment_change"
  | "summary_update"
  | "proposal_link";
type ProposalStatus = "draft" | "pending" | "approved" | "rejected" | "executed";

export type CommunicationContactStatus =
  | "overdue"
  | "waiting_internal"
  | "waiting_client"
  | "resolved"
  | "needs_review";
export type CommunicationContactRiskFlag =
  | "overdue_next_action"
  | "no_next_action"
  | "stale_7d"
  | "pending_proposal_stale"
  | "no_owner";
export type CommunicationWaitingOn = "internal" | "client" | "none";
export type CommunicationStatusReasonSource = "next_action" | "ai_summary" | "last_message_preview" | "none";
export type CommunicationContactSort = "attention" | "latest_activity";

interface ConversationRow {
  id: string;
  org_id: string;
  title: string;
  status: ConversationStatus;
  source_channel: CommunicationChannel;
  last_channel: CommunicationChannel;
  assignee_user_id: string | null;
  site_id: string | null;
  site_name_snapshot: string | null;
  client_name_snapshot: string | null;
  client_email_snapshot: string | null;
  ai_summary: string | null;
  ai_priority: string | null;
  next_action: string | null;
  next_action_due_date: string | null;
  last_activity_at: string;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

interface CommunicationParticipantRow {
  id: string;
  conversation_id: string;
  participant_kind: "client" | "internal" | "integration";
  display_name: string;
  email: string | null;
  phone: string | null;
  profile_id: string | null;
  is_primary: boolean;
  created_at: string;
}

interface CommunicationLogRow {
  id: string;
  conversation_id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  log_kind: CommunicationLogKind;
  subject: string | null;
  body: string;
  summary: string | null;
  occurred_at: string;
  created_by_type: "human" | "ai" | "system" | "integration";
  created_by_name_snapshot: string | null;
  external_source: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface CommunicationLinkRow {
  conversation_id: string;
  proposal_id: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

interface SiteRow {
  id: string;
  name: string;
  client_id: string | null;
}

interface ProposalRow {
  id: string;
  org_id: string;
  type: string;
  status: ProposalStatus;
  created_by: {
    type: "human" | "ai" | "system" | "integration";
    id: string;
    name: string;
  };
  payload: Record<string, unknown>;
  description: string;
  approvals: Array<{
    actor: { type: string; id: string; name: string };
    decision: "approve" | "reject";
    reason?: string;
    at: string;
  }>;
  required_approvals: number;
  executed_at?: string | null;
  executed_by?: {
    type: "human" | "ai" | "system" | "integration";
    id: string;
    name: string;
  } | null;
  result_event_id?: string | null;
  rejection_reason?: string | null;
  created_at: string;
  updated_at: string;
}

interface ContactConversationRef {
  conversation: ConversationRow;
  participant: CommunicationParticipantRow | null;
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  site: CommunicationSiteSummary | null;
  site_client_id: string | null;
  in_flight_proposal_count: number;
}

export interface CommunicationMemberSummary {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
}

export interface CommunicationSiteSummary {
  id: string;
  name: string;
}

export interface CommunicationConversationSummary {
  id: string;
  title: string;
  status: ConversationStatus;
  source_channel: CommunicationChannel;
  last_channel: CommunicationChannel;
  client_name: string | null;
  client_email: string | null;
  participant_summary: string;
  ai_summary: string | null;
  ai_priority: string | null;
  next_action: string | null;
  next_action_due_date: string | null;
  last_activity_at: string;
  last_message_preview: string | null;
  assignee: CommunicationMemberSummary | null;
  site: CommunicationSiteSummary | null;
  related_proposal_count: number;
  created_at: string;
  updated_at: string;
}

export interface CommunicationContactRecentLogRecord {
  id: string;
  conversation_id: string;
  conversation_title: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  log_kind: CommunicationLogKind;
  subject: string | null;
  body: string;
  summary: string | null;
  occurred_at: string;
  created_by_type: "human" | "ai" | "system" | "integration";
  created_by_name: string | null;
  external_source: string | null;
  external_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface CommunicationContactWhyNowItem {
  code: CommunicationContactRiskFlag | CommunicationContactStatus;
  title: string;
  description: string;
}

export interface CommunicationContactStatusRecord {
  contact_key: string;
  client_name: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner: CommunicationMemberSummary | null;
  status: CommunicationContactStatus;
  risk_flags: CommunicationContactRiskFlag[];
  waiting_on: CommunicationWaitingOn;
  attention_score: number;
  status_reason: string | null;
  status_reason_source: CommunicationStatusReasonSource;
  evidence_excerpt: string | null;
  latest_activity_at: string | null;
  last_external_activity_at: string | null;
  days_since_latest_activity: number | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  days_since_client_response: number | null;
  next_action: string | null;
  next_action_due_date: string | null;
  has_next_action: boolean;
  relevant_conversation_id: string | null;
  site: CommunicationSiteSummary | null;
  conversation_count: number;
  open_conversation_count: number;
  in_flight_proposal_count: number;
}

export interface CommunicationContactStatusDetail {
  summary: CommunicationContactStatusRecord;
  why_now: CommunicationContactWhyNowItem[];
  related_proposals: ProposalRow[];
  conversations: CommunicationConversationSummary[];
  recent_logs: CommunicationContactRecentLogRecord[];
  default_conversation_id: string | null;
}

export interface CommunicationContactListResponse {
  items: CommunicationContactStatusRecord[];
  total_count: number;
}

export interface CommunicationInsightsSummary {
  hygiene: {
    open_contacts: number;
    owner_coverage_rate: number;
    next_action_coverage_rate: number;
    overdue_rate: number;
    overdue_count: number;
    no_next_action_count: number;
    no_owner_count: number;
  };
  stagnation: {
    stale_7d_count: number;
    by_status: Array<{ status: CommunicationContactStatus; count: number }>;
    by_owner: Array<{ owner_id: string | null; owner_name: string; stale_count: number }>;
  };
  proposal_health: {
    in_flight_stale_count: number;
    follow_up_missing_after_link_count: number;
  };
  owner_workload: Array<{
    owner_id: string | null;
    owner_name: string;
    open_contacts: number;
    overdue_count: number;
    unowned_count: number;
  }>;
  reason_clusters: Array<{ key: string; label: string; count: number }>;
  client_health: Array<{
    rollup_key: string;
    client_id: string | null;
    client_name: string;
    open_contacts: number;
    overdue_count: number;
    in_flight_proposal_count: number;
    owner_count: number;
    sites: string[];
  }>;
}

export interface ListCommunicationContactsParams {
  orgId: string;
  q?: string | null;
  statuses?: CommunicationContactStatus[];
  ownerUserIds?: string[];
  riskFlags?: CommunicationContactRiskFlag[];
  includeResolved?: boolean;
  sort?: CommunicationContactSort;
  page?: number;
  pageSize?: number;
}

interface ContactAggregate {
  summary: CommunicationContactStatusRecord;
  why_now: CommunicationContactWhyNowItem[];
  conversations: CommunicationConversationSummary[];
  recent_logs: CommunicationContactRecentLogRecord[];
  related_proposals: ProposalRow[];
  default_conversation_id: string | null;
  client_rollup_key: string;
  client_rollup_name: string;
  client_rollup_id: string | null;
  latest_in_flight_link_created_at: string | null;
}

interface CommunicationReadModelData {
  contacts: ContactAggregate[];
}

const IN_FLIGHT_PROPOSAL_STATUSES = new Set<ProposalStatus>(["pending", "approved"]);
const STALL_CLUSTER_RULES: Array<{ key: string; label: string; matcher: RegExp }> = [
  { key: "pricing", label: "価格", matcher: /(価格|見積|単価|金額|値引|予算)/i },
  { key: "approval", label: "稟議", matcher: /(稟議|承認|決裁|社内確認)/i },
  { key: "legal", label: "法務", matcher: /(法務|契約|条項|NDA|秘密保持)/i },
  { key: "security", label: "セキュリティ", matcher: /(セキュリティ|security|監査|アクセス|権限)/i },
  { key: "no_reply", label: "返信なし", matcher: /(返信なし|返答待ち|折り返し|未返信|連絡待ち)/i },
  { key: "schedule", label: "日程調整", matcher: /(日程|工程|スケジュール|空き|調整)/i },
];

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeKeyPart(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRollupKey(value: string | null | undefined): string {
  return normalizeKeyPart(value).replace(/[^\p{L}\p{N}]+/gu, "-");
}

function getTodayDateInTokyo(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
}

function toTimestamp(value: string | null | undefined): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function compareIsoDesc(a: string | null | undefined, b: string | null | undefined): number {
  return toTimestamp(b) - toTimestamp(a);
}

function daysSince(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return null;
  }
  return Math.max(0, Math.floor((Date.now() - parsed) / 86_400_000));
}

function pickLater(a: string | null, b: string | null): string | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return toTimestamp(a) >= toTimestamp(b) ? a : b;
}

function buildMemberSummary(profile: ProfileRow | undefined): CommunicationMemberSummary | null {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    name: profile.full_name || profile.username || "名無し",
    username: profile.username,
    avatar_url: profile.avatar_url,
  };
}

function isOpenConversation(conversation: ConversationRow): boolean {
  return conversation.status !== "resolved";
}

function getParticipantSummary(
  conversation: ConversationRow,
  participantsByConversation: Map<string, CommunicationParticipantRow[]>
): string {
  const participants = participantsByConversation.get(conversation.id) || [];
  const primary = participants.find((participant) => participant.is_primary) || participants[0];
  return (
    primary?.display_name ||
    conversation.client_name_snapshot ||
    conversation.client_email_snapshot ||
    "取引先未設定"
  );
}

function buildConversationSummary(
  conversation: ConversationRow,
  participantsByConversation: Map<string, CommunicationParticipantRow[]>,
  assigneeMap: Map<string, ProfileRow>,
  siteMap: Map<string, SiteRow>,
  proposalIdsByConversation: Map<string, string[]>
): CommunicationConversationSummary {
  const site = conversation.site_id ? siteMap.get(conversation.site_id) : undefined;
  return {
    id: conversation.id,
    title: conversation.title,
    status: conversation.status,
    source_channel: conversation.source_channel,
    last_channel: conversation.last_channel,
    client_name: conversation.client_name_snapshot,
    client_email: conversation.client_email_snapshot,
    participant_summary: getParticipantSummary(conversation, participantsByConversation),
    ai_summary: conversation.ai_summary,
    ai_priority: conversation.ai_priority,
    next_action: conversation.next_action,
    next_action_due_date: conversation.next_action_due_date,
    last_activity_at: conversation.last_activity_at,
    last_message_preview: conversation.last_message_preview,
    assignee: conversation.assignee_user_id
      ? buildMemberSummary(assigneeMap.get(conversation.assignee_user_id))
      : null,
    site: conversation.site_id
      ? {
          id: conversation.site_id,
          name: site?.name || conversation.site_name_snapshot || "現場未設定",
        }
      : null,
    related_proposal_count: (proposalIdsByConversation.get(conversation.id) || []).length,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
  };
}

function buildRecentLogs(
  logs: CommunicationLogRow[],
  conversationMap: Map<string, ConversationRow>
): CommunicationContactRecentLogRecord[] {
  return logs
    .slice()
    .sort((left, right) => compareIsoDesc(left.occurred_at, right.occurred_at) || compareIsoDesc(left.created_at, right.created_at))
    .slice(0, 5)
    .map((log) => ({
      id: log.id,
      conversation_id: log.conversation_id,
      conversation_title: conversationMap.get(log.conversation_id)?.title || "会話",
      channel: log.channel,
      direction: log.direction,
      log_kind: log.log_kind,
      subject: log.subject,
      body: log.body,
      summary: log.summary,
      occurred_at: log.occurred_at,
      created_by_type: log.created_by_type,
      created_by_name: log.created_by_name_snapshot,
      external_source: log.external_source,
      external_id: log.external_id,
      metadata: log.metadata || {},
      created_at: log.created_at,
    }));
}

async function loadProfilesByIds(ids: string[]): Promise<Map<string, ProfileRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,username,avatar_url")
    .in("id", ids);

  if (error) {
    throw error;
  }

  return new Map(((data || []) as ProfileRow[]).map((row) => [row.id, row]));
}

async function loadSitesByIds(ids: string[], orgId: string): Promise<Map<string, SiteRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("sites")
    .select("id,name,client_id,deleted_at")
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) {
    throw error;
  }

  return new Map(
    ((data || []) as Array<SiteRow & { deleted_at?: string | null }>)
      .filter((row) => !row.deleted_at)
      .map((row) => [row.id, { id: row.id, name: row.name, client_id: row.client_id || null }])
  );
}

async function loadParticipants(
  conversationIds: string[],
  orgId: string
): Promise<Map<string, CommunicationParticipantRow[]>> {
  const map = new Map<string, CommunicationParticipantRow[]>();
  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from("communication_participants")
    .select("id,conversation_id,participant_kind,display_name,email,phone,profile_id,is_primary,created_at")
    .eq("org_id", orgId)
    .in("conversation_id", conversationIds)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  for (const participant of (data || []) as CommunicationParticipantRow[]) {
    const current = map.get(participant.conversation_id) || [];
    current.push(participant);
    map.set(participant.conversation_id, current);
  }

  return map;
}

async function loadLinks(
  conversationIds: string[],
  orgId: string
): Promise<Map<string, CommunicationLinkRow[]>> {
  const map = new Map<string, CommunicationLinkRow[]>();
  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from("communication_links")
    .select("conversation_id,proposal_id,created_at")
    .eq("org_id", orgId)
    .in("conversation_id", conversationIds);

  if (error) {
    throw error;
  }

  for (const link of (data || []) as CommunicationLinkRow[]) {
    const current = map.get(link.conversation_id) || [];
    current.push(link);
    map.set(link.conversation_id, current);
  }

  return map;
}

async function loadLogs(
  conversationIds: string[],
  orgId: string
): Promise<Map<string, CommunicationLogRow[]>> {
  const map = new Map<string, CommunicationLogRow[]>();
  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from("communication_logs")
    .select("id,conversation_id,channel,direction,log_kind,subject,body,summary,occurred_at,created_by_type,created_by_name_snapshot,external_source,external_id,metadata,created_at")
    .eq("org_id", orgId)
    .in("conversation_id", conversationIds)
    .order("occurred_at", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  for (const log of (data || []) as CommunicationLogRow[]) {
    const current = map.get(log.conversation_id) || [];
    current.push(log);
    map.set(log.conversation_id, current);
  }

  return map;
}

async function loadProposalsByIds(ids: string[], orgId: string): Promise<Map<string, ProposalRow>> {
  if (ids.length === 0) {
    return new Map();
  }

  const { data, error } = await supabaseAdmin
    .from("proposals")
    .select("*")
    .eq("org_id", orgId)
    .in("id", ids)
    .order("created_at", { ascending: false });

  if (error) {
    throw error;
  }

  return new Map(((data || []) as ProposalRow[]).map((row) => [row.id, row]));
}

function buildContactKey(participant: CommunicationParticipantRow | null, conversation: ConversationRow): string {
  const normalizedEmail = normalizeKeyPart(participant?.email || conversation.client_email_snapshot);
  if (normalizedEmail) {
    return normalizedEmail;
  }

  const display = normalizeKeyPart(participant?.display_name || conversation.client_name_snapshot || "取引先");
  const client = normalizeKeyPart(conversation.client_name_snapshot);
  return [display, client].filter(Boolean).join("--") || `conversation-${conversation.id}`;
}

function buildFallbackParticipant(conversation: ConversationRow): CommunicationParticipantRow | null {
  const displayName = normalizeString(conversation.client_name_snapshot) || normalizeString(conversation.client_email_snapshot);
  if (!displayName) {
    return null;
  }

  return {
    id: `fallback:${conversation.id}`,
    conversation_id: conversation.id,
    participant_kind: "client",
    display_name: displayName,
    email: normalizeString(conversation.client_email_snapshot),
    phone: null,
    profile_id: null,
    is_primary: true,
    created_at: conversation.created_at,
  };
}

function buildContactConversationRef(
  conversation: ConversationRow,
  participant: CommunicationParticipantRow | null,
  siteMap: Map<string, SiteRow>,
  inFlightProposalCount: number
): ContactConversationRef {
  const site = conversation.site_id
    ? siteMap.get(conversation.site_id)
    : undefined;

  return {
    conversation,
    participant,
    client_name: normalizeString(conversation.client_name_snapshot),
    contact_name: normalizeString(participant?.display_name),
    contact_email: normalizeString(participant?.email || conversation.client_email_snapshot),
    site: conversation.site_id
      ? {
          id: conversation.site_id,
          name: site?.name || conversation.site_name_snapshot || "現場未設定",
        }
      : null,
    site_client_id: site?.client_id || null,
    in_flight_proposal_count: inFlightProposalCount,
  };
}

function selectRelevantConversation(refs: ContactConversationRef[], today: string): ContactConversationRef | null {
  if (refs.length === 0) {
    return null;
  }

  const overdueCandidates = refs
    .filter((ref) => isOpenConversation(ref.conversation) && Boolean(ref.conversation.next_action_due_date) && ref.conversation.next_action_due_date! < today)
    .sort((left, right) => {
      const dueCompare = String(left.conversation.next_action_due_date).localeCompare(String(right.conversation.next_action_due_date));
      return dueCompare !== 0 ? dueCompare : compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at);
    });
  if (overdueCandidates.length > 0) {
    return overdueCandidates[0];
  }

  const internalCandidates = refs
    .filter((ref) => ref.conversation.status === "waiting_internal" || ref.conversation.status === "active")
    .sort((left, right) => compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at));
  if (internalCandidates.length > 0) {
    return internalCandidates[0];
  }

  const waitingClientCandidates = refs
    .filter((ref) => ref.conversation.status === "waiting_client")
    .sort((left, right) => compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at));
  if (waitingClientCandidates.length > 0) {
    return waitingClientCandidates[0];
  }

  return refs
    .slice()
    .sort((left, right) => compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at))[0];
}

function pickLatestNonNull<T>(refs: ContactConversationRef[], selector: (ref: ContactConversationRef) => T | null): T | null {
  const sorted = refs.slice().sort((left, right) => compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at));
  for (const ref of sorted) {
    const value = selector(ref);
    if (value) {
      return value;
    }
  }
  return null;
}

function deriveStatusReason(ref: ContactConversationRef | null): {
  status_reason: string | null;
  status_reason_source: CommunicationStatusReasonSource;
  evidence_excerpt: string | null;
} {
  if (!ref) {
    return {
      status_reason: null,
      status_reason_source: "none",
      evidence_excerpt: null,
    };
  }

  const nextAction = normalizeString(ref.conversation.next_action);
  if (nextAction) {
    return {
      status_reason: nextAction,
      status_reason_source: "next_action",
      evidence_excerpt: nextAction,
    };
  }

  const aiSummary = normalizeString(ref.conversation.ai_summary);
  if (aiSummary) {
    return {
      status_reason: aiSummary,
      status_reason_source: "ai_summary",
      evidence_excerpt: aiSummary,
    };
  }

  const preview = normalizeString(ref.conversation.last_message_preview);
  if (preview) {
    return {
      status_reason: preview,
      status_reason_source: "last_message_preview",
      evidence_excerpt: preview,
    };
  }

  return {
    status_reason: null,
    status_reason_source: "none",
    evidence_excerpt: null,
  };
}

function deriveStatus(refs: ContactConversationRef[], today: string): CommunicationContactStatus {
  const openRefs = refs.filter((ref) => isOpenConversation(ref.conversation));
  if (openRefs.some((ref) => Boolean(ref.conversation.next_action_due_date) && ref.conversation.next_action_due_date! < today)) {
    return "overdue";
  }
  if (openRefs.some((ref) => ref.conversation.status === "waiting_internal" || ref.conversation.status === "active")) {
    return "waiting_internal";
  }
  if (openRefs.some((ref) => ref.conversation.status === "waiting_client")) {
    return "waiting_client";
  }
  if (refs.length > 0 && refs.every((ref) => ref.conversation.status === "resolved")) {
    return "resolved";
  }
  return "needs_review";
}

function deriveWaitingOn(status: CommunicationContactStatus): CommunicationWaitingOn {
  if (status === "waiting_client") {
    return "client";
  }
  if (status === "resolved") {
    return "none";
  }
  return "internal";
}

function buildWhyNowItems(
  summary: CommunicationContactStatusRecord,
  relevantConversation: ContactConversationRef | null
): CommunicationContactWhyNowItem[] {
  const items: CommunicationContactWhyNowItem[] = [];

  if (summary.status === "overdue" && summary.next_action_due_date) {
    items.push({
      code: "overdue",
      title: "期限超過",
      description: `${summary.next_action_due_date} 期限の動きが止まっています。`,
    });
  } else if (summary.status === "waiting_internal") {
    items.push({
      code: "waiting_internal",
      title: "こちら対応待ち",
      description: "社内側の次アクションが残っています。",
    });
  } else if (summary.status === "waiting_client") {
    items.push({
      code: "waiting_client",
      title: "返答待ち",
      description: "相手からの返答待ちです。",
    });
  } else if (summary.status === "needs_review") {
    items.push({
      code: "needs_review",
      title: "確認中",
      description: "状態の整理が必要です。",
    });
  }

  for (const riskFlag of summary.risk_flags) {
    if (riskFlag === "no_next_action") {
      items.push({
        code: riskFlag,
        title: "次アクションなし",
        description: "次に何をするかが未設定です。",
      });
    } else if (riskFlag === "pending_proposal_stale") {
      items.push({
        code: riskFlag,
        title: "提案停滞",
        description: "関連 Proposal が動かないまま止まっています。",
      });
    } else if (riskFlag === "stale_7d") {
      items.push({
        code: riskFlag,
        title: "7日以上停滞",
        description: "外部とのやり取りが 7 日以上ありません。",
      });
    } else if (riskFlag === "no_owner") {
      items.push({
        code: riskFlag,
        title: "担当未設定",
        description: "この連絡先を持つ社内担当が決まっていません。",
      });
    } else if (riskFlag === "overdue_next_action" && summary.status !== "overdue") {
      items.push({
        code: riskFlag,
        title: "期限超過",
        description: "次アクションの期限が過ぎています。",
      });
    }
  }

  if (items.length === 0 && relevantConversation) {
    items.push({
      code: summary.status,
      title: "現在地",
      description: relevantConversation.conversation.title,
    });
  }

  return items;
}

function buildContactAggregate(
  contactKey: string,
  refs: ContactConversationRef[],
  participantsByConversation: Map<string, CommunicationParticipantRow[]>,
  assigneeMap: Map<string, ProfileRow>,
  siteMap: Map<string, SiteRow>,
  proposalIdsByConversation: Map<string, string[]>,
  proposalMap: Map<string, ProposalRow>,
  logsByConversation: Map<string, CommunicationLogRow[]>,
  linksByConversation: Map<string, CommunicationLinkRow[]>,
  today: string
): ContactAggregate {
  const relevantConversation = selectRelevantConversation(refs, today);
  const status = deriveStatus(refs, today);
  const waitingOn = deriveWaitingOn(status);
  const sortedRefs = refs.slice().sort((left, right) => compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at));
  const latestRef = sortedRefs[0] || null;
  const latestActivityAt = latestRef?.conversation.last_activity_at || null;

  let owner: CommunicationMemberSummary | null = null;
  for (const ref of sortedRefs) {
    if (ref.conversation.assignee_user_id) {
      owner = buildMemberSummary(assigneeMap.get(ref.conversation.assignee_user_id));
      if (owner) {
        break;
      }
    }
  }

  const allLogs = refs
    .flatMap((ref) => logsByConversation.get(ref.conversation.id) || [])
    .sort((left, right) => compareIsoDesc(left.occurred_at, right.occurred_at) || compareIsoDesc(left.created_at, right.created_at));
  const lastInboundAt = allLogs.find((log) => log.direction === "inbound")?.occurred_at || null;
  const lastOutboundAt = allLogs.find((log) => log.direction === "outbound")?.occurred_at || null;
  const lastExternalActivityAt = pickLater(lastInboundAt, lastOutboundAt);
  const stallReferenceAt = lastExternalActivityAt || latestActivityAt;
  const daysSinceLatestActivity = daysSince(latestActivityAt);
  const daysSinceClientResponse = daysSince(lastInboundAt);
  const relevantValues = relevantConversation
    ? {
        client_name: relevantConversation.client_name,
        contact_name: relevantConversation.contact_name,
        contact_email: relevantConversation.contact_email,
        site: relevantConversation.site,
      }
    : {
        client_name: null,
        contact_name: null,
        contact_email: null,
        site: null,
      };
  const pickedReason = deriveStatusReason(relevantConversation);
  const inFlightProposalIds = Array.from(
    new Set(
      refs.flatMap((ref) => (proposalIdsByConversation.get(ref.conversation.id) || []).filter((proposalId) => IN_FLIGHT_PROPOSAL_STATUSES.has(proposalMap.get(proposalId)?.status || "draft")))
    )
  );
  const openConversationCount = refs.filter((ref) => isOpenConversation(ref.conversation)).length;
  const nextAction = relevantConversation?.conversation.next_action || pickLatestNonNull(refs, (ref) => normalizeString(ref.conversation.next_action));
  const nextActionDueDate =
    relevantConversation?.conversation.next_action_due_date ||
    pickLatestNonNull(refs, (ref) => normalizeString(ref.conversation.next_action_due_date));
  const hasNextAction = Boolean(normalizeString(nextAction));

  const riskFlags: CommunicationContactRiskFlag[] = [];
  if (openConversationCount > 0 && refs.some((ref) => isOpenConversation(ref.conversation) && Boolean(ref.conversation.next_action_due_date) && ref.conversation.next_action_due_date! < today)) {
    riskFlags.push("overdue_next_action");
  }
  if (status !== "resolved" && !hasNextAction) {
    riskFlags.push("no_next_action");
  }
  if (status !== "resolved" && stallReferenceAt && (daysSince(stallReferenceAt) || 0) >= 7) {
    riskFlags.push("stale_7d");
  }
  if (status !== "resolved" && inFlightProposalIds.length > 0 && stallReferenceAt && (daysSince(stallReferenceAt) || 0) >= 3) {
    riskFlags.push("pending_proposal_stale");
  }
  if (status !== "resolved" && !owner) {
    riskFlags.push("no_owner");
  }

  let attentionScore = 0;
  if (riskFlags.includes("overdue_next_action")) attentionScore += 100;
  if (riskFlags.includes("pending_proposal_stale")) attentionScore += 80;
  if (riskFlags.includes("no_owner")) attentionScore += 60;
  if (riskFlags.includes("no_next_action")) attentionScore += 40;
  if (riskFlags.includes("stale_7d")) attentionScore += 30;
  if (status === "waiting_internal") attentionScore += 10;
  if (status === "waiting_client") attentionScore += 5;

  const conversationSummaries = refs
    .slice()
    .sort((left, right) => compareIsoDesc(left.conversation.last_activity_at, right.conversation.last_activity_at))
    .map((ref) =>
      buildConversationSummary(ref.conversation, participantsByConversation, assigneeMap, siteMap, proposalIdsByConversation)
    );
  const relatedProposals = Array.from(
    new Set(refs.flatMap((ref) => proposalIdsByConversation.get(ref.conversation.id) || []))
  )
    .map((proposalId) => proposalMap.get(proposalId))
    .filter((proposal): proposal is ProposalRow => Boolean(proposal))
    .sort((left, right) => compareIsoDesc(left.created_at, right.created_at));
  const latestInFlightLinkCreatedAt = refs
    .flatMap((ref) =>
      (linksByConversation.get(ref.conversation.id) || [])
        .filter((link) => Boolean(link.proposal_id) && IN_FLIGHT_PROPOSAL_STATUSES.has(proposalMap.get(link.proposal_id || "")?.status || "draft"))
        .map((link) => link.created_at)
    )
    .sort(compareIsoDesc)[0] || null;

  const latestNonNullClientName = pickLatestNonNull(refs, (ref) => ref.client_name);
  const latestNonNullContactName = pickLatestNonNull(refs, (ref) => ref.contact_name);
  const latestNonNullContactEmail = pickLatestNonNull(refs, (ref) => ref.contact_email);
  const latestNonNullSite = pickLatestNonNull(refs, (ref) => ref.site);
  const rollupName = relevantValues.client_name || latestNonNullClientName || latestNonNullContactName || "取引先未設定";
  const rollupSiteClientId = pickLatestNonNull(refs, (ref) => ref.site_client_id);

  const summary: CommunicationContactStatusRecord = {
    contact_key: contactKey,
    client_name: relevantValues.client_name || latestNonNullClientName,
    contact_name: relevantValues.contact_name || latestNonNullContactName,
    contact_email: relevantValues.contact_email || latestNonNullContactEmail,
    owner,
    status,
    risk_flags: riskFlags,
    waiting_on: waitingOn,
    attention_score: attentionScore,
    status_reason: pickedReason.status_reason,
    status_reason_source: pickedReason.status_reason_source,
    evidence_excerpt: pickedReason.evidence_excerpt,
    latest_activity_at: latestActivityAt,
    last_external_activity_at: lastExternalActivityAt,
    days_since_latest_activity: daysSinceLatestActivity,
    last_inbound_at: lastInboundAt,
    last_outbound_at: lastOutboundAt,
    days_since_client_response: daysSinceClientResponse,
    next_action: normalizeString(nextAction),
    next_action_due_date: normalizeString(nextActionDueDate),
    has_next_action: hasNextAction,
    relevant_conversation_id: relevantConversation?.conversation.id || null,
    site: relevantValues.site || latestNonNullSite,
    conversation_count: refs.length,
    open_conversation_count: openConversationCount,
    in_flight_proposal_count: inFlightProposalIds.length,
  };

  return {
    summary,
    why_now: buildWhyNowItems(summary, relevantConversation),
    conversations: conversationSummaries,
    recent_logs: buildRecentLogs(allLogs, new Map(refs.map((ref) => [ref.conversation.id, ref.conversation]))),
    related_proposals: relatedProposals,
    default_conversation_id: relevantConversation?.conversation.id || latestRef?.conversation.id || null,
    client_rollup_key: rollupSiteClientId || normalizeRollupKey(rollupName) || `contact:${contactKey}`,
    client_rollup_name: rollupName,
    client_rollup_id: rollupSiteClientId,
    latest_in_flight_link_created_at: latestInFlightLinkCreatedAt,
  };
}

function matchesQuery(summary: CommunicationContactStatusRecord, query: string): boolean {
  if (!query) {
    return true;
  }

  const haystack = [
    summary.client_name,
    summary.contact_name,
    summary.contact_email,
    summary.owner?.name,
    summary.status_reason,
    summary.site?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function buildCommunicationReadModel(
  conversations: ConversationRow[],
  participantsByConversation: Map<string, CommunicationParticipantRow[]>,
  assigneeMap: Map<string, ProfileRow>,
  siteMap: Map<string, SiteRow>,
  proposalIdsByConversation: Map<string, string[]>,
  proposalMap: Map<string, ProposalRow>,
  logsByConversation: Map<string, CommunicationLogRow[]>,
  linksByConversation: Map<string, CommunicationLinkRow[]>,
  today: string
): CommunicationReadModelData {
  const contactsMap = new Map<string, ContactConversationRef[]>();

  for (const conversation of conversations) {
    const participants = (participantsByConversation.get(conversation.id) || []).filter((participant) => participant.participant_kind === "client");
    const effectiveParticipants = participants.length > 0 ? participants : [buildFallbackParticipant(conversation)].filter(Boolean) as CommunicationParticipantRow[];
    const inFlightProposalCount = (proposalIdsByConversation.get(conversation.id) || []).filter((proposalId) => IN_FLIGHT_PROPOSAL_STATUSES.has(proposalMap.get(proposalId)?.status || "draft")).length;

    if (effectiveParticipants.length === 0) {
      const contactKey = buildContactKey(null, conversation);
      const current = contactsMap.get(contactKey) || [];
      current.push(buildContactConversationRef(conversation, null, siteMap, inFlightProposalCount));
      contactsMap.set(contactKey, current);
      continue;
    }

    for (const participant of effectiveParticipants) {
      const contactKey = buildContactKey(participant, conversation);
      const current = contactsMap.get(contactKey) || [];
      current.push(buildContactConversationRef(conversation, participant, siteMap, inFlightProposalCount));
      contactsMap.set(contactKey, current);
    }
  }

  const contacts = Array.from(contactsMap.entries()).map(([contactKey, refs]) =>
    buildContactAggregate(
      contactKey,
      refs,
      participantsByConversation,
      assigneeMap,
      siteMap,
      proposalIdsByConversation,
      proposalMap,
      logsByConversation,
      linksByConversation,
      today
    )
  );

  return { contacts };
}

async function loadReadModelData(orgId: string): Promise<CommunicationReadModelData> {
  const today = getTodayDateInTokyo();
  const { data, error } = await supabaseAdmin
    .from("communication_conversations")
    .select("id,org_id,title,status,source_channel,last_channel,assignee_user_id,site_id,site_name_snapshot,client_name_snapshot,client_email_snapshot,ai_summary,ai_priority,next_action,next_action_due_date,last_activity_at,last_message_preview,created_at,updated_at")
    .eq("org_id", orgId)
    .order("last_activity_at", { ascending: false });

  if (error) {
    throw error;
  }

  const conversations = (data || []) as ConversationRow[];
  const conversationIds = conversations.map((conversation) => conversation.id);
  const assigneeIds = Array.from(
    new Set(conversations.map((conversation) => conversation.assignee_user_id).filter((value): value is string => Boolean(value)))
  );
  const siteIds = Array.from(
    new Set(conversations.map((conversation) => conversation.site_id).filter((value): value is string => Boolean(value)))
  );

  const [participantsByConversation, siteMap, linksByConversation, logsByConversation, assigneeMap] = await Promise.all([
    loadParticipants(conversationIds, orgId),
    loadSitesByIds(siteIds, orgId),
    loadLinks(conversationIds, orgId),
    loadLogs(conversationIds, orgId),
    loadProfilesByIds(assigneeIds),
  ]);

  const proposalIds = Array.from(
    new Set(
      Array.from(linksByConversation.values()).flatMap((links) => links.map((link) => link.proposal_id).filter((proposalId): proposalId is string => Boolean(proposalId)))
    )
  );
  const proposalMap = await loadProposalsByIds(proposalIds, orgId);

  return buildCommunicationReadModel(
    conversations,
    participantsByConversation,
    assigneeMap,
    siteMap,
    new Map(
      Array.from(linksByConversation.entries()).map(([conversationId, links]) => [
        conversationId,
        links.map((link) => link.proposal_id).filter((proposalId): proposalId is string => Boolean(proposalId)),
      ])
    ),
    proposalMap,
    logsByConversation,
    linksByConversation,
    today
  );
}

export async function listCommunicationContacts(
  params: ListCommunicationContactsParams
): Promise<CommunicationContactListResponse> {
  const readModel = await loadReadModelData(params.orgId);
  const query = normalizeString(params.q)?.toLowerCase() || "";
  const statuses = new Set(params.statuses || []);
  const ownerUserIds = new Set(params.ownerUserIds || []);
  const riskFlags = new Set(params.riskFlags || []);
  const includeResolved = params.includeResolved === true;
  const sort = params.sort || "attention";
  const page = params.page && params.page > 0 ? Math.floor(params.page) : 1;
  const pageSize = params.pageSize && params.pageSize > 0 ? Math.min(Math.floor(params.pageSize), 200) : 50;

  let items = readModel.contacts.map((contact) => contact.summary);

  if (!includeResolved) {
    items = items.filter((item) => item.status !== "resolved");
  }
  if (query) {
    items = items.filter((item) => matchesQuery(item, query));
  }
  if (statuses.size > 0) {
    items = items.filter((item) => statuses.has(item.status));
  }
  if (ownerUserIds.size > 0) {
    items = items.filter((item) => Boolean(item.owner?.id && ownerUserIds.has(item.owner.id)));
  }
  if (riskFlags.size > 0) {
    items = items.filter((item) => item.risk_flags.some((risk) => riskFlags.has(risk)));
  }

  items.sort((left, right) => {
    if (sort === "latest_activity") {
      return compareIsoDesc(left.latest_activity_at, right.latest_activity_at) || right.attention_score - left.attention_score;
    }
    return right.attention_score - left.attention_score || compareIsoDesc(left.latest_activity_at, right.latest_activity_at);
  });

  const totalCount = items.length;
  const startIndex = (page - 1) * pageSize;
  return {
    items: items.slice(startIndex, startIndex + pageSize),
    total_count: totalCount,
  };
}

export async function getCommunicationContactDetail(
  orgId: string,
  contactKey: string
): Promise<CommunicationContactStatusDetail | null> {
  const readModel = await loadReadModelData(orgId);
  const contact = readModel.contacts.find((item) => item.summary.contact_key === contactKey);
  if (!contact) {
    return null;
  }

  return {
    summary: contact.summary,
    why_now: contact.why_now,
    related_proposals: contact.related_proposals,
    conversations: contact.conversations,
    recent_logs: contact.recent_logs,
    default_conversation_id: contact.default_conversation_id,
  };
}

export async function getCommunicationInsightsSummary(orgId: string): Promise<CommunicationInsightsSummary> {
  const readModel = await loadReadModelData(orgId);
  const contacts = readModel.contacts;
  const openContacts = contacts.filter((contact) => contact.summary.status !== "resolved");

  const byStatus = (["overdue", "waiting_internal", "waiting_client", "resolved", "needs_review"] as CommunicationContactStatus[])
    .map((status) => ({
      status,
      count: openContacts.filter((contact) => contact.summary.status === status && contact.summary.risk_flags.includes("stale_7d")).length,
    }))
    .filter((item) => item.count > 0);

  const staleByOwnerMap = new Map<string, { owner_id: string | null; owner_name: string; stale_count: number }>();
  for (const contact of openContacts.filter((item) => item.summary.risk_flags.includes("stale_7d"))) {
    const ownerId = contact.summary.owner?.id || null;
    const key = ownerId || "unowned";
    const current = staleByOwnerMap.get(key) || {
      owner_id: ownerId,
      owner_name: contact.summary.owner?.name || "未設定",
      stale_count: 0,
    };
    current.stale_count += 1;
    staleByOwnerMap.set(key, current);
  }

  const ownerWorkloadMap = new Map<string, {
    owner_id: string | null;
    owner_name: string;
    open_contacts: number;
    overdue_count: number;
    unowned_count: number;
  }>();
  for (const contact of openContacts) {
    const ownerId = contact.summary.owner?.id || null;
    const key = ownerId || "unowned";
    const current = ownerWorkloadMap.get(key) || {
      owner_id: ownerId,
      owner_name: contact.summary.owner?.name || "未設定",
      open_contacts: 0,
      overdue_count: 0,
      unowned_count: 0,
    };
    current.open_contacts += 1;
    if (contact.summary.status === "overdue") {
      current.overdue_count += 1;
    }
    if (!contact.summary.owner) {
      current.unowned_count += 1;
    }
    ownerWorkloadMap.set(key, current);
  }

  const reasonClusterMap = new Map<string, { key: string; label: string; count: number }>();
  for (const contact of openContacts) {
    const sourceText = [contact.summary.status_reason, contact.summary.evidence_excerpt]
      .filter(Boolean)
      .join(" ");
    const rule = STALL_CLUSTER_RULES.find((candidate) => candidate.matcher.test(sourceText));
    const clusterKey = rule?.key || "other";
    const current = reasonClusterMap.get(clusterKey) || {
      key: clusterKey,
      label: rule?.label || "その他",
      count: 0,
    };
    current.count += 1;
    reasonClusterMap.set(clusterKey, current);
  }

  const clientHealthMap = new Map<string, {
    rollup_key: string;
    client_id: string | null;
    client_name: string;
    open_contacts: number;
    overdue_count: number;
    in_flight_proposal_count: number;
    owner_ids: Set<string>;
    sites: Set<string>;
  }>();
  for (const contact of contacts) {
    const current = clientHealthMap.get(contact.client_rollup_key) || {
      rollup_key: contact.client_rollup_key,
      client_id: contact.client_rollup_id,
      client_name: contact.client_rollup_name,
      open_contacts: 0,
      overdue_count: 0,
      in_flight_proposal_count: 0,
      owner_ids: new Set<string>(),
      sites: new Set<string>(),
    };
    if (contact.summary.status !== "resolved") {
      current.open_contacts += 1;
    }
    if (contact.summary.status === "overdue") {
      current.overdue_count += 1;
    }
    current.in_flight_proposal_count += contact.summary.in_flight_proposal_count;
    if (contact.summary.owner?.id) {
      current.owner_ids.add(contact.summary.owner.id);
    }
    if (contact.summary.site?.name) {
      current.sites.add(contact.summary.site.name);
    }
    clientHealthMap.set(contact.client_rollup_key, current);
  }

  let followUpMissingAfterLinkCount = 0;
  followUpMissingAfterLinkCount = contacts.filter((contact) => {
    const linkedAt =
      contact.latest_in_flight_link_created_at ||
      contact.related_proposals.find((proposal) => IN_FLIGHT_PROPOSAL_STATUSES.has(proposal.status))?.created_at ||
      null;
    if (!linkedAt) {
      return false;
    }
    if ((daysSince(linkedAt) || 0) < 3) {
      return false;
    }
    return !contact.summary.last_outbound_at || toTimestamp(contact.summary.last_outbound_at) < toTimestamp(linkedAt);
  }).length;

  return {
    hygiene: {
      open_contacts: openContacts.length,
      owner_coverage_rate: openContacts.length === 0 ? 0 : openContacts.filter((contact) => Boolean(contact.summary.owner)).length / openContacts.length,
      next_action_coverage_rate: openContacts.length === 0 ? 0 : openContacts.filter((contact) => contact.summary.has_next_action).length / openContacts.length,
      overdue_rate: openContacts.length === 0 ? 0 : openContacts.filter((contact) => contact.summary.status === "overdue").length / openContacts.length,
      overdue_count: openContacts.filter((contact) => contact.summary.status === "overdue").length,
      no_next_action_count: openContacts.filter((contact) => contact.summary.risk_flags.includes("no_next_action")).length,
      no_owner_count: openContacts.filter((contact) => contact.summary.risk_flags.includes("no_owner")).length,
    },
    stagnation: {
      stale_7d_count: openContacts.filter((contact) => contact.summary.risk_flags.includes("stale_7d")).length,
      by_status: byStatus,
      by_owner: Array.from(staleByOwnerMap.values()).sort((left, right) => right.stale_count - left.stale_count),
    },
    proposal_health: {
      in_flight_stale_count: openContacts.filter((contact) => contact.summary.risk_flags.includes("pending_proposal_stale")).length,
      follow_up_missing_after_link_count: followUpMissingAfterLinkCount,
    },
    owner_workload: Array.from(ownerWorkloadMap.values()).sort((left, right) => right.open_contacts - left.open_contacts),
    reason_clusters: Array.from(reasonClusterMap.values()).sort((left, right) => right.count - left.count),
    client_health: Array.from(clientHealthMap.values())
      .map((item) => ({
        rollup_key: item.rollup_key,
        client_id: item.client_id,
        client_name: item.client_name,
        open_contacts: item.open_contacts,
        overdue_count: item.overdue_count,
        in_flight_proposal_count: item.in_flight_proposal_count,
        owner_count: item.owner_ids.size,
        sites: Array.from(item.sites).slice(0, 3),
      }))
      .sort((left, right) => right.open_contacts - left.open_contacts),
  };
}
