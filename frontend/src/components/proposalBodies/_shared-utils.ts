import type { ProposalRecord } from "../../lib/api";

/* ============================================================
   Common helpers — kept in a .ts file so react-refresh is happy
   (proposalBodies/_shared.tsx exports only React components)
   ============================================================ */

export const isRecord = (v: unknown): v is Record<string, unknown> =>
    Boolean(v) && typeof v === "object" && !Array.isArray(v);

export const formatYen = (n: number) => `¥${Math.abs(n).toLocaleString()}`;

export const toFiniteNumber = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const num = Number(v.replace(/[,\s¥￥]/g, ""));
        if (Number.isFinite(num)) return num;
    }
    return null;
};

export const toMonthLabel = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    const match = raw.match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    return `${match[1]}年${Number(match[2])}月`;
};

export const formatDate = (iso: string): string => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

export const formatRecordedDate = (raw: string): string => raw.replace(/-/g, "/");

export const ACTOR_TYPE_LABELS: Record<string, string> = {
    human: "人",
    ai: "AI",
    system: "自動",
    integration: "連携",
};

export const STATUS_LABELS: Record<string, string> = {
    draft: "下書き",
    pending: "承認待ち",
    approved: "承認済み",
    rejected: "却下",
    executed: "実行済み",
};

export function getStatusLabel(status: string): string {
    return STATUS_LABELS[status] || status;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isInternalPayloadValue = (key: string, value: unknown): boolean => {
    if (typeof value === "string" && UUID_RE.test(value.trim())) return true;
    if (value && typeof value === "object") return true;
    if (key.endsWith("_id") || key.endsWith("_snapshot") || key.endsWith("_version")) return true;
    return false;
};

export const PAYLOAD_LABELS: Record<string, string> = {
    vendor_name: "取引先",
    amount: "金額",
    amount_total: "合計金額",
    amount_subtotal: "小計",
    tax_amount: "消費税",
    total_amount: "合計金額",
    total: "合計",
    category: "区分",
    recorded_date: "日付",
    date: "日付",
    transaction_date: "取引日",
    description: "摘要",
    memo: "メモ",
    cost_center: "場所",
    currency: "通貨",
    worker_id: "作業者",
    assignee_id: "担当",
    task_kind: "種別",
    priority: "優先度",
    due_date: "期限",
    target_proposal_id: "対象提案",
    target_type: "対象タイプ",
};

export const AMOUNT_KEYS = new Set([
    "amount",
    "amount_total",
    "total_amount",
    "total",
    "value",
    "amount_subtotal",
    "tax_amount",
]);

export const DEFAULT_HIDDEN_KEYS = new Set([
    "source_message_subject",
    "source_message_from",
    "source_message_body_preview",
    "source_message_body_full",
    "email_subject",
    "email_from",
    "email_body_preview",
    "email_body_full",
    "suggested_tasks",
    "target_snapshot",
    "summary_snapshot",
    "snapshot_id",
    "policy_version",
    "reason_type",
    "month",
    "source",
    "member_id",
    "member_name",
    "explanation_cards",
    "evidence_refs",
    "internal_controls",
    "explanation_missing",
    "explanation_missing_message",
    "calculated_at",
    "drive_file_url",
]);

export const formatPayloadValue = (key: string, value: unknown): string => {
    if (AMOUNT_KEYS.has(key) && typeof value === "number") {
        return formatYen(value);
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
};

export function getRiskLabel(proposal: ProposalRecord, amountLabel: string): string {
    const explicit =
        typeof proposal.payload.risk_level === "string"
            ? proposal.payload.risk_level
            : typeof proposal.payload.risk === "string"
                ? proposal.payload.risk
                : null;
    if (explicit === "HIGH" || explicit === "high") return "要注意";
    if (explicit === "LOW" || explicit === "low") return "通常";
    if (amountLabel === "金額なし") return "判断要";
    return "通常";
}

export function getLedgerImpactLabel(proposal: ProposalRecord): string {
    const status = proposal.status;
    if (status === "executed") return "反映済み";
    if (status === "rejected") return "反映なし";

    if (proposal.type.startsWith("expense.")) return "承認後、経費として記録";
    if (proposal.type.startsWith("income.")) return "承認後、売上として記録";
    if (proposal.type.startsWith("invoice.")) return "承認後、請求として記録";
    if (proposal.type.startsWith("reward.") || proposal.type === "evaluation.finalize")
        return "承認後、月次報酬として記録";
    if (proposal.type.startsWith("communication."))
        return "承認後、メール由来の記録/対応タスクへ反映";
    if (proposal.type.startsWith("skill."))
        return "承認後、技能認定として記録";

    return "承認後、記録に反映";
}
