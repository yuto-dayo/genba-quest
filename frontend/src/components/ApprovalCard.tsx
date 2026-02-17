import { useState } from "react";
import { motion } from "framer-motion";
import {
    CheckCircle,
    XCircle,
    AlertTriangle,
    Image as ImageIcon,
    Loader2,
    ChevronDown,
    ChevronUp,
} from "lucide-react";
import { reviewExpense, type AccountingTransaction } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./ApprovalCard.module.css";

interface ApprovalCardProps {
    transaction: AccountingTransaction;
    onComplete: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
    material: "材料費",
    tool: "工具・備品",
    travel: "交通費",
    food: "食費・会議費",
    fuel: "燃料費",
    utility: "光熱費",
    other: "その他",
};

export function ApprovalCard({ transaction, onComplete }: ApprovalCardProps) {
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [comment, setComment] = useState("");
    const [error, setError] = useState<string | null>(null);

    const handleReview = async (action: "approve" | "reject") => {
        if (action === "reject" && !comment.trim()) {
            setError("否認理由を入力してください");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await reviewExpense(transaction.id, action, comment || undefined);
            onComplete();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    const categoryLabel = transaction.category
        ? CATEGORY_LABELS[transaction.category] || transaction.category
        : "不明";

    return (
        <motion.div
            className={styles.card}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            layout
        >
            {/* ヘッダー */}
            <div className={styles.header}>
                <div className={styles.riskBadge}>
                    <AlertTriangle size={14} />
                    高リスク
                </div>
                <span className={styles.date}>{transaction.recorded_date}</span>
            </div>

            {/* メイン情報 */}
            <div className={styles.main}>
                <div className={styles.vendor}>
                    {transaction.vendor_name || "取引先不明"}
                </div>
                <div className={styles.category}>{categoryLabel}</div>
                <div className={styles.amount}>
                    ¥{transaction.amount_total.toLocaleString()}
                </div>
            </div>

            {/* 説明 */}
            {transaction.description && (
                <div className={styles.description}>{transaction.description}</div>
            )}

            {/* 展開ボタン */}
            <button
                className={styles.expandButton}
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? (
                    <>
                        <ChevronUp size={16} />
                        詳細を閉じる
                    </>
                ) : (
                    <>
                        <ChevronDown size={16} />
                        詳細を表示
                    </>
                )}
            </button>

            {/* 展開コンテンツ */}
            {expanded && (
                <motion.div
                    className={styles.details}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                >
                    {/* 証憑画像 */}
                    {transaction.source_document?.storage_path ? (
                        <div className={styles.documentPreview}>
                            <ImageIcon size={16} />
                            <span>証憑画像あり</span>
                        </div>
                    ) : (
                        <div className={styles.noDocument}>
                            <ImageIcon size={16} />
                            <span>証憑なし</span>
                        </div>
                    )}

                    {/* 金額内訳 */}
                    <div className={styles.breakdown}>
                        <div className={styles.breakdownRow}>
                            <span>小計</span>
                            <span>¥{(transaction.amount_subtotal || 0).toLocaleString()}</span>
                        </div>
                        <div className={styles.breakdownRow}>
                            <span>消費税</span>
                            <span>¥{(transaction.tax_amount || 0).toLocaleString()}</span>
                        </div>
                        <div className={`${styles.breakdownRow} ${styles.total}`}>
                            <span>合計</span>
                            <span>¥{transaction.amount_total.toLocaleString()}</span>
                        </div>
                    </div>

                    {/* コメント入力 */}
                    <div className={styles.commentSection}>
                        <label className={styles.commentLabel}>
                            コメント（否認時は必須）
                        </label>
                        <textarea
                            className={styles.commentInput}
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                            placeholder="承認・否認の理由を入力..."
                            rows={2}
                        />
                    </div>

                    {error && (
                        <div className={styles.error}>
                            <AlertTriangle size={14} />
                            {error}
                        </div>
                    )}
                </motion.div>
            )}

            {/* アクションボタン */}
            <div className={styles.actions}>
                <button
                    className={`${styles.actionButton} ${styles.rejectButton}`}
                    onClick={() => handleReview("reject")}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 size={18} className={styles.spinner} />
                    ) : (
                        <XCircle size={18} />
                    )}
                    否認
                </button>
                <button
                    className={`${styles.actionButton} ${styles.approveButton}`}
                    onClick={() => handleReview("approve")}
                    disabled={loading}
                >
                    {loading ? (
                        <Loader2 size={18} className={styles.spinner} />
                    ) : (
                        <CheckCircle size={18} />
                    )}
                    承認
                </button>
            </div>
        </motion.div>
    );
}
