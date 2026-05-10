import { useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle, MessageSquare, X, XCircle, Zap } from "lucide-react";
import type { ProposalRecord } from "../lib/api";
import { resolveProposalBody } from "./proposalBodies";
import styles from "./ProposalDetailModal.module.css";

interface ProposalDetailModalProps {
    proposal: ProposalRecord;
    onClose: () => void;
    onApprove: (proposalId: string, reason?: string) => Promise<void>;
    onReject: (proposalId: string, reason: string) => Promise<void>;
    onInstruct: (proposalId: string, instruction: string) => Promise<void>;
    onExecute: (proposalId: string) => Promise<void>;
    isActing: boolean;
    actionError?: string | null;
}

function formatDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatShortDate(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

export function ProposalDetailModal({
    proposal,
    onClose,
    onApprove,
    onReject,
    onInstruct,
    onExecute,
    isActing,
    actionError,
}: ProposalDetailModalProps) {
    const [reason, setReason] = useState("");

    const approvedCount = proposal.approvals.filter((a) => a.decision === "approve").length;
    const requiredApprovals = Math.max(proposal.required_approvals, 1);
    const progressPercent = Math.min(
        (approvedCount / requiredApprovals) * 100,
        100,
    );

    const Body = resolveProposalBody(proposal.type);

    const handleApprove = async () => {
        await onApprove(proposal.id, reason.trim() || undefined);
    };

    const handleReject = async () => {
        if (!reason.trim()) return;
        await onReject(proposal.id, reason.trim());
    };

    const handleInstruct = async () => {
        if (!reason.trim()) return;
        await onInstruct(proposal.id, reason.trim());
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
                role="dialog"
                aria-modal="true"
                aria-label="proposal detail"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    className={styles.closeButton}
                    onClick={onClose}
                    aria-label="閉じる"
                >
                    <X size={20} />
                </button>

                {/* Type-specific body, dispatched via registry */}
                <Body proposal={proposal} />

                {/* Approval Progress (shared) */}
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
                                        <CheckCircle size={18} className={styles.timelineIconApprove} />
                                    ) : (
                                        <XCircle size={18} className={styles.timelineIconReject} />
                                    )}
                                </span>
                                <div className={styles.timelineContent}>
                                    <span className={styles.timelineActor}>{approval.actor.name}</span>
                                    <span
                                        className={`${styles.timelineDecision} ${approval.decision === "approve" ? styles.timelineDecisionApprove : styles.timelineDecisionReject}`}
                                    >
                                        {approval.decision === "approve" ? "承認" : "却下"}
                                    </span>
                                    {approval.reason && (
                                        <p className={styles.timelineReason}>{approval.reason}</p>
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
                        <div className={`${styles.resultInfo} ${styles.resultExecuted}`}>
                            <CheckCircle size={18} />
                            <div>
                                <div>実行済み</div>
                                {proposal.executed_at && (
                                    <div className={styles.resultDetail}>
                                        {formatDate(proposal.executed_at)}
                                        {proposal.executed_by && ` / ${proposal.executed_by.name}`}
                                    </div>
                                )}
                            </div>
                        </div>
                    </section>
                )}

                {/* Rejected Result */}
                {proposal.status === "rejected" && (
                    <section className={styles.section}>
                        <div className={`${styles.resultInfo} ${styles.resultRejected}`}>
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

                {/* Pending actions */}
                {proposal.status === "pending" && (
                    <section className={styles.section}>
                        <div className={styles.reasonField}>
                            <label className={styles.reasonLabel}>
                                コメント(却下・指示時は必須)
                            </label>
                            <textarea
                                className={styles.reasonTextarea}
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                placeholder="承認コメント / 却下理由 / AIへの指示..."
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
                                className={styles.instructButton}
                                disabled={isActing || !reason.trim()}
                                onClick={handleInstruct}
                            >
                                <MessageSquare size={16} />
                                指示
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
                        {actionError && (
                            <div className={`${styles.resultInfo} ${styles.resultRejected}`} role="alert">
                                <XCircle size={16} aria-hidden="true" />
                                <span>{actionError}</span>
                            </div>
                        )}
                    </section>
                )}

                {/* Execute action for approved */}
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
                        {actionError && (
                            <div className={`${styles.resultInfo} ${styles.resultRejected}`} role="alert">
                                <XCircle size={16} aria-hidden="true" />
                                <span>{actionError}</span>
                            </div>
                        )}
                    </section>
                )}
            </motion.div>
        </motion.div>
    );
}
