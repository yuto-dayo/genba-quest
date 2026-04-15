import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    BadgeCheck,
    Building2,
    CalendarDays,
    FileText,
    Loader2,
    Plus,
    ScrollText,
    ShieldAlert,
    Trash2,
    X,
} from "lucide-react";
import {
    correctInvoice,
    createInvoiceSupplement,
    type AccountingTransaction,
    type AccountingTransactionItem,
    type AccountingInvoiceListItem,
} from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./InvoiceCorrectionModal.module.css";

interface InvoiceCorrectionModalProps {
    invoice: AccountingInvoiceListItem;
    sourceTransaction: AccountingTransaction;
    mode: "document_only" | "supplement";
    onClose: () => void;
    onSuccess: () => void | Promise<void>;
}

const reasonOptions = [
    { value: "recipient_error", label: "宛先ミス" },
    { value: "address_error", label: "住所・表記ミス" },
    { value: "legal_field_missing", label: "法定記載不足" },
    { value: "duplicate_issue", label: "重複発行" },
    { value: "other", label: "その他" },
] as const;

type LineItemSource = "invoice" | "transaction" | "manual";

interface LineItemForm {
    id: string;
    item_name: string;
    quantity: string;
    unit_name: string;
    unit_price: string;
}

type NormalizedLineItem = {
    item_name: string;
    quantity: number | null;
    unit_name: string | null;
    unit_price: number | null;
    amount: number | null;
};

function isNormalizedLineItem(item: NormalizedLineItem | null): item is NormalizedLineItem {
    return item !== null;
}

function createLineItemId(): string {
    return globalThis.crypto?.randomUUID?.()
        || `invoice-item-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createLineItem(): LineItemForm {
    return {
        id: createLineItemId(),
        item_name: "",
        quantity: "",
        unit_name: "",
        unit_price: "",
    };
}

function createPrefilledLineItem(item: Pick<AccountingTransactionItem, "item_name" | "quantity" | "unit_name" | "unit_price">): LineItemForm {
    return {
        id: createLineItemId(),
        item_name: item.item_name || "",
        quantity: item.quantity != null ? String(item.quantity) : "",
        unit_name: item.unit_name || "",
        unit_price: item.unit_price != null ? String(item.unit_price) : "",
    };
}

function buildInitialLineItems(
    invoice: AccountingInvoiceListItem,
    sourceTransaction: AccountingTransaction
): {
    items: LineItemForm[];
    source: LineItemSource;
} {
    if (Array.isArray(invoice.display_line_items)) {
        return {
            items: invoice.display_line_items.map(createPrefilledLineItem),
            source: "invoice",
        };
    }

    const transactionItems = Array.isArray(sourceTransaction.items)
        ? sourceTransaction.items.filter((item) => (
            item.item_name
            || item.quantity != null
            || item.unit_name
            || item.unit_price != null
        ))
        : [];

    if (transactionItems.length > 0) {
        return {
            items: transactionItems.map(createPrefilledLineItem),
            source: "transaction",
        };
    }

    return {
        items: [],
        source: "manual",
    };
}

function parseDecimal(value: string): number | null {
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }

    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

function roundMoney(value: number): number {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatCurrency(value: number): string {
    return `¥${Math.round(value).toLocaleString()}`;
}

function formatDate(value?: string | null): string {
    return value ? value.replace(/-/g, "/") : "未設定";
}

function getLineItemAmount(item: Pick<AccountingTransactionItem, "quantity" | "unit_price" | "amount">): number | null {
    if (typeof item.amount === "number" && Number.isFinite(item.amount)) {
        return item.amount;
    }

    if (typeof item.quantity === "number" && typeof item.unit_price === "number") {
        return roundMoney(item.quantity * item.unit_price);
    }

    return null;
}

export function InvoiceCorrectionModal({
    invoice,
    sourceTransaction,
    mode,
    onClose,
    onSuccess,
}: InvoiceCorrectionModalProps) {
    const initialLineItemState = useMemo(
        () => buildInitialLineItems(invoice, sourceTransaction),
        [invoice, sourceTransaction]
    );
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        billing_name: invoice.billing_name || "",
        billing_address: invoice.billing_address || "",
        notes: invoice.notes || "",
        issue_date: new Date().toISOString().split("T")[0],
        correction_reason_type: mode === "supplement" ? "legal_field_missing" : "recipient_error",
        correction_note: "",
    });
    const [lineItems, setLineItems] = useState<LineItemForm[]>(
        initialLineItemState.items
    );
    const [lineItemSource, setLineItemSource] = useState<LineItemSource>(
        initialLineItemState.source
    );

    const isSupplementMode = mode === "supplement";
    const sourceSummary = invoice.source_summary || null;
    const siteSummary = sourceSummary?.site_names?.length
        ? sourceSummary.site_names.join(" / ")
        : sourceTransaction.site?.name || "現場未設定";
    const sourcePeriodLabel = sourceSummary?.period_start
        ? `${formatDate(sourceSummary.period_start)} - ${formatDate(sourceSummary.period_end || sourceSummary.period_start)}`
        : formatDate(invoice.source_transaction_date || sourceTransaction.recorded_date);
    const modeLabel = isSupplementMode ? "不足項目を追記" : "請求書の表示を修正";
    const submitLabel = loading
        ? "保存中..."
        : isSupplementMode
            ? "追記書を作成"
            : "修正内容を保存";

    useEffect(() => {
        setFormData({
            billing_name: invoice.billing_name || "",
            billing_address: invoice.billing_address || "",
            notes: invoice.notes || "",
            issue_date: new Date().toISOString().split("T")[0],
            correction_reason_type: mode === "supplement" ? "legal_field_missing" : "recipient_error",
            correction_note: "",
        });
        setLineItems(initialLineItemState.items);
        setLineItemSource(initialLineItemState.source);
        setError(null);
    }, [initialLineItemState, invoice.billing_address, invoice.billing_name, invoice.notes, mode]);

    const normalizedLineItems = useMemo(() => (
        lineItems
            .map((item) => {
                const itemName = item.item_name.trim();
                const unitName = item.unit_name.trim();
                const quantity = parseDecimal(item.quantity);
                const unitPrice = parseDecimal(item.unit_price);
                const hasAnyValue = Boolean(itemName || unitName || quantity !== null || unitPrice !== null);

                if (!hasAnyValue) {
                    return null;
                }

                return {
                    item_name: itemName,
                    quantity,
                    unit_name: unitName || null,
                    unit_price: unitPrice,
                    amount: quantity !== null && unitPrice !== null
                        ? roundMoney(quantity * unitPrice)
                        : null,
                } satisfies NormalizedLineItem;
            })
            .filter(isNormalizedLineItem)
    ), [lineItems]);
    const initialNormalizedLineItems = useMemo(() => (
        initialLineItemState.items
            .map((item) => {
                const itemName = item.item_name.trim();
                const unitName = item.unit_name.trim();
                const quantity = parseDecimal(item.quantity);
                const unitPrice = parseDecimal(item.unit_price);
                const hasAnyValue = Boolean(itemName || unitName || quantity !== null || unitPrice !== null);

                if (!hasAnyValue) {
                    return null;
                }

                return {
                    item_name: itemName,
                    quantity,
                    unit_name: unitName || null,
                    unit_price: unitPrice,
                    amount: quantity !== null && unitPrice !== null
                        ? roundMoney(quantity * unitPrice)
                        : null,
                } satisfies NormalizedLineItem;
            })
            .filter(isNormalizedLineItem)
    ), [initialLineItemState.items]);

    const lineItemSubtotal = useMemo(() => (
        normalizedLineItems.reduce((sum, item) => {
            const amount = getLineItemAmount(item);
            return sum + (amount ?? 0);
        }, 0)
    ), [normalizedLineItems]);

    const subtotalDifference = useMemo(() => {
        if (lineItemSubtotal <= 0 || sourceTransaction.amount_subtotal <= 0) {
            return 0;
        }

        return roundMoney(lineItemSubtotal - sourceTransaction.amount_subtotal);
    }, [lineItemSubtotal, sourceTransaction.amount_subtotal]);

    const handleLineItemChange = (
        id: string,
        field: keyof Omit<LineItemForm, "id">,
        value: string
    ) => {
        setLineItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
        );
    };

    const handleAddLineItem = () => {
        setLineItems((prev) => [...prev, createLineItem()]);
        setLineItemSource("manual");
    };

    const handleRemoveLineItem = (id: string) => {
        setLineItems((prev) => prev.filter((item) => item.id !== id));
    };

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();

        if (!formData.correction_note.trim()) {
            setError("理由を入力してください");
            return;
        }

        if (!isSupplementMode && !formData.billing_name.trim()) {
            setError("請求先名を入力してください");
            return;
        }

        try {
            const invalidLineItemIndex = normalizedLineItems.findIndex((item) => (
                !item.item_name
                || (item.quantity !== null && item.quantity <= 0)
                || (item.unit_price !== null && item.unit_price < 0)
            ));

            if (invalidLineItemIndex >= 0) {
                setError(`工事項目${invalidLineItemIndex + 1}の入力内容を確認してください`);
                return;
            }

            setLoading(true);
            setError(null);
            const lineItemsChanged = JSON.stringify(normalizedLineItems) !== JSON.stringify(initialNormalizedLineItems);

            if (isSupplementMode) {
                await createInvoiceSupplement(invoice.id, {
                    issue_date: formData.issue_date,
                    correction_reason_type: formData.correction_reason_type,
                    correction_note: formData.correction_note.trim(),
                    supplement_line_items: normalizedLineItems.length > 0
                        ? normalizedLineItems
                        : undefined,
                });
            } else {
                await correctInvoice(invoice.id, {
                    billing_name: formData.billing_name.trim(),
                    billing_address: formData.billing_address.trim() || undefined,
                    notes: formData.notes.trim() || undefined,
                    correction_reason_type: formData.correction_reason_type,
                    correction_note: formData.correction_note.trim(),
                    corrected_line_items: lineItemsChanged ? normalizedLineItems : undefined,
                });
            }

            await onSuccess();
            onClose();
        } catch (submitError: unknown) {
            setError(getErrorMessage(submitError));
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
                aria-labelledby="invoice-correction-title"
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 16, scale: 0.98 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                onClick={(event) => event.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="invoice-correction-title" className={styles.title}>
                        {modeLabel}
                    </h2>
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="閉じる">
                        <X size={18} />
                    </button>
                </header>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <section className={styles.hero}>
                        <div className={styles.heroHeader}>
                            <div>
                                <p className={styles.eyebrow}>Invoice correction</p>
                                <h3 className={styles.heroTitle}>{invoice.invoice_no}</h3>
                                <p className={styles.subtitle}>
                                    {isSupplementMode
                                        ? "会計を巻き戻さず、元請求書に不足していた表示項目だけを追記します。"
                                        : "会計を変えず、請求書の表示内容だけを修正履歴つきで更新します。"}
                                </p>
                            </div>
                            <span className={`${styles.documentChip} ${isSupplementMode ? styles.warning : styles.neutral}`}>
                                {isSupplementMode ? <ScrollText size={16} /> : <FileText size={16} />}
                                {modeLabel}
                            </span>
                        </div>

                        <div className={styles.heroGrid}>
                            <div className={styles.statusCard}>
                                <span className={styles.cardLabel}>請求先</span>
                                <strong className={styles.statusValue}>{invoice.billing_name || "未設定"}</strong>
                                <p>{siteSummary}</p>
                            </div>
                            <div className={styles.statusCard}>
                                <span className={styles.cardLabel}>対象期間</span>
                                <strong className={styles.statusValue}>{sourcePeriodLabel}</strong>
                                <p>{sourceSummary?.source_count || 1}件の売上を参照</p>
                            </div>
                            <div className={styles.statusCard}>
                                <span className={styles.cardLabel}>請求金額</span>
                                <strong className={styles.statusValue}>
                                    {formatCurrency(sourceSummary?.amount_total || sourceTransaction.amount_total)}
                                </strong>
                                <p>帳票修正では会計金額は変わりません</p>
                            </div>
                        </div>
                    </section>

                    <section className={styles.summaryPanel}>
                        <div className={styles.sectionHeader}>
                            <div>
                                <p className={styles.sectionEyebrow}>対象の確認</p>
                                <h3 className={styles.sectionTitle}>どの請求書を直すか先に固定する</h3>
                            </div>
                            <span className={styles.summaryChip}>
                                <BadgeCheck size={16} />
                                元帳はそのまま
                            </span>
                        </div>

                        <div className={styles.summaryGrid}>
                            <div className={styles.summaryCard}>
                                <span className={styles.summaryLabel}>元帳票</span>
                                <strong className={styles.summaryValue}>{invoice.invoice_no}</strong>
                                <p className={styles.summaryNote}>{formatDate(invoice.issue_date)} 発行</p>
                            </div>
                            <div className={styles.summaryCard}>
                                <span className={styles.summaryLabel}>元取引日</span>
                                <strong className={styles.summaryValue}>
                                    {formatDate(invoice.source_transaction_date || sourceTransaction.recorded_date)}
                                </strong>
                                <p className={styles.summaryNote}>{sourceTransaction.description || "取引説明なし"}</p>
                            </div>
                            <div className={styles.summaryCard}>
                                <span className={styles.summaryLabel}>現場数</span>
                                <strong className={styles.summaryValue}>{sourceSummary?.site_count || 1}</strong>
                                <p className={styles.summaryNote}>{siteSummary}</p>
                            </div>
                        </div>

                        <div className={styles.reasonBox}>
                            <span className={styles.reasonTitle}>この操作で変わるもの</span>
                            <div className={styles.reasonStatus}>
                                <ShieldAlert size={16} />
                                {isSupplementMode
                                    ? "追記書のPDFと修正履歴だけを追加します"
                                    : "請求先・住所・備考・表示明細だけを更新します"}
                            </div>
                        </div>
                    </section>

                    <section className={styles.formSection}>
                        <div className={styles.sectionHeader}>
                            <div>
                                <p className={styles.sectionEyebrow}>表示内容</p>
                                <h3 className={styles.sectionTitle}>
                                    {isSupplementMode ? "追記書として出す内容を整える" : "請求書に見せる内容を整える"}
                                </h3>
                            </div>
                        </div>

                        <div className={styles.formRow}>
                            <label className={styles.field}>
                                <span>誤りの種類</span>
                                <select
                                    value={formData.correction_reason_type}
                                    onChange={(event) => setFormData((prev) => ({
                                        ...prev,
                                        correction_reason_type: event.target.value,
                                    }))}
                                >
                                    {reasonOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <label className={styles.field}>
                                <span>{isSupplementMode ? "追記書の日付" : "元請求書の発行日"}</span>
                                {isSupplementMode ? (
                                    <input
                                        type="date"
                                        value={formData.issue_date}
                                        onChange={(event) => setFormData((prev) => ({
                                            ...prev,
                                            issue_date: event.target.value,
                                        }))}
                                    />
                                ) : (
                                    <div className={styles.readonlyField}>
                                        <CalendarDays size={16} />
                                        <span>{formatDate(invoice.issue_date)}</span>
                                    </div>
                                )}
                            </label>
                        </div>

                        {!isSupplementMode && (
                            <>
                                <div className={styles.formRow}>
                                    <label className={styles.field}>
                                        <span>請求先名</span>
                                        <input
                                            type="text"
                                            value={formData.billing_name}
                                            onChange={(event) => setFormData((prev) => ({
                                                ...prev,
                                                billing_name: event.target.value,
                                            }))}
                                        />
                                    </label>
                                    <label className={styles.field}>
                                        <span>請求先住所</span>
                                        <textarea
                                            value={formData.billing_address}
                                            onChange={(event) => setFormData((prev) => ({
                                                ...prev,
                                                billing_address: event.target.value,
                                            }))}
                                            rows={3}
                                        />
                                    </label>
                                </div>

                                <label className={styles.field}>
                                    <span>備考</span>
                                    <textarea
                                        value={formData.notes}
                                        onChange={(event) => setFormData((prev) => ({
                                            ...prev,
                                            notes: event.target.value,
                                        }))}
                                        rows={3}
                                    />
                                </label>
                            </>
                        )}
                    </section>

                    <section className={styles.lineItemSection}>
                        <div className={styles.lineItemSectionHeader}>
                            <div>
                                <p className={styles.sectionEyebrow}>表示明細</p>
                                <h3 className={styles.sectionTitle}>工事項目を請求書作成と同じ粒度で整える</h3>
                                <p className={styles.helperText}>
                                    {isSupplementMode
                                        ? "追記書に載せる工事項目を構造化して残します。会計金額は変更しません。"
                                        : "請求書に表示する工事項目だけを修正します。会計金額は変更しません。"}
                                </p>
                            </div>
                            <span className={styles.sourceBadge}>
                                <Building2 size={14} />
                                {lineItemSource === "invoice"
                                    ? "請求書保存内容から読込"
                                    : lineItemSource === "transaction"
                                    ? "取引明細から読込"
                                    : "手入力"}
                            </span>
                        </div>

                        {lineItems.length === 0 ? (
                            <div className={styles.emptyState}>
                                <p>{isSupplementMode ? "まだ工事項目は入っていません。必要な項目だけ追加してください。" : "まだ工事項目は入っていません。必要なら表示用の項目を追加してください。"}</p>
                            </div>
                        ) : (
                            <div className={styles.lineItemList}>
                                {lineItems.map((item, index) => {
                                    const quantity = parseDecimal(item.quantity);
                                    const unitPrice = parseDecimal(item.unit_price);
                                    const amount = quantity !== null && unitPrice !== null
                                        ? roundMoney(quantity * unitPrice)
                                        : null;

                                    return (
                                        <article key={item.id} className={styles.lineItemCard}>
                                            <div className={styles.lineItemCardHeader}>
                                                <strong>工事項目 {index + 1}</strong>
                                                <div className={styles.lineItemCardActions}>
                                                    <span className={styles.lineItemAmount}>
                                                        {amount !== null ? formatCurrency(amount) : "金額未設定"}
                                                    </span>
                                                    <button
                                                        type="button"
                                                        className={styles.removeButton}
                                                        onClick={() => handleRemoveLineItem(item.id)}
                                                        aria-label={`工事項目${index + 1}を削除`}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className={styles.lineItemGrid}>
                                                <label className={styles.field}>
                                                    <span>工事名</span>
                                                    <input
                                                        type="text"
                                                        value={item.item_name}
                                                        onChange={(event) => handleLineItemChange(item.id, "item_name", event.target.value)}
                                                        placeholder="例: 軒天補修工事"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>数量</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.quantity}
                                                        onChange={(event) => handleLineItemChange(item.id, "quantity", event.target.value)}
                                                        placeholder="例: 12"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>単位</span>
                                                    <input
                                                        type="text"
                                                        value={item.unit_name}
                                                        onChange={(event) => handleLineItemChange(item.id, "unit_name", event.target.value)}
                                                        placeholder="例: m / 式"
                                                    />
                                                </label>
                                                <label className={styles.field}>
                                                    <span>単価</span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        value={item.unit_price}
                                                        onChange={(event) => handleLineItemChange(item.id, "unit_price", event.target.value)}
                                                        placeholder="例: 8500"
                                                    />
                                                </label>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}

                        <div className={styles.lineItemFooter}>
                            <button
                                type="button"
                                className={styles.secondaryButton}
                                onClick={handleAddLineItem}
                            >
                                <Plus size={16} />
                                <span>工事項目を追加</span>
                            </button>
                            <div className={styles.summaryRow}>
                                <span className={styles.summaryChip}>
                                    構造化小計 {formatCurrency(lineItemSubtotal)}
                                </span>
                                <span className={styles.summaryChip}>
                                    元取引小計 {formatCurrency(sourceTransaction.amount_subtotal)}
                                </span>
                            </div>
                        </div>

                        {subtotalDifference !== 0 && (
                            <p className={styles.warningText}>
                                工事項目の小計と元取引の小計に差分があります。帳票表示だけの修正として扱うなら、そのまま保存できます。
                            </p>
                        )}
                    </section>

                    <section className={styles.formSection}>
                        <div className={styles.sectionHeader}>
                            <div>
                                <p className={styles.sectionEyebrow}>修正理由</p>
                                <h3 className={styles.sectionTitle}>監査ログに残す理由を短く書く</h3>
                            </div>
                        </div>

                        <label className={styles.field}>
                            <span>理由</span>
                            <textarea
                                value={formData.correction_note}
                                onChange={(event) => setFormData((prev) => ({
                                    ...prev,
                                    correction_note: event.target.value,
                                }))}
                                placeholder={isSupplementMode ? "例: 適格請求書登録番号の追完" : "例: 宛名に旧社名が残っていたため修正"}
                                rows={4}
                            />
                        </label>
                    </section>

                    {error && <div className={styles.error}>{error}</div>}

                    <div className={styles.actions}>
                        <button type="button" className={styles.secondaryButton} onClick={onClose}>
                            閉じる
                        </button>
                        <button type="submit" className={styles.primaryButton} disabled={loading}>
                            {loading ? <Loader2 size={16} className={styles.spinning} /> : null}
                            <span>{submitLabel}</span>
                        </button>
                    </div>
                </form>
            </motion.div>
        </motion.div>
    );
}
