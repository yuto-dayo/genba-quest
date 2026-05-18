import { getAuthToken } from "./supabase";
import { getActiveOrgId } from "../stores/activeOrg";
import { getDevAuthUserKey } from "./devAuth";

function isLoopbackApiUrl(value: string): boolean {
    try {
        const url = new URL(value);
        return url.hostname === "localhost" || url.hostname === "127.0.0.1";
    } catch {
        return false;
    }
}

const configuredApiBase = import.meta.env.VITE_API_URL?.trim() || "";
const rawApiBase =
    import.meta.env.DEV && (!configuredApiBase || isLoopbackApiUrl(configuredApiBase))
        ? ""
        : configuredApiBase;
const API_BASE = rawApiBase.endsWith("/") ? rawApiBase.slice(0, -1) : rawApiBase;

export const api = async <T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> => {
    const token = await getAuthToken();
    const activeOrgId = getActiveOrgId();
    const headers = new Headers(options.headers);

    if (!headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    headers.set("Authorization", `Bearer ${token}`);

    if (activeOrgId && !headers.has("x-org-id")) {
        headers.set("x-org-id", activeOrgId);
    }

    const devAuthUserKey = getDevAuthUserKey();
    if (devAuthUserKey && !headers.has("x-dev-user-key")) {
        headers.set("x-dev-user-key", devAuthUserKey);
    }

    let response: Response;
    try {
        response = await fetch(`${API_BASE}${endpoint}`, {
            ...options,
            headers,
        });
    } catch (error) {
        if (error instanceof TypeError) {
            throw new Error("NETWORK_ERROR: API server is unreachable. Start the server or set VITE_API_URL.");
        }

        throw error;
    }

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
        if (response.status === 429) {
            const retryAfterHeader = response.headers.get("Retry-After");
            const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
            const error = new Error("RATE_LIMITED") as Error & {
                status?: number;
                retryAfterSeconds?: number;
            };
            error.status = 429;
            if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
                error.retryAfterSeconds = retryAfterSeconds;
            }
            throw error;
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

function createClientIdempotencyKey(scope: string): string {
    const randomPart = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${scope}:${randomPart}`;
}

function withIdempotencyKey<T extends object>(
    scope: string,
    data: T,
): T & { idempotency_key: string } {
    const idempotencyKey = "idempotency_key" in data && typeof data.idempotency_key === "string"
        ? data.idempotency_key
        : null;
    return {
        ...data,
        idempotency_key: idempotencyKey || createClientIdempotencyKey(scope),
    };
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
    | "invoice.member_issue"
    | "invoice.member_mark_paid"
    | "invoice.member_void"
    | "reward.calculate"
    | "reward.adjust"
    | "reward.dispute_correction"
    | "reward.pool.adjust"
    | "path.level.update"
    | "level.objection"
    | "skill.achieve"
    | "skill.revoke"
    | "evaluation.submit"
    | "evaluation.finalize"
    | "assignment.create"
    | "assignment.update"
    | "assignment.cancel"
    | "leave.request"
    | "communication.review"
    | "communication.task"
    | "task.revision.request"
    | "site.create"
    | "site.complete"
    | "site.close.finalize"
    | "site.close.reopen"
    | "policy.update"
    | "profile.view_request"
    | "member.classification.update"
    | "recurring_expense.create"
    | "recurring_expense.update"
    | "recurring_expense.end"
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

export interface AssignmentProposalCreateInput {
    worker_id: string;
    site_id: string;
    site_name: string;
    date: string;
    note?: string;
}

export interface AssignmentProposalCreateResponse {
    proposal: ProposalRecord;
    auto_approved: boolean;
    auto_executed: boolean;
}

export const submitAssignmentCreateProposal = (
    input: AssignmentProposalCreateInput
) =>
    api<AssignmentProposalCreateResponse>("/api/v1/proposals/create-and-submit", {
        method: "POST",
        body: JSON.stringify({
            type: "assignment.create",
            payload: {
                worker_id: input.worker_id,
                site_id: input.site_id,
                site_name: input.site_name,
                date: input.date,
                note: input.note?.trim() || undefined,
            },
            description: `${input.site_name}（${input.date}）への配置`,
        }),
    });

export interface AssignmentCreateDraftCommitItemResult {
    draft_id: string;
    success: boolean;
    proposal_id?: string;
    auto_approved?: boolean;
    auto_executed?: boolean;
    error?: string;
}

export interface AssignmentCreateDraftCommitResponse {
    ok: boolean;
    total_proposals: number;
    pending_count: number;
    auto_approved_count: number;
    proposal_ids: string[];
    results: AssignmentCreateDraftCommitItemResult[];
    message: string;
}

export interface AssignmentCreateDraftCommitInput extends AssignmentProposalCreateInput {
    id: string;
}

export const commitAssignmentCreateDrafts = async (
    drafts: AssignmentCreateDraftCommitInput[]
): Promise<AssignmentCreateDraftCommitResponse> => {
    const settledResults = await Promise.allSettled(
        drafts.map((draft) => submitAssignmentCreateProposal(draft))
    );

    const results = settledResults.map<AssignmentCreateDraftCommitItemResult>((settled, index) => {
        const draft = drafts[index]!;
        if (settled.status === "fulfilled") {
            return {
                draft_id: draft.id,
                success: true,
                proposal_id: settled.value.proposal.id,
                auto_approved: settled.value.auto_approved,
                auto_executed: settled.value.auto_executed,
            };
        }

        return {
            draft_id: draft.id,
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

    let message = "変更案を送れませんでした。もう一度お試しください。";
    if (succeeded.length > 0 && failedCount > 0) {
        message = `${succeeded.length}件送信、${failedCount}件失敗しました。`;
    } else if (pendingCount > 0) {
        message = `${succeeded.length}件の変更案を送りました。`;
    } else if (succeeded.length > 0) {
        message = `${succeeded.length}件の変更案を送りました。`;
    }

    return {
        ok: succeeded.length > 0,
        total_proposals: results.length,
        pending_count: pendingCount,
        auto_approved_count: autoApprovedCount,
        proposal_ids: proposalIds,
        results,
        message,
    };
};

export type PersonalScheduleType = "event" | "task" | "vacation" | "sick_leave" | "business_trip" | "training";
export type PersonalScheduleVisibility = "personal" | "organization";

export interface PersonalSchedule {
    id: string;
    user_id: string;
    start_date: string;
    end_date: string;
    type: PersonalScheduleType;
    title: string;
    start_time?: string | null;
    end_time?: string | null;
    address?: string | null;
    color?: string | null;
    blocks_assignment: boolean;
    visibility: PersonalScheduleVisibility;
    reason?: string | null;
    approved: boolean;
    created_at?: string;
    updated_at?: string;
}

export const fetchPersonalSchedules = (params: {
    from: string;
    to: string;
    scope?: "organization" | "personal";
}) => {
    const searchParams = new URLSearchParams();
    searchParams.append("from", params.from);
    searchParams.append("to", params.to);
    if (params.scope) searchParams.append("scope", params.scope);

    return api<PersonalSchedule[]>(`/api/v1/calendar/personal-schedules?${searchParams.toString()}`);
};

export const deletePersonalSchedule = (scheduleId: string) =>
    api<{ ok: boolean; id: string }>(`/api/v1/calendar/personal-schedules/${scheduleId}`, {
        method: "DELETE",
    });

export interface LeaveRequestProposalInput {
    user_id?: string;
    date: string;
    reason?: string;
}

export const submitLeaveRequestProposal = (input: LeaveRequestProposalInput) =>
    api<AssignmentProposalCreateResponse>("/api/v1/proposals/create-and-submit", {
        method: "POST",
        body: JSON.stringify({
            type: "leave.request",
            payload: {
                user_id: input.user_id,
                start_date: input.date,
                end_date: input.date,
                schedule_type: "vacation",
                title: "休み",
                visibility: "organization",
                blocks_assignment: true,
                reason: input.reason?.trim() || undefined,
            },
            description: `${input.date} の休み`,
        }),
    });

export interface PersonalScheduleProposalInput {
    start_date: string;
    end_date?: string;
    schedule_type: PersonalScheduleType;
    title: string;
    start_time?: string;
    end_time?: string;
    address?: string;
    color?: string;
    visibility?: PersonalScheduleVisibility;
    reason?: string;
}

export const submitPersonalScheduleProposal = (input: PersonalScheduleProposalInput) =>
    api<AssignmentProposalCreateResponse>("/api/v1/proposals/create-and-submit", {
        method: "POST",
        body: JSON.stringify({
            type: "leave.request",
            payload: {
                schedule_type: input.schedule_type,
                title: input.title.trim(),
                start_date: input.start_date,
                end_date: input.end_date || input.start_date,
                start_time: input.start_time || undefined,
                end_time: input.end_time || undefined,
                address: input.address?.trim() || undefined,
                color: input.color?.trim() || undefined,
                visibility: input.visibility || "personal",
                blocks_assignment: ["vacation", "sick_leave"].includes(input.schedule_type),
                reason: input.reason?.trim() || undefined,
            },
            description:
                input.end_date && input.end_date !== input.start_date
                    ? `${input.start_date}〜${input.end_date} の${input.title.trim() || "予定"}`
                    : `${input.start_date} の${input.title.trim() || "予定"}`,
        }),
    });

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

export type CommunicationStatusReasonSource =
    | "next_action"
    | "ai_summary"
    | "last_message_preview"
    | "none";

export interface CommunicationContactStatusRecord {
    contact_key: string;
    client_id: string | null;
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

export interface CommunicationContactWhyNowItem {
    code: CommunicationContactRiskFlag | CommunicationContactStatus;
    title: string;
    description: string;
}

export interface CommunicationContactRecentLogRecord extends CommunicationLogRecord {
    conversation_id: string;
    conversation_title: string;
}

export interface CommunicationContactStatusDetail {
    summary: CommunicationContactStatusRecord;
    why_now: CommunicationContactWhyNowItem[];
    related_proposals: ProposalRecord[];
    conversations: CommunicationConversationRecord[];
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
    metadata?: Record<string, unknown>;
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
    metadata?: Record<string, unknown>;
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

export const fetchCommunicationContacts = (params?: {
    q?: string;
    status?: CommunicationContactStatus[];
    ownerUserId?: string[];
    risk?: CommunicationContactRiskFlag[];
    includeResolved?: boolean;
    sort?: "attention" | "latest_activity";
    page?: number;
    pageSize?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.append("q", params.q);
    params?.status?.forEach((value) => searchParams.append("status", value));
    params?.ownerUserId?.forEach((value) => searchParams.append("ownerUserId", value));
    params?.risk?.forEach((value) => searchParams.append("risk", value));
    if (params?.includeResolved !== undefined) searchParams.append("includeResolved", String(params.includeResolved));
    if (params?.sort) searchParams.append("sort", params.sort);
    if (params?.page !== undefined) searchParams.append("page", String(params.page));
    if (params?.pageSize !== undefined) searchParams.append("pageSize", String(params.pageSize));
    const query = searchParams.toString();
    return api<CommunicationContactListResponse>(`/api/v1/communications/contacts${query ? `?${query}` : ""}`);
};

export const fetchCommunicationContactDetail = (contactKey: string) =>
    api<CommunicationContactStatusDetail>(`/api/v1/communications/contacts/${encodeURIComponent(contactKey)}`);

export const fetchCommunicationInsightsSummary = () =>
    api<CommunicationInsightsSummary>("/api/v1/communications/insights/summary");

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
    type:
        | "auto_quest"
        | "approval_required"
        | "approval_result"
        | "schedule_conflict"
        | "system_alert"
        | "month_close_reminder";
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
export type FocusItemResolutionKind =
    | "completed_as_planned"
    | "completed_with_change"
    | "not_completed";

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
    resolution_kind?: FocusItemResolutionKind | null;
    resolution_note?: string | null;
    resolved_at?: string | null;
    resolved_by?: string | null;
    focus_date?: string | null;
    created_at: string;
    updated_at: string;
}

export interface FocusItemUpsertRequest {
    title: string;
    scope: FocusItemScope;
    horizon: FocusItemHorizon;
    note?: string;
    site_id?: string;
    focus_date?: string;
    status?: FocusItemStatus;
}

export const fetchFocusItems = (params?: {
    scope?: FocusItemScope;
    horizon?: FocusItemHorizon;
    status?: FocusItemStatus;
    focus_date_from?: string;
    focus_date_to?: string;
    resolved_from?: string;
    resolved_to?: string;
    include_legacy_done?: boolean;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.scope) searchParams.append("scope", params.scope);
    if (params?.horizon) searchParams.append("horizon", params.horizon);
    if (params?.status) searchParams.append("status", params.status);
    if (params?.focus_date_from) searchParams.append("focus_date_from", params.focus_date_from);
    if (params?.focus_date_to) searchParams.append("focus_date_to", params.focus_date_to);
    if (params?.resolved_from) searchParams.append("resolved_from", params.resolved_from);
    if (params?.resolved_to) searchParams.append("resolved_to", params.resolved_to);
    if (params?.include_legacy_done !== undefined) {
        searchParams.append("include_legacy_done", String(params.include_legacy_done));
    }
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

export const resolveFocusItem = (
    focusItemId: string,
    payload: {
        resolution_kind: FocusItemResolutionKind;
        resolution_note?: string | null;
    },
) =>
    api<FocusItemRecord>(`/api/v1/focus-items/${focusItemId}/resolve`, {
        method: "POST",
        body: JSON.stringify(payload),
    });

// 現場
export const fetchSites = () => api<Site[]>("/api/v1/sites");
export const fetchSite = (id: string) => api<Site>(`/api/v1/sites/${id}`);
export const createSite = (site: Partial<Site>) =>
    api<Site>("/api/v1/sites", { method: "POST", body: JSON.stringify(site) });
export const updateSite = (id: string, site: Partial<Site>) =>
    api<Site>(`/api/v1/sites/${id}`, { method: "PUT", body: JSON.stringify(site) });
export const updateSiteAssignedUsers = (id: string, assignedUsers: string[]) =>
    api<Site>(`/api/v1/sites/${id}/assigned-users`, {
        method: "PUT",
        body: JSON.stringify({ assigned_users: assignedUsers }),
    });
export const completeSite = (id: string, payload?: { effective_completed_at?: string }) =>
    api<SiteCompletionResult>(`/api/v1/sites/${id}/complete`, {
        method: "POST",
        body: payload ? JSON.stringify(payload) : undefined,
    });
export const completeSiteWithClose = (id: string, payload: CompleteSiteWithCloseRequest) =>
    api<CompleteSiteWithCloseResult>(`/api/v1/sites/${id}/complete-with-close`, {
        method: "POST",
        body: JSON.stringify(payload),
    });
export const reverseSiteCompletion = (
    id: string,
    payload?: { effective_reversed_at?: string; reason?: string }
) =>
    api<SiteCompletionReversalResult>(`/api/v1/sites/${id}/complete/reverse`, {
        method: "POST",
        body: payload ? JSON.stringify(payload) : undefined,
    });
export const deleteSite = (id: string, reason: string) =>
    api<Site>(`/api/v1/sites/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
export const fetchMembers = () =>
    api<Member[]>("/api/v1/org/members");

export type MemberContractType = "subcontract" | "employee_like" | "undetermined";
export type TaxWithholdingCategory = "none" | "10.21%" | "custom";
export type ClassificationCheckStatus = "verified" | "review_needed" | "unset";
export type MemberInvoiceRegistrationStatus = "registered" | "exempt" | "transitional" | "unknown";
export type TransitionalPhase = "pre-introduction" | "phase1-80" | "phase2-50" | "phase3-0";

export interface ClassificationCheckResults {
    q1_substitution: boolean;
    q2_time_freedom: boolean;
    q3_work_autonomy: boolean;
    q4_own_tools: boolean;
    q5_outcome_liability: boolean;
}

export interface MemberTaxClassification {
    id: string;
    org_id: string;
    member_id: string;
    contract_type: MemberContractType;
    tax_withholding_category: TaxWithholdingCategory;
    custom_withholding_rate: number | null;
    classification_check_status: ClassificationCheckStatus;
    classification_check_results: ClassificationCheckResults;
    classification_notes: string | null;
    invoice_registration_status: MemberInvoiceRegistrationStatus;
    invoice_registration_number: string | null;
    effective_from: string;
    effective_until: string | null;
    decided_by: string;
    decided_at: string;
    proposal_id: string | null;
    created_at: string;
}

export interface MemberTaxClassificationResponse {
    active: MemberTaxClassification | null;
    history: MemberTaxClassification[];
}

export interface SubmitClassificationProposalRequest {
    member_id: string;
    contract_type: MemberContractType;
    tax_withholding_category: TaxWithholdingCategory;
    custom_withholding_rate?: number | null;
    classification_check_results: ClassificationCheckResults;
    classification_notes?: string;
    invoice_registration_status?: MemberInvoiceRegistrationStatus;
    invoice_registration_number?: string | null;
    effective_from: string;
}

export interface MemberInvoiceRegistrationStatusResponse {
    status: MemberInvoiceRegistrationStatus;
    registration_number: string | null;
    deduction_rate: number;
    transitional_phase: TransitionalPhase;
}

export interface MonthlyDeductibleAmount {
    month: string;
    gross_subject_amount: number;
    deductible_amount: number;
    effective_deduction_rate: number;
    transitional_phase: TransitionalPhase;
    transitional_rate: number;
    member_count: number;
}

export const fetchMemberTaxClassification = (memberId: string, asOf?: string, options?: RequestInit) => {
    const params = new URLSearchParams();
    if (asOf) {
        params.set("asOf", asOf);
    }
    const query = params.toString();
    return api<MemberTaxClassificationResponse>(
        `/api/v1/members/${encodeURIComponent(memberId)}/tax-classification${query ? `?${query}` : ""}`,
        options,
    );
};

export const fetchMemberInvoiceStatus = (memberId: string, asOf?: string, options?: RequestInit) => {
    const params = new URLSearchParams();
    if (asOf) {
        params.set("asOf", asOf);
    }
    const query = params.toString();
    return api<MemberInvoiceRegistrationStatusResponse>(
        `/api/v1/members/${encodeURIComponent(memberId)}/invoice-status${query ? `?${query}` : ""}`,
        options,
    );
};

export const submitClassificationProposal = (payload: SubmitClassificationProposalRequest) =>
    api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>("/api/v1/proposals/create-and-submit", {
        method: "POST",
        body: JSON.stringify({
            type: "member.classification.update",
            payload,
            description: "契約区分を更新",
        }),
    });

export const updateMemberRole = (userId: string, role: "admin" | "member") =>
    api<{ membership: Member }>(`/api/v1/org/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
    });

export const removeOrgMember = (userId: string) =>
    api<{ membership: Member }>(`/api/v1/org/members/${userId}`, {
        method: "DELETE",
    });

// ============================================================
// Profile view consent (Phase 2-1)
// 拡張プロフィール閲覧の本人承認フロー
// ============================================================

export interface ProfileViewGrant {
    id: string;
    org_id: string;
    proposal_id: string;
    target_user_id: string;
    requesting_admin_id: string;
    purpose: string;
    granted_at: string;
    expires_at: string;
    revoked_at: string | null;
    revoked_by: string | null;
    revocation_reason: string | null;
    created_at: string;
}

export interface ExtendedProfile {
    id: string;
    phone: string | null;
    job_type: string | null;
    employment_kind: string | null;
    trade_name: string | null;
    invoice_registration_number: string | null;
    bank_name: string | null;
    branch_name: string | null;
    account_type: string | null;
    account_number: string | null;
    account_holder_kana: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
    emergency_contact_name: string | null;
    emergency_phone: string | null;
}

export interface ProfileViewExtendedResult {
    profile: ExtendedProfile;
    grant: ProfileViewGrant | null;
}

export const createProfileViewRequest = (input: {
    target_user_id: string;
    purpose: string;
    duration_hours?: number;
}) =>
    api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>(
        "/api/v1/profile-view-requests",
        {
            method: "POST",
            body: JSON.stringify(input),
        },
    );

export const revokeProfileViewGrant = (grantId: string, reason?: string) =>
    api<{ grant: ProfileViewGrant }>(`/api/v1/profile-view-grants/${grantId}/revoke`, {
        method: "POST",
        body: JSON.stringify({ reason: reason ?? null }),
    });

export const fetchProfileViewGrantsIncoming = () =>
    api<{ grants: ProfileViewGrant[] }>("/api/v1/profile-view-grants/incoming");

export const fetchProfileViewGrantsOutgoing = () =>
    api<{ grants: ProfileViewGrant[] }>("/api/v1/profile-view-grants/outgoing");

export const fetchExtendedProfile = (userId: string) =>
    api<ProfileViewExtendedResult>(`/api/v1/profile-view-extended/${userId}`);

// ============================================================
// Member-led invoices (Phase 2-2a)
// 本人主導の請求書発行: 個人事業主が自分の意思で組織に対して請求書を発行する
// ============================================================

export type MemberInvoiceSource = "path_reward" | "monthly_distribution" | "manual";
export type MemberInvoiceStatus = "issued" | "paid" | "void";

export interface MemberInvoiceLineItem {
    description: string;
    quantity: number;
    unit_amount: number;
    amount: number;
}

export interface MemberInvoiceDraft {
    source: MemberInvoiceSource;
    source_ref_id: string;
    period_month: string;
    amount_total: number;
    line_items: MemberInvoiceLineItem[];
    label: string;
}

export interface MemberInvoice {
    id: string;
    org_id: string;
    proposal_id: string;
    member_id: string;
    source: MemberInvoiceSource;
    source_ref_id: string | null;
    period_month: string;
    amount_total: number;
    line_items: MemberInvoiceLineItem[];
    snapshot_trade_name: string | null;
    snapshot_invoice_registration_no: string | null;
    snapshot_bank: {
        bank_name: string | null;
        branch_name: string | null;
        account_type: string | null;
        account_number: string | null;
        account_holder_kana: string | null;
    };
    snapshot_address: {
        postal_code: string | null;
        prefecture: string | null;
        city: string | null;
        address_line1: string | null;
        address_line2: string | null;
    };
    status: MemberInvoiceStatus;
    invoice_no: string;
    issued_at: string;
    created_at: string;
    updated_at: string;
}

export interface OutstandingInvoicesSummaryRow {
    status: MemberInvoiceStatus;
    period_month: string;
    invoice_count: number;
    total_amount: number;
}

export interface OutstandingInvoicesSummary {
    summary: OutstandingInvoicesSummaryRow[];
    totals: {
        issued: { count: number; amount: number };
        paid: { count: number; amount: number };
    };
}

export const fetchMemberInvoiceDrafts = (options?: RequestInit) =>
    api<{ drafts: MemberInvoiceDraft[] }>("/api/v1/member-invoices/drafts", options);

export const issueMemberInvoice = (input: {
    source: MemberInvoiceSource;
    source_ref_id: string;
    period_month: string;
}) =>
    api<{ proposal: ProposalRecord; invoice: MemberInvoice | null }>(
        "/api/v1/member-invoices/issue",
        {
            method: "POST",
            body: JSON.stringify(input),
        },
    );

export const fetchMyMemberInvoices = (options?: RequestInit) =>
    api<{ invoices: MemberInvoice[] }>("/api/v1/member-invoices/mine", options);

export const fetchOutstandingInvoicesSummary = () =>
    api<OutstandingInvoicesSummary>("/api/v1/org/invoices/outstanding-summary");

// ============================================================
// Phase 2-2b: 支払い記録 / 取り消し / admin 行アクション可能リスト
// ============================================================

export interface AdminActionableInvoice {
    invoice_id: string;
    invoice_no: string;
    period_month: string;
    amount_total: number;
    status: MemberInvoiceStatus;
    source: MemberInvoiceSource;
    issued_at: string;
}

export const fetchAdminActionableInvoices = (status: MemberInvoiceStatus = "issued") =>
    api<{ invoices: AdminActionableInvoice[] }>(
        `/api/v1/org/invoices/admin-actionable?status=${encodeURIComponent(status)}`,
    );

export interface InvoicePayoutDetail {
    invoice_id: string;
    invoice_no: string;
    amount: number;
    issued_at: string;
    snapshot: {
        bank_name: string | null;
        branch_name: string | null;
        account_type: string | null;
        account_number: string | null;
        account_holder: string | null;
        real_name: string | null;
        tax_id: string | null;
    };
    body_html: string;
    line_items: unknown[];
    expires_at: string;
    self_member_id: string;
    is_self: boolean;
    is_reviewer: boolean;
}

export interface InvoiceReviewAssignment {
    id: string;
    invoice_id: string;
    reviewer_user_id: string;
    org_id: string;
    assigned_at: string;
    expires_at: string;
    completed_at: string | null;
    reassigned_from: string | null;
}

export const fetchInvoicePayoutDetail = (invoiceId: string) =>
    api<InvoicePayoutDetail>(
        `/api/v1/accounting/invoices/${encodeURIComponent(invoiceId)}/payout-detail`,
    );

export const markInvoicePaid = (
    invoiceId: string,
    input: { paid_at: string; memo?: string },
) =>
    api<{
        proposal: ProposalRecord;
        invoice: MemberInvoice | null;
        assignment: InvoiceReviewAssignment;
        self_member_id: string;
        is_self: boolean;
    }>(`/api/v1/accounting/invoices/${encodeURIComponent(invoiceId)}/mark-paid`, {
        method: "POST",
        body: JSON.stringify(input),
    });

export const markMemberInvoicePaid = (
    invoiceId: string,
    input?: { paid_at?: string; paid_method?: string },
) =>
    api<{ proposal: ProposalRecord; invoice: MemberInvoice | null }>(
        `/api/v1/member-invoices/${invoiceId}/mark-paid`,
        {
            method: "POST",
            body: JSON.stringify(input ?? {}),
        },
    );

export const voidMemberInvoice = (invoiceId: string, reason: string) =>
    api<{ proposal: ProposalRecord; invoice: MemberInvoice | null }>(
        `/api/v1/member-invoices/${invoiceId}/void`,
        {
            method: "POST",
            body: JSON.stringify({ reason }),
        },
    );

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

// ============================================================
// 取引先の締め払いルール (PR #2 Money 再設計)
// ============================================================

export type BillingCycle = "weekly" | "biweekly" | "monthly" | "custom";

export interface ClosingRule {
    day?: number;
    weekday?: number;
    anchor_date?: string;
}

export interface PaymentRule {
    days?: number;
    month_offset?: number;
    day?: number;
}

export interface BillingRuleRecord {
    id: string;
    org_id: string;
    client_id: string;
    effective_from: string;
    effective_until: string | null;
    billing_cycle: BillingCycle;
    closing_rule: ClosingRule;
    payment_rule: PaymentRule;
    notes: string | null;
    created_at: string;
    updated_at: string;
    created_by: string | null;
}

export interface BillingPeriodPreview {
    period_start: string;
    period_end: string;
    payment_due_date: string;
}

export interface ActiveBillingRulePreview {
    rule: BillingRuleRecord | null;
    next_period: BillingPeriodPreview | null;
}

export interface CreateBillingRuleInput {
    effective_from: string;
    billing_cycle: BillingCycle;
    closing_rule: ClosingRule;
    payment_rule: PaymentRule;
    notes?: string | null;
}

export const fetchBillingRules = (clientId: string) =>
    api<BillingRuleRecord[]>(`/api/v1/sites/clients/${clientId}/billing-rules`);

export const fetchActiveBillingRule = (clientId: string, on?: string) => {
    const q = on ? `?on=${encodeURIComponent(on)}` : "";
    return api<ActiveBillingRulePreview>(`/api/v1/sites/clients/${clientId}/billing-rules/active${q}`);
};

export const createBillingRule = (clientId: string, input: CreateBillingRuleInput) =>
    api<BillingRuleRecord>(`/api/v1/sites/clients/${clientId}/billing-rules`, {
        method: "POST",
        body: JSON.stringify(input),
    });

// ============================================================
// 取引先 月次サマリ (PR #6 Money 取引先タブ 3 section)
// ============================================================

export type ReceiveStatus = "unbilled" | "billed" | "awaiting_payment";

export interface ReceivePartnerSummary {
    client_id: string;
    client_name: string;
    amount: number;
    rule: BillingRuleRecord | null;
    next_period: BillingPeriodPreview | null;
    status: ReceiveStatus;
    target_date: string | null;
    days_overdue: number | null;
    billed_at: string | null;
}

export interface PayPartnerSummary {
    vendor_name: string;
    amount: number;
    transaction_count: number;
    due_date: string | null;
}

export interface DonePartnerSummary {
    client_id: string | null;
    client_name: string;
    amount: number;
    paid_at: string;
}

export interface PartnersSummary {
    month: string;
    receive: { total: number; partners: ReceivePartnerSummary[] };
    pay: { total: number; partners: PayPartnerSummary[] };
    done: { total: number; partners: DonePartnerSummary[] };
}

export const fetchPartnersSummary = (month: string) =>
    api<PartnersSummary>(`/api/v1/accounting/partners/summary?month=${encodeURIComponent(month)}`);

// ============================================================
// 取引先 与信モニタリング (PR-31)
// ============================================================

export type CreditTier = "healthy" | "caution" | "warning" | "blocked";

export interface ClientCreditSummary {
    org_id: string;
    client_id: string;
    client_name: string;
    as_of_date: string;
    accounts_receivable_balance: number;
    overdue_count: number;
    sales_90_days: number;
    dso_days: number | null;
    credit_tier: CreditTier;
    credit_tier_sort?: number;
}

export interface CreditMonthlyTrendPoint {
    month: string;
    dso_days: number | null;
    accounts_receivable_balance: number;
}

export interface CreditOverdueInvoice {
    invoice_id: string;
    invoice_no: string;
    issue_date: string;
    due_date: string | null;
    amount: number;
    outstanding_amount: number;
    overdue_days: number;
}

export interface CreditRecentInvoice {
    invoice_id: string;
    invoice_no: string;
    issue_date: string;
    due_date: string | null;
    amount: number;
    outstanding_amount: number;
}

export interface CreditRecentCashReceipt {
    receipt_id: string;
    received_date: string;
    received_amount: number;
    allocated_amount: number;
    status: string;
    bank_txn_ref: string | null;
}

export interface ClientCreditMetrics extends ClientCreditSummary {
    monthly_trends: CreditMonthlyTrendPoint[];
    overdue_history: CreditOverdueInvoice[];
    recent_invoices: CreditRecentInvoice[];
    recent_cash_receipts: CreditRecentCashReceipt[];
}

export const fetchClientCreditSummaries = () =>
    api<{ clients: ClientCreditSummary[] }>("/api/v1/accounting/credit-monitoring/clients");

export const fetchClientCreditMetrics = (clientId: string, asOf?: string) => {
    const query = asOf ? `?as_of=${encodeURIComponent(asOf)}` : "";
    return api<ClientCreditMetrics>(
        `/api/v1/accounting/credit-monitoring/clients/${encodeURIComponent(clientId)}${query}`,
    );
};

export type CashReceiptVarianceReason =
    | "fee_deduction"
    | "overpayment"
    | "withholding_tax"
    | "partial_payment"
    | "unknown";

export interface CashReceiptAllocationInput {
    invoice_transaction_id: string;
    allocated_amount: number;
}

export interface SubmitCashReceiptProposalRequest {
    client_id: string;
    received_date: string;
    received_amount: number;
    allocations: CashReceiptAllocationInput[];
    variance_reason: CashReceiptVarianceReason;
    variance_memo?: string | null;
    notes?: string | null;
    bank_txn_ref?: string | null;
}

export interface CashReceiptAllocation {
    id: string;
    receipt_id: string;
    invoice_transaction_id: string;
    allocated_amount: number;
    created_at: string;
    invoice?: {
        id: string;
        kind: string;
        recorded_date: string;
        amount_total: number;
        description?: string | null;
    } | null;
}

export interface CashReceiptRecord {
    id: string;
    org_id: string;
    proposal_id: string;
    client_id: string;
    received_date: string;
    received_amount: number;
    allocated_amount: number;
    variance_amount?: number | null;
    variance_reason: CashReceiptVarianceReason | "tax_correction";
    variance_memo?: string | null;
    bank_txn_ref?: string | null;
    snapshot_client_name?: string | null;
    notes?: string | null;
    status: "draft" | "pending" | "reconciled" | string;
    ledger_event_id?: string | null;
    created_at: string;
    updated_at?: string | null;
    allocations: CashReceiptAllocation[];
    client?: { id: string; name: string } | null;
    proposal?: ProposalRecord | null;
}

export interface ClientInvoiceWithReceipts extends AccountingInvoiceListItem {
    cash_receipts: CashReceiptRecord[];
}

export const submitCashReceiptProposal = (data: SubmitCashReceiptProposalRequest) =>
    api<{ proposal: ProposalRecord }>("/api/v1/accounting/cash-receipts", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchCashReceipts = (params?: {
    client_id?: string;
    from?: string;
    to?: string;
    status?: string;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.client_id) searchParams.append("client_id", params.client_id);
    if (params?.from) searchParams.append("from", params.from);
    if (params?.to) searchParams.append("to", params.to);
    if (params?.status) searchParams.append("status", params.status);
    const query = searchParams.toString();
    return api<{ cash_receipts: CashReceiptRecord[] }>(
        `/api/v1/accounting/cash-receipts${query ? `?${query}` : ""}`,
    );
};

function getInvoiceTransactionIds(invoice: AccountingInvoiceListItem): string[] {
    return Array.from(new Set([
        invoice.source_transaction?.id,
        invoice.source_transaction_id,
        invoice.transaction_id,
    ].filter((value): value is string => typeof value === "string" && value.length > 0)));
}

export const fetchClientInvoicesWithReceipts = async (params?: {
    limit?: number;
    offset?: number;
    bucket?: "overdue" | "this_week" | "later" | "draft" | "all";
    source_transaction_id?: string;
}): Promise<ClientInvoiceWithReceipts[]> => {
    const [invoices, receiptResponse] = await Promise.all([
        fetchInvoices({ bucket: "all", limit: 200, ...params }),
        fetchCashReceipts(),
    ]);
    const receipts = receiptResponse.cash_receipts ?? [];

    return invoices.map((invoice) => {
        const transactionIds = new Set(getInvoiceTransactionIds(invoice));
        const cashReceipts = receipts.filter((receipt) =>
            receipt.allocations?.some((allocation) =>
                transactionIds.has(allocation.invoice_transaction_id)
            )
        );

        return {
            ...invoice,
            cash_receipts: cashReceipts,
        };
    });
};

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
export const fetchSiteDrawings = (siteId: string) =>
    api<SiteDrawing[]>(`/api/v1/sites/${siteId}/drawings`);
export const uploadSiteDrawing = (siteId: string, data: {
    file_base64: string;
    mime_type: string;
    original_filename?: string;
    title?: string;
    drawing_no?: string;
    discipline?: string;
    change_note?: string;
    drawing_id?: string;
}) =>
    api<SiteDrawing>(`/api/v1/sites/${siteId}/drawings`, {
        method: "POST",
        body: JSON.stringify(data),
    });
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
    user_id?: string;
    org_id?: string;
    role?: "admin" | "member";
    status?: "active" | "suspended" | "removed";
    title?: string | null;
    approval_limit?: number | null;
    joined_at?: string | null;
    display_name?: string | null;
    full_name: string | null;
    username: string | null;
    avatar_url: string | null;
}

export interface OrgContextRecord {
    org: {
        id: string;
        name: string;
        slug: string | null;
        status: "active" | "suspended";
    };
    membership: {
        org_id: string;
        user_id: string;
        role: "admin" | "member";
        status: "active" | "suspended" | "removed";
        title?: string | null;
        approval_limit?: number | null;
        joined_at?: string | null;
    };
}

export const fetchOrgContext = () =>
    api<OrgContextRecord>("/api/v1/org/context");

export type RecurringExpenseCategory =
    | "車両ローン"
    | "携帯代"
    | "月極駐車"
    | "工具リース"
    | "事務所家賃"
    | "保険"
    | "その他";

export interface RecurringExpenseRecord {
    id: string;
    org_id: string;
    member_id: string;
    category: RecurringExpenseCategory;
    title: string;
    monthly_amount: number | string;
    effective_from: string;
    effective_until: string | null;
    cycle: "monthly" | "quarterly";
    status: "active" | "paused" | "ended";
    expense_scope: "overhead" | "stockpile";
    proposal_id: string | null;
    created_at: string;
    created_by: string;
}

export interface RecurringExpenseDraft {
    member_user_id?: string;
    category: RecurringExpenseCategory;
    title: string;
    monthly_amount: number;
    effective_from: string;
    effective_until?: string | null;
    expense_scope?: "overhead" | "stockpile";
}

export interface RecurringExpenseProposalResponse {
    proposal: ProposalRecord;
    auto_approved: boolean;
    auto_executed: boolean;
}

export const fetchRecurringExpenses = (params?: { includeEnded?: boolean }) => {
    const query = params?.includeEnded ? "?include_ended=1" : "";
    return api<{ recurring_expenses: RecurringExpenseRecord[] }>(`/api/v1/recurring-expenses${query}`);
};

export const createRecurringExpenseProposal = (data: RecurringExpenseDraft) =>
    api<RecurringExpenseProposalResponse>("/api/v1/recurring-expenses", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const updateRecurringExpenseProposal = (id: string, data: RecurringExpenseDraft) =>
    api<RecurringExpenseProposalResponse>(`/api/v1/recurring-expenses/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(data),
    });

export const endRecurringExpenseProposal = (id: string, effectiveUntil: string) =>
    api<RecurringExpenseProposalResponse>(`/api/v1/recurring-expenses/${encodeURIComponent(id)}/end`, {
        method: "POST",
        body: JSON.stringify({ effective_until: effectiveUntil }),
    });

export interface AppEntryMembershipRecord {
    org_id: string;
    org_name: string;
    role: "admin" | "member";
}

export interface AppEntryPendingInvite {
    invite_id: string;
    org_id: string;
    org_name: string;
    role: "admin" | "member";
    email_normalized: string;
}

export type AppEntryStateRecord =
    | {
          state: "needs_system_bootstrap";
          viewer_email: string | null;
      }
    | {
          state: "needs_onboarding";
          viewer_email: string | null;
          bootstrap_allowed: boolean;
          bootstrap_with_code_enabled: boolean;
          memberships: [];
          pending_invites: [];
      }
    | {
          state: "needs_invite_action";
          viewer_email: string | null;
          bootstrap_allowed: boolean;
          bootstrap_with_code_enabled: boolean;
          memberships: [];
          pending_invites: AppEntryPendingInvite[];
      }
    | {
          state: "needs_org_selection";
          viewer_email: string | null;
          memberships: AppEntryMembershipRecord[];
      }
    | {
          state: "ready";
          viewer_email: string | null;
          active_org: AppEntryMembershipRecord;
          memberships: AppEntryMembershipRecord[];
      };

export interface OrgBootstrapRequest {
    name: string;
    slug?: string | null;
}

export interface OrgBootstrapResponse {
    active_org: {
        id: string;
        name: string;
        slug: string | null;
        status: "active";
    };
    membership: {
        org_id: string;
        user_id: string;
        role: "admin";
        status: "active";
    };
}

export interface OrgInviteAcceptResponse {
    active_org: {
        id: string;
        name: string;
        slug: string | null;
        status: "active";
    };
    membership: {
        org_id: string;
        user_id: string;
        role: "admin" | "member";
        status: "active";
    };
}

export const fetchAppEntryState = () =>
    api<AppEntryStateRecord>("/api/v1/app-entry-state");

export const bootstrapFirstOrg = (payload: OrgBootstrapRequest) =>
    api<OrgBootstrapResponse>("/api/v1/system/bootstrap-first-org", {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const bootstrapOrg = (payload: OrgBootstrapRequest) =>
    api<OrgBootstrapResponse>("/api/v1/org/bootstrap", {
        method: "POST",
        body: JSON.stringify(payload),
    });

export interface OrgBootstrapWithCodeRequest {
    name: string;
    code: string;
    slug?: string | null;
}

export const bootstrapOrgWithCode = (payload: OrgBootstrapWithCodeRequest) =>
    api<OrgBootstrapResponse>("/api/v1/org/bootstrap-with-code", {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const acceptOrgInvite = (inviteId: string) =>
    api<OrgInviteAcceptResponse>(`/api/v1/org/invites/${encodeURIComponent(inviteId)}/accept`, {
        method: "POST",
    });

export type OrgInviteRole = "admin" | "member";
export type OrgInviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface OrgInviteRecord {
    id: string;
    org_id: string;
    email_normalized: string;
    role: OrgInviteRole;
    status: OrgInviteStatus;
    expires_at: string;
    invited_by: string | null;
    accepted_by: string | null;
    accepted_at: string | null;
    revoked_at: string | null;
    created_at: string;
    updated_at: string;
}

export const listOrgInvites = (params?: { status?: OrgInviteStatus | "all" }) => {
    const search = new URLSearchParams();
    if (params?.status) {
        search.append("status", params.status);
    }
    const query = search.toString();
    return api<{ invites: OrgInviteRecord[] }>(`/api/v1/org/invites${query ? `?${query}` : ""}`);
};

export const createOrgInvite = (payload: { email: string; role: OrgInviteRole; ttl_days?: number }) =>
    api<{ invite: OrgInviteRecord }>("/api/v1/org/invites", {
        method: "POST",
        body: JSON.stringify(payload),
    });

export const revokeOrgInvite = (inviteId: string) =>
    api<{ invite: OrgInviteRecord }>(`/api/v1/org/invites/${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
    });

export const rotateOrgInvite = (inviteId: string, payload?: { ttl_days?: number }) =>
    api<{ invite: OrgInviteRecord }>(`/api/v1/org/invites/${encodeURIComponent(inviteId)}/rotate`, {
        method: "POST",
        body: JSON.stringify(payload ?? {}),
    });

export type EmploymentKind = "employee" | "sole_proprietor" | "helper";
export type BankAccountType = "ordinary" | "checking";

export interface MyProfileRecord {
    id: string;
    username: string | null;
    nickname: string | null;
    full_name: string | null;
    avatar_url: string | null;
    onboarding_completed_at: string | null;
    phone: string | null;
    job_type: string | null;
    employment_kind: EmploymentKind;
    trade_name: string | null;
    invoice_registration_number: string | null;
    bank_name: string | null;
    branch_name: string | null;
    account_type: BankAccountType | null;
    account_number: string | null;
    account_holder_kana: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
    emergency_contact_name: string | null;
    emergency_phone: string | null;
}

export type UpdateMyProfilePayload = Partial<{
    nickname: string | null;
    full_name: string | null;
    avatar_url: string | null;
    username: string | null;
    phone: string | null;
    job_type: string | null;
    employment_kind: EmploymentKind;
    trade_name: string | null;
    invoice_registration_number: string | null;
    bank_name: string | null;
    branch_name: string | null;
    account_type: BankAccountType | null;
    account_number: string | null;
    account_holder_kana: string | null;
    postal_code: string | null;
    prefecture: string | null;
    city: string | null;
    address_line1: string | null;
    address_line2: string | null;
    emergency_contact_name: string | null;
    emergency_phone: string | null;
    complete_onboarding: boolean;
}>;

export const fetchMyProfile = () =>
    api<{ profile: MyProfileRecord }>("/api/v1/profile/me");

export const updateMyProfile = (payload: UpdateMyProfilePayload) =>
    api<{ profile: MyProfileRecord }>("/api/v1/profile/me", {
        method: "PATCH",
        body: JSON.stringify(payload),
    });

export interface CompleteOnboardingPayload {
    nickname: string;
    full_name: string;
    employment_kind: EmploymentKind;
    job_type: string;
    avatar_url?: string | null;
}

export const completeOnboarding = (payload: CompleteOnboardingPayload) =>
    api<{ profile: MyProfileRecord }>("/api/v1/profile/me", {
        method: "PATCH",
        body: JSON.stringify({
            ...payload,
            complete_onboarding: true,
        }),
    });

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
    calendar_color_token?: string | null;
    calendar_color?: string | null;
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
    client?: {
        id: string;
        name: string;
        contact_person?: string | null;
        phone?: string | null;
        calendar_color_token?: string | null;
        calendar_color?: string | null;
    };
    assigned_users?: string[];
    started_at?: string;
    expected_completion_at?: string;
    schedule_mode?: "continuous" | "weekdays" | "custom";
    working_weekdays?: number[];
    custom_work_dates?: string[];
    required_worker_count?: number | null;
    created_at: string;
    updated_at?: string;
    completed_at?: string;
    description?: string;
    cautions?: string;
    close_phase?: "active" | "completed_unclosed" | "completed_close_pending" | "completed_close_rejected" | "completed_close_executed";
    active_close_proposal?: {
        id: string;
        status: ProposalStatus;
        required_approvals: number;
        created_at: string;
        executed_at?: string | null;
    } | null;
    current_accumulated_cost?: number;
}

export interface SiteCompletionResult {
    site_id: string;
    site_completion_event_id: string | null;
    revenue_basis_id: string | null;
    income_proposal_id: string | null;
    idempotent: boolean;
    site: Site;
}

export interface SiteCloseDraftInput {
    recognized_revenue: number;
    included_day_log_ids: string[];
    site_day_log_drafts?: Array<{
        date: string;
        member_id: string;
        role_type: PathV31RoleType;
        credited_unit: number;
        trade_families?: PathTradeFamily[];
        memo?: string;
    }>;
    material_cost: number;
    external_cost: number;
    direct_cost: number;
    overhead_allocated: number;
    known_rework_cost: number;
    approved_adjustments: number;
    difficulty_band: PathDifficultyBand;
    share_mode: PathV31ShareMode;
    fixed_template_key?: string | null;
    fixed_template_reason_code?: string | null;
    fixed_template_members?: Array<{
        member_id: string;
        share_ratio: number;
        role_type?: PathV31RoleType;
        source_day_log_ids?: string[];
    }>;
    outcome_snapshots?: Array<{
        member_id: string;
        outcome_status: PathV31OutcomeStatus;
        rework_units?: number;
        source?: string;
        notes?: string;
    }>;
    closed_at?: string | null;
}

export interface CompleteSiteWithCloseRequest extends SiteCloseDraftInput {
    client_request_id: string;
    effective_completed_at?: string;
    expected_site_updated_at?: string;
}

export interface SiteCloseProposalSummary {
    id: string;
    status: ProposalStatus;
    required_approvals: number;
    created_at: string;
    executed_at?: string | null;
}

export interface CompleteSiteWithCloseResult {
    site_id: string;
    site_completion_event_id: string | null;
    revenue_basis_id: string | null;
    income_proposal_id: string | null;
    idempotent: boolean;
    site: Site;
    close_proposal: SiteCloseProposalSummary;
    close_auto_approved: boolean;
    close_auto_executed: boolean;
    close_summary: Record<string, unknown>;
}

export interface SiteCompletionReversalResult {
    site_id: string;
    reversal_event_id: string | null;
    revenue_basis_id: string | null;
    income_reverse_proposal_id: string | null;
    reward_adjust_proposal_id: string | null;
    idempotent: boolean;
    site: Site;
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

export interface SiteDrawingVersion {
    id: string;
    org_id: string;
    site_id: string;
    drawing_id: string;
    version_no: number;
    storage_bucket: string;
    storage_path: string;
    original_filename: string;
    mime_type: string;
    file_size: number;
    sha256: string;
    uploaded_by: string | null;
    change_note: string | null;
    status: string;
    supersedes_version_id: string | null;
    created_at: string;
    signed_url?: string | null;
}

export interface SiteDrawing {
    id: string;
    org_id: string;
    site_id: string;
    title: string;
    drawing_no: string | null;
    discipline: string | null;
    status: string;
    latest_version_no: number;
    current_version_id: string | null;
    created_by: string | null;
    created_at: string;
    updated_at: string;
    current_version?: SiteDrawingVersion | null;
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

export interface ElectronicDocumentRecord {
    id: string;
    org_id: string;
    kind: "receipt" | "invoice" | "contract" | "purchase_order" | "delivery_note" | "other";
    transaction_date: string;
    counterparty_name: string;
    amount: number;
    storage_bucket: string;
    storage_path: string;
    original_filename?: string | null;
    mime_type: string;
    file_size_bytes: number;
    sha256: string;
    source_document_id?: string | null;
    source_transaction_id?: string | null;
    registered_by?: string | null;
    registered_at: string;
    retention_until: string;
    metadata_json?: Record<string, unknown>;
    created_at: string;
}

export interface OfficeProcessingRuleRecord {
    id: string;
    org_id: string;
    version: number;
    title: string;
    markdown_content: string;
    pdf_storage_bucket?: string | null;
    pdf_storage_path?: string | null;
    pdf_original_filename?: string | null;
    pdf_mime_type?: string | null;
    pdf_file_size_bytes?: number | null;
    pdf_sha256?: string | null;
    status: "active" | "superseded" | "archived";
    effective_from: string;
    registered_by?: string | null;
    created_at: string;
    updated_at: string;
}

export interface DocumentIntegrityReport {
    ok: boolean;
    checked_count: number;
    latest_attestation_id: string | null;
    latest_attestation_hash: string | null;
    issues: Array<{ id: string; sequence: number; error: string }>;
}

export const fetchElectronicDocuments = (params?: {
    from?: string;
    to?: string;
    counterparty?: string;
    minAmount?: number;
    maxAmount?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.from) searchParams.append("from", params.from);
    if (params?.to) searchParams.append("to", params.to);
    if (params?.counterparty) searchParams.append("counterparty", params.counterparty);
    if (params?.minAmount !== undefined) searchParams.append("minAmount", String(params.minAmount));
    if (params?.maxAmount !== undefined) searchParams.append("maxAmount", String(params.maxAmount));
    const query = searchParams.toString();
    return api<{ documents: ElectronicDocumentRecord[] }>(`/api/v1/documents/search${query ? `?${query}` : ""}`);
};

export const fetchOfficeProcessingRules = () =>
    api<{ rules: OfficeProcessingRuleRecord[] }>("/api/v1/documents/office-processing-rules");

export const registerOfficeProcessingRule = (data: {
    version: number;
    title?: string;
    markdown_content: string;
    effective_from?: string;
    pdf_base64?: string;
    pdf_mime_type?: string;
    pdf_original_filename?: string;
}) => api<{ rule: OfficeProcessingRuleRecord }>("/api/v1/documents/office-processing-rules", {
    method: "POST",
    body: JSON.stringify(data),
});

export const fetchDocumentIntegrityReport = () =>
    api<{ report: DocumentIntegrityReport }>("/api/v1/documents/integrity-report");

// 経費登録
export const createExpense = (data: CreateExpenseRequest) =>
    api<AccountingTransaction>("/api/v1/accounting/expenses", {
        method: "POST",
        body: JSON.stringify(withIdempotencyKey("accounting.expenses.create", data)),
    });

// 経費バケット集計 (Money画面ダッシュボード用)
// docs/MONEY_EXPENSE_FLOW.md §5.1
export interface ExpenseBucketCounts {
    count: number;
    amount: number;
}

export interface ExpenseBucketsReport {
    month: string;
    range: { from: string; to: string };
    buckets: {
        unassigned: ExpenseBucketCounts;
        needs_review: ExpenseBucketCounts;
        awaiting_verify: ExpenseBucketCounts;
        posted: ExpenseBucketCounts;
        asset_candidates: ExpenseBucketCounts;
        advance_stale: ExpenseBucketCounts;
    };
    oldest_unassigned_age_days: number | null;
    total_count: number;
}

export const fetchExpenseBuckets = (month?: string) =>
    api<ExpenseBucketsReport>(
        `/api/v1/accounting/expense_buckets${month ? `?month=${encodeURIComponent(month)}` : ""}`,
    );

// 経費の編集履歴 (詳細ビュー用)
// docs/MONEY_EXPENSE_FLOW.md §5.3
export interface ExpenseHistoryActor {
    type: "human" | "ai" | "system" | "integration";
    id: string;
    name?: string | null;
}

export interface ExpenseHistoryEntry {
    id: string;
    field: string;
    old_value: unknown;
    new_value: unknown;
    changed_by: ExpenseHistoryActor;
    changed_at: string;
    source: "manual" | "ai_inference" | "system_auto";
    reason?: string | null;
}

export interface ExpenseHistoryResponse {
    expense_id: string;
    entries: ExpenseHistoryEntry[];
}

export const fetchExpenseHistory = (expenseId: string) =>
    api<ExpenseHistoryResponse>(
        `/api/v1/accounting/expenses/${encodeURIComponent(expenseId)}/history`,
    );

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
        body: JSON.stringify(withIdempotencyKey("accounting.sales.adjust", data)),
    });

// 請求書作成
export const createInvoice = (data: CreateInvoiceRequest) =>
    api<AccountingInvoice>("/api/v1/accounting/invoices", {
        method: "POST",
        body: JSON.stringify(withIdempotencyKey("accounting.invoices.create", data)),
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
    bucket?: "overdue" | "this_week" | "later" | "draft" | "all";
    source_transaction_id?: string;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.limit) searchParams.append("limit", String(params.limit));
    if (params?.offset) searchParams.append("offset", String(params.offset));
    if (params?.bucket) searchParams.append("bucket", params.bucket);
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

export type TaxAccountCategory = "income" | "expense" | "asset" | "liability" | "equity";

export interface TaxAccountMapping {
    id: string;
    org_id: string;
    display_label: string;
    tax_account_code: string;
    tax_account_name: string;
    category: TaxAccountCategory;
    applicable_proposal_types: string[];
    effective_from: string;
    effective_until: string | null;
    created_by: string;
    created_at: string;
}

export interface AccountMasterOption {
    code: string;
    name: string;
    category: "asset" | "liability" | "equity" | "revenue" | "expense";
    is_active: boolean;
    display_order: number | null;
}

export interface TaxAccountMappingsResponse {
    mappings: TaxAccountMapping[];
    history: TaxAccountMapping[];
    accounts: AccountMasterOption[];
}

export interface UpdateTaxAccountMappingRequest {
    tax_account_code: string;
    tax_account_name: string;
    category: TaxAccountCategory;
    applicable_proposal_types: string[];
    effective_from: string;
}

export const fetchTaxAccountMappings = (params?: { as_of?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.as_of) searchParams.append("as_of", params.as_of);
    const query = searchParams.toString();
    return api<TaxAccountMappingsResponse>(`/api/v1/accounting/tax-account-mappings${query ? `?${query}` : ""}`);
};

export const updateTaxAccountMapping = (mappingId: string, data: UpdateTaxAccountMappingRequest) =>
    api<{ mapping: TaxAccountMapping }>(`/api/v1/accounting/tax-account-mappings/${mappingId}/revisions`, {
        method: "POST",
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
    api<{ original_voided: string; original_reversed?: string; reversal_created: string }>(`/api/v1/accounting/void/${id}`, {
        method: "POST",
        body: JSON.stringify(withIdempotencyKey("accounting.void.create", { reason })),
    });

type FetchPLParams = {
    month?: string;
    site_id?: string;
    cost_center?: string;
};

// 月次PL取得
export function fetchPL(params?: FetchPLParams & { source?: "legacy" }): Promise<PLReport>;
export function fetchPL(params: FetchPLParams & { source: "journal" }): Promise<PLJournalReport>;
export function fetchPL(params: FetchPLParams & { source: "compare" }): Promise<PLCompareReport>;
export function fetchPL(params?: FetchPLParams & { source?: PLSource }) {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.cost_center) searchParams.append("cost_center", params.cost_center);
    if (params?.source) searchParams.append("source", params.source);
    const query = searchParams.toString();
    return api<PLReport | PLJournalReport | PLCompareReport>(`/api/v1/accounting/pl${query ? `?${query}` : ""}`);
}

export const fetchMonthlyDeductible = (month: string) =>
    api<MonthlyDeductibleAmount>(`/api/v1/accounting/monthly-deductible?month=${encodeURIComponent(month)}`);

// キャッシュフローサマリ (PR #10)
export interface CashflowSummary {
    month: string;
    unbilled: number;
    awaiting_payment: number;
    pay_pending: number;
    done: number;
}

export const fetchCashflowSummary = (month: string) =>
    api<CashflowSummary>(`/api/v1/accounting/cashflow-summary?month=${encodeURIComponent(month)}`);

export interface SiteCostTransferPreviewRow {
    site_id: string;
    site_name: string;
    completed_at: string | null;
    accumulated_amount: number;
    from_account_code: "1230";
    to_account_code: "5420";
    transfer_status: "pending" | "transferred";
    transferred_at: string | null;
    proposal_id: string | null;
}

export interface SiteCostTransferPreview {
    month: string;
    transfers: SiteCostTransferPreviewRow[];
}

export const fetchSiteCostTransferPreview = (month: string) =>
    api<SiteCostTransferPreview>(
        `/api/v1/accounting/site-cost-transfers/preview?month=${encodeURIComponent(month)}`
    );

export interface TeamMemberReimbursement {
    member_id: string;
    nickname: string;
    total_advanced: number;
    unsettled: number;
    settled: number;
    count_pending: number;
    status: "pending" | "in_review" | "none" | "settled";
    recurring_total?: number;
    recurring_items?: Array<{
        id: string;
        category: RecurringExpenseCategory | string;
        title: string;
        monthly_amount: number;
    }>;
}

export interface MemberReimbursementsSummary {
    month: string;
    self_member_id: string | null;
    members: TeamMemberReimbursement[];
}

export interface MemberReimbursementBalance {
    member_id: string;
    month: string;
    total_advanced: number;
    unsettled: number;
    settled: number;
    carry_over_amount?: number;
    by_status: {
        unsubmitted: number;
        submitted: number;
        approved: number;
        reimbursed: number;
    };
    recent_items: Array<{
        id: string;
        occurred_on: string;
        category: string;
        amount: number;
        reimbursement_status: string;
        recurring_expense?: {
            id: string;
            category: RecurringExpenseCategory | string;
            title: string;
            monthly_amount: number;
        } | null;
    }>;
    recurring_total?: number;
    recurring_items?: Array<{
        id: string;
        category: RecurringExpenseCategory | string;
        title: string;
        monthly_amount: number;
    }>;
}

export interface TeamMemberReward {
    member_id: string;
    nickname: string;
    level: PathLevelOrNull;
    level_source?: PathLevelSource;
    attendance_days: number;
    amount: number;
    status: "finalized" | "preview" | "pending";
    has_invoice: boolean;
    has_paid: boolean;
}

export interface TeamRewardSummary {
    month: string;
    self_member_id: string | null;
    is_finalized: boolean;
    members: TeamMemberReward[];
}

export const fetchMemberReimbursementsSummary = (month: string) =>
    api<MemberReimbursementsSummary>(`/api/v1/accounting/member-reimbursements-summary?month=${encodeURIComponent(month)}`);

export const fetchMemberReimbursementBalance = (memberId: string, month: string, options?: RequestInit) =>
    api<MemberReimbursementBalance>(
        `/api/v1/accounting/member/${encodeURIComponent(memberId)}/reimbursement-balance?month=${encodeURIComponent(month)}`,
        options,
    );

export const fetchTeamRewardSummary = (month: string) =>
    api<TeamRewardSummary>(`/api/v1/path/module/team-reward-summary?month=${encodeURIComponent(month)}`);

export type DisputeCorrectionKind =
    | "reward_amount"
    | "reimbursement_missing"
    | "level_misjudgment"
    | "attendance_days"
    | "other";

export interface DisputeCorrectionProposalRequest {
    target_member_id: string;
    reward_member_id?: string | null;
    month: string;
    correction_kind: DisputeCorrectionKind;
    from_amount: number;
    to_amount: number;
    reason: string;
    details?: Record<string, unknown>;
    source_document_ids?: string[];
}

export interface DisputeCorrectionRecord {
    proposal_id: string;
    org_id: string;
    status: ProposalStatus;
    description: string;
    month: string;
    target_member_id: string;
    reward_member_id: string | null;
    correction_kind: DisputeCorrectionKind;
    from_amount: number | null;
    to_amount: number | null;
    delta_amount: number | null;
    reason: string | null;
    evidence_document_ids: unknown;
    assigned_reviewer_id: string | null;
    assigned_at: string | null;
    result_event_id: string | null;
    created_at: string;
    executed_at: string | null;
}

export interface DisputeCorrectionSubmitResponse {
    proposal: ProposalRecord;
    autoApproved?: boolean;
    autoExecuted?: boolean;
}

export const submitDisputeCorrectionProposal = (data: DisputeCorrectionProposalRequest) =>
    api<DisputeCorrectionSubmitResponse>("/api/v1/payout/dispute-corrections", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchDisputeCorrections = (params: {
    month?: string;
    target_member_id?: string;
    reward_member_id?: string;
    member_id?: string;
    status?: ProposalStatus;
    limit?: number;
} = {}) => {
    const searchParams = new URLSearchParams();
    if (params.month) searchParams.append("month", params.month);
    if (params.target_member_id) searchParams.append("target_member_id", params.target_member_id);
    if (params.reward_member_id) searchParams.append("reward_member_id", params.reward_member_id);
    if (params.member_id) searchParams.append("member_id", params.member_id);
    if (params.status) searchParams.append("status", params.status);
    if (params.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ corrections: DisputeCorrectionRecord[] }>(
        `/api/v1/payout/dispute-corrections${query ? `?${query}` : ""}`,
    ).then((response) => response.corrections);
};

// 月次推移 (PR #8)
export interface PLTrendMonth {
    month: string; // "YYYY-MM"
    sales: number;
    expenses: number;
    profit: number;
}

export interface PLTrendReport {
    months: PLTrendMonth[];
    basis: "legacy";
}

export const fetchPLTrend = (params?: { end?: string; months?: number }) => {
    const q = new URLSearchParams();
    if (params?.end) q.append("end", params.end);
    if (params?.months) q.append("months", String(params.months));
    const query = q.toString();
    return api<PLTrendReport>(`/api/v1/accounting/pl/trend${query ? `?${query}` : ""}`);
};

// 取引一覧
export const fetchTransactions = (params?: {
    kind?: "expense" | "sale" | "invoice";
    status?: string;
    created_by?: string;
    date_from?: string;
    date_to?: string;
    limit?: number;
    offset?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.kind) searchParams.append("kind", params.kind);
    if (params?.status) searchParams.append("status", params.status);
    if (params?.created_by) searchParams.append("created_by", params.created_by);
    if (params?.date_from) searchParams.append("date_from", params.date_from);
    if (params?.date_to) searchParams.append("date_to", params.date_to);
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

export interface AccountingCommandEnvelope {
    proposal?: unknown | null;
    approval?: Record<string, unknown>;
    execution?: Record<string, unknown>;
    posting?: Record<string, unknown>;
    projection?: Record<string, unknown>;
}

export interface AccountingTransaction extends AccountingCommandEnvelope {
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
    paid_by?: "org" | "member";
    claimant_member_id?: string | null;
    settlement_type?: "paid" | "unpaid";
    payment_account?: "cash" | "bank" | null;
    reimbursement_status?: "unsubmitted" | "submitted" | "approved" | "reimbursed" | null;
}

export interface AccountingTransactionItem {
    item_name: string;
    quantity?: number | null;
    unit_name?: string | null;
    unit_price?: number | null;
    amount?: number | null;
}

export interface CreateExpenseRequest {
    idempotency_key?: string;
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
    invoice_number?: string;
    expense_scope?: "job" | "job_advance" | "stockpile" | "overhead";
    paid_by?: "org" | "member";
    claimant_member_id?: string | null;
    settlement_type?: "paid" | "unpaid";
    payment_account?: "cash" | "bank" | null;
    reimbursement_status?: "unsubmitted" | "submitted" | "approved" | "reimbursed" | null;
    source_document_id?: string;
    input_sources?: Record<string, "ocr" | "manual">;
}

export interface CreateSaleRequest {
    idempotency_key?: string;
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
    idempotency_key?: string;
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

export interface AccountingInvoice extends AccountingCommandEnvelope {
    id: string;
    transaction_id: string;
    source_transaction_id?: string;
    invoice_no: string;
    status?: "draft" | "issued" | "paid" | "void" | string;
    invoice_bucket?: "overdue" | "this_week" | "later" | "draft" | "all";
    is_overdue?: boolean;
    days_until_due?: number | null;
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

export type PLSource = "legacy" | "journal" | "compare";

export interface PLSummary {
    sales: number;
    expenses: number;
    completed_cogs: number;
    overhead: number;
    work_in_progress: number;
    profit: number;
    distributable: number;
    transaction_count?: number;
    journal_entry_count?: number;
    journal_line_count?: number;
}

export interface PLReport extends PLSummary {
    month: string;
    source?: "legacy";
    transaction_count: number;
}

export interface PLJournalReport extends PLSummary {
    month: string;
    source: "journal";
    basis: "net_accounting";
}

export interface PLCompareReport {
    month: string;
    source: "compare";
    basis: {
        legacy: "gross";
        journal: "net_accounting";
        diff: "gross_compat";
    };
    tax_basis_warning: boolean;
    legacy: PLSummary;
    journal: PLSummary;
    journal_gross_compat: PLSummary;
    diff: Pick<PLSummary, "sales" | "expenses" | "completed_cogs" | "overhead" | "work_in_progress" | "profit" | "distributable">;
    mismatches: Array<{
        field: string;
        amount: number;
        basis: "gross_compat";
    }>;
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

export const PATH_LEVEL_OPTIONS = ["L1", "L2", "L3", "L4", "L5"] as const;
export const PATH_TRADE_FAMILY_OPTIONS = [
    "wall_finish",
    "floor_finish",
    "substrate_preparation",
    "decorative_sheet_or_film",
    "common_site_operations",
] as const;
export const PATH_DIFFICULTY_BAND_OPTIONS = ["S1", "S2", "S3"] as const;
export const PATH_ROLE_TYPE_OPTIONS = ["lead", "support", "teaching"] as const;
export const PATH_QUALITY_RESULT_OPTIONS = ["pass", "minor_fix", "major_fix"] as const;
export const PATH_OPPORTUNITY_STATUS_OPTIONS = [
    "not_observed",
    "opportunity_not_granted",
    "recheck_required",
    "observed",
] as const;

export const PATH_CERTIFICATION_STATUS_OPTIONS = [
    "candidate",
    "verified",
    "review_required",
    "revoked",
] as const;

export type PathBigSkillKey = (typeof PATH_BIG_SKILL_KEYS)[number];
export type PathBigSkillState = (typeof PATH_BIG_SKILL_STATE_OPTIONS)[number];
export type PathLevel = (typeof PATH_LEVEL_OPTIONS)[number];
export type PathLevelOrNull = PathLevel | null;
export type PathLevelSource = "history" | "profile" | "unset";
export type PathTradeFamily = (typeof PATH_TRADE_FAMILY_OPTIONS)[number];
export type PathDifficultyBand = (typeof PATH_DIFFICULTY_BAND_OPTIONS)[number];
export type PathRoleType = (typeof PATH_ROLE_TYPE_OPTIONS)[number];
export type PathQualityResult = (typeof PATH_QUALITY_RESULT_OPTIONS)[number];
export type PathOpportunityStatus = (typeof PATH_OPPORTUNITY_STATUS_OPTIONS)[number];
export type PathCertificationStatus = (typeof PATH_CERTIFICATION_STATUS_OPTIONS)[number];

export interface PathMonthlyEvaluationForm {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    selected_big_skill_states: Partial<Record<PathBigSkillKey, PathBigSkillState>>;
    work_days: number;
    A: number;
    R: number;
    Q: number;
    current_level: PathLevel | null;
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
    work_days?: number;
    A?: number;
    R?: number;
    Q?: number;
    current_level?: PathLevel | null;
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

export interface PathModuleMonthlyCloseInput {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    role_level: PathLevel | null;
    trade_family_observations: Record<string, unknown>;
    aqr_input: Record<string, unknown>;
    selected_site_ids: string[];
    comment: string;
    submitted_by: Record<string, unknown> | null;
    submitted_at: string;
    updated_at: string;
}

export interface PathModuleEvidenceRecord {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    trade_family: PathTradeFamily | null;
    evidence_class: string;
    origin_event_id: string;
    source_type: string;
    source_ref: string | null;
    summary: string;
    metadata: Record<string, unknown>;
    created_by: Record<string, unknown> | null;
    created_at: string;
}

export interface PathModuleAiAnnotation {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    reviewer_kind: "A" | "B";
    adapter_key: string;
    annotation: Record<string, unknown>;
    supporting_evidence_ids: string[];
    challenged_evidence_ids: string[];
    model_version: string;
    prompt_version: string;
    schema_version: string;
    created_by: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
}

export interface PathModuleSiteItemProfitSnapshot {
    id: string;
    org_id: string;
    month: string;
    site_id: string;
    item_key: string;
    item_name: string;
    trade_family: PathTradeFamily;
    revenue: number;
    material_cost: number;
    subcontract_cost: number;
    direct_cost: number;
    gross_profit: number;
    estimated_std_hours: number;
    difficulty_band: PathDifficultyBand;
    metadata: Record<string, unknown>;
    created_at: string;
    updated_at: string;
}

export interface PathModuleOpportunityAudit {
    id: string;
    org_id: string;
    month: string;
    member_id: string;
    trade_family: PathTradeFamily;
    opportunity_status: PathOpportunityStatus;
    eligible_but_unassigned_days: number;
    opportunity_concentration_score: number;
    promotion_blocked_by_opportunity: boolean;
    protected_challenge_count: number;
    summary: Record<string, unknown>;
    source_proposal_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface PathModuleMonthCloseProposalRequest {
    month: string;
    member_id: string;
    current_role_level?: PathLevel | null;
    A?: number;
    R?: number;
    Q?: number;
    selected_site_ids?: string[];
    neutral_flags?: string[];
    evidence_ids: string[];
    credited_units: Array<{
        member_id: string;
        unit_type: string;
        units: number;
        source_id?: string;
        metadata?: Record<string, unknown>;
    }>;
    opportunity_audits?: Array<{
        member_id: string;
        trade_family: PathTradeFamily;
        opportunity_status: PathOpportunityStatus;
        eligible_but_unassigned_days?: number;
        opportunity_concentration_score?: number;
        promotion_blocked_by_opportunity?: boolean;
        protected_challenge_count?: number;
        summary?: Record<string, unknown>;
    }>;
    explanation?: Record<string, unknown>;
}

export interface PathModuleRewardPoolInput {
    recognized_revenue: number;
    direct_costs: number;
    overhead_allocated: number;
    rule_reserve: number;
    prior_period_adjustments: number;
}

export interface PathModuleRewardContributionInput {
    package_id: string;
    trade_family: PathTradeFamily;
    std_hours: number;
    difficulty_band: PathDifficultyBand;
    responsibility_share: number;
    role_type: PathRoleType;
    quality_result: PathQualityResult;
    rated_units?: number;
}

export interface PathModuleRewardRunMemberInput {
    member_id: string;
    name: string;
    role_level: PathLevel;
    credited_units: number;
    guaranteed_pay?: number;
    A?: number;
    R?: number;
    Q?: number;
    neutral_flags?: string[];
    package_contributions: PathModuleRewardContributionInput[];
}

export interface PathModuleRewardPreviewMember {
    member_id: string;
    name: string;
    role_level: PathLevel;
    credited_units: number;
    rated_units: number;
    A: number;
    R: number;
    Q: number;
    monthly_point_total: number;
    monthly_coefficient: number;
    base_weight: number;
    variable_weight: number;
    base_amount: number;
    variable_amount: number;
    calculated_pay: number;
    guaranteed_pay: number;
    guarantee_adjustment: number;
    final_pay: number;
    package_points_total: number;
    explanations: Record<string, unknown>;
}

export interface PathModuleRewardPreview {
    calculation_system: "path_v22";
    calculation_version: string;
    month: string;
    close_id: string | null;
    month_close_id?: string | null;
    policy_bundle: {
        id: string;
        bundle_key: string;
        version: string;
        revision: number;
        effective_from: string;
        fingerprint: string;
    };
    input_hash: string;
    closed_profit: number;
    path_pool_amount: number;
    base_pool_amount: number;
    variable_pool_amount: number;
    guaranteed_total_amount: number;
    members: PathModuleRewardPreviewMember[];
    explanation_snapshots: Array<Record<string, unknown>>;
}

export interface PathModuleRewardRunProposalRequest {
    month_close_id: string;
}

export interface PathModuleRewardRunProposalResponse {
    proposal: ProposalRecord | null;
    auto_approved: boolean;
    auto_executed: boolean;
    preview: PathModuleRewardPreview;
    existing_reward_run?: PathModuleMonthCloseSummaryRewardRun | null;
    reused_existing?: boolean;
}

export interface PathModuleRewardAdjustmentProposalRequest {
    reward_run_id: string;
    correction_month: string;
    mode: "adjustment" | "reversal";
    reason_code: string;
    member_adjustments: Array<{
        member_id: string;
        amount: number;
        explanation: Record<string, unknown>;
    }>;
    note?: string;
}

export interface PathModuleMonthCloseSummaryClose {
    id: string;
    proposal_id: string | null;
    member_id: string;
    month: string;
    policy_fingerprint: string | null;
    input_hash: string | null;
    current_role_level?: PathLevel | null;
    A?: number;
    R?: number;
    Q?: number;
    selected_site_ids?: string[];
    neutral_flags?: string[];
    evidence_ids?: string[];
    explanation?: Record<string, unknown>;
    close_status?: string;
    finalized_at?: string;
    [key: string]: unknown;
}

export interface PathModuleMonthCloseSummaryRewardRun {
    id: string;
    proposal_id: string | null;
    month: string;
    run_type: string;
    status?: string;
    close_id?: string | null;
    policy_fingerprint?: string | null;
    input_hash?: string | null;
    closed_profit?: number;
    path_pool_amount?: number;
    base_pool_amount?: number;
    variable_pool_amount?: number;
    guarantee_total_amount?: number;
    reward_payload?: Record<string, unknown>;
    target_month?: string | null;
    correction_of_reward_run_id?: string | null;
    approved_at?: string;
    [key: string]: unknown;
}

export interface PathModuleMonthCloseSummary {
    month: string;
    closes: PathModuleMonthCloseSummaryClose[];
    reward_runs: PathModuleMonthCloseSummaryRewardRun[];
    eligible_closes?: Array<{
        id: string;
        month_close_id: string;
        month: string;
        status: string;
        fixed_at?: string | null;
        reward_rule_version_id?: string | null;
        preview_snapshot_id?: string | null;
        preview_cached?: boolean;
        member_count?: number | null;
        canonical_reward_run_id?: string | null;
        blocked_reason?: string | null;
    }>;
    latest_eligible_month_close_id?: string | null;
    canonical_reward_runs?: Array<Record<string, unknown>>;
}

export interface MonthCloseStatus {
    month: string;
    status: "open" | "closed";
}

export interface PathModulePendingProposal {
    id: string;
    type: ProposalType;
    status: ProposalStatus;
    description: string;
    created_by: ProposalActorRef | null;
    policy_ref?: string | null;
    required_approvals: number;
    created_at: string;
    payload?: Record<string, unknown>;
}

export interface PathModuleRewardExplanationSnapshot {
    id: string;
    reward_run_id?: string | null;
    proposal_id?: string | null;
    month: string;
    member_id: string;
    explanation_json: Record<string, unknown>;
    selected_site_ids?: string[];
    allocation_basis?: string;
    site_allocations?: PathModuleRewardExplanationSiteAllocation[];
    rendered_at?: string;
    [key: string]: unknown;
}

export interface PathModuleRewardExplanationSiteAllocation {
    site_id: string | null;
    site_name: string;
    site_selected: boolean;
    allocation_scope: "selected_site" | "matched_site" | "unmatched_package";
    package_count: number;
    package_ids: string[];
    std_hours_total: number;
    rated_units_total: number;
    package_points_total: number;
    member_points_total: number;
    member_point_share: number;
    variable_weight_allocated: number;
    variable_amount_allocated: number;
}

export interface PathRewardEvidenceRef {
    kind: "site" | "proposal" | "rule" | "section" | "status";
    label: string;
    href?: string | null;
    anchor?: string | null;
    site_id?: string | null;
    proposal_id?: string | null;
    meta?: Record<string, unknown>;
}

export interface PathRewardDeltaReason {
    key: "workload" | "high_profit_sites" | "corrections" | "responsibility" | "performance";
    label: string;
    direction: "increase" | "decrease" | "neutral";
    summary: string;
    impact_amount: number | null;
    evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardSiteBreakdownDetail {
    self_explanation: {
        amount: number;
        floor_amount: number;
        result_amount: number;
        correction_amount: number;
        reflected_ratio: number;
        credited_units: number;
        reason_lines: string[];
    };
    site_summary: {
        distributable_profit: number;
        participant_count: number;
        self_rank: number | null;
        self_band: "top" | "upper" | "middle" | "lower" | "solo";
        privacy_mode: "exact_distribution" | "band_only";
        anonymous_relative_distribution: number[];
    };
}

export interface PathRewardSiteBreakdown {
    site_id: string;
    site_name: string;
    amount: number;
    reflected_ratio: number;
    reason_summary: string;
    correction_state: "なし" | "あり";
    evidence_refs: PathRewardEvidenceRef[];
    detail: PathRewardSiteBreakdownDetail;
}

export interface PathRewardCorrectionHistoryItem {
    proposal_id: string;
    status: string;
    reason: string;
    amount: number;
    correction_month: string | null;
    target_month: string | null;
    mode: "adjustment" | "reversal" | "unknown";
    note: string;
    created_at: string;
    evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardCorrectionSummary {
    total_amount: number;
    applied_amount: number;
    count: number;
    has_corrections: boolean;
    items: PathRewardCorrectionHistoryItem[];
}

export interface PathPendingCloseSite {
    site_id: string;
    site_name: string;
    completed_at: string | null;
    close_proposal_status: string | null;
    href: string;
}

export interface PathRewardConfirmationSummary {
    month: string;
    member_id: string;
    member_name: string;
    status: "試算中" | "確定申請中" | "確定済み";
    is_objection_window?: boolean;
    estimated_amount: number;
    base_amount: number;
    result_amount: number;
    correction_amount: number;
    delta_amount: number | null;
    delta_empty_state: string | null;
    top_reasons: PathRewardDeltaReason[];
    increase_reasons: PathRewardDeltaReason[];
    decrease_reasons: PathRewardDeltaReason[];
    explanation_cards: Array<{
        id: "increase" | "decrease" | "corrections" | "rule";
        title: string;
        body: string;
        evidence_refs: PathRewardEvidenceRef[];
    }>;
    explanation_missing: boolean;
    explanation_missing_message: string | null;
    site_breakdown: PathRewardSiteBreakdown[];
    pending_close_sites: PathPendingCloseSite[];
    corrections: PathRewardCorrectionSummary;
    evidence_refs: PathRewardEvidenceRef[];
    internal_controls: {
        can_manage: boolean;
        month: string;
    };
}

export interface PathRewardQaRequest {
    month: string;
    member_id: string;
    question: string;
    site_id?: string | null;
}

export type PathRewardQaConfidence = "low" | "medium" | "high";

export interface PathRewardQaAmountBreakdown {
    label: string;
    amount: number;
    detail: string;
    evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardQaAdjustment {
    label: string;
    amount: number | null;
    detail: string;
    evidence_refs: PathRewardEvidenceRef[];
}

export interface PathRewardQaResponse {
    conclusion: string;
    amount_breakdown: PathRewardQaAmountBreakdown[];
    why_changed: string[];
    adjustments: PathRewardQaAdjustment[];
    evidence_refs: PathRewardEvidenceRef[];
    next_action: string | null;
    confidence: PathRewardQaConfidence;
}

export type PathV31RoleType = "assist" | "lead" | "solo" | "support";
export type PathV31ShareMode = "auto_points" | "fixed_template";
export type PathV31OutcomeStatus = "ok" | "rework" | "unknown";
export type PathV31SpeedClass = "slow" | "normal" | "fast";

export interface PathV31DayLog {
    id: string;
    org_id: string;
    date: string;
    site_id: string;
    member_id: string;
    trade_families: PathTradeFamily[];
    role_type: PathV31RoleType;
    credited_unit: number;
    memo: string;
    locked_by_site_close_id: string | null;
    created_at: string;
    updated_at: string;
}

export interface PathV31SiteCloseRequest {
    site_id: string;
    included_day_log_ids: string[];
    recognized_revenue: number;
    material_cost: number;
    external_cost: number;
    direct_cost: number;
    overhead_allocated: number;
    known_rework_cost: number;
    approved_adjustments: number;
    difficulty_band: PathDifficultyBand;
    share_mode: PathV31ShareMode;
    fixed_template_key?: string | null;
    fixed_template_reason_code?: string | null;
    fixed_template_members?: Array<{
        member_id: string;
        share_ratio: number;
        role_type?: PathV31RoleType;
        source_day_log_ids?: string[];
    }>;
    outcome_snapshots?: Array<{
        member_id: string;
        outcome_status: PathV31OutcomeStatus;
        rework_units?: number;
        source?: string;
        notes?: string;
    }>;
    closed_at?: string | null;
}

export interface PathV31SiteClose {
    id: string;
    org_id: string;
    site_id: string;
    proposal_id: string;
    distributable_profit: number;
    difficulty_band: PathDifficultyBand;
    share_mode: PathV31ShareMode;
    fixed_template_key?: string | null;
    fixed_template_reason_code?: string | null;
    share_snapshot: Array<{
        member_id: string;
        credited_units: number;
        raw_points: number;
        role_type_mix: Record<string, number>;
        result_share: number;
        result_eligible: boolean;
        source_day_log_ids: string[];
    }>;
    path_rule_version_id?: string | null;
    path_rule_version: string;
    path_rule_fingerprint: string;
    calculation_snapshot: Record<string, unknown>;
    closed_at: string;
    closed_by: Record<string, unknown> | null;
    status: string;
}

export interface PathV31MonthlyDistributionPreview {
    month: string;
    pool_amount: number;
    floor_rate: number;
    result_rate: number;
    nonlinear_exponent: number;
    path_rule_version_id: string;
    path_rule_version: string;
    path_rule_fingerprint: string;
    calculation_snapshot: Record<string, unknown>;
    members: Array<{
        member_id: string;
        member_name: string;
        floor_units: number;
        floor_pay: number;
        raw_result_weight: number;
        boosted_result_weight: number;
        speed_class: PathV31SpeedClass;
        speed_coeff: number;
        result_pay: number;
        correction: number;
        total_pay: number;
        calculation_snapshot: Record<string, unknown>;
    }>;
}

export interface PathV32SimpleMonthlyDistributionPreview {
    month: string;
    calculation_system: "path_v32_simple";
    path_rule_version: "3.2.0-simple";
    monthly_pool: number;
    site_profit_total: number;
    pool_adjustment_total: number;
    member_correction_total: number;
    total_weight_num: number;
    month_total_days: number;
    active_member_count: number;
    warnings: string[];
    calculation_snapshot: Record<string, unknown>;
    members: Array<{
        member_id: string;
        member_name: string;
        level: PathLevelOrNull;
        level_source: PathLevelSource;
        level_weight_milli: number;
        month_total_days: number;
        confirmed_work_days: number;
        work_presence_bp: number;
        monthly_weight_num: number;
        total_weight_num_snapshot: number;
        final_share_bp: number;
        raw_amount: number;
        rounded_amount: number;
        member_correction_amount: number;
        total_pay_amount: number;
        calculation_snapshot: Record<string, unknown>;
    }>;
}

export interface PathV31MonthlyWorkUnits {
    month: string;
    period_start: string;
    period_end: string;
    deduction_policy: {
        standard_units_mode: "calendar_days";
        leave_source: "personal_schedules";
        leave_types: Array<"vacation" | "sick_leave">;
        include_pending_proposals: boolean;
    };
    members: Array<{
        member_id: string;
        member_name: string;
        standard_units: number;
        leave_units: number;
        work_units: number;
        leave_breakdown: Partial<Record<"vacation" | "sick_leave", number>>;
        source_schedule_count: number;
    }>;
    total_work_units: number;
}

export interface PathV31Experience {
    member_id: string;
    cutover_date: string;
    ledgers: Array<{
        id: string;
        member_id: string;
        trade_family: PathTradeFamily;
        assist_units: number;
        lead_units: number;
        solo_units: number;
        recent_90d_units: number;
        ok_count: number;
        rework_count: number;
        last_performed_at: string | null;
        derived_labels: string[];
        metadata: Record<string, unknown>;
    }>;
}

export interface PathV31LeadRecommendationRequest {
    date: string;
    site_id: string;
    trade_family: PathTradeFamily;
    difficulty_band: PathDifficultyBand;
    risk_band?: "low" | "medium" | "high";
    candidate_member_ids: string[];
    chosen_member_id?: string | null;
    override_reason_code?: string | null;
    excluded_member_ids?: string[];
    restricted_member_ids?: string[];
    incident_blocked_member_ids?: string[];
    bad_condition_member_ids?: string[];
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

export const fetchPathModuleMonthlyCloseInputs = (params?: {
    month?: string;
    member_id?: string;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ inputs: PathModuleMonthlyCloseInput[] }>(
        `/api/v1/path/module/monthly-close-inputs${query ? `?${query}` : ""}`
    );
};

export const fetchPathModuleEvidence = (params?: {
    month?: string;
    member_id?: string;
    trade_family?: PathTradeFamily;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.trade_family) searchParams.append("trade_family", params.trade_family);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ evidence: PathModuleEvidenceRecord[] }>(
        `/api/v1/path/module/evidence${query ? `?${query}` : ""}`
    );
};

export const fetchPathModuleAiAnnotations = (params?: {
    month?: string;
    member_id?: string;
    reviewer_kind?: "A" | "B";
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.reviewer_kind) searchParams.append("reviewer_kind", params.reviewer_kind);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ annotations: PathModuleAiAnnotation[] }>(
        `/api/v1/path/module/ai-annotations${query ? `?${query}` : ""}`
    );
};

export const createPathModuleMonthCloseProposal = (data: PathModuleMonthCloseProposalRequest) =>
    api<PathProposalResponse>("/api/v1/path/module/month-close-proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const previewPathModuleRewardRun = (data: PathModuleRewardRunProposalRequest) =>
    api<{ preview: PathModuleRewardPreview }>("/api/v1/path/module/reward-run/preview", {
        method: "POST",
        body: JSON.stringify(data),
    }).then((response) => response.preview);

export const createPathModuleRewardRunProposal = (data: PathModuleRewardRunProposalRequest) =>
    api<PathModuleRewardRunProposalResponse>("/api/v1/path/module/reward-run/proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const createPathModuleRewardAdjustmentProposal = (
    data: PathModuleRewardAdjustmentProposalRequest
) =>
    api<PathProposalResponse>("/api/v1/path/module/reward-adjustment-proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchPathModuleMonthCloseSummary = (month: string) =>
    api<PathModuleMonthCloseSummary>(
        `/api/v1/path/module/month-close-summary?month=${encodeURIComponent(month)}`
    );

export const fetchMonthCloseStatus = (month: string) =>
    fetchPathModuleMonthCloseSummary(month).then<MonthCloseStatus>((summary) => {
        const hasClosedEligibleClose =
            summary.eligible_closes?.some((close) => close.status === "fixed" || close.status === "closed") ?? false;
        const hasClosedRun = summary.reward_runs.some(
            (run) => run.status === "executed" || run.status === "closed" || Boolean(run.approved_at),
        );

        return {
            month: summary.month || month,
            status: hasClosedEligibleClose || hasClosedRun ? "closed" : "open",
        };
    });

export const fetchPathModulePendingProposals = (limit = 50) =>
    api<{ proposals: PathModulePendingProposal[] }>(
        `/api/v1/path/module/pending-proposals?limit=${encodeURIComponent(String(limit))}`
    );

export const fetchPathModuleRewardExplanation = (memberId: string, month: string) =>
    api<{ explanation: PathModuleRewardExplanationSnapshot | null }>(
        `/api/v1/path/module/members/${encodeURIComponent(memberId)}/reward-explanation?month=${encodeURIComponent(month)}`
    );

export const fetchPathRewardConfirmation = (month: string, memberId: string, options?: RequestInit) =>
    api<{ summary: PathRewardConfirmationSummary }>(
        `/api/v1/path/module/reward-confirmation?month=${encodeURIComponent(month)}&member_id=${encodeURIComponent(memberId)}`,
        options,
    ).then((response) => response.summary);

export const askPathRewardConfirmationQuestion = (data: PathRewardQaRequest) =>
    api<{ answer: PathRewardQaResponse }>("/api/v1/path/module/reward-confirmation/qa", {
        method: "POST",
        body: JSON.stringify(data),
    }).then((response) => response.answer);

export const fetchPathModuleSiteItemProfitSummary = (params?: {
    month?: string;
    site_id?: string;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ summary: PathModuleSiteItemProfitSnapshot[] }>(
        `/api/v1/path/module/site-item-profit-summary${query ? `?${query}` : ""}`
    );
};

export const fetchPathModuleOpportunityAuditSummary = (month: string) =>
    api<{ summary: PathModuleOpportunityAudit[] }>(
        `/api/v1/path/module/opportunity-audit-summary?month=${encodeURIComponent(month)}`
    );

export const fetchPathV31DayLogs = (params?: {
    site_id?: string;
    member_id?: string;
    from?: string;
    to?: string;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.member_id) searchParams.append("member_id", params.member_id);
    if (params?.from) searchParams.append("from", params.from);
    if (params?.to) searchParams.append("to", params.to);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ logs: PathV31DayLog[] }>(
        `/api/v1/path/module/day-logs${query ? `?${query}` : ""}`
    );
};

export const savePathV31DayLog = (data: {
    id?: string;
    date: string;
    site_id: string;
    member_id: string;
    trade_families: PathTradeFamily[];
    role_type: PathV31RoleType;
    credited_unit: number;
    memo?: string;
}) =>
    api<{ log: PathV31DayLog }>("/api/v1/path/module/day-logs", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchPathV31SiteCloses = (params?: {
    month?: string;
    site_id?: string;
    limit?: number;
}) => {
    const searchParams = new URLSearchParams();
    if (params?.month) searchParams.append("month", params.month);
    if (params?.site_id) searchParams.append("site_id", params.site_id);
    if (params?.limit !== undefined) searchParams.append("limit", String(params.limit));
    const query = searchParams.toString();
    return api<{ site_closes: PathV31SiteClose[] }>(
        `/api/v1/path/module/site-closes${query ? `?${query}` : ""}`
    );
};

export const fetchPathV31MonthlyWorkUnits = (month: string) =>
    api<PathV31MonthlyWorkUnits>(
        `/api/v1/path/module/monthly-work-units?month=${encodeURIComponent(month)}`
    );

export const createPathV31SiteCloseProposal = (data: PathV31SiteCloseRequest) =>
    api<{
        proposal: ProposalRecord;
        auto_approved: boolean;
        auto_executed: boolean;
        preview: Record<string, unknown>;
    }>("/api/v1/path/module/site-closes", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const createPathV31SiteCloseReopenProposal = (data: {
    site_close_id: string;
    reason_code: string;
    note?: string;
}) =>
    api<PathProposalResponse>("/api/v1/path/module/site-close-reopen-proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const previewPathV31MonthlyDistribution = (month: string) =>
    api<{ preview: PathV31MonthlyDistributionPreview }>(
        "/api/v1/path/module/monthly-distribution/preview",
        {
            method: "POST",
            body: JSON.stringify({ month }),
        }
    ).then((response) => response.preview);

export const createPathV31MonthlyDistributionProposal = (month: string) =>
    api<{
        proposal: ProposalRecord;
        auto_approved: boolean;
        auto_executed: boolean;
        preview: Record<string, unknown>;
    }>("/api/v1/path/module/monthly-distribution/proposals", {
        method: "POST",
        body: JSON.stringify({ month }),
    });

export const previewPathV32SimpleMonthlyDistribution = (month: string) =>
    api<{ preview: PathV32SimpleMonthlyDistributionPreview }>(
        "/api/v1/path/module/monthly-distribution-v32/preview",
        {
            method: "POST",
            body: JSON.stringify({ month }),
        }
    ).then((response) => response.preview);

export const createPathV32SimpleMonthlyDistributionProposal = (month: string) =>
    api<{
        proposal: ProposalRecord;
        auto_approved: boolean;
        auto_executed: boolean;
        preview: Record<string, unknown>;
    }>("/api/v1/path/module/monthly-distribution-v32/proposals", {
        method: "POST",
        body: JSON.stringify({ month }),
    });

// ─── PATH V3.3 transparent governance ─────────────────────────────────────
// Spec: docs/REWARD_SYSTEM_V33.md
export type PathV33Tier = 1 | 2 | 3;
export type PathV33Level = "L1" | "L2" | "L3" | "L4" | "L5";

export interface PathV33LevelDraft {
    id: string;
    org_id: string;
    site_id: string;
    member_id: string;
    tier: PathV33Tier;
    work_days: number;
    self_comment: string;
    evidence: Record<string, unknown>;
    submitted_at: string;
    locked_at: string | null;
}

export interface PathV33AggregationResult {
    level: PathV33Level;
    weight_milli: number;
    score: number;
    total_work_days: number;
    draft_count: number;
    drafts: Array<{ site_id: string; tier: PathV33Tier; work_days: number }>;
}

export interface PathV33MonthlyPreview {
    month: string;
    member_id: string;
    current: PathV33AggregationResult;
    prior_level: PathV33Level | null;
    drafts: PathV33LevelDraft[];
}

export const submitPathV33LevelDraft = (data: {
    site_id: string;
    tier: PathV33Tier;
    self_comment?: string;
}) =>
    api<{ draft: PathV33LevelDraft; preview: PathV33MonthlyPreview }>(
        "/api/v1/path/module/v33/level-drafts",
        { method: "POST", body: JSON.stringify(data) },
    );

export const revisePathV33LevelDraft = (data: {
    draft_id: string;
    tier: PathV33Tier;
    self_comment?: string;
    reason: string;
}) =>
    api<{ draft: PathV33LevelDraft; preview: PathV33MonthlyPreview }>(
        "/api/v1/path/module/v33/level-drafts/revise",
        { method: "POST", body: JSON.stringify(data) },
    );

export interface ResponsibilityLockTarget {
    site_id: string;
    site_name: string;
    completed_at: string;
    deadline_at: string;
}

export const fetchResponsibilityLockTargets = () =>
    api<{ targets: ResponsibilityLockTarget[] }>("/api/v1/path/module/v33/me/responsibility-lock").then(
        (response) => response.targets,
    );

export const fetchPathV33MonthlyPreview = (memberId: string, month: string, options?: RequestInit) =>
    api<{ preview: PathV33MonthlyPreview }>(
        `/api/v1/path/module/v33/level-drafts/preview?member_id=${encodeURIComponent(memberId)}&month=${encodeURIComponent(month)}`,
        options,
    ).then((response) => response.preview);

export interface PathV33TeamFeedMember {
    member_id: string;
    member_name: string;
    current: PathV33AggregationResult;
    prior_level: PathV33Level | null;
    drafts: PathV33LevelDraft[];
}

export interface PathV33TeamFeedTimelineEntry {
    draft_id: string;
    member_id: string;
    member_name: string;
    site_id: string;
    site_name: string;
    tier: PathV33Tier;
    work_days: number;
    self_comment: string;
    submitted_at: string;
}

export interface PathV33TeamFeed {
    month: string;
    members: PathV33TeamFeedMember[];
    timeline: PathV33TeamFeedTimelineEntry[];
}

export const fetchPathV33TeamFeed = (month: string) =>
    api<{ feed: PathV33TeamFeed }>(
        `/api/v1/path/module/v33/team-feed?month=${encodeURIComponent(month)}`,
    ).then((response) => response.feed);

export interface PathV33CoSign {
    user_id: string;
    user_name: string;
    signed_at: string;
    comment: string;
}

export interface PathV33TargetResponse {
    agreed: boolean;
    comment: string;
    responded_at: string;
}

export interface PathV33Objection {
    id: string;
    org_id: string;
    target_member_id: string;
    target_month: string;
    target_draft_id: string;
    objector_id: string;
    proposed_tier: PathV33Tier;
    reason: string;
    evidence: Record<string, unknown>;
    co_signs: PathV33CoSign[];
    target_self_response: PathV33TargetResponse | null;
    required_co_signs: number;
    status: "open" | "accepted" | "rejected" | "expired";
    expires_at: string;
    resolved_at: string | null;
    resolved_tier: PathV33Tier | null;
    created_at: string;
    updated_at: string;
}

export const submitPathV33Objection = (data: {
    target_draft_id: string;
    proposed_tier: PathV33Tier;
    reason: string;
    evidence?: Record<string, unknown>;
}) =>
    api<{ objection: PathV33Objection }>("/api/v1/path/module/v33/objections", {
        method: "POST",
        body: JSON.stringify(data),
    }).then((response) => response.objection);

export const coSignPathV33Objection = (objectionId: string, comment?: string) =>
    api<{ objection: PathV33Objection }>(
        `/api/v1/path/module/v33/objections/${encodeURIComponent(objectionId)}/co-sign`,
        { method: "POST", body: JSON.stringify({ comment: comment ?? "" }) },
    ).then((response) => response.objection);

export const respondToPathV33Objection = (
    objectionId: string,
    data: { agreed: boolean; comment?: string },
) =>
    api<{ objection: PathV33Objection }>(
        `/api/v1/path/module/v33/objections/${encodeURIComponent(objectionId)}/target-response`,
        { method: "POST", body: JSON.stringify(data) },
    ).then((response) => response.objection);

export const fetchPathV33Objection = (objectionId: string) =>
    api<{ objection: PathV33Objection }>(
        `/api/v1/path/module/v33/objections/${encodeURIComponent(objectionId)}`,
    ).then((response) => response.objection);

export const fetchPathV33OpenObjections = () =>
    api<{ objections: PathV33Objection[] }>("/api/v1/path/module/v33/objections")
        .then((response) => response.objections);

// V3.3 Phase 5 month-end admin endpoints

export interface PathV33LockResult {
    month: string;
    locked_draft_count: number;
    recounted_drafts: number;
}

export interface PathV33ExpireResult {
    month: string;
    expired_objection_count: number;
}

export interface PathV33FinalizeMember {
    member_id: string;
    level: PathV33Level;
    score: number;
    weight_milli: number;
    draft_count: number;
    total_work_days: number;
}

export interface PathV33FinalizeResult {
    month: string;
    members: PathV33FinalizeMember[];
}

export const lockPathV33MonthDrafts = (month: string) =>
    api<PathV33LockResult>(
        `/api/v1/path/module/v33/month/${encodeURIComponent(month)}/lock-drafts`,
        { method: "POST" },
    );

export const expirePathV33MonthObjections = (month: string) =>
    api<PathV33ExpireResult>(
        `/api/v1/path/module/v33/month/${encodeURIComponent(month)}/expire-objections`,
        { method: "POST" },
    );

export const finalizePathV33Month = (month: string) =>
    api<PathV33FinalizeResult>(
        `/api/v1/path/module/v33/month/${encodeURIComponent(month)}/finalize`,
        { method: "POST" },
    );

/**
 * @deprecated V3.3 cutover (Phase 6): self-tier declarations now flow through
 * the bell → LevelDraftSheet path which writes to site_member_level_drafts.
 * The legacy path.level.update proposal type stays accepted by the DB for
 * historical-row replay but new UI must not call this helper.
 * Spec: docs/REWARD_SYSTEM_V33.md §7-9.
 */
export const createPathV32SimpleLevelUpdateProposal = (data: {
    member_id: string;
    level: PathLevel;
    effective_month: string;
    reason: string;
    evidence_snapshot?: Record<string, unknown>;
}) =>
    api<{
        proposal: ProposalRecord;
        auto_approved: boolean;
        auto_executed: boolean;
        payload: Record<string, unknown>;
    }>("/api/v1/path/module/level-update-proposals", {
        method: "POST",
        body: JSON.stringify(data),
    });

export const fetchPathV31Experience = (memberId: string) =>
    api<{ experience: PathV31Experience }>(
        `/api/v1/path/module/members/${encodeURIComponent(memberId)}/experience`
    ).then((response) => response.experience);

export const recommendPathV31LeadAssignment = (data: PathV31LeadRecommendationRequest) =>
    api<{
        recommendation: Record<string, unknown>;
        ranking: Array<Record<string, unknown>>;
        log: Record<string, unknown>;
    }>("/api/v1/path/module/lead-assignments/recommendation", {
        method: "POST",
        body: JSON.stringify(data),
    });

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

const LUQO_MEMBER_ID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidLegacyLuqoMembers(
    members: Array<{
        member_id: string;
        name: string;
    }>
) {
    const seen = new Set<string>();

    members.forEach((member, index) => {
        if (!LUQO_MEMBER_ID_PATTERN.test(member.member_id)) {
            throw new Error(`LEGACY_LUQO_MEMBER_ID_REQUIRED:${index}`);
        }
        if (!member.name.trim()) {
            throw new Error(`LEGACY_LUQO_MEMBER_NAME_REQUIRED:${index}`);
        }
        if (seen.has(member.member_id)) {
            throw new Error("LEGACY_LUQO_DUPLICATE_MEMBER_ID");
        }
        seen.add(member.member_id);
    });
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

// 報酬計算プレビュー（legacy/debug 専用）
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
}) => {
    assertValidLegacyLuqoMembers(data.members);

    return api<LUQORewardPreview>("/api/v1/luqo/reward/preview", {
        method: "POST",
        body: JSON.stringify(data),
    });
};

export const fetchLUQORewardCalculations = (params?: { period?: string }) => {
    const searchParams = new URLSearchParams();
    if (params?.period) searchParams.append("period", params.period);
    const q = searchParams.toString();
    return api<{ calculations: LUQORewardCalculation[] }>(
        `/api/v1/luqo/reward/calculations${q ? `?${q}` : ""}`
    );
};

// 報酬計算確定（legacy/debug 専用、主導線では未使用）
export const submitLUQORewardProposal = (data: {
    period: string;
    profit: number;
    company_rate: number;
    breakdown: LUQORewardBreakdownItem[];
}) => {
    assertValidLegacyLuqoMembers(data.breakdown);

    return api<{ proposal: ProposalRecord; auto_approved: boolean; auto_executed: boolean }>(
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
};

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
