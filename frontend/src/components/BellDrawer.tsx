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

import { useState } from "react";
import {
    motion,
    AnimatePresence,
    useMotionValue,
    useTransform,
    type PanInfo,
} from "framer-motion";
import { Bell, ChevronLeft, CheckCircle, AlertTriangle, Users, User } from "lucide-react";
import { ApprovalCard } from "./ApprovalCard";
import { reviewExpense, type AccountingTransaction, type ProposalRecord } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./BellDrawer.module.css";

const SWIPE_COMMIT_OFFSET = 100;
const SWIPE_COMMIT_VELOCITY = 500;

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
                                                    <SwipeableApprovalRow
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

    const approved = (proposal.approvals ?? []).filter((a) => a.decision === "approve");
    const required = Math.max(1, proposal.required_approvals ?? 1);
    const approvedCount = Math.min(approved.length, required);
    const remaining = Math.max(0, required - approvedCount);
    const progressPct = Math.round((approvedCount / required) * 100);
    const isComplete = approvedCount >= required;

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

            <div className={styles.consensusProgress}>
                <div className={styles.consensusProgressRow}>
                    <span>
                        <strong>{approvedCount}</strong> / {required} 承認済み
                    </span>
                    {remaining > 0 && (
                        <span className={styles.meState}>あと {remaining} 名</span>
                    )}
                </div>
                <div className={styles.progressBar}>
                    <div
                        className={`${styles.progressFill} ${isComplete ? styles.progressComplete : ""}`}
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
                <div className={styles.avatars}>
                    {approved.map((a, idx) => (
                        <span
                            key={`done-${a.actor.id ?? idx}`}
                            className={`${styles.avatar} ${styles.avatarDone}`}
                            title={a.actor.name}
                        >
                            {(a.actor.name || "?").slice(0, 1)}
                        </span>
                    ))}
                    {Array.from({ length: remaining }).map((_, idx) => (
                        <span key={`pending-${idx}`} className={styles.avatar} aria-hidden>
                            ?
                        </span>
                    ))}
                </div>
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

// ============================================================
// Swipe gesture wrapper for approval cards (v3.3 mock 仕様)
//   - 右に 100px or 500px/s 超で commit → 承認
//   - 左に 100px or 500px/s 超で commit → 却下 (reason="スワイプで却下")
//   - drag 中に左右の "✓ 承認" / "✕ 却下" 背景が透明度で出現
//   - commit 時にカードが画面外へスライドアウト
// ============================================================

interface SwipeableApprovalRowProps {
    transaction: AccountingTransaction;
    onComplete: () => void;
}

function SwipeableApprovalRow({ transaction, onComplete }: SwipeableApprovalRowProps) {
    const x = useMotionValue(0);
    const approveOpacity = useTransform(x, [20, 100], [0, 1]);
    const rejectOpacity = useTransform(x, [-100, -20], [1, 0]);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [exiting, setExiting] = useState<"approve" | "reject" | null>(null);

    async function commit(action: "approve" | "reject") {
        if (pending) return;
        setPending(true);
        setError(null);
        try {
            const reason = action === "reject" ? "スワイプで却下" : undefined;
            await reviewExpense(transaction.id, action, reason);
            setExiting(action);
            // wait for exit animation, then notify parent
            setTimeout(() => onComplete(), 320);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            x.set(0);
        } finally {
            setPending(false);
        }
    }

    function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
        if (pending || exiting) return;
        const { offset, velocity } = info;
        if (offset.x > SWIPE_COMMIT_OFFSET || velocity.x > SWIPE_COMMIT_VELOCITY) {
            void commit("approve");
        } else if (offset.x < -SWIPE_COMMIT_OFFSET || velocity.x < -SWIPE_COMMIT_VELOCITY) {
            void commit("reject");
        } else {
            x.set(0);
        }
    }

    return (
        <div className={styles.swipeWrap}>
            <motion.div
                className={`${styles.swipeBg} ${styles.swipeBgReject}`}
                style={{ opacity: rejectOpacity }}
                aria-hidden
            >
                ✕ 却下
            </motion.div>
            <motion.div
                className={`${styles.swipeBg} ${styles.swipeBgApprove}`}
                style={{ opacity: approveOpacity }}
                aria-hidden
            >
                ✓ 承認
            </motion.div>
            <motion.div
                className={styles.swipeCard}
                style={{ x }}
                drag={exiting || pending ? false : "x"}
                dragConstraints={{ left: -200, right: 200 }}
                dragElastic={0.2}
                onDragEnd={handleDragEnd}
                animate={
                    exiting === "approve"
                        ? { x: 480, opacity: 0 }
                        : exiting === "reject"
                            ? { x: -480, opacity: 0 }
                            : undefined
                }
                transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            >
                <ApprovalCard transaction={transaction} onComplete={onComplete} />
                {error && <div className={styles.swipeError}>{error}</div>}
            </motion.div>
        </div>
    );
}
