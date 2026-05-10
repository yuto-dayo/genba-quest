import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ProposalRecord } from "../../lib/api";
import styles from "./_shared.module.css";

/* ============================================================
   Common helpers
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

const STATUS_LABELS: Record<string, string> = {
    draft: "下書き",
    pending: "承認待ち",
    approved: "承認済み",
    rejected: "却下",
    executed: "実行済み",
};

const ACTOR_CHIP_CLASS: Record<string, string> = {
    ai: styles.actorAi,
    system: styles.actorSystem,
    integration: styles.actorIntegration,
};

const STATUS_CHIP_CLASS: Record<string, string> = {
    draft: "",
    pending: styles.statusPending,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    executed: styles.statusExecuted,
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isInternalPayloadValue = (key: string, value: unknown): boolean => {
    if (typeof value === "string" && UUID_RE.test(value.trim())) return true;
    if (value && typeof value === "object") return true;
    if (key.endsWith("_id") || key.endsWith("_snapshot") || key.endsWith("_version")) return true;
    return false;
};

/* ============================================================
   BodyHeader — type/status/actor chips + title + date
   ============================================================ */

interface BodyHeaderProps {
    typeLabel: string;
    statusLabel?: string;
    statusKey?: string;
    actorTypeLabel?: string;
    actorTypeKey?: string;
    title: string;
    subtitle?: string;
    dateIso?: string;
}

export function BodyHeader({
    typeLabel,
    statusLabel,
    statusKey,
    actorTypeLabel,
    actorTypeKey,
    title,
    subtitle,
    dateIso,
}: BodyHeaderProps) {
    const statusClass = statusKey ? STATUS_CHIP_CLASS[statusKey] || "" : "";
    const actorClass = actorTypeKey ? ACTOR_CHIP_CLASS[actorTypeKey] || "" : "";
    return (
        <header className={styles.bodyHeader}>
            <div className={styles.headerChips}>
                <span className={styles.typeChip}>{typeLabel}</span>
                {statusLabel && (
                    <span className={`${styles.statusChip} ${statusClass}`}>{statusLabel}</span>
                )}
                {actorTypeLabel && (
                    <span className={`${styles.actorChip} ${actorClass}`}>{actorTypeLabel}</span>
                )}
            </div>
            <h2 className={styles.headerTitle}>{title}</h2>
            {subtitle && <p className={styles.headerSubtitle}>{subtitle}</p>}
            {dateIso && <span className={styles.headerDate}>{formatDate(dateIso)}</span>}
        </header>
    );
}

export function getStatusLabel(status: string): string {
    return STATUS_LABELS[status] || status;
}

/* ============================================================
   DecisionSummaryGrid — 作成者 / 必要承認 / 反映先 / リスク
   ============================================================ */

interface DecisionSummaryGridProps {
    headlineLabel?: string;
    headlineValue?: string;
    items: Array<{ label: string; value: ReactNode }>;
}

export function DecisionSummaryGrid({
    headlineLabel = "判断材料",
    headlineValue,
    items,
}: DecisionSummaryGridProps) {
    return (
        <section className={styles.decisionSummary} aria-label="判断材料">
            <div className={styles.decisionHead}>
                <span className={styles.decisionEyebrow}>{headlineLabel}</span>
                {headlineValue && <strong>{headlineValue}</strong>}
            </div>
            <div className={styles.decisionGrid}>
                {items.map((item, i) => (
                    <div key={i} className={styles.decisionItem}>
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                    </div>
                ))}
            </div>
        </section>
    );
}

/* ============================================================
   AmountHero — large amount block (the decision focal point)
   ============================================================ */

interface AmountHeroProps {
    label: string;
    amount: number;
    sign?: "expense" | "income" | "neutral";
    subMeta?: string;
}

export function AmountHero({ label, amount, sign = "neutral", subMeta }: AmountHeroProps) {
    const valueClass =
        amount === 0
            ? styles.amountValueZero
            : sign === "expense"
                ? styles.amountValueExpense
                : "";
    const display =
        amount === 0
            ? formatYen(0)
            : sign === "expense"
                ? `−${formatYen(amount)}`
                : sign === "income"
                    ? `+${formatYen(amount)}`
                    : formatYen(amount);
    return (
        <section className={styles.amountHero}>
            <span className={styles.amountLabel}>{label}</span>
            <strong className={`${styles.amountValue} ${valueClass}`}>{display}</strong>
            {subMeta && <span className={styles.amountSubMeta}>{subMeta}</span>}
        </section>
    );
}

/* ============================================================
   StatsGrid — 2-col grid of label+value pairs
   ============================================================ */

export interface StatItem {
    label: string;
    value: ReactNode;
    muted?: boolean;
}

export function StatsGrid({ items }: { items: StatItem[] }) {
    if (items.length === 0) return null;
    return (
        <div className={styles.statsGrid}>
            {items.map((item, i) => (
                <div key={i} className={styles.statItem}>
                    <span className={styles.statLabel}>{item.label}</span>
                    <span
                        className={`${styles.statValue} ${item.muted ? styles.statValueMuted : ""}`}
                    >
                        {item.value}
                    </span>
                </div>
            ))}
        </div>
    );
}

/* ============================================================
   ReasonsList — for PATH "main reasons" or anything similar
   ============================================================ */

export interface ReasonEntry {
    key: string;
    label: string;
    summary?: string;
    impactAmount?: number | null;
    direction?: "positive" | "negative" | "neutral";
}

export function ReasonsList({ title, reasons }: { title?: string; reasons: ReasonEntry[] }) {
    if (reasons.length === 0) return null;
    return (
        <div className={styles.reasons}>
            {title && <span className={styles.reasonsTitle}>{title}</span>}
            {reasons.map((r) => (
                <div key={r.key} className={styles.reasonItem}>
                    <div className={styles.reasonHead}>
                        <span className={styles.reasonLabel}>{r.label}</span>
                        {r.impactAmount !== undefined &&
                            r.impactAmount !== null &&
                            r.impactAmount !== 0 && (
                                <span
                                    className={`${styles.reasonImpact} ${r.direction === "positive"
                                            ? styles.reasonImpactPositive
                                            : r.direction === "negative"
                                                ? styles.reasonImpactNegative
                                                : ""
                                        }`}
                                >
                                    {r.direction === "negative" ? "−" : "+"}
                                    {formatYen(r.impactAmount)}
                                </span>
                            )}
                    </div>
                    {r.summary && <p className={styles.reasonSummary}>{r.summary}</p>}
                </div>
            ))}
        </div>
    );
}

/* ============================================================
   DescriptionBlock — for plain-text body content
   ============================================================ */

export function DescriptionBlock({ label, text }: { label: string; text: string }) {
    return (
        <div className={styles.descriptionBlock}>
            <span className={styles.descriptionLabel}>{label}</span>
            <p className={styles.descriptionText}>{text}</p>
        </div>
    );
}

/* ============================================================
   OpenLink — deep links into other pages
   ============================================================ */

export function OpenLink({ to, label }: { to: string; label: string }) {
    // Using anchor for cross-target compatibility (router-relative paths handled by parent)
    return (
        <a href={to} className={styles.openLink}>
            {label}
            <ExternalLink size={14} />
        </a>
    );
}

/* ============================================================
   EmailContext — communication.* bodies use this
   ============================================================ */

interface EmailContextProps {
    subject?: string | null;
    from?: string | null;
    bodyPreview?: string | null;
    bodyFull?: string | null;
}

export function EmailContext({ subject, from, bodyPreview, bodyFull }: EmailContextProps) {
    const [showFull, setShowFull] = useState(false);
    const hasContent = Boolean(subject || from || bodyPreview || bodyFull);
    if (!hasContent) return null;
    const body = showFull ? bodyFull || bodyPreview || "" : bodyPreview || bodyFull || "";
    const canToggle = Boolean(bodyFull && bodyPreview && bodyFull !== bodyPreview);
    return (
        <section className={styles.emailContext} aria-label="メール本文">
            {(subject || from) && (
                <div className={styles.emailMeta}>
                    {subject && (
                        <p>
                            <strong>件名</strong>
                            {subject}
                        </p>
                    )}
                    {from && (
                        <p>
                            <strong>送信者</strong>
                            {from}
                        </p>
                    )}
                </div>
            )}
            {body && <pre className={styles.emailBody}>{body}</pre>}
            {canToggle && (
                <button
                    type="button"
                    className={styles.emailToggle}
                    onClick={() => setShowFull((p) => !p)}
                >
                    {showFull ? "要点表示に戻す" : "本文を全文表示"}
                </button>
            )}
        </section>
    );
}

/* ============================================================
   DriveLinkSection
   ============================================================ */

export function DriveLinkSection({ url }: { url: string }) {
    return (
        <a className={styles.driveLink} href={url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={14} />
            元ファイルを開く
        </a>
    );
}

/* ============================================================
   TechnicalDetails — collapsed payload disclosure
   ============================================================ */

const PAYLOAD_LABELS: Record<string, string> = {
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

const AMOUNT_KEYS = new Set([
    "amount",
    "amount_total",
    "total_amount",
    "total",
    "value",
    "amount_subtotal",
    "tax_amount",
]);

const DEFAULT_HIDDEN_KEYS = new Set([
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

const formatPayloadValue = (key: string, value: unknown): string => {
    if (AMOUNT_KEYS.has(key) && typeof value === "number") {
        return formatYen(value);
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
};

interface TechnicalDetailsProps {
    proposal: ProposalRecord;
    extraHiddenKeys?: Set<string>;
}

export function TechnicalDetails({ proposal, extraHiddenKeys }: TechnicalDetailsProps) {
    const hidden = extraHiddenKeys
        ? new Set([...DEFAULT_HIDDEN_KEYS, ...extraHiddenKeys])
        : DEFAULT_HIDDEN_KEYS;
    const entries = Object.entries(proposal.payload).filter(
        ([key, v]) =>
            !hidden.has(key) &&
            v !== null &&
            v !== undefined &&
            v !== "" &&
            !isInternalPayloadValue(key, v),
    );
    if (entries.length === 0) return null;
    return (
        <details className={styles.technicalDetails}>
            <summary className={styles.technicalSummary}>技術的な詳細(開発者向け)</summary>
            <div className={styles.payloadGrid}>
                {entries.map(([key, value]) => (
                    <div key={key} style={{ display: "contents" }}>
                        <span className={styles.payloadKey}>{PAYLOAD_LABELS[key] || key}</span>
                        <span
                            className={`${styles.payloadValue} ${AMOUNT_KEYS.has(key) ? styles.payloadAmount : ""}`}
                        >
                            {formatPayloadValue(key, value)}
                        </span>
                    </div>
                ))}
            </div>
        </details>
    );
}

/* ============================================================
   Risk + actor helpers used by bodies
   ============================================================ */

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
