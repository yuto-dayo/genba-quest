import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import {
    X,
    Upload,
    Camera,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Receipt,
    Copy,
} from "lucide-react";
import {
    uploadDocument,
    analyzeDocumentOcr,
    createExpense,
    fetchTransactions,
    fetchSites,
    type AccountingDocument,
    type OcrFields,
    type AccountingTransaction,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { OcrHighlight } from "./OcrHighlight";
import { JournalPreview } from "./JournalPreview";
import { generateExpenseJournalLines } from "./journalLines";
import styles from "./ExpenseModal.module.css";

interface ExpenseModalProps {
    onClose: () => void;
    onSuccess: () => void;
}

type Step = "upload" | "ocr" | "form";

const CATEGORIES = [
    { value: "material", label: "材料費" },
    { value: "tool", label: "工具・備品" },
    { value: "travel", label: "交通費" },
    { value: "food", label: "食費・会議費" },
    { value: "fuel", label: "燃料費" },
    { value: "utility", label: "光熱費" },
    { value: "other", label: "その他" },
];

export function ExpenseModal({ onClose, onSuccess }: ExpenseModalProps) {
    const [step, setStep] = useState<Step>("upload");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 画像関連
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [document, setDocument] = useState<AccountingDocument | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // OCR結果
    const [ocrFields, setOcrFields] = useState<OcrFields | null>(null);
    const [highlightedField, setHighlightedField] = useState<string | null>(null);

    // フォーム
    const [formData, setFormData] = useState({
        vendor_name: "",
        recorded_date: new Date().toISOString().split("T")[0],
        amount_subtotal: "",
        tax_amount: "",
        amount_total: "",
        category: "other",
        description: "",
        cost_center: "SITE" as "HQ" | "SITE",
        site_id: "" as string,
        invoice_number: "",
        payment_method: "cash" as "cash" | "card" | "transfer" | "other",
    });

    const [inputSources, setInputSources] = useState<Record<string, "ocr" | "manual">>({});

    // 重複検知用
    const [recentTransactions, setRecentTransactions] = useState<AccountingTransaction[]>([]);
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

    // 現場リスト
    const [sites, setSites] = useState<Site[]>([]);

    // 初期データ取得
    useEffect(() => {
        // 重複検知用の経費履歴
        fetchTransactions({ kind: "expense", limit: 100 })
            .then(setRecentTransactions)
            .catch((err) => {
                console.warn("Failed to fetch transactions for duplicate check:", err);
            });

        // 現場リスト
        fetchSites()
            .then(setSites)
            .catch((err) => {
                console.warn("Failed to fetch sites:", err);
            });
    }, []);

    // 重複検知
    useEffect(() => {
        if (!formData.amount_total || !formData.recorded_date) {
            setDuplicateWarning(null);
            return;
        }

        const total = Number(formData.amount_total);
        const date = formData.recorded_date;
        const vendor = formData.vendor_name?.toLowerCase();

        const duplicate = recentTransactions.find((tx) => {
            const sameAmount = tx.amount_total === total;
            const sameDate = tx.recorded_date?.split("T")[0] === date;
            const sameVendor = vendor && tx.vendor_name?.toLowerCase().includes(vendor);
            return sameAmount && sameDate && (sameVendor || !vendor);
        });

        if (duplicate) {
            setDuplicateWarning(
                `同日・同額の経費が既に登録されています（${duplicate.vendor_name || "取引先不明"} ¥${duplicate.amount_total.toLocaleString()}）`
            );
        } else {
            setDuplicateWarning(null);
        }
    }, [formData.amount_total, formData.recorded_date, formData.vendor_name, recentTransactions]);

    // 税率・金額整合性チェック
    const validationWarnings = useMemo(() => {
        const warnings: string[] = [];
        const subtotal = Number(formData.amount_subtotal) || 0;
        const tax = Number(formData.tax_amount) || 0;
        const total = Number(formData.amount_total) || 0;

        if (subtotal > 0 && tax > 0 && total > 0) {
            // 金額整合性チェック
            const calculatedTotal = subtotal + tax;
            if (Math.abs(calculatedTotal - total) > 1) {
                warnings.push(`小計(${subtotal}) + 消費税(${tax}) = ${calculatedTotal} ≠ 合計(${total})`);
            }

            // 税率チェック（10%または8%）
            const rate10 = subtotal * 0.1;
            const rate8 = subtotal * 0.08;
            const tolerance = 2; // 端数誤差許容

            if (Math.abs(tax - rate10) > tolerance && Math.abs(tax - rate8) > tolerance) {
                warnings.push(`税額が10%（¥${Math.round(rate10)}）にも8%（¥${Math.round(rate8)}）にも一致しません`);
            }
        }

        return warnings;
    }, [formData.amount_subtotal, formData.tax_amount, formData.amount_total]);

    // 推定税率を計算
    const estimatedTaxRate = useMemo(() => {
        const subtotal = Number(formData.amount_subtotal) || 0;
        const tax = Number(formData.tax_amount) || 0;
        if (subtotal <= 0 || tax <= 0) return null;

        const rate10 = subtotal * 0.1;
        const rate8 = subtotal * 0.08;

        if (Math.abs(tax - rate10) <= 2) return "10%";
        if (Math.abs(tax - rate8) <= 2) return "8%";
        return null;
    }, [formData.amount_subtotal, formData.tax_amount]);

    // 仕訳プレビュー用のライン生成
    const journalLines = useMemo(() => {
        const subtotal = Number(formData.amount_subtotal) || 0;
        const tax = Number(formData.tax_amount) || 0;
        const total = Number(formData.amount_total) || 0;

        // 税区分を推定（8%か10%か）
        const taxCategory = estimatedTaxRate === "8%" ? "08_REDUCED" : "10_STANDARD";

        return generateExpenseJournalLines(subtotal, tax, total, taxCategory);
    }, [formData.amount_subtotal, formData.tax_amount, formData.amount_total, estimatedTaxRate]);

    // ファイル選択ハンドラ
    const handleFileSelect = async (file: File) => {
        if (!file.type.match(/^image\/(jpeg|png|webp|heic)$/) && file.type !== "application/pdf") {
            setError("対応形式: JPEG, PNG, WebP, HEIC, PDF");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            // プレビュー表示
            const reader = new FileReader();
            reader.onload = (e) => {
                setImagePreview(e.target?.result as string);
            };
            reader.readAsDataURL(file);

            // Base64変換
            const arrayBuffer = await file.arrayBuffer();
            const base64 = btoa(
                new Uint8Array(arrayBuffer).reduce(
                    (data, byte) => data + String.fromCharCode(byte),
                    ""
                )
            );

            // アップロード
            const doc = await uploadDocument({
                file_base64: base64,
                mime_type: file.type,
                original_filename: file.name,
                doc_type: "receipt",
            });

            setDocument(doc);
            setStep("ocr");

            // OCR実行
            const ocrResult = await analyzeDocumentOcr(doc.id);
            setDocument(ocrResult);

            if (ocrResult.ocr_fields) {
                setOcrFields(ocrResult.ocr_fields as OcrFields);
                applyOcrToForm(ocrResult.ocr_fields as OcrFields);
            }

            setStep("form");
        } catch (err: unknown) {
            setError(getErrorMessage(err));
            setStep("upload");
        } finally {
            setLoading(false);
        }
    };

    // OCR結果をフォームに適用
    const applyOcrToForm = (fields: OcrFields) => {
        const newFormData = { ...formData };
        const newSources: Record<string, "ocr" | "manual"> = {};

        if (fields.vendor_name) {
            newFormData.vendor_name = String(fields.vendor_name.value || "");
            newSources.vendor_name = "ocr";
        }

        if (fields.date) {
            newFormData.recorded_date = String(fields.date.value || newFormData.recorded_date);
            newSources.recorded_date = "ocr";
        }

        if (fields.subtotal) {
            newFormData.amount_subtotal = String(fields.subtotal.value || "");
            newSources.amount_subtotal = "ocr";
        }

        if (fields.tax_amount) {
            newFormData.tax_amount = String(fields.tax_amount.value || "");
            newSources.tax_amount = "ocr";
        }

        if (fields.total_amount) {
            newFormData.amount_total = String(fields.total_amount.value || "");
            newSources.amount_total = "ocr";
        }

        // インボイス登録番号
        const invoiceNum = fields.invoice_number as { value?: string | number } | undefined;
        if (invoiceNum?.value) {
            newFormData.invoice_number = String(invoiceNum.value);
            newSources.invoice_number = "ocr";
        }

        setFormData(newFormData);
        setInputSources(newSources);
    };

    // フォーム変更
    const handleInputChange = (field: string, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
        setInputSources((prev) => ({ ...prev, [field]: "manual" }));
    };

    // フィールドホバー
    const handleFieldHover = useCallback((field: string | null) => {
        setHighlightedField(field);
    }, []);

    // 送信
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.amount_total) {
            setError("合計金額は必須です");
            return;
        }

        // コストセンターがSITEの場合、現場選択は必須
        if (formData.cost_center === "SITE" && !formData.site_id) {
            setError("現場を選択してください");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await createExpense({
                vendor_name: formData.vendor_name || undefined,
                recorded_date: formData.recorded_date,
                amount_subtotal: formData.amount_subtotal
                    ? Number(formData.amount_subtotal)
                    : undefined,
                tax_amount: formData.tax_amount ? Number(formData.tax_amount) : undefined,
                amount_total: Number(formData.amount_total),
                category: formData.category,
                description: formData.description || undefined,
                cost_center: formData.cost_center,
                site_id: formData.cost_center === "SITE" ? formData.site_id : undefined,
                source_document_id: document?.id,
                input_sources: inputSources,
            });

            onSuccess();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    };

    // ドラッグ&ドロップ
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) handleFileSelect(file);
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
                aria-labelledby="expense-modal-title"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="expense-modal-title" className={styles.title}>経費登録</h2>
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

                <div className={styles.content}>
                    {/* 左側: 画像/OCR */}
                    <div className={styles.imageSection}>
                        {step === "upload" && !loading && (
                            <div
                                className={styles.dropzone}
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*,application/pdf"
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (file) handleFileSelect(file);
                                    }}
                                    className={styles.fileInput}
                                />
                                <Upload size={48} className={styles.dropzoneIcon} />
                                <p className={styles.dropzoneText}>
                                    レシート・領収書をドロップ
                                    <br />
                                    またはクリックして選択
                                </p>
                                <div className={styles.dropzoneHint}>
                                    <Camera size={16} />
                                    スマホで撮影もOK
                                </div>
                            </div>
                        )}

                        {loading && step === "ocr" && (
                            <div className={styles.ocrLoading}>
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                                >
                                    <Loader2 size={48} />
                                </motion.div>
                                <p>OCR解析中...</p>
                            </div>
                        )}

                        {imagePreview && step === "form" && (
                            <OcrHighlight
                                imageSrc={imagePreview}
                                ocrBlocks={document?.ocr_blocks || []}
                                ocrFields={ocrFields}
                                highlightedField={highlightedField}
                            />
                        )}

                        {!imagePreview && step === "form" && (
                            <div className={styles.noImage}>
                                <p>画像なしで登録</p>
                            </div>
                        )}
                    </div>

                    {/* 右側: フォーム */}
                    <form className={styles.form} onSubmit={handleSubmit}>
                        <div className={styles.formGroup}>
                            <label className={styles.label}>
                                取引先名
                                {inputSources.vendor_name === "ocr" && (
                                    <span className={styles.ocrBadge}>OCR</span>
                                )}
                            </label>
                            <input
                                type="text"
                                className={styles.input}
                                value={formData.vendor_name}
                                onChange={(e) => handleInputChange("vendor_name", e.target.value)}
                                onMouseEnter={() => handleFieldHover("vendor_name")}
                                onMouseLeave={() => handleFieldHover(null)}
                                placeholder="店舗名・会社名"
                            />
                        </div>

                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    日付
                                    {inputSources.recorded_date === "ocr" && (
                                        <span className={styles.ocrBadge}>OCR</span>
                                    )}
                                </label>
                                <input
                                    type="date"
                                    className={styles.input}
                                    value={formData.recorded_date}
                                    onChange={(e) =>
                                        handleInputChange("recorded_date", e.target.value)
                                    }
                                    onMouseEnter={() => handleFieldHover("date")}
                                    onMouseLeave={() => handleFieldHover(null)}
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>カテゴリ</label>
                                <select
                                    className={styles.select}
                                    value={formData.category}
                                    onChange={(e) => handleInputChange("category", e.target.value)}
                                >
                                    {CATEGORIES.map((cat) => (
                                        <option key={cat.value} value={cat.value}>
                                            {cat.label}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        {/* 商品明細 */}
                        {ocrFields?.items && ocrFields.items.length > 0 && (
                            <div className={styles.lineItems}>
                                <div className={styles.lineItemsHeader}>
                                    <Receipt size={14} />
                                    商品明細（{ocrFields.items.length}件）
                                </div>
                                <div className={styles.lineItemsList}>
                                    {ocrFields.items.map((item, index) => (
                                        <div key={index} className={styles.lineItem}>
                                            <span className={styles.lineItemName}>
                                                {String(item.name?.value || "不明")}
                                            </span>
                                            <span className={styles.lineItemAmount}>
                                                ¥{Number(item.amount?.value || 0).toLocaleString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    小計
                                    {inputSources.amount_subtotal === "ocr" && (
                                        <span className={styles.ocrBadge}>OCR</span>
                                    )}
                                </label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={formData.amount_subtotal}
                                    onChange={(e) =>
                                        handleInputChange("amount_subtotal", e.target.value)
                                    }
                                    onMouseEnter={() => handleFieldHover("subtotal")}
                                    onMouseLeave={() => handleFieldHover(null)}
                                    placeholder="0"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    消費税
                                    {inputSources.tax_amount === "ocr" && (
                                        <span className={styles.ocrBadge}>OCR</span>
                                    )}
                                    {estimatedTaxRate && (
                                        <span
                                            className={`${styles.taxRateBadge} ${estimatedTaxRate === "8%"
                                                ? styles.reduced
                                                : styles.standard
                                                }`}
                                        >
                                            {estimatedTaxRate}
                                        </span>
                                    )}
                                </label>
                                <input
                                    type="number"
                                    className={styles.input}
                                    value={formData.tax_amount}
                                    onChange={(e) =>
                                        handleInputChange("tax_amount", e.target.value)
                                    }
                                    onMouseEnter={() => handleFieldHover("tax_amount")}
                                    onMouseLeave={() => handleFieldHover(null)}
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>
                                合計金額 *
                                {inputSources.amount_total === "ocr" && (
                                    <span className={styles.ocrBadge}>OCR</span>
                                )}
                            </label>
                            <input
                                type="number"
                                className={`${styles.input} ${styles.totalInput}`}
                                value={formData.amount_total}
                                onChange={(e) =>
                                    handleInputChange("amount_total", e.target.value)
                                }
                                onMouseEnter={() => handleFieldHover("total_amount")}
                                onMouseLeave={() => handleFieldHover(null)}
                                placeholder="0"
                                required
                            />
                        </div>

                        {/* バリデーション警告 */}
                        {validationWarnings.length > 0 && (
                            <div className={styles.validationWarning}>
                                <AlertTriangle size={16} />
                                <div>
                                    {validationWarnings.map((w, i) => (
                                        <div key={i}>{w}</div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 重複警告 */}
                        {duplicateWarning && (
                            <div className={styles.duplicateWarning}>
                                <Copy size={16} />
                                <span>{duplicateWarning}</span>
                            </div>
                        )}

                        {/* 仕訳プレビュー */}
                        {journalLines.length > 0 && <JournalPreview lines={journalLines} />}

                        <div className={styles.formRow}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    登録番号（インボイス）
                                    {inputSources.invoice_number === "ocr" && (
                                        <span className={styles.ocrBadge}>OCR</span>
                                    )}
                                </label>
                                <input
                                    type="text"
                                    className={styles.input}
                                    value={formData.invoice_number}
                                    onChange={(e) =>
                                        handleInputChange("invoice_number", e.target.value)
                                    }
                                    placeholder="T1234567890123"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>支払方法</label>
                                <select
                                    className={styles.select}
                                    value={formData.payment_method}
                                    onChange={(e) =>
                                        handleInputChange("payment_method", e.target.value)
                                    }
                                >
                                    <option value="cash">現金</option>
                                    <option value="card">カード</option>
                                    <option value="transfer">振込</option>
                                    <option value="other">その他</option>
                                </select>
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>摘要</label>
                            <textarea
                                className={styles.textarea}
                                value={formData.description}
                                onChange={(e) => handleInputChange("description", e.target.value)}
                                placeholder="メモ（任意）"
                                rows={2}
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>コストセンター</label>
                            <div className={styles.radioGroup}>
                                <label className={styles.radio}>
                                    <input
                                        type="radio"
                                        name="cost_center"
                                        value="SITE"
                                        checked={formData.cost_center === "SITE"}
                                        onChange={(e) =>
                                            handleInputChange("cost_center", e.target.value)
                                        }
                                    />
                                    現場
                                </label>
                                <label className={styles.radio}>
                                    <input
                                        type="radio"
                                        name="cost_center"
                                        value="HQ"
                                        checked={formData.cost_center === "HQ"}
                                        onChange={(e) =>
                                            handleInputChange("cost_center", e.target.value)
                                        }
                                    />
                                    本社
                                </label>
                            </div>
                        </div>

                        {/* 現場選択（SITEの場合のみ表示） */}
                        {formData.cost_center === "SITE" && (
                            <div className={styles.formGroup}>
                                <label className={styles.label}>現場 *</label>
                                <select
                                    className={styles.select}
                                    value={formData.site_id}
                                    onChange={(e) => handleInputChange("site_id", e.target.value)}
                                    required
                                >
                                    <option value="">現場を選択してください</option>
                                    {sites.map((site) => (
                                        <option key={site.id} value={site.id}>
                                            {site.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

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
                </div>
            </motion.div>
        </motion.div>
    );
}
