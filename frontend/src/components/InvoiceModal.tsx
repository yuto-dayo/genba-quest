import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
    X,
    Loader2,
    CheckCircle,
    AlertTriangle,
    FileText,
    Calendar,
} from "lucide-react";
import {
    createInvoice,
    fetchTransactions,
    type AccountingTransaction,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./InvoiceModal.module.css";

interface InvoiceModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

export function InvoiceModal({ onClose, onSuccess }: InvoiceModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sales, setSales] = useState<AccountingTransaction[]>([]);
    const [loadingSales, setLoadingSales] = useState(true);

    const [formData, setFormData] = useState({
        transaction_id: "",
        issue_date: new Date().toISOString().split("T")[0],
        due_date: "",
        billing_name: "",
        billing_address: "",
        notes: "",
    });

    useEffect(() => {
        const loadSales = async () => {
            try {
                // 売上取引のみ取得
                const data = await fetchTransactions({ kind: "sale", limit: 50 });
                setSales(data);
            } catch (err) {
                console.error("Failed to load sales:", err);
            } finally {
                setLoadingSales(false);
            }
        };
        loadSales();
    }, []);

    // デフォルトの支払期限を設定（発行日から1ヶ月後）
    useEffect(() => {
        if (formData.issue_date && !formData.due_date) {
            const issueDate = new Date(formData.issue_date);
            issueDate.setMonth(issueDate.getMonth() + 1);
            setFormData((prev) => ({
                ...prev,
                due_date: issueDate.toISOString().split("T")[0],
            }));
        }
    }, [formData.issue_date, formData.due_date]);

    // 選択された売上取引
    const selectedSale = sales.find((s) => s.id === formData.transaction_id);

    const handleInputChange = (field: string, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.transaction_id) {
            setError("売上を選択してください");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await createInvoice({
                transaction_id: formData.transaction_id,
                issue_date: formData.issue_date || undefined,
                due_date: formData.due_date || undefined,
                billing_name: formData.billing_name || undefined,
                billing_address: formData.billing_address || undefined,
                notes: formData.notes || undefined,
            });

            onSuccess();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
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
                aria-labelledby="invoice-modal-title"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="invoice-modal-title" className={styles.title}>
                        <FileText size={20} />
                        請求書作成
                    </h2>
                    <button className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                        <X size={24} />
                    </button>
                </header>

                {error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}

                <form className={styles.form} onSubmit={handleSubmit}>
                    {/* 売上選択 */}
                    <div className={styles.formGroup}>
                        <label className={styles.label}>対象売上 *</label>
                        {loadingSales ? (
                            <div className={styles.loadingBox}>
                                <Loader2 size={20} className={styles.spinner} />
                                読み込み中...
                            </div>
                        ) : sales.length === 0 ? (
                            <div className={styles.emptyBox}>
                                売上がありません。先に売上を登録してください。
                            </div>
                        ) : (
                            <select
                                className={styles.select}
                                value={formData.transaction_id}
                                onChange={(e) =>
                                    handleInputChange("transaction_id", e.target.value)
                                }
                                required
                            >
                                <option value="">-- 売上を選択 --</option>
                                {sales.map((sale) => (
                                    <option key={sale.id} value={sale.id}>
                                        {sale.recorded_date} - {sale.description || sale.site?.name || "売上"} - ¥{sale.amount_total.toLocaleString()}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>

                    {/* 選択された売上の詳細 */}
                    {selectedSale && (
                        <div className={styles.selectedInfo}>
                            <div className={styles.infoRow}>
                                <span className={styles.infoLabel}>金額</span>
                                <span className={styles.infoValue}>
                                    ¥{selectedSale.amount_total.toLocaleString()}
                                </span>
                            </div>
                            {selectedSale.site && (
                                <div className={styles.infoRow}>
                                    <span className={styles.infoLabel}>現場</span>
                                    <span className={styles.infoValue}>{selectedSale.site.name}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* 日付 */}
                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label className={styles.label}>
                                <Calendar size={14} />
                                発行日
                            </label>
                            <input
                                type="date"
                                className={styles.input}
                                value={formData.issue_date}
                                onChange={(e) => handleInputChange("issue_date", e.target.value)}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>
                                <Calendar size={14} />
                                支払期限
                            </label>
                            <input
                                type="date"
                                className={styles.input}
                                value={formData.due_date}
                                onChange={(e) => handleInputChange("due_date", e.target.value)}
                            />
                        </div>
                    </div>

                    {/* 請求先情報 */}
                    <div className={styles.formGroup}>
                        <label className={styles.label}>請求先名</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={formData.billing_name}
                            onChange={(e) => handleInputChange("billing_name", e.target.value)}
                            placeholder="株式会社○○ 御中"
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>請求先住所</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={formData.billing_address}
                            onChange={(e) => handleInputChange("billing_address", e.target.value)}
                            placeholder="〒000-0000 東京都..."
                        />
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>備考</label>
                        <textarea
                            className={styles.textarea}
                            value={formData.notes}
                            onChange={(e) => handleInputChange("notes", e.target.value)}
                            placeholder="お支払いは銀行振込でお願いいたします。"
                            rows={3}
                        />
                    </div>

                    <div className={styles.formActions}>
                        <button
                            type="button"
                            className={styles.cancelButton}
                            onClick={onClose}
                        >
                            キャンセル
                        </button>
                        <button
                            type="submit"
                            className={styles.submitButton}
                            disabled={loading || !formData.transaction_id}
                        >
                            {loading ? (
                                <Loader2 size={20} className={styles.spinner} />
                            ) : (
                                <CheckCircle size={20} />
                            )}
                            作成
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}
