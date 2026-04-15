import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { X, Loader2, Save, Building2, Landmark, ReceiptText } from "lucide-react";
import {
    fetchInvoiceSettings,
    updateInvoiceSettings,
    type InvoiceSettings,
    type UpdateInvoiceSettingsRequest,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./InvoiceSettingsModal.module.css";

interface InvoiceSettingsModalProps {
    onClose: () => void;
    onSaved: (settings: InvoiceSettings) => void;
}

type FormState = UpdateInvoiceSettingsRequest;

const defaultFormState: FormState = {
    issuer_name: "",
    issuer_address: "",
    issuer_contact: "",
    bank_account_text: "",
    invoice_issuer_status: "unregistered",
    qualified_invoice_registration_number: "",
    qualified_invoice_registered_at: "",
    invoice_notes_default: "",
};

const statusMeta = {
    unregistered: {
        label: "未登録",
        tone: "neutral",
        helper: "通常請求書のみ発行できます",
    },
    applied: {
        label: "申請中",
        tone: "warning",
        helper: "登録完了までは適格請求書を出せません",
    },
    registered: {
        label: "登録済み",
        tone: "success",
        helper: "登録日以後の取引で適格請求書を発行できます",
    },
} as const;

function toFormState(settings: InvoiceSettings): FormState {
    return {
        issuer_name: settings.issuer_name || "",
        issuer_address: settings.issuer_address || "",
        issuer_contact: settings.issuer_contact || "",
        bank_account_text: settings.bank_account_text || "",
        invoice_issuer_status: settings.invoice_issuer_status,
        qualified_invoice_registration_number: settings.qualified_invoice_registration_number || "",
        qualified_invoice_registered_at: settings.qualified_invoice_registered_at || "",
        invoice_notes_default: settings.invoice_notes_default || "",
    };
}

export function InvoiceSettingsModal({ onClose, onSaved }: InvoiceSettingsModalProps) {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [form, setForm] = useState<FormState>(defaultFormState);

    useEffect(() => {
        const load = async () => {
            try {
                const settings = await fetchInvoiceSettings();
                setForm(toFormState(settings));
            } catch (err: unknown) {
                setError(getErrorMessage(err));
            } finally {
                setLoading(false);
            }
        };

        load();
    }, []);

    const handleChange = (field: keyof FormState, value: string) => {
        setForm((prev) => {
            if (field === "invoice_issuer_status" && value !== "registered") {
                return {
                    ...prev,
                    invoice_issuer_status: value as FormState["invoice_issuer_status"],
                    qualified_invoice_registration_number: "",
                    qualified_invoice_registered_at: "",
                };
            }

            return {
                ...prev,
                [field]: value,
            };
        });
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!form.issuer_name.trim()) {
            setError("発行者名を入力してください");
            return;
        }

        if (form.invoice_issuer_status === "registered") {
            if (!form.qualified_invoice_registration_number?.trim()) {
                setError("登録済みの場合は登録番号が必要です");
                return;
            }

            if (!form.qualified_invoice_registered_at?.trim()) {
                setError("登録済みの場合は登録日が必要です");
                return;
            }
        }

        try {
            setSaving(true);
            setError(null);
            const payload: UpdateInvoiceSettingsRequest = {
                issuer_name: form.issuer_name.trim(),
                issuer_address: form.issuer_address?.trim() || undefined,
                issuer_contact: form.issuer_contact?.trim() || undefined,
                bank_account_text: form.bank_account_text?.trim() || undefined,
                invoice_issuer_status: form.invoice_issuer_status,
                qualified_invoice_registration_number:
                    form.invoice_issuer_status === "registered"
                        ? form.qualified_invoice_registration_number?.trim().toUpperCase()
                        : undefined,
                qualified_invoice_registered_at:
                    form.invoice_issuer_status === "registered"
                        ? form.qualified_invoice_registered_at?.trim()
                        : undefined,
                invoice_notes_default: form.invoice_notes_default?.trim() || undefined,
            };
            const saved = await updateInvoiceSettings(payload);
            onSaved(saved);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    const currentStatus = statusMeta[form.invoice_issuer_status];

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
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>請求書発行設定</p>
                        <h2 className={styles.title}>発行者情報</h2>
                    </div>
                    <button className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                        <X size={22} />
                    </button>
                </header>

                {loading ? (
                    <div className={styles.loadingState}>
                        <Loader2 size={20} className={styles.spinner} />
                        設定を読み込み中...
                    </div>
                ) : (
                    <form className={styles.form} onSubmit={handleSubmit}>
                        {error && <div className={styles.error}>{error}</div>}

                        <section className={styles.hero}>
                            <div className={styles.heroCopy}>
                                <span className={`${styles.statusChip} ${styles[currentStatus.tone]}`}>
                                    {currentStatus.label}
                                </span>
                                <h3>請求書の見た目と発行可否をここで固定します</h3>
                                <p>{currentStatus.helper}</p>
                            </div>

                            <div className={styles.previewCard}>
                                <div className={styles.previewRow}>
                                    <Building2 size={16} />
                                    <span>{form.issuer_name || "発行者名を設定してください"}</span>
                                </div>
                                <div className={styles.previewRow}>
                                    <ReceiptText size={16} />
                                    <span>
                                        {form.invoice_issuer_status === "registered"
                                            ? form.qualified_invoice_registration_number || "登録番号を入力してください"
                                            : "適格請求書は未発行"}
                                    </span>
                                </div>
                                <div className={styles.previewRow}>
                                    <Landmark size={16} />
                                    <span>{form.bank_account_text || "振込先未設定"}</span>
                                </div>
                            </div>
                        </section>

                        <div className={styles.grid}>
                            <label className={styles.field}>
                                <span>発行者名 *</span>
                                <input
                                    className={styles.input}
                                    value={form.issuer_name}
                                    onChange={(event) => handleChange("issuer_name", event.target.value)}
                                    placeholder="GENBA QUEST株式会社"
                                    required
                                />
                            </label>

                            <label className={styles.field}>
                                <span>事業者状態 *</span>
                                <select
                                    className={styles.input}
                                    value={form.invoice_issuer_status}
                                    onChange={(event) => handleChange("invoice_issuer_status", event.target.value)}
                                >
                                    <option value="unregistered">未登録</option>
                                    <option value="applied">申請中</option>
                                    <option value="registered">登録済み</option>
                                </select>
                            </label>

                            <label className={`${styles.field} ${styles.full}`}>
                                <span>住所</span>
                                <input
                                    className={styles.input}
                                    value={form.issuer_address}
                                    onChange={(event) => handleChange("issuer_address", event.target.value)}
                                    placeholder="〒000-0000 東京都..."
                                />
                            </label>

                            <label className={styles.field}>
                                <span>連絡先</span>
                                <input
                                    className={styles.input}
                                    value={form.issuer_contact}
                                    onChange={(event) => handleChange("issuer_contact", event.target.value)}
                                    placeholder="03-xxxx-xxxx"
                                />
                            </label>

                            <label className={styles.field}>
                                <span>振込先</span>
                                <input
                                    className={styles.input}
                                    value={form.bank_account_text}
                                    onChange={(event) => handleChange("bank_account_text", event.target.value)}
                                    placeholder="○○銀行 ○○支店 普通 1234567"
                                />
                            </label>

                            <label className={styles.field}>
                                <span>登録番号</span>
                                <input
                                    className={styles.input}
                                    value={form.qualified_invoice_registration_number}
                                    onChange={(event) => handleChange("qualified_invoice_registration_number", event.target.value)}
                                    placeholder="T1234567890123"
                                    disabled={form.invoice_issuer_status !== "registered"}
                                />
                            </label>

                            <label className={styles.field}>
                                <span>登録日</span>
                                <input
                                    type="date"
                                    className={styles.input}
                                    value={form.qualified_invoice_registered_at}
                                    onChange={(event) => handleChange("qualified_invoice_registered_at", event.target.value)}
                                    disabled={form.invoice_issuer_status !== "registered"}
                                />
                            </label>

                            <label className={`${styles.field} ${styles.full}`}>
                                <span>デフォルト備考</span>
                                <textarea
                                    className={styles.textarea}
                                    value={form.invoice_notes_default}
                                    onChange={(event) => handleChange("invoice_notes_default", event.target.value)}
                                    placeholder="お支払いは銀行振込でお願いいたします。"
                                    rows={4}
                                />
                            </label>
                        </div>

                        <footer className={styles.actions}>
                            <button type="button" className={styles.cancelButton} onClick={onClose}>
                                キャンセル
                            </button>
                            <button type="submit" className={styles.submitButton} disabled={saving}>
                                {saving ? <Loader2 size={18} className={styles.spinner} /> : <Save size={18} />}
                                保存
                            </button>
                        </footer>
                    </form>
                )}
            </motion.div>
        </motion.div>
    );
}
