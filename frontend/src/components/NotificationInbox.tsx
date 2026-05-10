import { motion, AnimatePresence } from "framer-motion";
import {
    CheckCircle,
    ChevronRight,
    FileText,
    HardHat,
    Inbox,
    Receipt,
    Sparkles,
    TrendingUp,
    X,
} from "lucide-react";
import { type ReactNode } from "react";
import {
    type AccountingTransaction,
    type NotificationRecord,
    type ProposalRecord,
} from "../lib/api";
import styles from "./NotificationInbox.module.css";

const PROPOSAL_LABELS: Record<string, string> = {
    "expense.create": "経費登録の確認",
    "expense.update": "経費更新の確認",
    "expense.void": "経費取消の確認",
    "income.create": "売上登録の確認",
    "invoice.create": "請求書作成の確認",
    "invoice.send": "請求書送信の確認",
    "invoice.mark_paid": "入金記録の確認",
    "communication.review": "メール要点の確認",
    "communication.task": "メール対応タスク",
    "policy.update": "運用ルール変更",
    "evaluation.finalize": "月締めの確認",
    "reward.calculate": "報酬計算の確認",
    "reward.adjust": "報酬補正の確認",
    "skill.achieve": "技能認定の確認",
    "skill.revoke": "技能取消の確認",
};

const PROPOSAL_AMOUNT_KEYS = [
    "amount_total",
    "total_amount",
    "amount",
    "total",
    "payout_amount",
    "reward_amount",
];

type InboxItem =
    | { kind: "siteDraft"; notification: NotificationRecord; sortKey: string; key: string }
    | { kind: "approval"; transaction: AccountingTransaction; sortKey: string; key: string }
    | { kind: "proposal"; proposal: ProposalRecord; sortKey: string; key: string };

const ageDaysFromIso = (iso: string | undefined): number => {
    if (!iso) return 0;
    const ms = Date.now() - new Date(iso).getTime();
    if (Number.isNaN(ms)) return 0;
    return Math.floor(ms / (1000 * 60 * 60 * 24));
};

const ageLabel = (iso: string | undefined): string => {
    if (!iso) return "";
    const days = ageDaysFromIso(iso);
    if (days <= 0) return "今日";
    if (days === 1) return "1日経過";
    if (days < 7) return `${days}日経過`;
    if (days < 30) return `${Math.floor(days / 7)}週間経過`;
    return `${Math.floor(days / 30)}ヶ月経過`;
};

const ageSeverity = (iso: string | undefined): "fresh" | "warn" | "alert" => {
    const days = ageDaysFromIso(iso);
    if (days < 1) return "fresh";
    if (days < 3) return "warn";
    return "alert";
};

const formatYen = (n: number) => `¥${Math.abs(n).toLocaleString()}`;

const findProposalAmount = (proposal: ProposalRecord): number | null => {
    const payload = proposal.payload as Record<string, unknown>;
    for (const key of PROPOSAL_AMOUNT_KEYS) {
        const v = payload[key];
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "string") {
            const n = Number(v.replace(/[,\s¥￥]/g, ""));
            if (Number.isFinite(n)) return n;
        }
    }
    for (const v of Object.values(payload)) {
        if (v && typeof v === "object" && !Array.isArray(v)) {
            for (const key of PROPOSAL_AMOUNT_KEYS) {
                const n = (v as Record<string, unknown>)[key];
                if (typeof n === "number" && Number.isFinite(n)) return n;
                if (typeof n === "string") {
                    const num = Number(n.replace(/[,\s¥￥]/g, ""));
                    if (Number.isFinite(num)) return num;
                }
            }
        }
    }
    return null;
};

const getNotificationDataString = (n: NotificationRecord, key: string): string | null => {
    const v = n.data?.[key];
    return typeof v === "string" ? v : null;
};

interface Props {
    open: boolean;
    onClose: () => void;
    siteLevelDrafts: NotificationRecord[];
    pendingApprovals: AccountingTransaction[];
    pendingProposals: ProposalRecord[];
    onSelectSiteDraft: (notification: NotificationRecord) => void;
    onSelectApproval: (transaction: AccountingTransaction) => void;
    onSelectProposal: (proposal: ProposalRecord) => void;
}

export function NotificationInbox({
    open,
    onClose,
    siteLevelDrafts,
    pendingApprovals,
    pendingProposals,
    onSelectSiteDraft,
    onSelectApproval,
    onSelectProposal,
}: Props) {
    const items: InboxItem[] = [
        ...siteLevelDrafts.map<InboxItem>((n) => ({
            kind: "siteDraft",
            notification: n,
            sortKey: n.created_at,
            key: `siteDraft-${n.id}`,
        })),
        ...pendingApprovals.map<InboxItem>((t) => ({
            kind: "approval",
            transaction: t,
            sortKey: t.recorded_date || t.created_at,
            key: `approval-${t.id}`,
        })),
        ...pendingProposals.map<InboxItem>((p) => ({
            kind: "proposal",
            proposal: p,
            sortKey: p.created_at,
            key: `proposal-${p.id}`,
        })),
    ];

    items.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const total = items.length;

    const renderItem = (item: InboxItem, index: number): ReactNode => {
        let tag: string;
        let title: string;
        let subtitle: string;
        let icon: ReactNode;
        let iconClass: string;
        let onTap: () => void;
        let dateIso: string | undefined;

        if (item.kind === "siteDraft") {
            const n = item.notification;
            tag = "完了現場";
            title = getNotificationDataString(n, "site_name") || n.title || "完了現場";
            subtitle = "レベル入力をお願いします";
            icon = <HardHat size={16} />;
            iconClass = styles.iconSite;
            onTap = () => onSelectSiteDraft(n);
            dateIso = n.created_at;
        } else if (item.kind === "approval") {
            const t = item.transaction;
            tag =
                t.kind === "expense"
                    ? "経費の確認"
                    : t.kind === "sale"
                        ? "売上の確認"
                        : "請求の確認";
            title = t.vendor_name || t.site?.name || t.description || "明細";
            const sign = t.kind === "expense" ? "−" : "+";
            const riskHint = t.risk_level === "HIGH" ? " ・ 要注意" : "";
            subtitle = `${sign}${formatYen(t.amount_total)}${riskHint}`;
            icon =
                t.kind === "expense" ? (
                    <Receipt size={16} />
                ) : t.kind === "sale" ? (
                    <TrendingUp size={16} />
                ) : (
                    <FileText size={16} />
                );
            iconClass =
                t.kind === "expense"
                    ? styles.iconExpense
                    : t.kind === "sale"
                        ? styles.iconSale
                        : styles.iconInvoice;
            onTap = () => onSelectApproval(t);
            dateIso = t.recorded_date;
        } else {
            const p = item.proposal;
            // communication.task の中で source が path_reward_confirmation の時は
            // インボックス上の見た目を "PATH 確認依頼" に切り替えて、経費承認と区別しやすくする
            const isPathConfirmationTask =
                p.type === "communication.task" &&
                (p.payload?.source === "path_reward_confirmation" ||
                    p.payload?.source === "path_module");
            tag = isPathConfirmationTask
                ? "PATH 確認依頼"
                : PROPOSAL_LABELS[p.type] || "提案の確認";
            title = p.description || "Proposal";
            const amount = findProposalAmount(p);
            const actor =
                p.created_by.type === "ai"
                    ? "AIから"
                    : p.created_by.type === "integration"
                        ? "連携から"
                        : p.created_by.type === "system"
                            ? "自動"
                            : p.created_by.name;
            subtitle = amount !== null ? `${formatYen(amount)} ・ ${actor}` : actor;
            icon = <Sparkles size={16} />;
            iconClass = styles.iconProposal;
            onTap = () => onSelectProposal(p);
            dateIso = p.created_at;
        }

        const sev = ageSeverity(dateIso);
        const sevClass =
            sev === "alert" ? styles.itemAlert : sev === "warn" ? styles.itemWarn : "";

        return (
            <motion.button
                key={item.key}
                type="button"
                className={`${styles.item} ${sevClass}`}
                onClick={onTap}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
            >
                <span className={`${styles.itemIcon} ${iconClass}`}>{icon}</span>
                <div className={styles.itemBody}>
                    <span className={styles.itemTag}>{tag}</span>
                    <strong className={styles.itemTitle}>{title}</strong>
                    <span className={styles.itemMeta}>{subtitle}</span>
                </div>
                <div className={styles.itemAside}>
                    <span className={`${styles.itemAge} ${sevClass}`}>{ageLabel(dateIso)}</span>
                    <ChevronRight size={16} className={styles.itemChevron} />
                </div>
            </motion.button>
        );
    };

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        className={styles.backdrop}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.15 }}
                        onClick={onClose}
                    />
                    <motion.div
                        className={styles.sheet}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="inbox-title"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={{ type: "spring", stiffness: 320, damping: 32 }}
                    >
                        <div className={styles.handle} aria-hidden="true" />
                        <div className={styles.header}>
                            <div className={styles.headerCopy}>
                                <span className={styles.headerEyebrow}>未処理</span>
                                <h2 id="inbox-title" className={styles.headerTitle}>
                                    <Inbox size={18} />
                                    {total > 0 ? `${total}件 残ってます` : "全部終わってます"}
                                </h2>
                            </div>
                            <button
                                type="button"
                                className={styles.closeBtn}
                                onClick={onClose}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className={styles.body}>
                            {total === 0 ? (
                                <div className={styles.empty}>
                                    <span className={styles.emptyIcon}>
                                        <CheckCircle size={48} />
                                    </span>
                                    <p className={styles.emptyTitle}>未処理はありません</p>
                                    <p className={styles.emptyDesc}>
                                        新しい依頼が届いたらここに集まります
                                    </p>
                                </div>
                            ) : (
                                <div className={styles.list}>
                                    {items.map((item, index) => renderItem(item, index))}
                                </div>
                            )}
                        </div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
