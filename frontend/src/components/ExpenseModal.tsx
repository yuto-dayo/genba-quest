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
import { BottomSheet } from "./BottomSheet";
import {
    uploadDocument,
    analyzeDocumentOcr,
    createExpense,
    fetchMembers,
    fetchTransactions,
    fetchSites,
    type AccountingDocument,
    type OcrFields,
    type AccountingTransaction,
    type Member,
    type Site,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import { OcrHighlight } from "./OcrHighlight";
import { JournalPreview } from "./JournalPreview";
import { generateExpenseJournalLines, normalizeNetSubtotal, type ExpenseCategory } from "./journalLines";
import styles from "./ExpenseModal.module.css";

interface ExpenseModalProps {
    open: boolean;
    onClose: () => void;
    onSuccess: () => void;
    initialSiteId?: string;
    initialCategory?: ExpenseCategory;
    initialTaxCategory?: "10_STANDARD" | "08_REDUCED" | "00_EXEMPT" | "00_TAXFREE";
    initialVendorName?: string;
    initialRecordedDate?: string;
    initialAmountSubtotal?: string;
    initialTaxAmount?: string;
    initialAmountTotal?: string;
    initialDescription?: string;
    initialCostCenter?: "HQ" | "SITE";
    initialExpenseItemCode?: string;
    initialExpenseItemOther?: string;
    defaultPaidBy?: "org" | "member";
    defaultClaimantMemberId?: string | null;
}

type Step = "upload" | "ocr" | "form";

const CATEGORIES = [
    { value: "material", label: "材料費" },
    { value: "tool", label: "工具・備品" },
    { value: "travel", label: "交通費" },
    { value: "food", label: "食費・会議費" },
    { value: "fuel", label: "燃料費" },
    { value: "utility", label: "光熱費" },
    { value: "other", label: "雑費・その他" },
];

const TAX_CATEGORIES = [
    { value: "10_STANDARD", label: "課税 10%" },
    { value: "08_REDUCED", label: "軽減 8%" },
    { value: "00_EXEMPT", label: "非課税" },
    { value: "00_TAXFREE", label: "不課税" },
] as const;

const MISC_ITEM_OPTIONS = [
    { value: "parking", label: "駐車場代" },
    { value: "toll", label: "高速代" },
    { value: "consumable", label: "消耗品" },
    { value: "cleaning", label: "清掃・片付け" },
    { value: "waste", label: "処分費" },
    { value: "fee", label: "手数料" },
    { value: "other", label: "その他" },
] as const;

function isZeroTaxCategory(taxCategory: string): boolean {
    return taxCategory === "00_EXEMPT" || taxCategory === "00_TAXFREE";
}

// F-3: 紐付け先 4値. 値は内部コード, タイトル/ヒントは職人語.
// docs/MONEY_EXPENSE_FLOW.md §11.1
const SCOPE_OPTIONS = [
    { value: "job", title: "現場", hint: "今日 (or 直近) に作業した現場の経費" },
    { value: "job_advance", title: "先行仕入れ", hint: "着工前の現場用に買った分" },
    { value: "stockpile", title: "共通在庫", hint: "どの現場でも使う消耗品" },
    { value: "overhead", title: "本部・会社", hint: "事務所・工具・燃料 (本部車) など" },
] as const;

type ExpenseScopeValue = typeof SCOPE_OPTIONS[number]["value"];

export function ExpenseModal({
    open,
    onClose,
    onSuccess,
    initialSiteId = "",
    initialCategory = "other",
    initialTaxCategory = "00_TAXFREE",
    initialVendorName = "",
    initialRecordedDate,
    initialAmountSubtotal = "",
    initialTaxAmount = "",
    initialAmountTotal = "",
    initialDescription = "",
    initialCostCenter = "SITE",
    initialExpenseItemCode = "",
    initialExpenseItemOther = "",
    defaultPaidBy = "org",
    defaultClaimantMemberId = null,
}: ExpenseModalProps) {
    const hasPrefilledForm = Boolean(
        initialVendorName
        || initialDescription
        || initialAmountSubtotal
        || initialAmountTotal
    );
    const [step, setStep] = useState<Step>(hasPrefilledForm ? "form" : "upload");
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
        vendor_name: initialVendorName,
        recorded_date: initialRecordedDate || new Date().toISOString().split("T")[0],
        amount_subtotal: initialAmountSubtotal,
        tax_amount: initialTaxAmount,
        amount_total: initialAmountTotal,
        category: initialCategory,
        tax_category: initialTaxCategory,
        expense_item_code: initialExpenseItemCode,
        expense_item_other: initialExpenseItemOther,
        description: initialDescription,
        cost_center: initialCostCenter,
        site_id: initialSiteId,
        invoice_number: "",
        payment_method: "cash" as "cash" | "card" | "transfer" | "other",
        paid_by: defaultPaidBy,
        claimant_member_id: defaultClaimantMemberId || "",
        payment_account: "" as "" | "cash" | "bank",
        // F-3: 紐付け先 4値. 既存 cost_center から初期値を導出する.
        expense_scope: (initialCostCenter === "HQ" ? "overhead" : "job") as
            | "job"
            | "job_advance"
            | "stockpile"
            | "overhead",
    });

    const [inputSources, setInputSources] = useState<Record<string, "ocr" | "manual">>({});

    // 重複検知用
    const [recentTransactions, setRecentTransactions] = useState<AccountingTransaction[]>([]);
    const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);

    // 現場リスト
    const [sites, setSites] = useState<Site[]>([]);
    const [members, setMembers] = useState<Member[]>([]);

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

        fetchMembers()
            .then(setMembers)
            .catch((err) => {
                console.warn("Failed to fetch members:", err);
            });
    }, []);

    const activeMembers = useMemo(
        () => members.filter((member) => !member.status || member.status === "active"),
        [members]
    );

    useEffect(() => {
        if (formData.claimant_member_id || activeMembers.length === 0) {
            return;
        }

        const fallbackMemberId = defaultClaimantMemberId
            && activeMembers.some((member) => member.id === defaultClaimantMemberId)
            ? defaultClaimantMemberId
            : activeMembers[0]?.id;

        if (fallbackMemberId) {
            setFormData((prev) => ({
                ...prev,
                claimant_member_id: prev.claimant_member_id || fallbackMemberId,
            }));
        }
    }, [activeMembers, defaultClaimantMemberId, formData.claimant_member_id]);

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
        const rawSubtotal = Number(formData.amount_subtotal) || 0;
        const tax = Number(formData.tax_amount) || 0;
        const total = Number(formData.amount_total) || 0;
        const zeroTax = isZeroTaxCategory(formData.tax_category);
        const subtotal = normalizeNetSubtotal(rawSubtotal, tax, total);

        if (subtotal > 0 && total > 0) {
            const calculatedTotal = subtotal + tax;
            if (Math.abs(calculatedTotal - total) > 1) {
                warnings.push(`小計(${subtotal}) + 消費税(${tax}) = ${calculatedTotal} ≠ 合計(${total})`);
            }
        }

        if (zeroTax && tax > 0) {
            warnings.push("非課税・不課税では消費税は 0 円になります");
        }

        if (!zeroTax && subtotal > 0 && tax > 0) {
            const expectedTax = formData.tax_category === "08_REDUCED" ? subtotal * 0.08 : subtotal * 0.1;
            if (Math.abs(tax - expectedTax) > 2) {
                warnings.push(`税額が選択した税区分（¥${Math.round(expectedTax)}）と一致しません`);
            }
        }

        return warnings;
    }, [formData.amount_subtotal, formData.tax_amount, formData.amount_total, formData.tax_category]);

    // 仕訳プレビュー用のライン生成
    const journalLines = useMemo(() => {
        const rawSubtotal = Number(formData.amount_subtotal) || 0;
        const tax = Number(formData.tax_amount) || 0;
        const total = Number(formData.amount_total) || 0;
        const subtotal = normalizeNetSubtotal(rawSubtotal, tax, total);

        return generateExpenseJournalLines(subtotal, tax, total, formData.tax_category, formData.category as ExpenseCategory);
    }, [formData.amount_subtotal, formData.tax_amount, formData.amount_total, formData.category, formData.tax_category]);

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

        const rawSubtotal = Number(newFormData.amount_subtotal) || 0;
        const tax = Number(newFormData.tax_amount) || 0;
        const total = Number(newFormData.amount_total) || 0;
        const normalizedSubtotal = normalizeNetSubtotal(rawSubtotal, tax, total);

        if (normalizedSubtotal > 0) {
            newFormData.amount_subtotal = String(normalizedSubtotal);
        }

        if (normalizedSubtotal > 0 && tax > 0) {
            const rate10 = normalizedSubtotal * 0.1;
            const rate8 = normalizedSubtotal * 0.08;
            if (Math.abs(tax - rate8) <= 2) {
                newFormData.tax_category = "08_REDUCED";
            } else if (Math.abs(tax - rate10) <= 2) {
                newFormData.tax_category = "10_STANDARD";
            }
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
        setFormData((prev) => {
            const next = { ...prev, [field]: value };

            if (field === "category") {
                const nextCategory = value;
                if (nextCategory !== "other") {
                    next.expense_item_code = "";
                    next.expense_item_other = "";
                    if (prev.tax_category === "00_TAXFREE" && !prev.tax_amount) {
                        next.tax_category = "10_STANDARD";
                    }
                } else if (!prev.tax_amount) {
                    next.tax_category = "00_TAXFREE";
                }
            }

            if (field === "tax_category" && isZeroTaxCategory(value)) {
                next.tax_amount = "";
            }

            if (field === "expense_item_code" && value !== "other") {
                next.expense_item_other = "";
            }

            return next;
        });
        setInputSources((prev) => ({ ...prev, [field]: "manual" }));
    };

    // F-3: scope 切替. cost_center と site_id を一緒に整える.
    const handleScopeChange = (value: ExpenseScopeValue) => {
        setFormData((prev) => {
            const requiresSite = value === "job" || value === "job_advance";
            return {
                ...prev,
                expense_scope: value,
                cost_center: requiresSite ? "SITE" : "HQ",
                // 現場を要求しない scope に切り替えたら site_id をクリア
                site_id: requiresSite ? prev.site_id : "",
            };
        });
        setInputSources((prev) => ({ ...prev, expense_scope: "manual" }));
    };

    const scopeRequiresSite =
        formData.expense_scope === "job" || formData.expense_scope === "job_advance";
    const selectedClaimant = members.find((member) => member.id === formData.claimant_member_id);
    const claimantIsOrgMember =
        formData.paid_by !== "member"
        || Boolean(selectedClaimant && (!selectedClaimant.status || selectedClaimant.status === "active"));

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

        // 現場 / 先行仕入れ の場合、現場選択は必須
        if (scopeRequiresSite && !formData.site_id) {
            setError("現場を選んでください");
            return;
        }

        if (formData.category === "other" && formData.expense_item_code === "other" && !formData.expense_item_other.trim()) {
            setError("雑費で「その他」を選んだ場合は内容を入力してください");
            return;
        }

        if (formData.paid_by === "member" && !claimantIsOrgMember) {
            setError("立替した人を選んでください");
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
                tax_category: formData.tax_category,
                expense_item_code: formData.category === "other" ? formData.expense_item_code || undefined : undefined,
                expense_item_other: formData.category === "other" && formData.expense_item_code === "other"
                    ? formData.expense_item_other.trim() || undefined
                    : undefined,
                invoice_number: formData.invoice_number.trim() || undefined,
                description: formData.description || undefined,
                cost_center: formData.cost_center,
                site_id: scopeRequiresSite ? formData.site_id : undefined,
                expense_scope: formData.expense_scope,
                paid_by: formData.paid_by,
                claimant_member_id: formData.paid_by === "member" ? formData.claimant_member_id : undefined,
                settlement_type: formData.paid_by === "member" ? "unpaid" : "paid",
                payment_account: formData.paid_by === "member" ? formData.payment_account || null : undefined,
                reimbursement_status: formData.paid_by === "member" ? "unsubmitted" : undefined,
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

    const openFilePicker = () => {
        if (!fileInputRef.current) {
            return;
        }

        fileInputRef.current.value = "";
        fileInputRef.current.click();
    };

    return (
        <BottomSheet open={open} onClose={onClose} ariaLabel="経費登録">
            <div className={styles.modal}>
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

                        {step === "upload" && !loading && (
                            <div
                                className={styles.dropzone}
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={openFilePicker}
                            >
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
                            <div
                                className={styles.noImage}
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                            >
                                <Upload size={28} className={styles.noImageIcon} />
                                <p className={styles.noImageTitle}>画像を添付して入力補完</p>
                                <p className={styles.noImageText}>
                                    現場はこのまま保持したまま、レシートから取引先名・日付・金額をOCRで補完できます。
                                </p>
                                <button
                                    type="button"
                                    className={styles.attachButton}
                                    onClick={openFilePicker}
                                >
                                    <Camera size={16} />
                                    レシートを添付
                                </button>
                                <span className={styles.noImageHint}>
                                    JPEG / PNG / WebP / HEIC / PDF
                                </span>
                            </div>
                        )}
                    </div>

                    {/* 右側: フォーム */}
                    <form className={styles.form} onSubmit={handleSubmit}>
                        <div className={styles.formGroup}>
                            <label className={styles.label}>誰が払った？</label>
                            <div className={styles.segmentedControl} role="group" aria-label="誰が払った？">
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${formData.paid_by === "org" ? styles.segmentButtonActive : ""}`}
                                    onClick={() => handleInputChange("paid_by", "org")}
                                    aria-pressed={formData.paid_by === "org"}
                                >
                                    会社
                                </button>
                                <button
                                    type="button"
                                    className={`${styles.segmentButton} ${formData.paid_by === "member" ? styles.segmentButtonActive : ""}`}
                                    onClick={() => handleInputChange("paid_by", "member")}
                                    aria-pressed={formData.paid_by === "member"}
                                >
                                    立替
                                </button>
                            </div>
                        </div>

                        {formData.paid_by === "member" && (
                            <div className={styles.reimbursementFields}>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>立替した人</label>
                                    <select
                                        className={styles.select}
                                        value={formData.claimant_member_id}
                                        onChange={(e) => handleInputChange("claimant_member_id", e.target.value)}
                                        disabled={activeMembers.length === 0}
                                        required
                                    >
                                        <option value="">メンバーを選択</option>
                                        {members.map((member) => {
                                            const disabled = Boolean(member.status && member.status !== "active");
                                            const label = member.display_name || member.full_name || member.username || "名前未設定";
                                            return (
                                                <option key={member.id} value={member.id} disabled={disabled}>
                                                    {label}
                                                    {disabled ? "（無効）" : ""}
                                                </option>
                                            );
                                        })}
                                    </select>
                                    {!claimantIsOrgMember && (
                                        <span className={styles.fieldError}>
                                            有効な組織メンバーを選んでください。
                                        </span>
                                    )}
                                </div>

                                <div className={styles.formGroup}>
                                    <label className={styles.label}>精算口座（任意）</label>
                                    <select
                                        className={styles.select}
                                        value={formData.payment_account}
                                        onChange={(e) => handleInputChange("payment_account", e.target.value)}
                                    >
                                        <option value="">未指定</option>
                                        <option value="cash">現金</option>
                                        <option value="bank">銀行</option>
                                    </select>
                                </div>
                            </div>
                        )}

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

                        {formData.category === "other" && (
                            <>
                                <div className={styles.formGroup}>
                                    <label className={styles.label}>雑費項目</label>
                                    <select
                                        className={styles.select}
                                        value={formData.expense_item_code}
                                        onChange={(e) => handleInputChange("expense_item_code", e.target.value)}
                                    >
                                        <option value="">選択してください</option>
                                        {MISC_ITEM_OPTIONS.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                    <span className={styles.fieldHint}>
                                        頻度の高い雑費を選んでおくと後で集計しやすくなります。
                                    </span>
                                </div>

                                {formData.expense_item_code === "other" && (
                                    <div className={styles.formGroup}>
                                        <label className={styles.label}>雑費内容</label>
                                        <input
                                            type="text"
                                            className={styles.input}
                                            value={formData.expense_item_other}
                                            onChange={(e) => handleInputChange("expense_item_other", e.target.value)}
                                            placeholder="例: 現場まわりの立替雑費"
                                        />
                                    </div>
                                )}
                            </>
                        )}

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
                                <label className={styles.label}>税区分</label>
                                <select
                                    className={styles.select}
                                    value={formData.tax_category}
                                    onChange={(e) => handleInputChange("tax_category", e.target.value)}
                                >
                                    {TAX_CATEGORIES.map((taxCategory) => (
                                        <option key={taxCategory.value} value={taxCategory.value}>
                                            {taxCategory.label}
                                        </option>
                                    ))}
                                </select>
                                <span className={styles.fieldHint}>
                                    {formData.category === "other"
                                        ? "雑費は税なし前提で初期設定しています。必要なら変更してください。"
                                        : "領収書に合わせて税区分を選択してください。"}
                                </span>
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    消費税
                                    {inputSources.tax_amount === "ocr" && (
                                        <span className={styles.ocrBadge}>OCR</span>
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
                                    disabled={isZeroTaxCategory(formData.tax_category)}
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

                        {/* F-3: 紐付け先 (どこの分の経費か) — 4値 chip */}
                        <div className={styles.formGroup}>
                            <label className={styles.label}>このレシート、どこの分？</label>
                            <div className={styles.scopeChips}>
                                {SCOPE_OPTIONS.map((option) => {
                                    const active = formData.expense_scope === option.value;
                                    return (
                                        <button
                                            type="button"
                                            key={option.value}
                                            className={`${styles.scopeChip} ${active ? styles.scopeChipActive : ""}`}
                                            onClick={() => handleScopeChange(option.value)}
                                            aria-pressed={active}
                                        >
                                            <span className={styles.scopeChipTitle}>{option.title}</span>
                                            <span className={styles.scopeChipHint}>{option.hint}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* 現場選択 — 現場 / 先行仕入れ のときだけ */}
                        {scopeRequiresSite && (
                            <div className={styles.formGroup}>
                                <label className={styles.label}>
                                    {formData.expense_scope === "job_advance" ? "どの現場の先行仕入れ？" : "現場"}
                                    {" *"}
                                </label>
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
                                disabled={loading || !claimantIsOrgMember}
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
            </div>
        </BottomSheet>
    );
}
