import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { X, Loader2, CheckCircle, AlertTriangle, Building2 } from "lucide-react";
import { createSale, fetchSites, type Site } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./SalesModal.module.css";

interface SalesModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

export function SalesModal({ onClose, onSuccess }: SalesModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sites, setSites] = useState<Site[]>([]);
    const [loadingSites, setLoadingSites] = useState(true);

    const [formData, setFormData] = useState({
        site_id: "",
        client_name: "",
        recorded_date: new Date().toISOString().split("T")[0],
        description: "",
        amount_subtotal: "",
        tax_amount: "",
        amount_total: "",
    });

    useEffect(() => {
        const loadSites = async () => {
            try {
                const data = await fetchSites();
                setSites(data);
            } catch (err) {
                console.error("Failed to load sites:", err);
            } finally {
                setLoadingSites(false);
            }
        };
        loadSites();
    }, []);

    const handleInputChange = (field: string, value: string) => {
        setFormData((prev) => {
            const updated = { ...prev, [field]: value };

            // 小計と税額から合計を自動計算
            if (field === "amount_subtotal" || field === "tax_amount") {
                const subtotal = parseFloat(field === "amount_subtotal" ? value : updated.amount_subtotal) || 0;
                const tax = parseFloat(field === "tax_amount" ? value : updated.tax_amount) || 0;
                updated.amount_total = String(subtotal + tax);
            }

            return updated;
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.amount_total) {
            setError("合計金額は必須です");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await createSale({
                site_id: formData.site_id || undefined,
                description: formData.description || undefined,
                recorded_date: formData.recorded_date,
                amount_subtotal: formData.amount_subtotal
                    ? Number(formData.amount_subtotal)
                    : undefined,
                tax_amount: formData.tax_amount ? Number(formData.tax_amount) : undefined,
                amount_total: Number(formData.amount_total),
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
                aria-labelledby="sales-modal-title"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="sales-modal-title" className={styles.title}>売上登録</h2>
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
                    <div className={styles.formGroup}>
                        <label className={styles.label}>
                            <Building2 size={16} />
                            現場
                        </label>
                        <select
                            className={styles.select}
                            value={formData.site_id}
                            onChange={(e) => handleInputChange("site_id", e.target.value)}
                            disabled={loadingSites}
                        >
                            <option value="">-- 現場を選択 --</option>
                            {sites.map((site) => (
                                <option key={site.id} value={site.id}>
                                    {site.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label className={styles.label}>日付 *</label>
                            <input
                                type="date"
                                className={styles.input}
                                value={formData.recorded_date}
                                onChange={(e) => handleInputChange("recorded_date", e.target.value)}
                                required
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>顧客名</label>
                            <input
                                type="text"
                                className={styles.input}
                                value={formData.client_name}
                                onChange={(e) => handleInputChange("client_name", e.target.value)}
                                placeholder="顧客名（任意）"
                            />
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>摘要</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={formData.description}
                            onChange={(e) => handleInputChange("description", e.target.value)}
                            placeholder="工事内容など"
                        />
                    </div>

                    <div className={styles.formRow}>
                        <div className={styles.formGroup}>
                            <label className={styles.label}>小計（税抜）</label>
                            <input
                                type="number"
                                className={styles.input}
                                value={formData.amount_subtotal}
                                onChange={(e) => handleInputChange("amount_subtotal", e.target.value)}
                                placeholder="0"
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>消費税</label>
                            <input
                                type="number"
                                className={styles.input}
                                value={formData.tax_amount}
                                onChange={(e) => handleInputChange("tax_amount", e.target.value)}
                                placeholder="0"
                            />
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>合計金額 *</label>
                        <input
                            type="number"
                            className={`${styles.input} ${styles.totalInput}`}
                            value={formData.amount_total}
                            onChange={(e) => handleInputChange("amount_total", e.target.value)}
                            placeholder="0"
                            required
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
                            disabled={loading}
                        >
                            {loading ? (
                                <Loader2 size={20} className={styles.spinner} />
                            ) : (
                                <CheckCircle size={20} />
                            )}
                            登録
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}
