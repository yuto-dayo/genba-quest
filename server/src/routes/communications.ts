import { Router, Response } from "express";
import { AuthenticatedRequest } from "../middleware/authMiddleware";
import { supabaseAdmin } from "../lib/supabaseAdmin";
import { resolveOrgId } from "../lib/org";
import {
  getCommunicationContactDetail,
  getCommunicationInsightsSummary,
  listCommunicationContacts,
  type CommunicationContactRiskFlag,
  type CommunicationContactSort,
  type CommunicationContactStatus,
} from "../services/communication-contact-read-model";

const router = Router();
const COMMUNICATIONS_MIGRATION_ERROR =
  "communication_* テーブルが未適用です。Supabase に `server/sql/040_communication_conversations.sql` を適用してください。";

const VALID_CONVERSATION_STATUSES = new Set([
  "active",
  "waiting_internal",
  "waiting_client",
  "resolved",
]);
const VALID_CHANNELS = new Set([
  "gmail",
  "phone",
  "line",
  "in_person",
  "sms",
  "manual",
  "system",
]);
const VALID_DIRECTIONS = new Set(["inbound", "outbound", "internal"]);
const VALID_LOG_KINDS = new Set([
  "message",
  "note",
  "status_change",
  "assignment_change",
  "summary_update",
  "proposal_link",
]);
const VALID_CONTACT_STATUSES = new Set([
  "overdue",
  "waiting_internal",
  "waiting_client",
  "resolved",
  "needs_review",
]);
const VALID_CONTACT_RISKS = new Set([
  "overdue_next_action",
  "no_next_action",
  "stale_7d",
  "pending_proposal_stale",
  "no_owner",
]);
const VALID_CONTACT_SORTS = new Set(["attention", "latest_activity"]);

type CommunicationConversationStatus = "active" | "waiting_internal" | "waiting_client" | "resolved";
type CommunicationChannel = "gmail" | "phone" | "line" | "in_person" | "sms" | "manual" | "system";
type CommunicationDirection = "inbound" | "outbound" | "internal";
type CommunicationLogKind =
  | "message"
  | "note"
  | "status_change"
  | "assignment_change"
  | "summary_update"
  | "proposal_link";

interface ConversationRow {
  id: string;
  org_id: string;
  title: string;
  status: CommunicationConversationStatus;
  source_channel: CommunicationChannel;
  last_channel: CommunicationChannel;
  external_thread_key: string | null;
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
  created_by_user_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CommunicationLogRow {
  id: string;
  org_id: string;
  conversation_id: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  log_kind: CommunicationLogKind;
  subject: string | null;
  body: string;
  summary: string | null;
  occurred_at: string;
  created_by_type: "human" | "ai" | "system" | "integration";
  created_by_user_id: string | null;
  created_by_name_snapshot: string | null;
  external_source: string | null;
  external_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface CommunicationLinkRow {
  conversation_id: string;
  proposal_id: string | null;
}

interface CommunicationParticipantRow {
  id: string;
  org_id: string;
  conversation_id: string;
  participant_kind: "client" | "internal" | "integration";
  display_name: string;
  email: string | null;
  phone: string | null;
  profile_id: string | null;
  is_primary: boolean;
  created_at: string;
  updated_at: string;
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
}

interface ProposalRow {
  id: string;
  org_id: string;
  type: string;
  status: string;
  document_id?: string | null;
  site_id?: string | null;
  created_by: {
    type: "human" | "ai" | "system" | "integration";
    id: string;
    name: string;
  };
  payload: Record<string, unknown>;
  description: string;
  policy_ref?: string | null;
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

interface CommunicationMemberSummary {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
}

interface CommunicationSiteSummary {
  id: string;
  name: string;
}

interface CommunicationConversationSummary {
  id: string;
  title: string;
  status: CommunicationConversationStatus;
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

interface CommunicationParticipantRecord {
  id: string;
  participant_kind: "client" | "internal" | "integration";
  display_name: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
  profile: CommunicationMemberSummary | null;
  created_at: string;
}

interface CommunicationLogRecord {
  id: string;
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

interface CommunicationDetailResponse {
  conversation: CommunicationConversationSummary;
  logs: CommunicationLogRecord[];
  participants: CommunicationParticipantRecord[];
  related_proposals: ProposalRow[];
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return normalizeString(value);
}

function normalizeLimit(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 30;
  }
  return Math.min(Math.floor(parsed), 100);
}

function normalizeOffset(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return Math.floor(parsed);
}

function normalizePage(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1;
  }
  return Math.floor(parsed);
}

function normalizePageSize(raw: unknown): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }
  return Math.min(Math.floor(parsed), 200);
}

function normalizeBoolean(raw: unknown, fallback = false): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw !== "string") {
    return fallback;
  }

  if (raw === "true" || raw === "1") {
    return true;
  }
  if (raw === "false" || raw === "0") {
    return false;
  }
  return fallback;
}

function normalizeStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.flatMap((value) => normalizeStringArray(value));
  }
  const value = normalizeString(raw);
  return value ? [value] : [];
}

function normalizeContactStatuses(raw: unknown): CommunicationContactStatus[] | null {
  const values = normalizeStringArray(raw);
  if (values.length === 0) {
    return [];
  }
  if (values.some((value) => !VALID_CONTACT_STATUSES.has(value))) {
    return null;
  }
  return values as CommunicationContactStatus[];
}

function normalizeContactRiskFlags(raw: unknown): CommunicationContactRiskFlag[] | null {
  const values = normalizeStringArray(raw);
  if (values.length === 0) {
    return [];
  }
  if (values.some((value) => !VALID_CONTACT_RISKS.has(value))) {
    return null;
  }
  return values as CommunicationContactRiskFlag[];
}

function normalizeContactSort(raw: unknown): CommunicationContactSort | null {
  const value = normalizeString(raw);
  if (!value) {
    return "attention";
  }
  if (!VALID_CONTACT_SORTS.has(value)) {
    return null;
  }
  return value as CommunicationContactSort;
}

function normalizeConversationStatus(raw: unknown): CommunicationConversationStatus | null {
  const value = normalizeString(raw);
  if (!value || !VALID_CONVERSATION_STATUSES.has(value)) {
    return null;
  }
  return value as CommunicationConversationStatus;
}

function normalizeChannel(raw: unknown): CommunicationChannel | null {
  const value = normalizeString(raw);
  if (!value || !VALID_CHANNELS.has(value)) {
    return null;
  }
  return value as CommunicationChannel;
}

function normalizeDirection(raw: unknown): CommunicationDirection | null {
  const value = normalizeString(raw);
  if (!value || !VALID_DIRECTIONS.has(value)) {
    return null;
  }
  return value as CommunicationDirection;
}

function normalizeLogKind(raw: unknown): CommunicationLogKind | null {
  const value = normalizeString(raw);
  if (!value || !VALID_LOG_KINDS.has(value)) {
    return null;
  }
  return value as CommunicationLogKind;
}

function normalizeMetadata(raw: unknown): Record<string, unknown> | null {
  if (raw === undefined || raw === null) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function normalizeDateOnly(raw: unknown): string | null {
  const value = normalizeString(raw);
  if (!value) {
    return null;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeOccurredAt(raw: unknown): string | null {
  const value = normalizeString(raw);
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function isMissingCommunicationSchemaError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: string;
    message?: string;
    details?: string;
  };

  const message = typeof candidate.message === "string" ? candidate.message : "";
  const details = typeof candidate.details === "string" ? candidate.details : "";
  const combined = `${message} ${details}`;

  return (
    candidate.code === "PGRST205" ||
    combined.includes("communication_conversations") ||
    combined.includes("communication_logs") ||
    combined.includes("communication_links") ||
    combined.includes("communication_participants") ||
    combined.includes("relation") && combined.includes("does not exist")
  );
}

function respondMissingSchema(res: Response): void {
  res.status(503).json({ error: COMMUNICATIONS_MIGRATION_ERROR });
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

function buildSiteSummary(row: ConversationRow, siteMap: Map<string, SiteRow>): CommunicationSiteSummary | null {
  if (!row.site_id) {
    return null;
  }

  const site = siteMap.get(row.site_id);
  return {
    id: row.site_id,
    name: site?.name || row.site_name_snapshot || "現場未設定",
  };
}

function readParticipantSummary(
  row: ConversationRow,
  participantsByConversation: Map<string, CommunicationParticipantRow[]>
): string {
  const participants = participantsByConversation.get(row.id) || [];
  const primary = participants.find((participant) => participant.is_primary) || participants[0];

  if (primary?.display_name) {
    return primary.display_name;
  }

  if (row.client_name_snapshot) {
    return row.client_name_snapshot;
  }

  if (row.client_email_snapshot) {
    return row.client_email_snapshot;
  }

  return "取引先未設定";
}

function pickConversationStatusFromDirection(direction: CommunicationDirection): CommunicationConversationStatus {
  if (direction === "outbound") {
    return "waiting_client";
  }
  return "waiting_internal";
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
    .select("id,name,deleted_at")
    .eq("org_id", orgId)
    .in("id", ids);

  if (error) {
    throw error;
  }

  return new Map(
    ((data || []) as Array<SiteRow & { deleted_at?: string | null }>)
      .filter((row) => !row.deleted_at)
      .map((row) => [row.id, { id: row.id, name: row.name }])
  );
}

async function loadParticipantRows(
  conversationIds: string[],
  orgId: string
): Promise<Map<string, CommunicationParticipantRow[]>> {
  const map = new Map<string, CommunicationParticipantRow[]>();
  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from("communication_participants")
    .select("id,org_id,conversation_id,participant_kind,display_name,email,phone,profile_id,is_primary,created_at,updated_at")
    .eq("org_id", orgId)
    .in("conversation_id", conversationIds)
    .order("is_primary", { ascending: false })
    .order("created_at", { ascending: true });

  if (error) {
    throw error;
  }

  for (const row of (data || []) as CommunicationParticipantRow[]) {
    const current = map.get(row.conversation_id) || [];
    current.push(row);
    map.set(row.conversation_id, current);
  }

  return map;
}

async function loadProposalLinks(
  conversationIds: string[],
  orgId: string
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (conversationIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from("communication_links")
    .select("conversation_id,proposal_id")
    .eq("org_id", orgId)
    .in("conversation_id", conversationIds);

  if (error) {
    throw error;
  }

  for (const row of (data || []) as CommunicationLinkRow[]) {
    if (!row.proposal_id) {
      continue;
    }

    const current = map.get(row.conversation_id) || [];
    current.push(row.proposal_id);
    map.set(row.conversation_id, current);
  }

  return map;
}

async function hydrateConversationRows(
  orgId: string,
  rows: ConversationRow[]
): Promise<CommunicationConversationSummary[]> {
  if (rows.length === 0) {
    return [];
  }

  const assigneeIds = Array.from(
    new Set(rows.map((row) => row.assignee_user_id).filter((value): value is string => Boolean(value)))
  );
  const siteIds = Array.from(
    new Set(rows.map((row) => row.site_id).filter((value): value is string => Boolean(value)))
  );
  const conversationIds = rows.map((row) => row.id);

  const [assigneeMap, siteMap, participantsByConversation, proposalLinksByConversation] = await Promise.all([
    loadProfilesByIds(assigneeIds),
    loadSitesByIds(siteIds, orgId),
    loadParticipantRows(conversationIds, orgId),
    loadProposalLinks(conversationIds, orgId),
  ]);

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    source_channel: row.source_channel,
    last_channel: row.last_channel,
    client_name: row.client_name_snapshot,
    client_email: row.client_email_snapshot,
    participant_summary: readParticipantSummary(row, participantsByConversation),
    ai_summary: row.ai_summary,
    ai_priority: row.ai_priority,
    next_action: row.next_action,
    next_action_due_date: row.next_action_due_date,
    last_activity_at: row.last_activity_at,
    last_message_preview: row.last_message_preview,
    assignee: buildMemberSummary(
      row.assignee_user_id ? assigneeMap.get(row.assignee_user_id) : undefined
    ),
    site: buildSiteSummary(row, siteMap),
    related_proposal_count: (proposalLinksByConversation.get(row.id) || []).length,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));
}

async function loadConversationDetail(orgId: string, conversationId: string): Promise<CommunicationDetailResponse | null> {
  const { data: conversationData, error: conversationError } = await supabaseAdmin
    .from("communication_conversations")
    .select("*")
    .eq("org_id", orgId)
    .eq("id", conversationId)
    .maybeSingle();

  if (conversationError) {
    throw conversationError;
  }

  if (!conversationData) {
    return null;
  }

  const conversationRow = conversationData as ConversationRow;
  const [conversationSummary] = await hydrateConversationRows(orgId, [conversationRow]);

  const [{ data: logData, error: logError }, participantMap, proposalLinksByConversation] = await Promise.all([
    supabaseAdmin
      .from("communication_logs")
      .select("id,org_id,conversation_id,channel,direction,log_kind,subject,body,summary,occurred_at,created_by_type,created_by_user_id,created_by_name_snapshot,external_source,external_id,metadata,created_at,updated_at")
      .eq("org_id", orgId)
      .eq("conversation_id", conversationId)
      .order("occurred_at", { ascending: true })
      .order("created_at", { ascending: true }),
    loadParticipantRows([conversationId], orgId),
    loadProposalLinks([conversationId], orgId),
  ]);

  if (logError) {
    throw logError;
  }

  const logRows = (logData || []) as CommunicationLogRow[];
  const participantRows = participantMap.get(conversationId) || [];
  const participantProfileIds = Array.from(
    new Set(
      participantRows.map((participant) => participant.profile_id).filter((value): value is string => Boolean(value))
    )
  );
  const participantProfileMap = await loadProfilesByIds(participantProfileIds);
  const proposalIds = Array.from(new Set(proposalLinksByConversation.get(conversationId) || []));

  const relatedProposals: ProposalRow[] = [];
  if (proposalIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from("proposals")
      .select("*")
      .eq("org_id", orgId)
      .in("id", proposalIds)
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    relatedProposals.push(...((data || []) as ProposalRow[]));
  }

  return {
    conversation: conversationSummary,
    logs: logRows.map((row) => ({
      id: row.id,
      channel: row.channel,
      direction: row.direction,
      log_kind: row.log_kind,
      subject: row.subject,
      body: row.body,
      summary: row.summary,
      occurred_at: row.occurred_at,
      created_by_type: row.created_by_type,
      created_by_name: row.created_by_name_snapshot,
      external_source: row.external_source,
      external_id: row.external_id,
      metadata: row.metadata || {},
      created_at: row.created_at,
    })),
    participants: participantRows.map((row) => ({
      id: row.id,
      participant_kind: row.participant_kind,
      display_name: row.display_name,
      email: row.email,
      phone: row.phone,
      is_primary: row.is_primary,
      profile: row.profile_id ? buildMemberSummary(participantProfileMap.get(row.profile_id)) : null,
      created_at: row.created_at,
    })),
    related_proposals: relatedProposals,
  };
}

async function resolveSite(
  siteId: string | null,
  orgId: string
): Promise<{ site_id: string | null; site_name_snapshot: string | null }> {
  if (!siteId) {
    return {
      site_id: null,
      site_name_snapshot: null,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("sites")
    .select("id,name,deleted_at")
    .eq("id", siteId)
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data || data.deleted_at) {
    throw new Error("SITE_NOT_FOUND");
  }

  return {
    site_id: data.id,
    site_name_snapshot: typeof data.name === "string" ? data.name : null,
  };
}

async function resolveProfile(profileId: string | null): Promise<ProfileRow | null> {
  if (!profileId) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id,full_name,username,avatar_url")
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new Error("PROFILE_NOT_FOUND");
  }

  return data as ProfileRow;
}

async function ensureParticipant(input: {
  orgId: string;
  conversationId: string;
  participantKind: "client" | "internal" | "integration";
  displayName: string;
  email?: string | null;
  phone?: string | null;
  profileId?: string | null;
  isPrimary?: boolean;
}) {
  const normalizedEmail = normalizeNullableString(input.email);
  const normalizedPhone = normalizeNullableString(input.phone);
  const normalizedProfileId = normalizeNullableString(input.profileId);
  let existingQuery = supabaseAdmin
    .from("communication_participants")
    .select("id")
    .eq("org_id", input.orgId)
    .eq("conversation_id", input.conversationId);

  if (normalizedProfileId) {
    existingQuery = existingQuery.eq("profile_id", normalizedProfileId);
  } else if (normalizedEmail) {
    existingQuery = existingQuery.eq("email", normalizedEmail);
  } else {
    existingQuery = existingQuery.eq("display_name", input.displayName);
  }

  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) {
    throw existingError;
  }

  const participantPayload = {
    org_id: input.orgId,
    conversation_id: input.conversationId,
    participant_kind: input.participantKind,
    display_name: input.displayName,
    email: normalizedEmail,
    phone: normalizedPhone,
    profile_id: normalizedProfileId,
    is_primary: Boolean(input.isPrimary),
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabaseAdmin
      .from("communication_participants")
      .update(participantPayload)
      .eq("id", existing.id);

    if (error) {
      throw error;
    }
    return;
  }

  const { error } = await supabaseAdmin
    .from("communication_participants")
    .insert({
      ...participantPayload,
      created_at: new Date().toISOString(),
    });

  if (error) {
    throw error;
  }
}

async function insertLog(input: {
  orgId: string;
  conversationId: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  logKind: CommunicationLogKind;
  subject?: string | null;
  body: string;
  summary?: string | null;
  occurredAt: string;
  createdByType: "human" | "ai" | "system" | "integration";
  createdByUserId?: string | null;
  createdByName?: string | null;
  externalSource?: string | null;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from("communication_logs")
    .insert({
      org_id: input.orgId,
      conversation_id: input.conversationId,
      channel: input.channel,
      direction: input.direction,
      log_kind: input.logKind,
      subject: input.subject || null,
      body: input.body,
      summary: input.summary || null,
      occurred_at: input.occurredAt,
      created_by_type: input.createdByType,
      created_by_user_id: input.createdByUserId || null,
      created_by_name_snapshot: input.createdByName || null,
      external_source: input.externalSource || null,
      external_id: input.externalId || null,
      metadata: input.metadata || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data;
}

router.get("/contacts", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const statuses = normalizeContactStatuses(req.query.status);
    const riskFlags = normalizeContactRiskFlags(req.query.risk);
    const sort = normalizeContactSort(req.query.sort);

    if (statuses === null) {
      res.status(400).json({ error: "status must be overdue, waiting_internal, waiting_client, resolved, or needs_review" });
      return;
    }
    if (riskFlags === null) {
      res.status(400).json({ error: "risk must be overdue_next_action, no_next_action, stale_7d, pending_proposal_stale, or no_owner" });
      return;
    }
    if (!sort) {
      res.status(400).json({ error: "sort must be attention or latest_activity" });
      return;
    }

    const response = await listCommunicationContacts({
      orgId,
      q: normalizeString(req.query.q),
      statuses,
      ownerUserIds: normalizeStringArray(req.query.ownerUserId),
      riskFlags,
      includeResolved: normalizeBoolean(req.query.includeResolved, false),
      sort,
      page: normalizePage(req.query.page),
      pageSize: normalizePageSize(req.query.pageSize),
    });

    res.json(response);
  } catch (err) {
    console.error("[COMMUNICATIONS] contacts list failed:", err);
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡ボードの取得に失敗しました" });
  }
});

router.get("/contacts/:contactKey", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const contactKey = normalizeString(req.params.contactKey);

    if (!contactKey) {
      res.status(400).json({ error: "Invalid contactKey" });
      return;
    }

    const detail = await getCommunicationContactDetail(orgId, contactKey);
    if (!detail) {
      res.status(404).json({ error: "Contact not found" });
      return;
    }

    res.json(detail);
  } catch (err) {
    console.error("[COMMUNICATIONS] contact detail failed:", err);
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡詳細の取得に失敗しました" });
  }
});

router.get("/insights/summary", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const summary = await getCommunicationInsightsSummary(orgId);
    res.json(summary);
  } catch (err) {
    console.error("[COMMUNICATIONS] insights failed:", err);
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡分析の取得に失敗しました" });
  }
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const limit = normalizeLimit(req.query.limit);
    const offset = normalizeOffset(req.query.offset);
    const statusParam = req.query.status;
    const status = normalizeConversationStatus(statusParam);

    if (statusParam !== undefined && status === null) {
      res.status(400).json({ error: "Invalid status query" });
      return;
    }

    let query = supabaseAdmin
      .from("communication_conversations")
      .select("*")
      .eq("org_id", orgId)
      .order("last_activity_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const hydrated = await hydrateConversationRows(orgId, (data || []) as ConversationRow[]);
    res.json(hydrated);
  } catch (err) {
    console.error("[COMMUNICATIONS] list failed:", err);
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡一覧の取得に失敗しました" });
  }
});

router.get("/:conversationId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const conversationId = normalizeString(req.params.conversationId);

    if (!conversationId) {
      res.status(400).json({ error: "Invalid conversationId" });
      return;
    }

    const detail = await loadConversationDetail(orgId, conversationId);
    if (!detail) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    res.json(detail);
  } catch (err) {
    console.error("[COMMUNICATIONS] detail failed:", err);
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡詳細の取得に失敗しました" });
  }
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const title = normalizeString(req.body?.title);
    const channel = normalizeChannel(req.body?.channel);
    const direction = normalizeDirection(req.body?.direction);
    const body = normalizeString(req.body?.body);
    const subject = normalizeNullableString(req.body?.subject);
    const summary = normalizeNullableString(req.body?.summary);
    const occurredAt = normalizeOccurredAt(req.body?.occurred_at) || new Date().toISOString();
    const nextAction = normalizeNullableString(req.body?.next_action);
    const nextActionDueDate = req.body?.next_action_due_date === undefined
      ? null
      : normalizeDateOnly(req.body?.next_action_due_date);
    const requestedStatus = req.body?.status === undefined
      ? null
      : normalizeConversationStatus(req.body?.status);
    const assigneeUserId = normalizeNullableString(req.body?.assignee_user_id);
    const participantName = normalizeString(req.body?.participant_name);
    const participantEmail = normalizeNullableString(req.body?.participant_email);
    const participantPhone = normalizeNullableString(req.body?.participant_phone);
    const metadata = normalizeMetadata(req.body?.metadata);
    const sourceChannel = channel && channel !== "system" ? channel : "manual";

    if (!title) {
      res.status(400).json({ error: "title is required" });
      return;
    }

    if (!channel || channel === "system") {
      res.status(400).json({ error: "channel must be gmail, phone, line, in_person, sms, or manual" });
      return;
    }

    if (!direction) {
      res.status(400).json({ error: "direction must be inbound, outbound, or internal" });
      return;
    }

    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    if (metadata === null) {
      res.status(400).json({ error: "metadata must be an object" });
      return;
    }

    if (req.body?.next_action_due_date !== undefined && nextActionDueDate === null) {
      res.status(400).json({ error: "next_action_due_date must be YYYY-MM-DD" });
      return;
    }

    if (req.body?.status !== undefined && requestedStatus === null) {
      res.status(400).json({ error: "status must be active, waiting_internal, waiting_client, or resolved" });
      return;
    }

    const [siteSnapshot, assigneeProfile] = await Promise.all([
      resolveSite(normalizeNullableString(req.body?.site_id), orgId),
      resolveProfile(assigneeUserId),
    ]);

    const { data, error } = await supabaseAdmin
      .from("communication_conversations")
      .insert({
        org_id: orgId,
        title,
        status: requestedStatus || pickConversationStatusFromDirection(direction),
        source_channel: sourceChannel,
        last_channel: channel,
        assignee_user_id: assigneeProfile?.id || null,
        site_id: siteSnapshot.site_id,
        site_name_snapshot: siteSnapshot.site_name_snapshot,
        client_name_snapshot: participantName,
        client_email_snapshot: participantEmail,
        ai_summary: summary,
        next_action: nextAction,
        next_action_due_date: nextActionDueDate,
        last_activity_at: occurredAt,
        last_message_preview: truncateText(body, 220),
        created_by_user_id: req.userId || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) {
      throw error;
    }

    const conversationId = data.id as string;

    await insertLog({
      orgId,
      conversationId,
      channel,
      direction,
      logKind: normalizeLogKind(req.body?.log_kind) || "message",
      subject,
      body,
      summary,
      occurredAt,
      createdByType: "human",
      createdByUserId: req.userId || null,
      createdByName: req.userName || null,
      metadata,
    });

    if (participantName || participantEmail || participantPhone) {
      await ensureParticipant({
        orgId,
        conversationId,
        participantKind: "client",
        displayName: participantName || participantEmail || "取引先",
        email: participantEmail,
        phone: participantPhone,
        isPrimary: true,
      });
    }

    if (assigneeProfile) {
      await ensureParticipant({
        orgId,
        conversationId,
        participantKind: "internal",
        displayName: assigneeProfile.full_name || assigneeProfile.username || "担当者",
        profileId: assigneeProfile.id,
        isPrimary: false,
      });
    }

    const detail = await loadConversationDetail(orgId, conversationId);
    res.status(201).json(detail);
  } catch (err) {
    console.error("[COMMUNICATIONS] create failed:", err);
    const message = err instanceof Error ? err.message : "";
    if (message === "SITE_NOT_FOUND") {
      res.status(404).json({ error: "指定した現場が見つかりません" });
      return;
    }
    if (message === "PROFILE_NOT_FOUND") {
      res.status(404).json({ error: "指定した担当者が見つかりません" });
      return;
    }
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡会話の作成に失敗しました" });
  }
});

router.post("/:conversationId/logs", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const conversationId = normalizeString(req.params.conversationId);
    const channel = normalizeChannel(req.body?.channel);
    const direction = normalizeDirection(req.body?.direction);
    const body = normalizeString(req.body?.body);
    const subject = normalizeNullableString(req.body?.subject);
    const summary = normalizeNullableString(req.body?.summary);
    const logKind = normalizeLogKind(req.body?.log_kind) || "message";
    const occurredAt = normalizeOccurredAt(req.body?.occurred_at) || new Date().toISOString();
    const metadata = normalizeMetadata(req.body?.metadata);

    if (!conversationId) {
      res.status(400).json({ error: "Invalid conversationId" });
      return;
    }

    if (!channel || channel === "system") {
      res.status(400).json({ error: "channel must be gmail, phone, line, in_person, sms, or manual" });
      return;
    }

    if (!direction) {
      res.status(400).json({ error: "direction must be inbound, outbound, or internal" });
      return;
    }

    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    if (metadata === null) {
      res.status(400).json({ error: "metadata must be an object" });
      return;
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("communication_conversations")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", conversationId)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (!existing) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    await insertLog({
      orgId,
      conversationId,
      channel,
      direction,
      logKind,
      subject,
      body,
      summary,
      occurredAt,
      createdByType: "human",
      createdByUserId: req.userId || null,
      createdByName: req.userName || null,
      metadata,
    });

    const participantName = normalizeString(req.body?.participant_name);
    const participantEmail = normalizeNullableString(req.body?.participant_email);
    const participantPhone = normalizeNullableString(req.body?.participant_phone);

    if (participantName || participantEmail || participantPhone) {
      await ensureParticipant({
        orgId,
        conversationId,
        participantKind: "client",
        displayName: participantName || participantEmail || "取引先",
        email: participantEmail,
        phone: participantPhone,
        isPrimary: false,
      });
    }

    const { error: updateError } = await supabaseAdmin
      .from("communication_conversations")
      .update({
        last_channel: channel,
        last_activity_at: occurredAt,
        last_message_preview: truncateText(body, 220),
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", conversationId);

    if (updateError) {
      throw updateError;
    }

    const detail = await loadConversationDetail(orgId, conversationId);
    res.status(201).json(detail);
  } catch (err) {
    console.error("[COMMUNICATIONS] add log failed:", err);
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡ログの追加に失敗しました" });
  }
});

router.patch("/:conversationId", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = resolveOrgId(req.orgId);
    const conversationId = normalizeString(req.params.conversationId);

    if (!conversationId) {
      res.status(400).json({ error: "Invalid conversationId" });
      return;
    }

    const { data: existingData, error: existingError } = await supabaseAdmin
      .from("communication_conversations")
      .select("*")
      .eq("org_id", orgId)
      .eq("id", conversationId)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (!existingData) {
      res.status(404).json({ error: "Conversation not found" });
      return;
    }

    const existing = existingData as ConversationRow;
    const hasStatus = Object.prototype.hasOwnProperty.call(req.body || {}, "status");
    const hasAssignee = Object.prototype.hasOwnProperty.call(req.body || {}, "assignee_user_id");
    const hasNextAction = Object.prototype.hasOwnProperty.call(req.body || {}, "next_action");
    const hasNextActionDueDate = Object.prototype.hasOwnProperty.call(req.body || {}, "next_action_due_date");
    const hasSite = Object.prototype.hasOwnProperty.call(req.body || {}, "site_id");
    const hasTitle = Object.prototype.hasOwnProperty.call(req.body || {}, "title");

    if (!hasStatus && !hasAssignee && !hasNextAction && !hasNextActionDueDate && !hasSite && !hasTitle) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    let assigneeProfile: ProfileRow | null = null;
    let siteSnapshot: { site_id: string | null; site_name_snapshot: string | null } | null = null;
    let newStatus: CommunicationConversationStatus | null = null;

    if (hasStatus) {
      newStatus = req.body?.status === null ? null : normalizeConversationStatus(req.body?.status);
      if (!newStatus) {
        res.status(400).json({ error: "status must be active, waiting_internal, waiting_client, or resolved" });
        return;
      }
      patch.status = newStatus;
    }

    if (hasAssignee) {
      const assigneeUserId = normalizeNullableString(req.body?.assignee_user_id);
      assigneeProfile = await resolveProfile(assigneeUserId);
      patch.assignee_user_id = assigneeProfile?.id || null;
    }

    if (hasNextAction) {
      patch.next_action = normalizeNullableString(req.body?.next_action);
    }

    if (hasNextActionDueDate) {
      if (req.body?.next_action_due_date === null || req.body?.next_action_due_date === "") {
        patch.next_action_due_date = null;
      } else {
        const dueDate = normalizeDateOnly(req.body?.next_action_due_date);
        if (!dueDate) {
          res.status(400).json({ error: "next_action_due_date must be YYYY-MM-DD" });
          return;
        }
        patch.next_action_due_date = dueDate;
      }
    }

    if (hasSite) {
      siteSnapshot = await resolveSite(normalizeNullableString(req.body?.site_id), orgId);
      patch.site_id = siteSnapshot.site_id;
      patch.site_name_snapshot = siteSnapshot.site_name_snapshot;
    }

    if (hasTitle) {
      const title = normalizeString(req.body?.title);
      if (!title) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      patch.title = title;
    }

    const { error: updateError } = await supabaseAdmin
      .from("communication_conversations")
      .update(patch)
      .eq("org_id", orgId)
      .eq("id", conversationId);

    if (updateError) {
      throw updateError;
    }

    const logPromises: Promise<unknown>[] = [];

    if (hasStatus && newStatus && newStatus !== existing.status) {
      logPromises.push(
        insertLog({
          orgId,
          conversationId,
          channel: "system",
          direction: "internal",
          logKind: "status_change",
          body: `状態を「${newStatus}」へ変更しました。`,
          occurredAt: new Date().toISOString(),
          createdByType: "human",
          createdByUserId: req.userId || null,
          createdByName: req.userName || null,
          metadata: {
            previous_status: existing.status,
            next_status: newStatus,
          },
        })
      );
    }

    if (hasAssignee && existing.assignee_user_id !== (assigneeProfile?.id || null)) {
      logPromises.push(
        insertLog({
          orgId,
          conversationId,
          channel: "system",
          direction: "internal",
          logKind: "assignment_change",
          body: assigneeProfile
            ? `担当を「${assigneeProfile.full_name || assigneeProfile.username || assigneeProfile.id}」へ変更しました。`
            : "担当を解除しました。",
          occurredAt: new Date().toISOString(),
          createdByType: "human",
          createdByUserId: req.userId || null,
          createdByName: req.userName || null,
          metadata: {
            previous_assignee_user_id: existing.assignee_user_id,
            next_assignee_user_id: assigneeProfile?.id || null,
          },
        })
      );

      if (assigneeProfile) {
        logPromises.push(
          ensureParticipant({
            orgId,
            conversationId,
            participantKind: "internal",
            displayName: assigneeProfile.full_name || assigneeProfile.username || "担当者",
            profileId: assigneeProfile.id,
            isPrimary: false,
          })
        );
      }
    }

    if (
      (hasNextAction && existing.next_action !== (patch.next_action as string | null)) ||
      (hasNextActionDueDate && existing.next_action_due_date !== (patch.next_action_due_date as string | null)) ||
      (hasSite && existing.site_id !== (siteSnapshot?.site_id || null))
    ) {
      logPromises.push(
        insertLog({
          orgId,
          conversationId,
          channel: "system",
          direction: "internal",
          logKind: "summary_update",
          body: "次アクションまたは関連現場を更新しました。",
          occurredAt: new Date().toISOString(),
          createdByType: "human",
          createdByUserId: req.userId || null,
          createdByName: req.userName || null,
          metadata: {
            next_action: patch.next_action ?? existing.next_action,
            next_action_due_date: patch.next_action_due_date ?? existing.next_action_due_date,
            site_id: patch.site_id ?? existing.site_id,
          },
        })
      );
    }

    await Promise.all(logPromises);

    const detail = await loadConversationDetail(orgId, conversationId);
    res.json(detail);
  } catch (err) {
    console.error("[COMMUNICATIONS] update failed:", err);
    const message = err instanceof Error ? err.message : "";
    if (message === "SITE_NOT_FOUND") {
      res.status(404).json({ error: "指定した現場が見つかりません" });
      return;
    }
    if (message === "PROFILE_NOT_FOUND") {
      res.status(404).json({ error: "指定した担当者が見つかりません" });
      return;
    }
    if (isMissingCommunicationSchemaError(err)) {
      respondMissingSchema(res);
      return;
    }
    res.status(500).json({ error: "連絡会話の更新に失敗しました" });
  }
});

export default router;
