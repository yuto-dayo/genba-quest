import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    RefreshCw,
    AlertCircle,
    CheckCircle,
    XCircle,
    Zap,
    Clock,
    Bell,
} from "lucide-react";
import { ProposalDetailModal } from "../components/ProposalDetailModal";
import {
    fetchPendingProposals,
    fetchExecutableProposals,
    approveProposal,
    rejectProposal,
    executeProposal,
    approveProposalsBatch,
    rejectProposalsBatch,
    fetchNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    type NotificationRecord,
    type ProposalRecord,
} from "../lib/api";
import { useCalendar } from "../hooks/useCalendar";
import { WeekCalendar } from "../components/calendar/WeekCalendar";
import { TodayAssignments } from "../components/today/TodayAssignments";
import { MonthlySummary } from "../components/today/MonthlySummary";
import { getErrorMessage } from "../lib/error";
import styles from "./Today.module.css";

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

const sortByCreatedAtDesc = (a: ProposalRecord, b: ProposalRecord) =>
    b.created_at.localeCompare(a.created_at);

const toAmountNumber = (value: unknown): number | null => {
    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "string") {
        const normalized = value.replace(/[,\s¥￥]/g, "");
        if (!normalized) return null;
        const parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
};

const extractProposalAmount = (payload: Record<string, unknown>): number | null => {
    const directKeys = ["amount", "amount_total", "total_amount", "total", "value"];
    for (const key of directKeys) {
        const amount = toAmountNumber(payload[key]);
        if (amount !== null && amount !== 0) {
            return Math.abs(amount);
        }
    }

    const subtotal = toAmountNumber(payload.amount_subtotal);
    const taxAmount = toAmountNumber(payload.tax_amount);
    if (subtotal !== null || taxAmount !== null) {
        return Math.abs((subtotal || 0) + (taxAmount || 0));
    }

    return null;
};

const formatProposalDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return isoDate;
    }

    return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

const formatNotificationDate = (isoDate: string): string => {
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) {
        return isoDate;
    }

    return date.toLocaleString("ja-JP", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
};

export function Today() {
    const [pendingProposals, setPendingProposals] = useState<ProposalRecord[]>([]);
    const [readyToExecuteProposals, setReadyToExecuteProposals] = useState<ProposalRecord[]>([]);
    const [selectedProposalIds, setSelectedProposalIds] = useState<string[]>([]);
    const [proposalActionError, setProposalActionError] = useState<string | null>(null);
    const [proposalActionNotice, setProposalActionNotice] = useState<string | null>(null);
    const [actingProposalId, setActingProposalId] = useState<string | null>(null);
    const [batchActionLoading, setBatchActionLoading] = useState(false);

    const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
    const [notificationsLoading, setNotificationsLoading] = useState(false);
    const [notificationsError, setNotificationsError] = useState<string | null>(null);
    const [notificationActionId, setNotificationActionId] = useState<string | null>(null);

    const [markAllNotificationsLoading, setMarkAllNotificationsLoading] = useState(false);

    const { calendarDays, selectDate, selectedDate } = useCalendar();
    const todayAssignments = useMemo(() => {
        return calendarDays.find(d => d.isToday)?.assignments || [];
    }, [calendarDays]);

    const [selectedProposal, setSelectedProposal] = useState<ProposalRecord | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadProposalQueue = useCallback(async () => {
        try {
            const [pending, executable] = await Promise.all([
                fetchPendingProposals(),
                fetchExecutableProposals(),
            ]);
            const sortedPending = [...pending].sort(sortByCreatedAtDesc);
            setPendingProposals(sortedPending);
            setReadyToExecuteProposals([...executable].sort(sortByCreatedAtDesc));
            setSelectedProposalIds((current) => {
                const pendingIdSet = new Set(sortedPending.map((proposal) => proposal.id));
                return current.filter((proposalId) => pendingIdSet.has(proposalId));
            });
            setProposalActionError(null);
        } catch (err: unknown) {
            console.error("Failed to load proposal queue:", err);
            setPendingProposals([]);
            setReadyToExecuteProposals([]);
            setSelectedProposalIds([]);
            setProposalActionError("承認待ちの取得に失敗しました");
        }
    }, []);

    const loadNotifications = useCallback(async () => {
        setNotificationsLoading(true);
        try {
            const data = await fetchNotifications({ limit: 20 });
            setNotifications(data);
            setNotificationsError(null);
        } catch (err: unknown) {
            console.error("Failed to load notifications:", err);
            setNotifications([]);
            setNotificationsError("通知の取得に失敗しました");
        } finally {
            setNotificationsLoading(false);
        }
    }, []);

    const refreshLists = useCallback(async () => {
        await Promise.all([loadProposalQueue(), loadNotifications()]);
    }, [loadNotifications, loadProposalQueue]);

    const loadData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            await refreshLists();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [refreshLists]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const handleApproveProposal = async (proposalId: string, reason?: string) => {
        try {
            setActingProposalId(proposalId);
            setProposalActionError(null);
            setProposalActionNotice(null);
            await approveProposal(proposalId, reason);
            await refreshLists();
        } catch (err: unknown) {
            setProposalActionError(getErrorMessage(err));
        } finally {
            setActingProposalId(null);
        }
    };

    const handleRejectProposal = async (proposalId: string, reason?: string) => {
        const finalReason = reason ?? window.prompt("却下理由を入力してください");
        if (finalReason === null) return;
        if (!finalReason.trim()) {
            setProposalActionError("却下理由は必須です");
            return;
        }

        try {
            setActingProposalId(proposalId);
            setProposalActionError(null);
            setProposalActionNotice(null);
            await rejectProposal(proposalId, finalReason.trim());
            await refreshLists();
        } catch (err: unknown) {
            setProposalActionError(getErrorMessage(err));
        } finally {
            setActingProposalId(null);
        }
    };

    const handleExecuteProposal = async (proposalId: string) => {
        try {
            setActingProposalId(proposalId);
            setProposalActionError(null);
            setProposalActionNotice(null);
            await executeProposal(proposalId);
            await refreshLists();
        } catch (err: unknown) {
            setProposalActionError(getErrorMessage(err));
        } finally {
            setActingProposalId(null);
        }
    };

    const handleToggleProposalSelection = (proposalId: string) => {
        setSelectedProposalIds((current) => {
            if (current.includes(proposalId)) {
                return current.filter((id) => id !== proposalId);
            }
            return [...current, proposalId];
        });
    };

    const handleToggleSelectAll = () => {
        if (selectedProposalIds.length === pendingProposals.length) {
            setSelectedProposalIds([]);
            return;
        }
        setSelectedProposalIds(pendingProposals.map((proposal) => proposal.id));
    };

    const handleBatchApprove = async () => {
        if (selectedProposalIds.length === 0) return;

        try {
            setBatchActionLoading(true);
            setProposalActionError(null);
            setProposalActionNotice(null);

            const result = await approveProposalsBatch(selectedProposalIds);
            await refreshLists();

            if (result.failed_count > 0) {
                const firstFailure = result.results.find((item) => !item.success);
                setProposalActionError(
                    `一括承認: ${result.success_count}件成功 / ${result.failed_count}件失敗${firstFailure?.error ? `（${firstFailure.error}）` : ""
                    }`
                );
                return;
            }

            setProposalActionNotice(`一括承認が完了しました（${result.success_count}件）`);
        } catch (err: unknown) {
            setProposalActionError(getErrorMessage(err));
        } finally {
            setBatchActionLoading(false);
        }
    };

    const handleBatchReject = async () => {
        if (selectedProposalIds.length === 0) return;

        const reason = window.prompt("一括却下理由を入力してください");
        if (reason === null) return;
        if (!reason.trim()) {
            setProposalActionError("一括却下の理由は必須です");
            return;
        }

        try {
            setBatchActionLoading(true);
            setProposalActionError(null);
            setProposalActionNotice(null);

            const result = await rejectProposalsBatch(selectedProposalIds, reason.trim());
            await refreshLists();

            if (result.failed_count > 0) {
                const firstFailure = result.results.find((item) => !item.success);
                setProposalActionError(
                    `一括却下: ${result.success_count}件成功 / ${result.failed_count}件失敗${firstFailure?.error ? `（${firstFailure.error}）` : ""
                    }`
                );
                return;
            }

            setProposalActionNotice(`一括却下が完了しました（${result.success_count}件）`);
        } catch (err: unknown) {
            setProposalActionError(getErrorMessage(err));
        } finally {
            setBatchActionLoading(false);
        }
    };

    const handleMarkNotificationRead = async (notificationId: string) => {
        try {
            setNotificationActionId(notificationId);
            setNotificationsError(null);

            const updated = await markNotificationRead(notificationId);
            setNotifications((current) =>
                current.map((item) => (item.id === notificationId ? updated : item))
            );
        } catch (err: unknown) {
            setNotificationsError(getErrorMessage(err));
        } finally {
            setNotificationActionId(null);
        }
    };

    const handleMarkAllNotificationsRead = async () => {
        try {
            setMarkAllNotificationsLoading(true);
            setNotificationsError(null);

            await markAllNotificationsRead();
            setNotifications((current) =>
                current.map((item) => (item.read ? item : { ...item, read: true }))
            );
        } catch (err: unknown) {
            setNotificationsError(getErrorMessage(err));
        } finally {
            setMarkAllNotificationsLoading(false);
        }
    };

    const selectedProposalIdSet = useMemo(
        () => new Set(selectedProposalIds),
        [selectedProposalIds]
    );

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>データを読み込み中...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorPage}>
                <AlertCircle size={48} />
                <h3>読み込みに失敗しました</h3>
                <p>ネットワーク接続を確認してください</p>
                <button onClick={loadData} className={styles.retryButton}>
                    <RefreshCw size={16} />
                    再試行
                </button>
            </div>
        );
    }

    const totalPending = pendingProposals.length + readyToExecuteProposals.length;
    const allPendingSelected =
        pendingProposals.length > 0 && selectedProposalIds.length === pendingProposals.length;
    const unreadNotificationCount = notifications.filter((notification) => !notification.read).length;

    return (
        <div className={styles.container}>
            {/* Header */}
            <motion.div
                className={styles.header}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div>
                    <h1 className={styles.pageTitle}>今日</h1>
                    <p className={styles.pageSubtitle}>
                        {new Date().toLocaleDateString("ja-JP", {
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                            weekday: "long",
                        })}
                    </p>
                </div>
                <button onClick={loadData} className={styles.refreshButton}>
                    <RefreshCw size={18} />
                </button>
            </motion.div>

            {/* Week Calendar */}
            <motion.section
                className={styles.section}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
            >
                <WeekCalendar
                    days={calendarDays}
                    onSelectDate={selectDate}
                    selectedDate={selectedDate}
                />
            </motion.section>

            {/* Today's Focus */}
            <motion.div
                className={styles.focusGrid}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 }}
            >
                <div>
                    <TodayAssignments assignments={todayAssignments} />
                </div>
                <div>
                    <MonthlySummary />
                    <div className={`${styles.summaryCard} ${totalPending > 0 ? styles.summaryCardAlert : ""}`} style={{ marginTop: '12px' }}>
                        <Clock size={20} />
                        <div className={styles.summaryInfo}>
                            <span className={styles.summaryValue}>{totalPending}</span>
                            <span className={styles.summaryLabel}>承認待ち</span>
                        </div>
                    </div>
                </div>
            </motion.div>

            {/* Notifications */}
            <section className={styles.section}>
                <div className={styles.sectionHeaderRow}>
                    <h2 className={styles.sectionTitle}>
                        <Bell size={18} />
                        通知
                        {unreadNotificationCount > 0 && (
                            <span className={styles.countBadge}>{unreadNotificationCount}</span>
                        )}
                    </h2>
                    <button
                        type="button"
                        className={styles.inlineActionButton}
                        disabled={unreadNotificationCount === 0 || markAllNotificationsLoading}
                        onClick={handleMarkAllNotificationsRead}
                    >
                        全て既読
                    </button>
                </div>

                {notificationsError && (
                    <div className={styles.errorBanner}>
                        <AlertCircle size={14} />
                        {notificationsError}
                    </div>
                )}

                {notificationsLoading ? (
                    <div className={styles.notificationState}>通知を読み込み中...</div>
                ) : notifications.length === 0 ? (
                    <div className={styles.notificationState}>通知はありません</div>
                ) : (
                    <div className={styles.notificationList}>
                        {notifications.map((notification) => {
                            const isActionLoading = notificationActionId === notification.id;

                            return (
                                <article
                                    key={notification.id}
                                    className={`${styles.notificationCard} ${!notification.read ? styles.notificationCardUnread : ""
                                        }`}
                                >
                                    <div className={styles.notificationHeader}>
                                        <span className={styles.notificationTitle}>
                                            {notification.title || "通知"}
                                        </span>
                                        {!notification.read && <span className={styles.unreadDot} />}
                                    </div>
                                    <p className={styles.notificationMessage}>{notification.message}</p>
                                    <div className={styles.notificationFooter}>
                                        <span className={styles.notificationDate}>
                                            {formatNotificationDate(notification.created_at)}
                                        </span>
                                        {!notification.read && (
                                            <button
                                                type="button"
                                                className={styles.inlineActionButton}
                                                disabled={isActionLoading}
                                                onClick={() => handleMarkNotificationRead(notification.id)}
                                            >
                                                既読にする
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Proposals */}
            <section className={styles.section}>
                <h2 className={styles.sectionTitle}>
                    <AlertCircle size={18} />
                    承認待ち
                    {totalPending > 0 && (
                        <span className={styles.countBadge}>{totalPending}</span>
                    )}
                </h2>

                {proposalActionError && (
                    <div className={styles.errorBanner}>
                        <AlertCircle size={14} />
                        {proposalActionError}
                    </div>
                )}

                {proposalActionNotice && (
                    <div className={styles.noticeBanner}>
                        <CheckCircle size={14} />
                        {proposalActionNotice}
                    </div>
                )}

                {pendingProposals.length > 0 && (
                    <div className={styles.batchBar}>
                        <div className={styles.batchSummary}>
                            <button
                                type="button"
                                className={styles.batchToggleButton}
                                disabled={batchActionLoading}
                                onClick={handleToggleSelectAll}
                            >
                                {allPendingSelected ? "全選択解除" : "全選択"}
                            </button>
                            <span className={styles.batchCount}>{selectedProposalIds.length}件選択中</span>
                        </div>
                        <div className={styles.batchActions}>
                            <button
                                type="button"
                                className={`${styles.batchActionButton} ${styles.batchRejectButton}`}
                                disabled={selectedProposalIds.length === 0 || batchActionLoading}
                                onClick={handleBatchReject}
                            >
                                一括却下
                            </button>
                            <button
                                type="button"
                                className={`${styles.batchActionButton} ${styles.batchApproveButton}`}
                                disabled={selectedProposalIds.length === 0 || batchActionLoading}
                                onClick={handleBatchApprove}
                            >
                                一括承認
                            </button>
                        </div>
                    </div>
                )}

                {totalPending === 0 ? (
                    <div className={styles.emptyState}>
                        <CheckCircle size={40} />
                        <p>承認待ちはありません</p>
                        <span>提案が提出されるとここに表示されます</span>
                    </div>
                ) : (
                    <div className={styles.proposalGrid}>
                        {pendingProposals.map((proposal) => {
                            const approvedCount = proposal.approvals.filter(
                                (a) => a.decision === "approve"
                            ).length;
                            const requiredApprovals = Math.max(proposal.required_approvals, 1);
                            const amount = extractProposalAmount(proposal.payload);
                            const isActing = actingProposalId === proposal.id;
                            const isSelected = selectedProposalIdSet.has(proposal.id);

                            return (
                                <motion.article
                                    key={proposal.id}
                                    className={`${styles.proposalCard} ${isSelected ? styles.proposalCardSelected : ""}`}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    onClick={() => setSelectedProposal(proposal)}
                                    style={{ cursor: "pointer" }}
                                >
                                    <div className={styles.proposalHeader}>
                                        <span className={styles.proposalType}>
                                            {PROPOSAL_TYPE_LABELS[proposal.type] || proposal.type}
                                        </span>
                                        <div className={styles.proposalHeaderActions}>
                                            <label
                                                className={styles.selectControl}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    disabled={batchActionLoading || isActing}
                                                    onChange={() => handleToggleProposalSelection(proposal.id)}
                                                />
                                                選択
                                            </label>
                                            <span className={styles.actorBadge}>
                                                {proposal.created_by.type.toUpperCase()}
                                            </span>
                                        </div>
                                    </div>

                                    <p className={styles.proposalDescription}>
                                        {proposal.description}
                                    </p>

                                    <div className={styles.proposalMeta}>
                                        {amount !== null && (
                                            <span className={styles.proposalAmount}>
                                                ¥{amount.toLocaleString()}
                                            </span>
                                        )}
                                        <span>承認 {approvedCount}/{requiredApprovals}</span>
                                        <span>{formatProposalDate(proposal.created_at)}</span>
                                    </div>

                                    <div className={styles.proposalActions}>
                                        <button
                                            type="button"
                                            className={`${styles.actionButton} ${styles.rejectButton}`}
                                            disabled={isActing || batchActionLoading}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleRejectProposal(proposal.id);
                                            }}
                                        >
                                            <XCircle size={16} />
                                            却下
                                        </button>
                                        <button
                                            type="button"
                                            className={`${styles.actionButton} ${styles.approveButton}`}
                                            disabled={isActing || batchActionLoading}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleApproveProposal(proposal.id);
                                            }}
                                        >
                                            <CheckCircle size={16} />
                                            承認
                                        </button>
                                    </div>
                                </motion.article>
                            );
                        })}

                        {readyToExecuteProposals.map((proposal) => {
                            const amount = extractProposalAmount(proposal.payload);
                            const isActing = actingProposalId === proposal.id;

                            return (
                                <motion.article
                                    key={proposal.id}
                                    className={`${styles.proposalCard} ${styles.executeCard}`}
                                    initial={{ opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    onClick={() => setSelectedProposal(proposal)}
                                    style={{ cursor: "pointer" }}
                                >
                                    <div className={styles.proposalHeader}>
                                        <span className={styles.proposalType}>
                                            {PROPOSAL_TYPE_LABELS[proposal.type] || proposal.type}
                                        </span>
                                        <span className={`${styles.actorBadge} ${styles.readyBadge}`}>
                                            READY
                                        </span>
                                    </div>

                                    <p className={styles.proposalDescription}>
                                        {proposal.description}
                                    </p>

                                    <div className={styles.proposalMeta}>
                                        {amount !== null && (
                                            <span className={styles.proposalAmount}>
                                                ¥{amount.toLocaleString()}
                                            </span>
                                        )}
                                        <span>承認済み・実行待ち</span>
                                        <span>{formatProposalDate(proposal.updated_at)}</span>
                                    </div>

                                    <div className={styles.proposalActions}>
                                        <button
                                            type="button"
                                            className={`${styles.actionButton} ${styles.executeButton}`}
                                            disabled={isActing || batchActionLoading}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleExecuteProposal(proposal.id);
                                            }}
                                        >
                                            <Zap size={16} />
                                            実行
                                        </button>
                                    </div>
                                </motion.article>
                            );
                        })}
                    </div>
                )}
            </section>

            {/* Detail Modal */}
            {selectedProposal && (
                <ProposalDetailModal
                    proposal={selectedProposal}
                    onClose={() => setSelectedProposal(null)}
                    onApprove={handleApproveProposal}
                    onReject={handleRejectProposal}
                    onExecute={handleExecuteProposal}
                    isActing={actingProposalId !== null || batchActionLoading}
                />
            )}
        </div>
    );
}
