import { getAuthToken } from "./supabase";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:4001";

export const api = async <T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> => {
    const token = await getAuthToken();

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...options.headers,
        },
    });

    if (!response.ok) {
        let errorMessage = `API Error: ${response.status}`;
        try {
            const errorBody = await response.json();
            if (typeof errorBody?.error === "string") {
                errorMessage = errorBody.error;
            } else if (typeof errorBody?.message === "string") {
                errorMessage = errorBody.message;
            }
        } catch {
            // JSON parse failed — use default message
        }
        throw new Error(errorMessage);
    }

    return response.json();
};

function getErrorMessageFromResponse(response: Response): Promise<string> {
    return response
        .json()
        .then((body) => {
            if (typeof body?.error === "string") {
                return body.error;
            }
            if (typeof body?.message === "string") {
                return body.message;
            }
            return `API Error: ${response.status}`;
        })
        .catch(() => `API Error: ${response.status}`);
}

function parseFilenameFromDisposition(contentDisposition: string | null): string | null {
    if (!contentDisposition) {
        return null;
    }

    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
        return decodeURIComponent(utf8Match[1]);
    }

    const basicMatch = contentDisposition.match(/filename="([^"]+)"/i);
    if (basicMatch?.[1]) {
        return basicMatch[1];
    }

    return null;
}

// ============================================================
// Proposals
// ============================================================

export type ProposalType =
    | "expense.create"
    | "expense.update"
    | "expense.void"
    | "income.create"
    | "income.update"
    | "invoice.create"
    | "invoice.send"
    | "invoice.mark_paid"
    | "reward.calculate"
    | "reward.adjust"
    | "skill.achieve"
    | "skill.revoke"
    | "evaluation.submit"
    | "evaluation.finalize"
    | "assignment.create"
    | "assignment.update"
    | "assignment.cancel"
    | "communication.review"
    | "communication.task"
    | "task.revision.request"
    | "site.create"
    | "site.complete"
    | "policy.update"
    | "luqo.catalog.add"
    | "luqo.star.achieve"
    | "luqo.score.update"
    | "luqo.reward.calculate";

export type ProposalStatus = "draft" | "pending" | "approved" | "rejected" | "executed";

export type ProposalActorType = "human" | "ai" | "system" | "integration";

export interface ProposalActorRef {
    type: ProposalActorType;
    id: string;
    name: string;
}

export interface ProposalApproval {
    actor: ProposalActorRef;
    decision: "approve" | "reject";
    reason?: string;
    at: string;
}

export interface ProposalRecord {
    id: string;
    org_id: string;
    type: ProposalType;
    status: ProposalStatus;
    document_id?: string | null;
    site_id?: string | null;
    created_by: ProposalActorRef;
    payload: Record<string, unknown>;
    description: string;
    policy_ref?: string;
    approvals: ProposalApproval[];
    required_approvals: number;
    executed_at?: string;
    executed_by?: ProposalActorRef;
    result_event_id?: string;
    rejection_reason?: string;
    created_at: string;
    updated_at: string;
}

export interface ProposalApprovalResponse {
    proposal: ProposalRecord;
    is_fully_approved: boolean;
    auto_executed: boolean;
}

export interface ProposalBatchApprovalItem {
    proposal_id: string;
    success: boolean;
    proposal?: ProposalRecord;
    is_fully_approved?: boolean;
    auto_executed?: boolean;
    error?: string;
}

export interface ProposalBatchRejectItem {
    proposal_id: string;
    success: boolean;
    proposal?: ProposalRecord;
    error?: string;
}

export interface ProposalBatchApprovalResponse {
    total: number;
    success_count: number;
    failed_count: number;
    results: ProposalBatchApprovalItem[];
}

export interface ProposalBatchRejectResponse {
    total: number;
    success_count: number;
    failed_count: number;
    results: ProposalBatchRejectItem[];
}

export interface ProposalInstructionResponse {
    proposal: ProposalRecord;
    auto_approved: boolean;
    auto_executed: boolean;
    submitted: boolean;
}

export const fetchPendingProposals = () =>
    api<ProposalRecord[]>("/api/v1/proposals/pending");

export const fetchExecutableProposals = () =>
    api<ProposalRecord[]>("/api/v1/proposals?status=approved");

export const fetchProposals = (params?: {
    status?: ProposalStatus;
    type?: ProposalType;
    site_id?: string;
    limit?: number;
    offset?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    if (params?.type) searchParams.append("type", params.type);
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.append("offset", String(params.offset));
    const query = searchParams.toString();
    return api<ProposalRecord[]>(`/api/v1/proposals${query ? `?${query}` : ""}`);
};

export const approveProposal = (proposalId: string, reason?: string) =>
    api<ProposalApprovalResponse>(`/api/v1/proposals/${proposalId}/approve`, {
        method: "POST",
        body: JSON.stringify({ reason }),
    });

export const approveProposalsBatch = (proposalIds: string[], reason?: string) =>
    api<ProposalBatchApprovalResponse>("/api/v1/proposals/approve/batch", {
        method: "POST",
        body: JSON.stringify({ proposal_ids: proposalIds, reason }),
    });

export const rejectProposal = (proposalId: string, reason: string) =>
    api<ProposalRecord>(`/api/v1/proposals/${proposalId}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
    });

export const instructProposal = (proposalId: string, instruction: string) =>
    api<ProposalInstructionResponse>(`/api/v1/proposals/${proposalId}/instruct`, {
        method: "POST",
        body: JSON.stringify({ instruction }),
    });

export const rejectProposalsBatch = (proposalIds: string[], reason: string) =>
    api<ProposalBatchRejectResponse>("/api/v1/proposals/reject/batch", {
        method: "POST",
        body: JSON.stringify({ proposal_ids: proposalIds, reason }),
    });

export const executeProposal = (proposalId: string) =>
    api<ProposalRecord>(`/api/v1/proposals/${proposalId}/execute`, {
        method: "POST",
    });

export interface SimulatorProposalRequest {
    worker_id: string;
    slot_id: string;
    site_id: string;
    site_name: string;
    date: string;
    warning_codes?: string[];
}

export interface SimulatorCommitItemResult {
    placement_index: number;
    success: boolean;
    proposal_id?: string;
    auto_approved?: boolean;
    auto_executed?: boolean;
    error?: string;
}

export interface SimulatorCommitResponse {
    ok: boolean;
    total_proposals: number;
    pending_count: number;
    auto_approved_count: number;
    proposal_ids: string[];
    results: SimulatorCommitItemResult[];
    message: string;
}

function getPromiseErrorMessage(reason: unknown): string {
    if (reason instanceof Error && reason.message) {
        return reason.message;
    }
    return "Unknown error";
}

export const commitSimulatorDraft = async (
    placements: SimulatorProposalRequest[],
    overrideReason?: string
): Promise<SimulatorCommitResponse> => {
    const normalizedOverrideReason = overrideReason?.trim();
    const settledResults = await Promise.allSettled(
        placements.map((placement) => {
            const hasWarnings =
                Array.isArray(placement.warning_codes) &&
                placement.warning_codes.length > 0;
            const overridePayload =
                normalizedOverrideReason && hasWarnings
                    ? {
                          override: {
                              reason: normalizedOverrideReason,
                              risk_codes: placement.warning_codes,
                          },
                          override_reason: normalizedOverrideReason,
                      }
                    : {};

            return api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>(
                "/api/v1/proposals/create-and-submit",
                {
                    method: "POST",
                    body: JSON.stringify({
                        type: "assignment.create",
                        payload: {
                            worker_id: placement.worker_id,
                            slot_id: placement.slot_id,
                            site_id: placement.site_id,
                            site_name: placement.site_name,
                            date: placement.date,
                            ...overridePayload,
                        },
                        description: `${placement.site_name}（${placement.date}）への配置`,
                    }),
                }
            );
        })
    );

    const results: SimulatorCommitItemResult[] = settledResults.map((settled, index) => {
        if (settled.status === "fulfilled") {
            return {
                placement_index: index,
                success: true,
                proposal_id: settled.value.proposal.id,
                auto_approved: settled.value.auto_approved,
                auto_executed: settled.value.auto_executed,
            };
        }

        return {
            placement_index: index,
            success: false,
            error: getPromiseErrorMessage(settled.reason),
        };
    });

    const succeeded = results.filter((result) => result.success);
    const autoApprovedCount = succeeded.filter((result) => result.auto_approved).length;
    const pendingCount = succeeded.length - autoApprovedCount;
    const proposalIds = succeeded
        .map((result) => result.proposal_id)
        .filter((proposalId): proposalId is string => typeof proposalId === "string");
    const failedCount = results.length - succeeded.length;

    const ok = succeeded.length > 0;
    let message: string;
    if (!ok) {
        message = "Proposalの作成に失敗しました。";
    } else if (failedCount > 0) {
        message = `${succeeded.length}件成功、${failedCount}件失敗しました（${pendingCount}件は承認待ち）。`;
    } else if (pendingCount > 0) {
        message = `${succeeded.length}件のProposalを作成しました（${pendingCount}件は承認待ち）。`;
    } else {
        message = `${succeeded.length}件のProposalを作成し、自動承認対象として送信しました。`;
    }

    return {
        ok,
        total_proposals: results.length,
        pending_count: pendingCount,
        auto_approved_count: autoApprovedCount,
        proposal_ids: proposalIds,
        results,
        message,
    };
};

export type CommunicationConversationStatus = "active" | "waiting_internal" | "waiting_client" | "resolved";

export type CommunicationChannel =
    | "gmail"
    | "phone"
    | "line"
    | "in_person"
    | "sms"
    | "manual"
    | "system";

export type CommunicationDirection = "inbound" | "outbound" | "internal";

export type CommunicationLogKind =
    | "message"
    | "note"
    | "status_change"
    | "assignment_change"
    | "summary_update"
    | "proposal_link";

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

export interface CommunicationConversationRecord {
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

export interface CommunicationLogRecord {
    id: string;
    channel: CommunicationChannel;
    direction: CommunicationDirection;
    log_kind: CommunicationLogKind;
    subject: string | null;
    body: string;
    summary: string | null;
    occurred_at: string;
    created_by_type: ProposalActorType;
    created_by_name: string | null;
    external_source: string | null;
    external_id: string | null;
    metadata: Record<string, unknown>;
    created_at: string;
}

export interface CommunicationParticipantRecord {
    id: string;
    participant_kind: "client" | "internal" | "integration";
    display_name: string;
    email: string | null;
    phone: string | null;
    is_primary: boolean;
    profile: CommunicationMemberSummary | null;
    created_at: string;
}

export interface CommunicationDetailRecord {
    conversation: CommunicationConversationRecord;
    logs: CommunicationLogRecord[];
    participants: CommunicationParticipantRecord[];
    related_proposals: ProposalRecord[];
}

export interface CreateCommunicationConversationRequest {
    title: string;
    channel: Exclude<CommunicationChannel, "system">;
    direction: CommunicationDirection;
    body: string;
    subject?: string;
    summary?: string;
    occurred_at?: string;
    status?: CommunicationConversationStatus;
    assignee_user_id?: string | null;
    site_id?: string | null;
    next_action?: string | null;
    next_action_due_date?: string | null;
    participant_name?: string | null;
    participant_email?: string | null;
    participant_phone?: string | null;
    log_kind?: Exclude<CommunicationLogKind, "proposal_link">;
}

export interface CreateCommunicationLogRequest {
    channel: Exclude<CommunicationChannel, "system">;
    direction: CommunicationDirection;
    body: string;
    subject?: string;
    summary?: string;
    occurred_at?: string;
    participant_name?: string | null;
    participant_email?: string | null;
    participant_phone?: string | null;
    log_kind?: Exclude<CommunicationLogKind, "proposal_link">;
}

export interface UpdateCommunicationConversationRequest {
    title?: string;
    status?: CommunicationConversationStatus;
    assignee_user_id?: string | null;
    site_id?: string | null;
    next_action?: string | null;
    next_action_due_date?: string | null;
}

export const fetchCommunications = (params?: {
    limit?: number;
    offset?: number;
    status?: CommunicationConversationStatus;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    if (params?.offset !== undefined) searchParams.append("offset", String(params.offset));
    if (params?.status) searchParams.append("status", params.status);
    const query = searchParams.toString();
    return api<CommunicationConversationRecord[]>(`/api/v1/communications${query ? `?${query}` : ""}`);
};

export const fetchCommunicationDetail = (conversationId: string) =>
    api<CommunicationDetailRecord>(`/api/v1/communications/${encodeURIComponent(conversationId)}`);

export const createCommunicationConversation = (payload: CreateCommunicationConversationRequest) =>
    api<CommunicationDetailRecord>("/api/v1/communications", {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const addCommunicationLog = (
    conversationId: string,
    payload: CreateCommunicationLogRequest
) =>
    api<CommunicationDetailRecord>(`/api/v1/communications/${encodeURIComponent(conversationId)}/logs`, {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const updateCommunicationConversation = (
    conversationId: string,
    payload: UpdateCommunicationConversationRequest
) =>
    api<CommunicationDetailRecord>(`/api/v1/communications/${encodeURIComponent(conversationId)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
    });

export interface NotificationRecord {
    id: string;
    user_id: string;
    type: "auto_quest" | "approval_required" | "approval_result" | "schedule_conflict" | "system_alert";
    title: string;
    message: string;
    data: Record<string, unknown>;
    read: boolean;
    created_at: string;
}

export const fetchNotifications = (params?: { unread_only?: boolean; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.unread_only !== undefined) searchParams.append("unread_only", String(params.unread_only));
    if (params?.limit) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<NotificationRecord[]>(`/api/v1/notifications${query ? `?${query}` : ""}`);
};

export const markNotificationRead = (notificationId: string) =>
    api<NotificationRecord>(`/api/v1/notifications/${notificationId}/read`, {
        method: "POST",
    });

export const markAllNotificationsRead = () =>
    api<{ updated_count: number }>("/api/v1/notifications/read-all", {
        method: "POST",
    });

export type FocusItemScope = "personal" | "org";
export type FocusItemHorizon = "today" | "week" | "later";
export type FocusItemStatus = "open" | "done";

export interface FocusItemRecord {
    id: string;
    org_id: string;
    scope: FocusItemScope;
    horizon: FocusItemHorizon;
    status: FocusItemStatus;
    title: string;
    note?: string | null;
    site_id?: string | null;
    site_name_snapshot?: string | null;
    created_by: string;
    completed_by?: string | null;
    completed_at?: string | null;
    created_at: string;
    updated_at: string;
}

export interface FocusItemUpsertRequest {
    title: string;
    scope: FocusItemScope;
    horizon: FocusItemHorizon;
    note?: string;
    site_id?: string;
    status?: FocusItemStatus;
}

export const fetchFocusItems = (params?: {
    scope?: FocusItemScope;
    horizon?: FocusItemHorizon;
    status?: FocusItemStatus;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.scope) searchParams.append("scope", params.scope);
    if (params?.horizon) searchParams.append("horizon", params.horizon);
    if (params?.status) searchParams.append("status", params.status);
    const query = searchParams.toString();
    return api<FocusItemRecord[]>(`/api/v1/focus-items${query ? `?${query}` : ""}`);
};

export const createFocusItem = (payload: FocusItemUpsertRequest) =>
    api<FocusItemRecord>("/api/v1/focus-items", {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const updateFocusItem = (focusItemId: string, payload: FocusItemUpsertRequest & { status: FocusItemStatus }) =>
    api<FocusItemRecord>(`/api/v1/focus-items/${focusItemId}`, {
        method: "PUT",
        body: JSON.stringify(payload),
    });

export const completeFocusItem = (focusItemId: string) =>
    api<FocusItemRecord>(`/api/v1/focus-items/${focusItemId}/complete`, {
        method: "POST",
    });

export const reopenFocusItem = (focusItemId: string) =>
    api<FocusItemRecord>(`/api/v1/focus-items/${focusItemId}/reopen`, {
        method: "POST",
    });

// 現場
export const fetchSites = () => api<Site[]>("/api/v1/sites");
export const fetchSite = (id: string) => api<Site>(`/api/v1/sites/${id}`);
export const createSite = (site: Partial<Site>) =>
    api<Site>("/api/v1/sites", { method: "POST", body: JSON.stringify(site) });
export const updateSite = (id: string, site: Partial<Site>) =>
    api<Site>(`/api/v1/sites/${id}`, { method: "PUT", body: JSON.stringify(site) });
export const completeSite = (id: string) =>
    api<Site>(`/api/v1/sites/${id}/complete`, { method: "POST" });
export const deleteSite = (id: string, reason: string) =>
    api<Site>(`/api/v1/sites/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
export const fetchMembers = () =>
    api<Member[]>("/api/v1/sites/members");
export const fetchClients = (params?: { status?: "active" | "deleted" | "all" }) => {
    const searchParams = new URLSearchParams();
    if (params?.status) searchParams.append("status", params.status);
    const query = searchParams.toString();
    return api<Client[]>(`/api/v1/sites/clients${query ? `?${query}` : ""}`);
};
export const createClient = (client: CreateClientRequest) =>
    api<Client>("/api/v1/sites/clients", { method: "POST", body: JSON.stringify(client) });
export const updateClient = (id: string, client: UpdateClientRequest) =>
    api<Client>(`/api/v1/sites/clients/${id}`, { method: "PUT", body: JSON.stringify(client) });
export const deleteClient = (id: string, reason: string) =>
    api<Client>(`/api/v1/sites/clients/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
export const restoreClient = (id: string) =>
    api<Client>(`/api/v1/sites/clients/${id}/restore`, { method: "POST" });
export const scanBusinessCard = (data: {
    file_base64: string;
    mime_type: string;
    provider?: "gemini" | "openai" | "anthropic";
}) =>
    api<BusinessCardClientDraft>("/api/v1/sites/clients/scan-business-card", {
        method: "POST",
        body: JSON.stringify(data),
    });
export const fetchSiteDocuments = (siteId: string) =>
    api<SiteDocument[]>(`/api/v1/sites/${siteId}/documents`);
export const uploadSiteDocument = (siteId: string, data: { file_base64: string; mime_type: string; original_filename?: string }) =>
    api<SiteDocument>(`/api/v1/sites/${siteId}/documents`, { method: "POST", body: JSON.stringify(data) });
export const fetchSiteLineItems = (siteId: string) =>
    api<SiteLineItem[]>(`/api/v1/sites/${siteId}/line-items`);
export const saveSiteLineItems = (siteId: string, items: SiteLineItemInput[]) =>
    api<SiteLineItem[]>(`/api/v1/sites/${siteId}/line-items`, { method: "PUT", body: JSON.stringify({ items }) });
export const parseSiteDraftFromText = (text: string) =>
    api<SiteDraftFromText>("/api/v1/sites/draft-from-text", {
        method: "POST",
        body: JSON.stringify({ text }),
    });

// シェルパ
export const chatWithSherpa = (message: string, context?: ChatMessage[]) =>
    api<{ reply: string }>("/api/v1/sherpa/chat", { method: "POST", body: JSON.stringify({ message, context }) });
export const checkExpense = (description: string, amount: number, category: string) =>
    api<ExpenseCheck>("/api/v1/sherpa/expense-check", { method: "POST", body: JSON.stringify({ description, amount, category }) });
export interface SherpaProposalCreateRequest {
    type: ProposalType;
    payload: Record<string, unknown>;
    description: string;
    submit?: boolean;
}
export interface SherpaProposalCreateResponse {
    proposal: ProposalRecord;
    auto_approved: boolean;
    auto_executed: boolean;
    submitted: boolean;
}
export const createProposalFromSherpa = (data: SherpaProposalCreateRequest) =>
    api<SherpaProposalCreateResponse>("/api/v1/sherpa/proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

// 経理Sherpa
export const accountingChatWithSherpa = (message: string, context?: ChatMessage[], provider?: string) =>
    api<{ reply: string }>("/api/v1/sherpa/accounting-chat", { method: "POST", body: JSON.stringify({ message, context, provider }) });

// 型定義
export interface Member {
    id: string;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
}

export interface Client {
    id: string;
    org_id?: string;
    name: string;
    department?: string | null;
    contact_person?: string | null;
    email?: string | null;
    phone?: string | null;
    postal_code?: string | null;
    prefecture?: string | null;
    city?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    address?: string | null;
    billing_name?: string | null;
    billing_postal_code?: string | null;
    billing_prefecture?: string | null;
    billing_city?: string | null;
    billing_address_line1?: string | null;
    billing_address_line2?: string | null;
    billing_address?: string | null;
    payment_terms?: string | null;
    invoice_notes_default?: string | null;
    created_at: string;
    updated_at?: string | null;
    deleted_at?: string | null;
    deleted_by?: string | null;
    deletion_reason?: string | null;
}

export interface CreateClientRequest {
    name: string;
    department?: string;
    contact_person?: string;
    email?: string;
    phone?: string;
    postal_code?: string;
    prefecture?: string;
    city?: string;
    address_line1?: string;
    address_line2?: string;
    address?: string;
    billing_name?: string;
    billing_postal_code?: string;
    billing_prefecture?: string;
    billing_city?: string;
    billing_address_line1?: string;
    billing_address_line2?: string;
    billing_address?: string;
    payment_terms?: string;
    invoice_notes_default?: string;
}

export type UpdateClientRequest = CreateClientRequest;

export interface BusinessCardClientDraft {
    name?: string | null;
    department?: string | null;
    contact_person?: string | null;
    email?: string | null;
    phone?: string | null;
    postal_code?: string | null;
    prefecture?: string | null;
    city?: string | null;
    address_line1?: string | null;
    address_line2?: string | null;
    raw_text?: string | null;
}

export interface Site {
    id: string;
    org_id?: string;
    name: string;
    address?: string;
    area_sqm?: number;
    work_types?: string[];
    estimated_hours?: number;
    actual_hours?: number;
    revenue?: number;
    status: string;
    client_id?: string;
    client?: { id: string; name: string };
    assigned_users?: string[];
    started_at?: string;
    expected_completion_at?: string;
    schedule_mode?: "continuous" | "weekdays" | "custom";
    working_weekdays?: number[];
    custom_work_dates?: string[];
    created_at: string;
    completed_at?: string;
    description?: string;
    cautions?: string;
}

export interface SiteDocument {
    id: string;
    doc_type: string;
    original_filename?: string;
    mime_type?: string;
    file_size?: number;
    storage_path?: string;
    drive_file_url?: string;
    signed_url?: string;
    created_at: string;
}

export interface SiteLineItem {
    id: string;
    site_id: string;
    item_name: string;
    quantity: number | null;
    unit_name: string | null;
    unit_price: number | null;
    sort_order: number;
    created_by: string | null;
    created_at: string;
    updated_by: string | null;
    updated_at: string;
}

export interface SiteLineItemInput {
    id?: string;
    item_name: string;
    quantity?: number | null;
    unit_name?: string;
    unit_price?: number | null;
    sort_order?: number;
}

export interface SiteDraftFromText {
    name?: string | null;
    address?: string | null;
    client_name?: string | null;
    started_at?: string | null;
    expected_completion_at?: string | null;
    schedule_mode?: "continuous" | "weekdays" | "custom" | null;
    working_weekdays?: number[];
    cautions?: string | null;
    line_items: SiteLineItemInput[];
    detected_fields: number;
    confidence: number;
}

export interface ChatMessage {
    role: "user" | "assistant";
    content: string;
}

export interface ExpenseCheck {
    suspicious: boolean;
    reason: string;
    suggestion: string;
}

// ============================================================
// 経理（Accounting）
// ============================================================

// ドキュメントアップロード
export const uploadDocument = (data: {
    file_base64: string;
    mime_type: string;
    original_filename?: string;
    doc_type: "receipt" | "invoice" | "contract" | "other";
    site_id?: string;
    client_id?: string;
}) => api<AccountingDocument>("/api/v1/accounting/documents", {
    method: "POST",
    body: JSON.stringify(data),
});

// OCR解析
export const analyzeDocumentOcr = (document_id: string) =>
    api<AccountingDocument>("/api/v1/accounting/ocr/analyze", {
        method: "POST",
        body: JSON.stringify({ document_id }),
    });

// 経費登録
export const createExpense = (data: CreateExpenseRequest) =>
    api<AccountingTransaction>("/api/v1/accounting/expenses", {
        method: "POST",
        body: JSON.stringify(data),
    });

// 経費承認/否認
export const reviewExpense = (id: string, action: "approve" | "reject", comment?: string) =>
    api<AccountingTransaction>(`/api/v1/accounting/expenses/${id}/review`, {
        method: "POST",
        body: JSON.stringify({ action, comment }),
    });

// 一括承認/否認
export const batchReviewExpenses = (ids: string[], action: "approve" | "reject", comment?: string) =>
    api<BatchReviewResult>("/api/v1/accounting/expenses/batch-review", {
        method: "POST",
        body: JSON.stringify({ ids, action, comment }),
    });

export interface BatchReviewResult {
    success: string[];
    failed: Array<{ id: string; error: string }>;
}

// 売上登録
export const createSale = (data: CreateSaleRequest) =>
    api<AccountingTransaction>("/api/v1/accounting/sales", {
        method: "POST",
        body: JSON.stringify(data),
    });

// 請求書作成
export const createInvoice = (data: CreateInvoiceRequest) =>
    api<AccountingInvoice>("/api/v1/accounting/invoices", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const correctInvoice = (invoiceId: string, data: CorrectInvoiceRequest) =>
    api<AccountingInvoice>(`/api/v1/accounting/invoices/${invoiceId}/correct`, {
        method: "POST",
        body: JSON.stringify(data),
    });

export const createInvoiceSupplement = (invoiceId: string, data: CreateInvoiceSupplementRequest) =>
    api<AccountingInvoice>(`/api/v1/accounting/invoices/${invoiceId}/supplement`, {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchInvoices = (params?: {
    limit?: number;
    offset?: number;
    source_transaction_id?: string;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append("limit", String(params.limit));
    if (params?.offset) searchParams.append("offset", String(params.offset));
    if (params?.source_transaction_id) searchParams.append("source_transaction_id", params.source_transaction_id);
    const query = searchParams.toString();
    return api<AccountingInvoiceListItem[]>(`/api/v1/accounting/invoices${query ? `?${query}` : ""}`);
};

export const fetchInvoiceSettings = () =>
    api<InvoiceSettings>("/api/v1/accounting/invoice-settings");

export const updateInvoiceSettings = (data: UpdateInvoiceSettingsRequest) =>
    api<InvoiceSettings>("/api/v1/accounting/invoice-settings", {
        method: "PUT",
        body: JSON.stringify(data),
    });

export const fetchInvoiceEligibility = (transactionId: string) =>
    api<InvoiceEligibility>(`/api/v1/accounting/invoice-eligibility/${transactionId}`);

export const fetchInvoiceEligibilityForTransactions = (transactionIds: string[]) =>
    api<InvoiceEligibility>("/api/v1/accounting/invoice-eligibility", {
        method: "POST",
        body: JSON.stringify({ transaction_ids: transactionIds }),
    });

export const fetchInvoiceCandidates = (params?: {
    client_id?: string;
    date_from?: string;
    date_to?: string;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.client_id) searchParams.append("client_id", params.client_id);
    if (params?.date_from) searchParams.append("date_from", params.date_from);
    if (params?.date_to) searchParams.append("date_to", params.date_to);
    const query = searchParams.toString();
    return api<AccountingTransaction[]>(`/api/v1/accounting/invoice-candidates${query ? `?${query}` : ""}`);
};

export const downloadInvoicePdf = async (invoiceId: string): Promise<{ blob: Blob; filename: string }> => {
    const token = await getAuthToken();
    const response = await fetch(`${API_BASE}/api/v1/accounting/invoices/${invoiceId}/download`, {
        cache: "no-store",
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        throw new Error(await getErrorMessageFromResponse(response));
    }

    const filename = parseFilenameFromDisposition(response.headers.get("Content-Disposition"))
        || `${invoiceId}.pdf`;

    return {
        blob: await response.blob(),
        filename,
    };
};

// 取消（逆仕訳）
export const voidTransaction = (id: string, reason: string) =>
    api<{ original_voided: string; reversal_created: string }>(`/api/v1/accounting/void/${id}`, {
        method: "POST",
        body: JSON.stringify({ reason }),
    });

// 月次PL取得
export const fetchPL = (params?: { month?: string; site_id?: string; cost_center?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.cost_center) searchParams.append("cost_center", params.cost_center);
    const query = searchParams.toString();
    return api<PLReport>(`/api/v1/accounting/pl${query ? `?${query}` : ""}`);
};

// 取引一覧
export const fetchTransactions = (params?: {
    kind?: "expense" | "sale" | "invoice";
    status?: string;
    limit?: number;
    offset?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.kind) searchParams.append("kind", params.kind);
    if (params?.status) searchParams.append("status", params.status);
    if (params?.limit) searchParams.append("limit", String(params.limit));
    if (params?.offset) searchParams.append("offset", String(params.offset));
    const query = searchParams.toString();
    return api<AccountingTransaction[]>(`/api/v1/accounting/transactions${query ? `?${query}` : ""}`);
};

// 未承認取引一覧
export const fetchPendingApprovals = () =>
    api<AccountingTransaction[]>("/api/v1/accounting/pending-approvals");

// 取引検索
export const searchTransactions = (params: {
    q?: string;
    kind?: "expense" | "sale" | "invoice";
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params.q) searchParams.append("q", params.q);
    if (params.kind) searchParams.append("kind", params.kind);
    if (params.date_from) searchParams.append("date_from", params.date_from);
    if (params.date_to) searchParams.append("date_to", params.date_to);
    if (params.limit) searchParams.append("limit", String(params.limit));
    if (params.offset) searchParams.append("offset", String(params.offset));
    const query = searchParams.toString();
    return api<AccountingTransaction[]>(`/api/v1/accounting/transactions/search${query ? `?${query}` : ""}`);
};

// 経理型定義
export interface AccountingDocument {
    id: string;
    doc_type: string;
    storage_path?: string | null;
    gmail_message_id?: string | null;
    gmail_attachment_id?: string | null;
    drive_file_id?: string | null;
    drive_file_url?: string | null;
    drive_folder_id?: string | null;
    original_filename?: string;
    mime_type: string;
    file_size: number;
    sha256: string;
    ocr_text?: string | null;
    ocr_provider?: string;
    ocr_blocks?: OcrBlock[];
    ocr_fields?: OcrFields;
    field_provenance?: Record<string, { source: string; at: string }>;
    uploaded_by: string;
    site_id?: string;
    client_id?: string;
    created_at: string;
}

export interface OcrBlock {
    page?: number;
    text: string;
    bbox: { x0: number; y0: number; x1: number; y1: number };
    confidence?: number;
}

export interface OcrFieldValue {
    value: string | number;
    confidence: number;
    bbox_refs: number[];
}

export interface OcrFields {
    total_amount?: OcrFieldValue;
    tax_amount?: OcrFieldValue;
    subtotal?: OcrFieldValue;
    vendor_name?: OcrFieldValue;
    date?: OcrFieldValue;
    items?: Array<{
        name: OcrFieldValue;
        quantity?: OcrFieldValue;
        unit_price?: OcrFieldValue;
        amount?: OcrFieldValue;
    }>;
    [key: string]: OcrFieldValue | undefined | unknown;
}

export interface AccountingTransaction {
    id: string;
    kind: "expense" | "sale" | "invoice";
    cost_center: "HQ" | "SITE";
    site_id?: string;
    client_id?: string;
    vendor_name?: string;
    description?: string;
    recorded_date: string;
    amount_subtotal: number;
    tax_amount: number;
    amount_total: number;
    category?: string;
    expense_item_code?: string;
    expense_item_other?: string;
    tax_category?: "10_STANDARD" | "08_REDUCED" | "00_EXEMPT" | "00_TAXFREE";
    risk_level?: "LOW" | "HIGH";
    status: "draft" | "pending_review" | "posted" | "approved" | "rejected" | "voided";
    review_status?: "pending" | "approved" | "rejected";
    reviewer_id?: string;
    reviewed_at?: string;
    review_comment?: string;
    source_document_id?: string;
    source_document?: AccountingDocument;
    input_sources?: Record<string, "ocr" | "manual">;
    created_by: string;
    created_at: string;
    voided_by?: string;
    voided_at?: string;
    void_reason?: string;
    voids_transaction_id?: string;
    site?: { id: string; name: string };
    client?: { id: string; name: string };
    reviewer?: { id: string; full_name: string };
    items?: AccountingTransactionItem[];
}

export interface AccountingTransactionItem {
    item_name: string;
    quantity?: number | null;
    unit_name?: string | null;
    unit_price?: number | null;
    amount?: number | null;
}

export interface CreateExpenseRequest {
    cost_center?: "HQ" | "SITE";
    site_id?: string;
    vendor_name?: string;
    description?: string;
    recorded_date?: string;
    amount_subtotal?: number;
    tax_amount?: number;
    amount_total?: number;
    category?: string;
    expense_item_code?: string;
    expense_item_other?: string;
    tax_category?: "10_STANDARD" | "08_REDUCED" | "00_EXEMPT" | "00_TAXFREE";
    source_document_id?: string;
    input_sources?: Record<string, "ocr" | "manual">;
}

export interface CreateSaleRequest {
    site_id?: string;
    client_id?: string;
    description?: string;
    recorded_date?: string;
    unit_name?: string;
    unit_price?: number;
    quantity?: number;
    items?: Array<{
        item_name: string;
        quantity: number;
        unit_name: string;
        unit_price: number;
    }>;
    amount_subtotal?: number;
    tax_amount?: number;
    amount_total?: number;
    source_document_id?: string;
    input_sources?: Record<string, "ocr" | "manual">;
}

export interface CreateInvoiceRequest {
    transaction_id?: string;
    source_transaction_ids?: string[];
    issue_date?: string;
    due_date?: string;
    billing_name?: string;
    billing_address?: string;
    notes?: string;
    requested_document_type?: "auto" | "standard_invoice" | "qualified_invoice";
}

export interface CorrectInvoiceRequest {
    billing_name: string;
    billing_address?: string;
    notes?: string;
    correction_reason_type: string;
    correction_note: string;
    corrected_line_items?: AccountingTransactionItem[];
}

export interface CreateInvoiceSupplementRequest {
    issue_date?: string;
    correction_reason_type: string;
    correction_note: string;
    supplement_line_items?: AccountingTransactionItem[];
}

export interface InvoiceSettings {
    org_id: string;
    issuer_name: string;
    issuer_address?: string | null;
    issuer_contact?: string | null;
    bank_account_text?: string | null;
    invoice_issuer_status: "unregistered" | "applied" | "registered";
    qualified_invoice_registration_number?: string | null;
    qualified_invoice_registered_at?: string | null;
    invoice_notes_default?: string | null;
}

export interface UpdateInvoiceSettingsRequest {
    issuer_name: string;
    issuer_address?: string;
    issuer_contact?: string;
    bank_account_text?: string;
    invoice_issuer_status: "unregistered" | "applied" | "registered";
    qualified_invoice_registration_number?: string;
    qualified_invoice_registered_at?: string;
    invoice_notes_default?: string;
}

export interface InvoiceEligibility {
    transaction_id: string;
    transaction_ids?: string[];
    source_transaction_date: string;
    source_period_start?: string;
    source_period_end?: string;
    source_count?: number;
    issuer_status: "unregistered" | "applied" | "registered";
    resolved_document_type: "standard_invoice" | "qualified_invoice";
    eligible_for_qualified_invoice: boolean;
    reason_codes: string[];
    reason_messages: string[];
}

export interface InvoiceSourceSummary {
    source_count: number;
    site_count: number;
    client_id?: string | null;
    client_name?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    site_names: string[];
    amount_subtotal: number;
    tax_amount: number;
    amount_total: number;
    currency: string;
}

export interface AccountingInvoice {
    id: string;
    transaction_id: string;
    source_transaction_id?: string;
    invoice_no: string;
    document_type?: "standard_invoice" | "qualified_invoice" | "invoice_supplement";
    issue_date: string;
    due_date?: string;
    billing_name?: string;
    billing_address?: string;
    notes?: string;
    pdf_render_status?: "pending" | "generated" | "failed" | "locked";
    eligibility?: InvoiceEligibility;
    source_summary?: InvoiceSourceSummary | null;
    display_line_items?: AccountingTransactionItem[];
    created_by: string;
    created_at: string;
}

export interface AccountingInvoiceListItem extends AccountingInvoice {
    source_transaction_date?: string;
    source_transaction?: {
        id: string;
        description?: string;
        amount_total: number;
        status: "draft" | "pending_review" | "posted" | "approved" | "rejected" | "voided";
        recorded_date: string;
        site?: { id: string; name: string };
        client?: { id: string; name: string };
    } | null;
    source_summary?: InvoiceSourceSummary | null;
}

export interface PLReport {
    month: string;
    sales: number;
    expenses: number;
    profit: number;
    distributable: number;
    transaction_count: number;
}

// ============================================================
// PATH評価システム
// ============================================================

export const PATH_BIG_SKILL_KEYS = [
    "cross_work",
    "putty_foundation",
    "planning_preparation",
    "quality_stability",
    "site_trust",
    "education_support",
] as const;

export const PATH_BIG_SKILL_STATE_OPTIONS = [
    "unverified",
    "assist_required",
    "conditional",
    "near_independent",
    "stable_independent",
] as const;

export const PATH_LEVEL_OPTIONS = ["L1", "L2", "L3", "L4"] as const;

export const PATH_CERTIFICATION_STATUS_OPTIONS = [
    "candidate",
    "verified",
    "review_required",
    "revoked",
] as const;

export type PathBigSkillKey = (typeof PATH_BIG_SKILL_KEYS)[number];
export type PathBigSkillState = (typeof PATH_BIG_SKILL_STATE_OPTIONS)[number];
export type PathLevel = (typeof PATH_LEVEL_OPTIONS)[number];
export type PathCertificationStatus = (typeof PATH_CERTIFICATION_STATUS_OPTIONS)[number];

export interface PathMonthlyEvaluationForm {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    selected_big_skill_states: Partial<Record<PathBigSkillKey, PathBigSkillState>>;
    selected_roles: string[];
    site_ids: string[];
    photo_flag: boolean;
    rework_flag: "none" | "minor" | "major";
    comment: string;
    submitted_at: string;
    updated_at: string;
}

export interface PathMonthlyEvaluationFormInput {
    month: string;
    member_id: string;
    selected_big_skill_states: Partial<Record<PathBigSkillKey, PathBigSkillState>>;
    selected_roles?: string[];
    site_ids?: string[];
    photo_flag?: boolean;
    rework_flag?: "none" | "minor" | "major";
    comment?: string;
}

export interface PathMonthlyEvaluationAiReview {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    monthly_summary: string;
    candidate_states: Partial<Record<PathBigSkillKey, PathBigSkillState>>;
    candidate_skill_tags: string[];
    profile_update_candidates: Array<Record<string, unknown>>;
    promotion_candidate_flag: boolean;
    reasons: Array<Record<string, unknown> | string>;
    evidence_summary: Array<Record<string, unknown> | string>;
    unknown_points: Array<Record<string, unknown> | string>;
    review_required_flag: boolean;
    generated_at: string;
    updated_at: string;
}

export interface PathAiReviewGenerateRequest {
    month: string;
    member_id: string;
    provider?: "gemini" | "openai" | "anthropic";
}

export interface PathAiReviewGenerateResponse {
    review: PathMonthlyEvaluationAiReview;
    provider: "gemini" | "openai" | "anthropic";
}

export interface PathMonthlyEvaluationConfirmation {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    target_type: "big_skill" | "skill_tag" | "level";
    target_key: string;
    confirmation_status: string;
    comment: string;
    confirmed_at: string;
    updated_at: string;
}

export interface PathMonthlyEvaluationFinalization {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    proposal_id: string | null;
    confirmed_big_skill_states: Partial<Record<PathBigSkillKey, PathBigSkillState>>;
    work_days: number;
    A: number;
    R: number;
    Q: number;
    current_level: PathLevel | null;
    comment: string;
    finalized_at: string;
    updated_at: string;
}

export interface PathSkillProfile {
    id: string;
    org_id: string;
    member_id: string;
    current_level: PathLevel | null;
    current_level_since: string | null;
    cross_work_status: PathBigSkillState;
    putty_foundation_status: PathBigSkillState;
    planning_preparation_status: PathBigSkillState;
    quality_stability_status: PathBigSkillState;
    site_trust_status: PathBigSkillState;
    education_support_status: PathBigSkillState;
    updated_at: string;
}

export interface PathSkillCertification {
    id: string;
    org_id: string;
    member_id: string;
    skill_key: string;
    category: string;
    status: PathCertificationStatus;
    evidence_count: number;
    last_site_id: string | null;
    note: string;
    review_required_flag: boolean;
    verified_at: string;
    updated_at: string;
}

export interface PathFinalizeProposalRequest {
    month: string;
    member_id: string;
    confirmed_states: Partial<Record<PathBigSkillKey, PathBigSkillState>>;
    work_days?: number;
    A?: number;
    R?: number;
    Q?: number;
    current_level?: PathLevel | null;
    comment?: string;
    description?: string;
}

export interface PathSkillProposalRequest {
    action?: "achieve" | "revoke";
    member_id: string;
    skill_key: string;
    category: string;
    status?: PathCertificationStatus;
    evidence_count?: number;
    last_site_id?: string | null;
    note?: string;
    review_required_flag?: boolean;
    description?: string;
}

export interface PathProposalResponse {
    proposal: ProposalRecord;
    auto_approved: boolean;
    auto_executed: boolean;
    payload: Record<string, unknown>;
}

export interface PathRewardProfitInputs {
    sales: number;
    outsourcing_cost: number;
    materials_cost: number;
    parking_cost: number;
    transport_cost: number;
    other_direct_cost: number;
    common_cost: number;
    reserve_amount: number;
}

export interface PathRewardMemberInput {
    member_id: string;
    name: string;
    work_days: number;
    level: PathLevel;
    A: number;
    R: number;
    Q: number;
}

export interface PathRewardMemberResult extends PathRewardMemberInput {
    level_coefficient: number;
    base_weight: number;
    monthly_point_total: number;
    monthly_coefficient: number;
    base_reward: number;
    variable_reward: number;
    total_reward: number;
}

export interface PathRewardPreview {
    calculation_system: string;
    calculation_version: string;
    month: string;
    profit_inputs: PathRewardProfitInputs;
    profit_amount: number;
    base_pool_rate: number;
    variable_pool_rate: number;
    base_pool_amount: number;
    variable_pool_amount: number;
    total_amount: number;
    member_count: number;
    members: PathRewardMemberResult[];
    constant_snapshot: {
        base_pool_rate: number;
        variable_pool_rate: number;
        level_coefficients: Record<PathLevel, number>;
        monthly_coefficient_rules: Array<{
            min: number;
            max: number;
            coefficient: number;
        }>;
    };
}

export interface PathRewardProposalRequest {
    month: string;
    profit_inputs: PathRewardProfitInputs;
    members: PathRewardMemberInput[];
    description?: string;
}

export interface PathRewardProposalResponse {
    proposal: ProposalRecord;
    auto_approved: boolean;
    auto_executed: boolean;
    preview: PathRewardPreview;
}

export interface PathRewardCalculationSnapshot {
    id: string;
    org_id: string;
    month: string;
    proposal_id: string;
    member_id: string;
    calculation_system: string;
    calculation_version: string;
    input_snapshot: {
        month?: string;
        member_id?: string;
        name?: string;
        work_days?: number;
        level?: PathLevel;
        A?: number;
        R?: number;
        Q?: number;
        profit_inputs_snapshot?: PathRewardProfitInputs;
        constant_snapshot?: PathRewardPreview["constant_snapshot"];
        [key: string]: unknown;
    };
    result_snapshot: {
        profit_amount?: number;
        base_pool_amount?: number;
        variable_pool_amount?: number;
        level_coefficient?: number;
        base_weight?: number;
        monthly_point_total?: number;
        monthly_coefficient?: number;
        base_reward?: number;
        variable_reward?: number;
        total_reward?: number;
        [key: string]: unknown;
    };
    policy_snapshot: Record<string, unknown>;
    executed_by: Record<string, unknown> | null;
    finalized_at: string;
    created_at: string;
}

export const fetchPathForms = (params?: { month?: string; member_id?: string; limit?: number }) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ forms: PathMonthlyEvaluationForm[] }>(
        `/api/v1/path/evaluations/forms${query ? `?${query}` : ""}`
    );
};

export const savePathForm = (data: PathMonthlyEvaluationFormInput) =>
    api<{ form: PathMonthlyEvaluationForm }>("/api/v1/path/evaluations/forms", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchPathAiReviews = (params?: {
    month?: string;
    member_id?: string;
    review_required_flag?: boolean;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.review_required_flag !== undefined) {
        searchParams.append("review_required_flag", String(params.review_required_flag));
    }
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ reviews: PathMonthlyEvaluationAiReview[] }>(
        `/api/v1/path/evaluations/ai-reviews${query ? `?${query}` : ""}`
    );
};

export const generatePathAiReview = (data: PathAiReviewGenerateRequest) =>
    api<PathAiReviewGenerateResponse>("/api/v1/path/evaluations/ai-reviews/generate", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchPathConfirmations = (params?: {
    month?: string;
    member_id?: string;
    target_type?: "big_skill" | "skill_tag" | "level";
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.target_type) searchParams.append("target_type", params.target_type);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ confirmations: PathMonthlyEvaluationConfirmation[] }>(
        `/api/v1/path/evaluations/confirmations${query ? `?${query}` : ""}`
    );
};

export const fetchPathProfiles = (params?: {
    member_id?: string;
    current_level?: PathLevel;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.current_level) searchParams.append("current_level", params.current_level);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ profiles: PathSkillProfile[] }>(
        `/api/v1/path/evaluations/profiles${query ? `?${query}` : ""}`
    );
};

export const fetchPathFinalizations = (params?: {
    month?: string;
    member_id?: string;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ finalizations: PathMonthlyEvaluationFinalization[] }>(
        `/api/v1/path/evaluations/finalizations${query ? `?${query}` : ""}`
    );
};

export const fetchPathCertifications = (params?: {
    member_id?: string;
    skill_key?: string;
    status?: PathCertificationStatus;
    review_required_flag?: boolean;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.skill_key) searchParams.append("skill_key", params.skill_key);
    if (params?.status) searchParams.append("status", params.status);
    if (params?.review_required_flag !== undefined) {
        searchParams.append("review_required_flag", String(params.review_required_flag));
    }
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ certifications: PathSkillCertification[] }>(
        `/api/v1/path/evaluations/certifications${query ? `?${query}` : ""}`
    );
};

export const createPathFinalizeProposal = (data: PathFinalizeProposalRequest) =>
    api<PathProposalResponse>("/api/v1/path/evaluations/finalize-proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const createPathSkillProposal = (data: PathSkillProposalRequest) =>
    api<PathProposalResponse>("/api/v1/path/evaluations/skill-proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const previewPathReward = (data: PathRewardProposalRequest) =>
    api<PathRewardPreview>("/api/v1/path/rewards/preview", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const createPathRewardProposal = (data: PathRewardProposalRequest) =>
    api<PathRewardProposalResponse>("/api/v1/path/rewards/proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchPathRewardCalculations = (params?: {
    month?: string;
    member_id?: string;
    proposal_id?: string;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.proposal_id) searchParams.append("proposal_id", params.proposal_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ calculations: PathRewardCalculationSnapshot[] }>(
        `/api/v1/path/rewards/calculations${query ? `?${query}` : ""}`
    );
};

// ============================================================
// LUQO評価システム
// ============================================================

export interface LUQOCategory {
    id: string;
    org_id: string;
    name: string;
    display_order: number;
    is_active: boolean;
    created_at: string;
}

export interface LUQOSkillItem {
    id: string;
    org_id: string;
    category_id: string;
    category?: LUQOCategory;
    name: string;
    is_speed: boolean;
    speed_threshold: number | null;
    speed_unit: string | null;
    points: number;
    description: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
}

export interface LUQOStarAchievement {
    id: string;
    org_id: string;
    member_id: string;
    star_id: string;
    star?: LUQOSkillItem;
    achieved_at: string;
    proposal_id: string | null;
    revoked_at: string | null;
}

export interface LUQOPeriodScore {
    id: string;
    org_id: string;
    member_id: string;
    period: string;
    lu_score: number | null;
    q_score: number | null;
    o_score: number | null;
    luqo_score: number | null;
    tech_stars: number;
    speed_stars: number;
    combo: number | null;
    submission_rate: number | null;
    finalized: boolean;
}

export interface LUQORewardBreakdownItem {
    member_id: string;
    name: string;
    days: number;
    tech_stars: number;
    speed_stars: number;
    S: number;
    V: number;
    combo: number;
    effort: number;
    ratio: number;
    amount: number;
}

export interface LUQORewardPreview {
    period: string;
    profit: number;
    company_rate: number;
    distributable: number;
    tech_max: number;
    speed_max: number;
    members: LUQORewardBreakdownItem[];
    total_check: number;
}

export interface LUQORewardCalculation {
    id: string;
    org_id: string;
    period: string;
    profit: number;
    company_rate: number;
    distributable: number;
    breakdown: LUQORewardBreakdownItem[];
    proposal_id: string | null;
    finalized: boolean;
    created_at: string;
}

// カタログ取得
export const fetchLUQOCategories = () =>
    api<{ categories: LUQOCategory[] }>("/api/v1/luqo/categories");

export const fetchLUQOCatalog = (categoryId?: string) => {
    const q = categoryId ? `?category_id=${categoryId}` : "";
    return api<{ catalog: LUQOSkillItem[]; tech_max: number; speed_max: number }>(
        `/api/v1/luqo/catalog${q}`
    );
};

// スター達成取得
export const fetchMemberAchievements = (memberId: string) =>
    api<{ achievements: LUQOStarAchievement[]; techStars: number; speedStars: number }>(
        `/api/v1/luqo/members/${memberId}/achievements`
    );

// スコア取得
export const fetchLUQOScores = (params?: { period?: string; member_id?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.period) searchParams.append("period", params.period);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    const q = searchParams.toString();
    return api<{ scores: LUQOPeriodScore[] }>(`/api/v1/luqo/scores${q ? `?${q}` : ""}`);
};

// 報酬計算プレビュー
export const previewLUQOReward = (data: {
    period: string;
    profit: number;
    company_rate?: number;
    members: Array<{
        member_id: string;
        name: string;
        days: number;
        tech_stars: number;
        speed_stars: number;
    }>;
}) =>
    api<LUQORewardPreview>("/api/v1/luqo/reward/preview", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchLUQORewardCalculations = (params?: { period?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.period) searchParams.append("period", params.period);
    const q = searchParams.toString();
    return api<{ calculations: LUQORewardCalculation[] }>(
        `/api/v1/luqo/reward/calculations${q ? `?${q}` : ""}`
    );
};

// 報酬計算確定 (Proposalを作成して申請)
export const submitLUQORewardProposal = (data: {
    period: string;
    profit: number;
    company_rate: number;
    breakdown: LUQORewardBreakdownItem[];
}) =>
    api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>(
        "/api/v1/proposals/create-and-submit",
        {
            method: "POST",
            body: JSON.stringify({
                type: "luqo.reward.calculate",
                payload: {
                    period: data.period,
                    profit: data.profit,
                    company_rate: data.company_rate,
                    breakdown: data.breakdown,
                },
                description: `${data.period} 月次報酬計算`,
            }),
        }
    );

// スター達成申請 (Proposal作成)
export const submitStarAchieveProposal = (data: {
    memberId: string;
    memberName: string;
    starId: string;
    starName: string;
}) =>
    api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>(
        "/api/v1/proposals/create-and-submit",
        {
            method: "POST",
            body: JSON.stringify({
                type: "luqo.star.achieve",
                payload: {
                    member_id: data.memberId,
                    star_id: data.starId,
                },
                description: `スター達成申請: ${data.memberName} - ${data.starName}`,
            }),
        }
    );

// スキル項目追加申請 (Proposal作成)
export const submitCatalogAddProposal = (data: {
    categoryId: string;
    name: string;
    points: number;
    isSpeed: boolean;
    speedThreshold?: number;
    speedUnit?: string;
    description?: string;
}) =>
    api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>(
        "/api/v1/proposals/create-and-submit",
        {
            method: "POST",
            body: JSON.stringify({
                type: "luqo.catalog.add",
                payload: {
                    category_id: data.categoryId,
                    name: data.name,
                    points: data.points,
                    is_speed: data.isSpeed,
                    speed_threshold: data.speedThreshold ?? null,
                    speed_unit: data.speedUnit ?? null,
                    description: data.description ?? null,
                },
                description: `スキル項目追加申請: ${data.name}（${data.points}pt）`,
            }),
        }
    );
