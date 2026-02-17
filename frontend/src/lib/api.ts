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
    | "site.create"
    | "site.complete"
    | "policy.update";

export type ProposalStatus = "draft" | "proposed" | "approved" | "rejected" | "executed";

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

export const fetchPendingProposals = () =>
    api<ProposalRecord[]>("/api/v1/proposals/pending");

export const fetchExecutableProposals = () =>
    api<ProposalRecord[]>("/api/v1/proposals?status=approved");

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

export const rejectProposalsBatch = (proposalIds: string[], reason: string) =>
    api<ProposalBatchRejectResponse>("/api/v1/proposals/reject/batch", {
        method: "POST",
        body: JSON.stringify({ proposal_ids: proposalIds, reason }),
    });

export const executeProposal = (proposalId: string) =>
    api<ProposalRecord>(`/api/v1/proposals/${proposalId}/execute`, {
        method: "POST",
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

// 現場
export const fetchSites = () => api<Site[]>("/api/v1/sites");
export const fetchSite = (id: string) => api<Site>(`/api/v1/sites/${id}`);
export const createSite = (site: Partial<Site>) =>
    api<Site>("/api/v1/sites", { method: "POST", body: JSON.stringify(site) });
export const updateSite = (id: string, site: Partial<Site>) =>
    api<Site>(`/api/v1/sites/${id}`, { method: "PUT", body: JSON.stringify(site) });
export const completeSite = (id: string) =>
    api<Site>(`/api/v1/sites/${id}/complete`, { method: "POST" });

// シェルパ
export const chatWithSherpa = (message: string, context?: ChatMessage[]) =>
    api<{ reply: string }>("/api/v1/sherpa/chat", { method: "POST", body: JSON.stringify({ message, context }) });
export const checkExpense = (description: string, amount: number, category: string) =>
    api<ExpenseCheck>("/api/v1/sherpa/expense-check", { method: "POST", body: JSON.stringify({ description, amount, category }) });

// 経理Sherpa
export const accountingChatWithSherpa = (message: string, context?: ChatMessage[], provider?: string) =>
    api<{ reply: string }>("/api/v1/sherpa/accounting-chat", { method: "POST", body: JSON.stringify({ message, context, provider }) });

// 型定義
export interface Site {
    id: string;
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
    created_at: string;
    completed_at?: string;
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
    storage_path: string;
    original_filename?: string;
    mime_type: string;
    file_size: number;
    sha256: string;
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
    source_document_id?: string;
    input_sources?: Record<string, "ocr" | "manual">;
}

export interface CreateSaleRequest {
    site_id?: string;
    client_id?: string;
    description?: string;
    recorded_date?: string;
    amount_subtotal?: number;
    tax_amount?: number;
    amount_total?: number;
    source_document_id?: string;
    input_sources?: Record<string, "ocr" | "manual">;
}

export interface CreateInvoiceRequest {
    transaction_id: string;
    issue_date?: string;
    due_date?: string;
    billing_name?: string;
    billing_address?: string;
    notes?: string;
}

export interface AccountingInvoice {
    id: string;
    transaction_id: string;
    invoice_no: string;
    issue_date: string;
    due_date?: string;
    billing_name?: string;
    billing_address?: string;
    notes?: string;
    created_by: string;
    created_at: string;
}

export interface PLReport {
    month: string;
    sales: number;
    expenses: number;
    profit: number;
    distributable: number;
    transaction_count: number;
}


