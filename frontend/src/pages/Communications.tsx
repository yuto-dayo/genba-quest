import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    AlertCircle,
    Mail,
    RefreshCw,
    ChevronDown,
    ChevronUp,
    ClipboardList,
    MessageSquareWarning,
} from "lucide-react";
import {
    fetchCommunicationDetail,
    fetchCommunications,
    type CommunicationDetailRecord,
    type CommunicationRecord,
    type ProposalStatus,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./Communications.module.css";

const PRIORITY_LABELS: Record<string, string> = {
    urgent: "最優先",
    high: "高",
    medium: "中",
    low: "低",
};

const STATUS_LABELS: Record<ProposalStatus, string> = {
    draft: "下書き",
    pending: "承認待ち",
    approved: "承認済み",
    rejected: "却下",
    executed: "実行済み",
};

function formatDateTime(value?: string | null): string {
    if (!value) {
        return "日時不明";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatPriority(value?: string | null): string {
    if (!value) {
        return "未設定";
    }
    return PRIORITY_LABELS[value] || value;
}

function formatStatus(value: ProposalStatus): string {
    return STATUS_LABELS[value] || value;
}

export function Communications() {
    const [communications, setCommunications] = useState<CommunicationRecord[]>([]);
    const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
    const [detail, setDetail] = useState<CommunicationDetailRecord | null>(null);
    const [expandedBodyMap, setExpandedBodyMap] = useState<Record<string, boolean>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [detailError, setDetailError] = useState<string | null>(null);

    const loadCommunications = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);
            const data = await fetchCommunications({ limit: 30 });
            setCommunications(data);
        } catch (err: unknown) {
            setCommunications([]);
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadCommunications();
    }, [loadCommunications]);

    useEffect(() => {
        if (communications.length === 0) {
            setSelectedMessageId(null);
            return;
        }

        setSelectedMessageId((current) => {
            if (current && communications.some((item) => item.source_message_id === current)) {
                return current;
            }
            return communications[0]!.source_message_id;
        });
    }, [communications]);

    useEffect(() => {
        if (!selectedMessageId) {
            setDetail(null);
            setDetailError(null);
            return;
        }

        const loadDetail = async () => {
            try {
                setDetailLoading(true);
                setDetailError(null);
                const data = await fetchCommunicationDetail(selectedMessageId);
                setDetail(data);
            } catch (err: unknown) {
                setDetail(null);
                setDetailError(getErrorMessage(err));
            } finally {
                setDetailLoading(false);
            }
        };

        loadDetail();
    }, [selectedMessageId]);

    const selectedCommunication = useMemo(
        () => communications.find((item) => item.source_message_id === selectedMessageId) || null,
        [communications, selectedMessageId]
    );

    const toggleBody = (messageId: string) => {
        setExpandedBodyMap((current) => ({
            ...current,
            [messageId]: !current[messageId],
        }));
    };

    if (loading) {
        return (
            <div className={styles.loading}>
                <div className={styles.spinner} />
                <p>メール履歴を読み込み中...</p>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <motion.header
                className={styles.header}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
            >
                <div>
                    <h1 className={styles.pageTitle}>メール履歴</h1>
                    <p className={styles.pageSubtitle}>DAO準拠 Read Model（Proposal/Event由来）</p>
                </div>
                <button type="button" className={styles.refreshButton} onClick={loadCommunications}>
                    <RefreshCw size={18} />
                    更新
                </button>
            </motion.header>

            {error && (
                <div className={styles.errorBanner}>
                    <AlertCircle size={14} />
                    {error}
                </div>
            )}

            {communications.length === 0 ? (
                <section className={styles.emptyState}>
                    <Mail size={42} />
                    <h2>メール履歴はまだありません</h2>
                    <p>Gmail連携で提案が作成されるとここに表示されます。</p>
                </section>
            ) : (
                <div className={styles.layout}>
                    <section className={styles.listSection}>
                        {communications.map((item) => {
                            const isSelected = item.source_message_id === selectedMessageId;
                            const isExpanded = Boolean(expandedBodyMap[item.source_message_id]);
                            const preview = item.source_message_body_preview || "";
                            const full = item.source_message_body_full || "";
                            const hasToggle = Boolean(preview && full && preview !== full);
                            const bodyText = isExpanded ? (full || preview) : (preview || full);

                            return (
                                <article
                                    key={item.source_message_id}
                                    className={`${styles.card} ${isSelected ? styles.cardSelected : ""}`}
                                    onClick={() => setSelectedMessageId(item.source_message_id)}
                                >
                                    <div className={styles.cardHeader}>
                                        <h2 className={styles.subject}>{item.source_message_subject}</h2>
                                        <span className={styles.statusBadge}>{formatStatus(item.review_status)}</span>
                                    </div>

                                    <p className={styles.metaLine}>
                                        {item.source_message_from} ・ {formatDateTime(item.source_message_date || item.created_at)}
                                    </p>

                                    <p className={styles.summary}>{item.summary}</p>

                                    <pre className={styles.bodyPreview}>
                                        {bodyText || "本文情報がありません"}
                                    </pre>

                                    {hasToggle && (
                                        <button
                                            type="button"
                                            className={styles.bodyToggle}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                toggleBody(item.source_message_id);
                                            }}
                                        >
                                            {isExpanded ? (
                                                <>
                                                    <ChevronUp size={14} />
                                                    本文を折りたたむ
                                                </>
                                            ) : (
                                                <>
                                                    <ChevronDown size={14} />
                                                    本文全文を表示
                                                </>
                                            )}
                                        </button>
                                    )}

                                    <div className={styles.badges}>
                                        <span>優先度: {formatPriority(item.priority)}</span>
                                        <span>提案タスク: {item.task_suggestion_count}件</span>
                                    </div>
                                </article>
                            );
                        })}
                    </section>

                    <aside className={styles.detailSection}>
                        {!selectedCommunication && (
                            <div className={styles.detailState}>メールを選択してください</div>
                        )}

                        {selectedCommunication && detailLoading && (
                            <div className={styles.detailState}>詳細を読み込み中...</div>
                        )}

                        {selectedCommunication && detailError && (
                            <div className={styles.errorBanner}>
                                <AlertCircle size={14} />
                                {detailError}
                            </div>
                        )}

                        {selectedCommunication && !detailLoading && detail && (
                            <>
                                <div className={styles.detailBlock}>
                                    <h3 className={styles.detailTitle}>
                                        <ClipboardList size={16} />
                                        対応タスク
                                    </h3>
                                    {detail.tasks.length === 0 ? (
                                        <p className={styles.detailState}>タスク提案はありません</p>
                                    ) : (
                                        <div className={styles.detailList}>
                                            {detail.tasks.map((task) => (
                                                <article key={task.proposal_id} className={styles.detailCard}>
                                                    <div className={styles.detailHeader}>
                                                        <span className={styles.detailLabel}>{task.title}</span>
                                                        <span className={styles.statusBadge}>
                                                            {formatStatus(task.status)}
                                                        </span>
                                                    </div>
                                                    <p className={styles.detailDescription}>{task.description}</p>
                                                    <p className={styles.detailMeta}>
                                                        優先度: {formatPriority(task.priority)} ・ 期限: {task.due_date || "未設定"}
                                                    </p>
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className={styles.detailBlock}>
                                    <h3 className={styles.detailTitle}>
                                        <MessageSquareWarning size={16} />
                                        修正指示
                                    </h3>
                                    {detail.revisions.length === 0 ? (
                                        <p className={styles.detailState}>修正指示はありません</p>
                                    ) : (
                                        <div className={styles.detailList}>
                                            {detail.revisions.map((revision) => (
                                                <article key={revision.proposal_id} className={styles.detailCard}>
                                                    <div className={styles.detailHeader}>
                                                        <span className={styles.detailLabel}>修正指示</span>
                                                        <span className={styles.statusBadge}>
                                                            {formatStatus(revision.status)}
                                                        </span>
                                                    </div>
                                                    <p className={styles.detailDescription}>{revision.instruction}</p>
                                                    <p className={styles.detailMeta}>
                                                        作成: {formatDateTime(revision.created_at)}
                                                    </p>
                                                </article>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </>
                        )}
                    </aside>
                </div>
            )}
        </div>
    );
}
