import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Bot, User, X, Sparkles, FilePlus2, CheckCircle2, AlertTriangle } from "lucide-react";
import { useSherpa } from "../hooks/useSherpa";
import { createProposalFromSherpa, type ProposalType } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./SherpaChat.module.css";

interface SherpaChatProps {
    open: boolean;
    onClose: () => void;
}

const SHERPA_PROPOSAL_OPTIONS: Array<{
    value: ProposalType;
    label: string;
    template: Record<string, unknown>;
    description: string;
}> = [
    {
        value: "expense.create",
        label: "経費登録",
        template: { amount: 10000, category: "material", recorded_date: "2026-02-18" },
        description: "資材購入を提案します",
    },
    {
        value: "expense.update",
        label: "経費更新",
        template: { expense_id: "replace-with-id", amount: 12000 },
        description: "既存経費の金額を更新します",
    },
    {
        value: "expense.void",
        label: "経費取消",
        template: { expense_id: "replace-with-id", reason: "誤登録のため" },
        description: "誤登録した経費を取消します",
    },
    {
        value: "income.create",
        label: "売上登録",
        template: { amount: 280000, category: "construction", recorded_date: "2026-02-18" },
        description: "工事売上を登録します",
    },
    {
        value: "income.update",
        label: "売上更新",
        template: { income_id: "replace-with-id", amount: 300000 },
        description: "既存売上を更新します",
    },
    {
        value: "invoice.create",
        label: "請求作成",
        template: { client_id: "replace-with-client-id", amount_total: 330000, due_date: "2026-03-31" },
        description: "請求書を作成します",
    },
    {
        value: "invoice.send",
        label: "請求送信",
        template: { invoice_id: "replace-with-id", channel: "email" },
        description: "請求書送信を提案します",
    },
    {
        value: "invoice.mark_paid",
        label: "入金記録",
        template: { invoice_id: "replace-with-id", paid_amount: 330000, paid_at: "2026-02-18" },
        description: "請求書の入金を記録します",
    },
    {
        value: "reward.calculate",
        label: "報酬計算",
        template: { period: "2026-02", mode: "monthly" },
        description: "月次報酬を計算します",
    },
    {
        value: "reward.adjust",
        label: "報酬調整",
        template: { member_id: "replace-with-member-id", delta: 5000, reason: "追加作業" },
        description: "報酬調整を提案します",
    },
    {
        value: "skill.achieve",
        label: "スキル達成",
        template: { member_id: "replace-with-member-id", skill_id: "replace-with-skill-id" },
        description: "スキル達成を記録します",
    },
    {
        value: "skill.revoke",
        label: "スキル取消",
        template: { member_id: "replace-with-member-id", skill_id: "replace-with-skill-id", reason: "誤判定のため" },
        description: "スキル達成を取り消します",
    },
    {
        value: "evaluation.submit",
        label: "評価提出",
        template: { member_id: "replace-with-member-id", score: 4, comment: "現場対応が安定" },
        description: "評価を提出します",
    },
    {
        value: "evaluation.finalize",
        label: "評価確定",
        template: { evaluation_id: "replace-with-id", result: "approved" },
        description: "評価結果を確定します",
    },
    {
        value: "assignment.create",
        label: "アサイン作成",
        template: { worker_id: "replace-with-worker-id", site_id: "replace-with-site-id", date: "2026-02-19" },
        description: "作業アサインを作成します",
    },
    {
        value: "assignment.update",
        label: "アサイン更新",
        template: { assignment_id: "replace-with-id", date: "2026-02-20" },
        description: "作業アサインを更新します",
    },
    {
        value: "assignment.cancel",
        label: "アサイン取消",
        template: { assignment_id: "replace-with-id", reason: "工程変更のため" },
        description: "作業アサインを取り消します",
    },
    {
        value: "site.create",
        label: "現場作成",
        template: { name: "渋谷ビル改修", address: "東京都渋谷区", start_date: "2026-03-01" },
        description: "新規現場を登録します",
    },
    {
        value: "site.complete",
        label: "現場完了",
        template: { site_id: "replace-with-site-id", completed_at: "2026-02-18" },
        description: "現場を完了状態にします",
    },
];

const DEFAULT_PROPOSAL = SHERPA_PROPOSAL_OPTIONS[0];

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function SherpaChat({ open, onClose }: SherpaChatProps) {
    const navigate = useNavigate();
    const { messages, loading: sending, sendMessage } = useSherpa();
    const [input, setInput] = useState("");
    const [mode, setMode] = useState<"chat" | "proposal">("chat");

    const [proposalType, setProposalType] = useState<ProposalType>(DEFAULT_PROPOSAL.value);
    const [proposalDescription, setProposalDescription] = useState(DEFAULT_PROPOSAL.description);
    const [proposalPayloadText, setProposalPayloadText] = useState(
        JSON.stringify(DEFAULT_PROPOSAL.template, null, 2)
    );
    const [submit, setSubmit] = useState(true);
    const [proposalLoading, setProposalLoading] = useState(false);
    const [proposalError, setProposalError] = useState<string | null>(null);
    const [proposalResult, setProposalResult] = useState<{
        proposalId: string;
        status: string;
        submitted: boolean;
        autoApproved: boolean;
        autoExecuted: boolean;
    } | null>(null);

    const messagesEndRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || sending) return;

        const content = input;
        setInput("");
        await sendMessage(content);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const applyTemplate = (type: ProposalType) => {
        const selected = SHERPA_PROPOSAL_OPTIONS.find((option) => option.value === type);
        if (!selected) return;
        setProposalType(selected.value);
        setProposalDescription(selected.description);
        setProposalPayloadText(JSON.stringify(selected.template, null, 2));
        setProposalError(null);
        setProposalResult(null);
    };

    const handleCreateProposal = async () => {
        if (proposalLoading) return;

        if (!proposalDescription.trim()) {
            setProposalError("説明は必須です");
            return;
        }

        let parsedPayload: unknown;
        try {
            parsedPayload = JSON.parse(proposalPayloadText);
        } catch {
            setProposalError("payload は有効なJSONで入力してください");
            return;
        }

        if (!isObjectRecord(parsedPayload)) {
            setProposalError("payload はJSONオブジェクトで入力してください");
            return;
        }

        setProposalLoading(true);
        setProposalError(null);

        try {
            const response = await createProposalFromSherpa({
                type: proposalType,
                payload: parsedPayload,
                description: proposalDescription.trim(),
                submit,
            });

            setProposalResult({
                proposalId: response.proposal.id,
                status: response.proposal.status,
                submitted: response.submitted,
                autoApproved: response.auto_approved,
                autoExecuted: response.auto_executed,
            });
        } catch (err: unknown) {
            setProposalError(getErrorMessage(err));
        } finally {
            setProposalLoading(false);
        }
    };

    const handleOpenApprovalQueue = () => {
        if (!proposalResult) return;
        navigate(`/?proposal=${proposalResult.proposalId}`);
        onClose();
    };

    const queueCtaEnabled =
        proposalResult !== null &&
        proposalResult.submitted &&
        (proposalResult.status === "pending" || proposalResult.status === "approved");

    const queueCtaLabel =
        proposalResult?.status === "approved" ? "実行待ちを開く" : "承認待ちを開く";

    const suggestions = [
        "今日の現場の進捗を教えて",
        "経費精算のルールは？",
        "来週のシフトを確認",
    ];

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        className={styles.overlay}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={onClose}
                    />

                    <motion.div
                        className={styles.panel}
                        initial={{ y: "100%", opacity: 0.5 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: "100%", opacity: 0 }}
                        transition={{
                            type: "spring",
                            damping: 28,
                            stiffness: 300,
                        }}
                    >
                        <div className={styles.header}>
                            <div className={styles.headerLeft}>
                                <Bot size={20} />
                                <div>
                                    <span className={styles.headerTitle}>シェルパ</span>
                                    <span className={styles.headerStatus}>
                                        <Sparkles size={10} />
                                        オンライン
                                    </span>
                                </div>
                            </div>
                            <button className={styles.closeButton} onClick={onClose}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className={styles.modeTabs}>
                            <button
                                type="button"
                                className={`${styles.modeTab} ${mode === "chat" ? styles.modeTabActive : ""}`}
                                onClick={() => setMode("chat")}
                            >
                                <Bot size={14} />
                                チャット
                            </button>
                            <button
                                type="button"
                                className={`${styles.modeTab} ${mode === "proposal" ? styles.modeTabActive : ""}`}
                                onClick={() => setMode("proposal")}
                            >
                                <FilePlus2 size={14} />
                                提案作成
                            </button>
                        </div>

                        {mode === "chat" ? (
                            <>
                                <div className={styles.messagesArea}>
                                    {messages.map((message) => (
                                        <div
                                            key={message.id}
                                            className={`${styles.message} ${styles[message.role]}`}
                                        >
                                            <div className={styles.messageIcon}>
                                                {message.role === "assistant" ? (
                                                    <Bot size={16} />
                                                ) : (
                                                    <User size={16} />
                                                )}
                                            </div>
                                            <div className={styles.messageBubble}>
                                                <p>{message.content}</p>
                                                <span className={styles.messageTime}>
                                                    {message.timestamp.toLocaleTimeString("ja-JP", {
                                                        hour: "2-digit",
                                                        minute: "2-digit",
                                                    })}
                                                </span>
                                            </div>
                                        </div>
                                    ))}

                                    {sending && (
                                        <div className={`${styles.message} ${styles.assistant}`}>
                                            <div className={styles.messageIcon}>
                                                <Bot size={16} />
                                            </div>
                                            <div className={styles.typing}>
                                                <span /><span /><span />
                                            </div>
                                        </div>
                                    )}

                                    <div ref={messagesEndRef} />
                                </div>

                                {messages.length <= 1 && (
                                    <div className={styles.suggestions}>
                                        {suggestions.map((s, i) => (
                                            <button
                                                key={i}
                                                className={styles.suggestionButton}
                                                onClick={() => setInput(s)}
                                            >
                                                {s}
                                            </button>
                                        ))}
                                    </div>
                                )}

                                <div className={styles.inputArea}>
                                    <textarea
                                        className={styles.input}
                                        placeholder="メッセージを入力..."
                                        value={input}
                                        onChange={(e) => setInput(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        rows={1}
                                        disabled={sending}
                                    />
                                    <button
                                        className={styles.sendButton}
                                        onClick={handleSend}
                                        disabled={!input.trim() || sending}
                                    >
                                        <Send size={18} />
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className={styles.proposalPane}>
                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>提案タイプ</label>
                                    <select
                                        className={styles.formSelect}
                                        value={proposalType}
                                        onChange={(e) => applyTemplate(e.target.value as ProposalType)}
                                        disabled={proposalLoading}
                                    >
                                        {SHERPA_PROPOSAL_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.formLabel}>説明</label>
                                    <textarea
                                        className={styles.formTextarea}
                                        value={proposalDescription}
                                        onChange={(e) => setProposalDescription(e.target.value)}
                                        rows={2}
                                        disabled={proposalLoading}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <div className={styles.formLabelRow}>
                                        <label className={styles.formLabel}>Payload (JSON)</label>
                                        <button
                                            type="button"
                                            className={styles.templateButton}
                                            onClick={() => applyTemplate(proposalType)}
                                            disabled={proposalLoading}
                                        >
                                            テンプレート適用
                                        </button>
                                    </div>
                                    <textarea
                                        className={`${styles.formTextarea} ${styles.payloadTextarea}`}
                                        value={proposalPayloadText}
                                        onChange={(e) => setProposalPayloadText(e.target.value)}
                                        rows={9}
                                        disabled={proposalLoading}
                                    />
                                </div>

                                <label className={styles.submitToggle}>
                                    <input
                                        type="checkbox"
                                        checked={submit}
                                        onChange={(e) => setSubmit(e.target.checked)}
                                        disabled={proposalLoading}
                                    />
                                    作成後すぐに提出（pending化）
                                </label>

                                {proposalError && (
                                    <div className={styles.errorBanner}>
                                        <AlertTriangle size={14} />
                                        {proposalError}
                                    </div>
                                )}

                                {proposalResult && (
                                    <div className={styles.successBanner}>
                                        <CheckCircle2 size={14} />
                                        <div>
                                            <div>Proposalを作成しました（{proposalResult.status}）</div>
                                            <div className={styles.resultMeta}>
                                                id: {proposalResult.proposalId}
                                                {proposalResult.autoApproved && " / auto-approved"}
                                                {proposalResult.autoExecuted && " / auto-executed"}
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className={styles.proposalActions}>
                                    <button
                                        type="button"
                                        className={styles.createButton}
                                        onClick={handleCreateProposal}
                                        disabled={proposalLoading}
                                    >
                                        {proposalLoading ? "作成中..." : "提案を作成"}
                                    </button>
                                    {queueCtaEnabled && (
                                        <button
                                            type="button"
                                            className={styles.openQueueButton}
                                            onClick={handleOpenApprovalQueue}
                                        >
                                            {queueCtaLabel}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
}
