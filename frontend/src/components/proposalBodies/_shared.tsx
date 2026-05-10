import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { ProposalRecord } from "../../lib/api";
import {
    AMOUNT_KEYS,
    DEFAULT_HIDDEN_KEYS,
    PAYLOAD_LABELS,
    formatDate,
    formatPayloadValue,
    formatYen,
    isInternalPayloadValue,
} from "./_shared-utils";
import styles from "./_shared.module.css";

/* ============================================================
   Component-only file (helpers live in _shared-utils.ts so the
   react-refresh/only-export-components rule stays satisfied)
   ============================================================ */

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
