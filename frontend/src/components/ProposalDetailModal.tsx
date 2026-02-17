import { useState } from "react";
import { motion } from "framer-motion";
import { X, CheckCircle, XCircle, Zap } from "lucide-react";
import type { ProposalRecord } from "../lib/api";
import styles from "./ProposalDetailModal.module.css";

interface ProposalDetailModalProps {
    proposal: ProposalRecord;
    onClose: () => void;
    onApprove: (proposalId: string, reason?: string) => Promise<void>;
    onReject: (proposalId: string, reason: string) => Promise<void>;
    onExecute: (proposalId: string) => Promise<void>;
    isActing: boolean;
}

const PROPOSAL_TYPE_LABELS: Record<string, string> = {
    "expense.create": "経費登録",
    "expense.update": "経費更新",
    "expense.void": "経費取消",
    "income.create": "売上登録",
    "income.update": "売上更新",
    "invoice.create": "請求作成",
    "invoice.send": "請求送信",
    "invoice.mark_paid": "入金記録",
    "reward.calculate": "報酬計算",
    "reward.adjust": "報酬調整",
    "skill.achieve": "スキル達成",
    "skill.revoke": "スキル取消",
    "evaluation.submit": "評価提出",
    "evaluation.finalize": "評価確定",
    "assignment.create": "アサイン作成",
    "assignment.update": "アサイン更新",
    "assignment.cancel": "アサイン取消",
    "site.create": "現場作成",
    "site.complete": "現場完了",
    "policy.update": "ポリシー更新",
};

const STATUS_LABELS: Record<string, string> = {
    draft: "下書き",
    proposed: "承認待ち",
    approved: "承認済み",
    rejected: "却下",
    executed: "実行済み",
};

const PAYLOAD_LABELS: Record<string, string> = {
    vendor_name: "取引先",
    amount: "金額",
    amount_total: "合計金額",
    amount_subtotal: "小計",
    tax_amount: "消費税",
    total_amount: "合計金額",
    total: "合計",
    category: "カテゴリ",
    recorded_date: "日付",
    date: "日付",
    transaction_date: "取引日",
    description: "摘要",
    memo: "メモ",
    site_id: "現場ID",
    cost_center: "コストセンター",
    currency: "通貨",
    worker_id: "作業者ID",
    assignee_id: "アサインID",
};

const AMOUNT_KEYS = new Set([
    "amount", "amount_total", "total_amount", "total", "value",
    "amount_subtotal", "tax_amount",
]);

function formatPayloadValue(key: string, value: unknown): string {
    if (value === null || value === undefined) return "-";
    if (typeof value === "number" && AMOUNT_KEYS.has(key)) {
        return `¥${Math.abs(value).toLocaleString()}`;
    }
    if (typeof value === "string" && AMOUNT_KEYS.has(key)) {
        const normalized = value.replace(/[,\s¥￥]/g, "");
        const num = Number(normalized);
        if (Number.isFinite(num)) {
            return `¥${Math.abs(num).toLocaleString()}`;
        }
    }
    if (typeof value === "object") {
        return JSON.stringify(value);
    }
    return String(value);
}

function formatDate(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatShortDate(isoDate: string): string {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return isoDate;
    return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

const statusClass: Record<string, string> = {
    draft: styles.statusDraft,
    proposed: styles.statusProposed,
    approved: styles.statusApproved,
    rejected: styles.statusRejected,
    executed: styles.statusExecuted,
};

const actorClass: Record<string, string> = {
    human: styles.actorHuman,
    ai: styles.actorAi,
    system: styles.actorSystem,
    integration: styles.actorIntegration,
};

export function ProposalDetailModal({
    proposal,
    onClose,
    onApprove,
    onReject,
    onExecute,
    isActing,
}: ProposalDetailModalProps) {
    const [reason, setReason] = useState("");

    const approvedCount = proposal.approvals.filter(
        (a) => a.decision === "approve"
    ).length;
    const requiredApprovals = Math.max(proposal.required_approvals, 1);
    const progressPercent = Math.min(
        (approvedCount / requiredApprovals) * 100,
        100
    );

    const payloadEntries = Object.entries(proposal.payload).filter(
        ([, v]) => v !== null && v !== undefined && v !== ""
    );

    const handleApprove = async () => {
        await onApprove(proposal.id, reason.trim() || undefined);
    };

    const handleReject = async () => {
        if (!reason.trim()) return;
        await onReject(proposal.id, reason.trim());
    };

    const handleExecute = async () => {
        await onExecute(proposal.id);
    };

    return (
        <motion.div
            className={styles.overlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
        >
            <motion.div
                className={styles.modal}
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className={styles.closeButton}
                    onClick={onClose}
                >
                    <X size={20} />
                </button>

                {/* Header */}
                <div className={styles.header}>
                    <span className={styles.typeBadge}>
                        {PROPOSAL_TYPE_LABELS[proposal.type] || proposal.type}
                    </span>
                    <span
                        className={`${styles.statusBadge} ${statusClass[proposal.status] || ""}`}
                    >
                        {STATUS_LABELS[proposal.status] || proposal.status}
                    </span>
                    <span
                        className={`${styles.actorBadge} ${actorClass[proposal.created_by.type] || ""}`}
                    >
                        {proposal.created_by.type.toUpperCase()}
                    </span>
                </div>

                <p className={styles.description}>{proposal.description}</p>
                <span className={styles.date}>
                    {formatDate(proposal.created_at)}
                </span>

                {/* Payload Details */}
                {payloadEntries.length > 0 && (
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>詳細</h3>
                        <div className={styles.payloadGrid}>
                            {payloadEntries.map(([key, value]) => (
                                <div key={key} style={{ display: "contents" }}>
                                    <span className={styles.payloadKey}>
                                        {PAYLOAD_LABELS[key] || key}
                                    </span>
                                    <span
                                        className={`${styles.payloadValue} ${AMOUNT_KEYS.has(key) ? styles.payloadAmount : ""}`}
                                    >
                                        {formatPayloadValue(key, value)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Approval Progress */}
                <section className={styles.section}>
                    <h3 className={styles.sectionTitle}>承認状況</h3>
                    <div className={styles.progressRow}>
                        <div className={styles.progressBar}>
                            <div
                                className={`${styles.progressFill} ${approvedCount >= requiredApprovals ? styles.progressFillComplete : ""}`}
                                style={{ width: `${progressPercent}%` }}
                            />
                        </div>
                        <span className={styles.progressLabel}>
                            {approvedCount}/{requiredApprovals}
                        </span>
                    </div>
                </section>

                {/* Approval Timeline */}
                {proposal.approvals.length > 0 && (
                    <section className={styles.section}>
                        <h3 className={styles.sectionTitle}>承認履歴</h3>
                        {proposal.approvals.map((approval, i) => (
                            <div key={i} className={styles.timelineItem}>
                                <span className={styles.timelineIcon}>
                                    {approval.decision === "approve" ? (
                                        <CheckCircle
                                            size={18}
                                            className={styles.timelineIconApprove}
                                        />
                                    ) : (
                                        <XCircle
                                            size={18}
                                            className={styles.timelineIconReject}
                                        />
                                    )}
                                </span>
                                <div className={styles.timelineContent}>
                                    <span className={styles.timelineActor}>
                                        {approval.actor.name}
                                    </span>
                                    <span
                                        className={`${styles.timelineDecision} ${approval.decision === "approve" ? styles.timelineDecisionApprove : styles.timelineDecisionReject}`}
                                    >
                                        {approval.decision === "approve"
                                            ? "承認"
                                            : "却下"}
                                    </span>
                                    {approval.reason && (
                                        <p className={styles.timelineReason}>
                                            {approval.reason}
                                        </p>
                                    )}
                                    <span className={styles.timelineDate}>
                                        {formatShortDate(approval.at)}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </section>
                )}

                {/* Executed Result */}
                {proposal.status === "executed" && (
                    <section className={styles.section}>
                        <div
                            className={`${styles.resultInfo} ${styles.resultExecuted}`}
                        >
                            <CheckCircle size={18} />
                            <div>
                                <div>実行済み</div>
                                {proposal.executed_at && (
                                    <div className={styles.resultDetail}>
                                        {formatDate(proposal.executed_at)}
                                        {proposal.executed_by &&
                                            ` / ${proposal.executed_by.name}`}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* Rejected Result */}
                {proposal.status === "rejected" && (
                    <section className={styles.section}>
                        <div
                            className={`${styles.resultInfo} ${styles.resultRejected}`}
                        >
                            <XCircle size={18} />
                            <div>
                                <div>却下済み</div>
                                {proposal.rejection_reason && (
                                    <div className={styles.resultDetail}>
                                        {proposal.rejection_reason}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* Actions for proposed */}
                {proposal.status === "proposed" && (
                    <section className={styles.section}>
                        <div className={styles.reasonField}>
                            <label className={styles.reasonLabel}>
                                コメント（却下時は必須）
                            </label>
                            <textarea
                                className={styles.reasonTextarea}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="承認・却下の理由..."
                                rows={3}
                            />
                        </div>
                        <div className={styles.actionButtons}>
                            <button
                                type="button"
                                className={styles.rejectButton}
                                disabled={isActing || !reason.trim()}
                                onClick={handleReject}
                            >
                                <XCircle size={16} />
                                却下
                            </button>
                            <button
                                type="button"
                                className={styles.approveButton}
                                disabled={isActing}
                                onClick={handleApprove}
                            >
                                <CheckCircle size={16} />
                                承認
                            </button>
                        </div>
                    </section>
                )}

                {/* Execute button for approved (fallback) */}
                {proposal.status === "approved" && (
                    <section className={styles.section}>
                        <div className={styles.actionButtons}>
                            <button
                                type="button"
                                className={styles.executeButton}
                                disabled={isActing}
                                onClick={handleExecute}
                            >
                                <Zap size={16} />
                                実行
                            </button>
                        </div>
                    </section>
                )}
            </motion.div>
        </motion.div>
    );
}
