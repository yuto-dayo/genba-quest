/**
 * BellDrawer (PR #9) — v3.3 mock Phone ② に合わせた通知ベルドロワー。
 * 3 section: 自分が承認担当 / 全員承認待ち / お知らせ
 *
 * MVP スコープ:
 *  - 自分が承認担当 → 既存 ApprovalCard を再利用
 *  - 全員承認待ち → ProposalRecord を簡易カードで列挙、タップで親に open
 *  - お知らせ → 入金/支払予定の通知。実データ繋ぎは後続 PR (placeholder で empty)
 *
 * 後続 PR に残す:
 *  - 承認カードの swipe gesture (drag="x")
 *  - 全員承認のアバター列 + bounce
 *  - 連携: 入金/支払予定 API
 *  - 全アプリ共通ヘッダへの bell 移設 (現状は Money 内)
 */

import { motion, AnimatePresence } from "framer-motion";
import { Bell, ChevronLeft, CheckCircle, AlertTriangle, Users, User } from "lucide-react";
import { ApprovalCard } from "./ApprovalCard";
import type { AccountingTransaction, ProposalRecord } from "../lib/api";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./BellDrawer.module.css";
import triggerStyles from "./BellTrigger.module.css";

interface BellTriggerProps {
    count: number;
    onClick: () => void;
}

export function BellTrigger({ count, onClick }: BellTriggerProps) {
    return (
        <button
            type="button"
            className={triggerStyles.trigger}
            onClick={onClick}
            aria-label={count > 0 ? `通知 ${count}件` : "通知"}
        >
            <Bell size={18} aria-hidden />
            {count > 0 && (
                <span className={triggerStyles.badge} aria-hidden>
                    {count > 99 ? "99+" : count}
                </span>
            )}
            <span className={triggerStyles.label}>
                {count > 0 ? `通知 ${count}件` : "通知"}
            </span>
        </button>
    );
}

interface BellDrawerProps {
    open: boolean;
    onClose: () => void;
    selfApprovals: AccountingTransaction[];
    consensusPending: ProposalRecord[];
    onSelfApprovalComplete: () => void;
    onOpenProposal: (proposal: ProposalRecord) => void;
}

const formatYen = (n: number) => `¥${Math.abs(n).toLocaleString()}`;

export function BellDrawer({
    open,
    onClose,
    selfApprovals,
    consensusPending,
    onSelfApprovalComplete,
    onOpenProposal,
}: BellDrawerProps) {
    const totalCount = selfApprovals.length + consensusPending.length;
    const allClear = totalCount === 0;

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        className={styles.backdrop}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />
                    <motion.aside
                        className={styles.panel}
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="bell-drawer-title"
                        initial={{ x: "100%" }}
                        animate={{ x: "0%" }}
                        exit={{ x: "100%" }}
                        transition={motionTokens.spatialDefault}
                    >
                        <div className={styles.header}>
                            <button
                                type="button"
                                className={styles.closeBtn}
                                onClick={onClose}
                                aria-label="通知を閉じる"
                            >
                                <ChevronLeft size={22} />
                            </button>
                            <h2 id="bell-drawer-title" className={styles.title}>通知</h2>
                            <button
                                type="button"
                                className={styles.clearAll}
                                disabled={allClear}
                                onClick={onClose}
                            >
                                {allClear ? "クリア" : "全て表示"}
                            </button>
                        </div>

                        <div className={styles.body}>
                            {allClear ? (
                                <div className={styles.allClearState}>
                                    <div className={styles.allClearIcon}>
                                        <CheckCircle size={32} aria-hidden />
                                    </div>
                                    <div className={styles.allClearText}>
                                        通知はありません
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <section className={styles.section}>
                                        <div className={styles.sectionHead}>
                                            <span className={styles.sectionLabel}>
                                                <span className={styles.sectionIcon}>
                                                    <User size={11} aria-hidden />
                                                </span>
                                                自分が承認担当
                                            </span>
                                            {selfApprovals.length > 0 && (
                                                <span className={styles.sectionCount}>
                                                    {selfApprovals.length}
                                                </span>
                                            )}
                                        </div>
                                        {selfApprovals.length === 0 ? (
                                            <div className={styles.emptyHint}>
                                                自分宛の承認待ちはありません
                                            </div>
                                        ) : (
                                            <div className={styles.cardList}>
                                                {selfApprovals.map((tx) => (
                                                    <ApprovalCard
                                                        key={tx.id}
                                                        transaction={tx}
                                                        onComplete={onSelfApprovalComplete}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </section>

                                    <section className={styles.section}>
                                        <div className={styles.sectionHead}>
                                            <span className={styles.sectionLabel}>
                                                <span className={`${styles.sectionIcon} ${styles.warn}`}>
                                                    <Users size={11} aria-hidden />
                                                </span>
                                                全員承認待ち
                                            </span>
                                            {consensusPending.length > 0 && (
                                                <span className={`${styles.sectionCount} ${styles.warn}`}>
                                                    {consensusPending.length}
                                                </span>
                                            )}
                                        </div>
                                        {consensusPending.length === 0 ? (
                                            <div className={styles.emptyHint}>
                                                全員承認待ちのProposalはありません
                                            </div>
                                        ) : (
                                            <div className={styles.cardList}>
                                                {consensusPending.map((p) => (
                                                    <ConsensusProposalCard
                                                        key={p.id}
                                                        proposal={p}
                                                        onClick={() => onOpenProposal(p)}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </section>
                                </>
                            )}

                            <section className={styles.section}>
                                <div className={styles.sectionHead}>
                                    <span className={styles.sectionLabel}>
                                        <span className={`${styles.sectionIcon} ${styles.muted}`}>
                                            <Bell size={11} aria-hidden />
                                        </span>
                                        お知らせ
                                    </span>
                                </div>
                                <div className={styles.emptyHint}>
                                    入金・支払予定の通知がここに表示されます (後続実装)
                                </div>
                            </section>
                        </div>
                    </motion.aside>
                </>
            )}
        </AnimatePresence>
    );
}

interface ConsensusProposalCardProps {
    proposal: ProposalRecord;
    onClick: () => void;
}

function ConsensusProposalCard({ proposal, onClick }: ConsensusProposalCardProps) {
    const amount = readProposalAmount(proposal);
    const title = readProposalTitle(proposal);
    const requester = readRequester(proposal);
    const createdAt = proposal.created_at
        ? new Date(proposal.created_at).toLocaleString("ja-JP", {
              month: "numeric",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
          })
        : null;

    return (
        <button type="button" className={styles.consensusCard} onClick={onClick}>
            <div className={styles.consensusHead}>
                <span className={styles.consensusBadge}>{proposal.type ?? "Proposal"}</span>
                {createdAt && (
                    <span className={styles.consensusWho}>
                        {requester ? `起票: ${requester} · ` : ""}{createdAt}
                    </span>
                )}
            </div>
            <div className={styles.consensusTitleRow}>
                <span className={styles.consensusTitle}>{title}</span>
                {amount !== null && (
                    <span className={styles.consensusAmount}>{formatYen(amount)}</span>
                )}
            </div>
            <div className={styles.consensusMeta}>
                <AlertTriangle size={11} aria-hidden /> タップで承認画面を開く
            </div>
        </button>
    );
}

function readProposalAmount(p: ProposalRecord): number | null {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    const candidates = [payload.amount_total, payload.amount, payload.value];
    for (const c of candidates) {
        if (typeof c === "number" && Number.isFinite(c)) return c;
    }
    return null;
}

function readProposalTitle(p: ProposalRecord): string {
    const payload = (p.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.description === "string" && payload.description.trim()) {
        return payload.description.trim();
    }
    if (typeof p.description === "string" && p.description.trim()) {
        return p.description.trim();
    }
    return p.type ?? "Proposal";
}

function readRequester(p: ProposalRecord): string | null {
    return p.created_by?.name?.trim() || null;
}
