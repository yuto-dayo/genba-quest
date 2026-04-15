import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
    X,
    Loader2,
    CheckCircle,
    AlertTriangle,
    Building2,
    Plus,
    Trash2,
    Calculator,
} from "lucide-react";
import { createSale, fetchSites, type Site } from "../lib/api";
import { getErrorMessage } from "../lib/error";
import styles from "./SalesModal.module.css";

interface SalesModalProps {
    onClose: () => void;
    onSuccess: () => void;
    initialSiteId?: string;
    initialRecordedDate?: string;
    initialDescription?: string;
    initialItems?: SalesModalInitialItem[];
}

interface SalesModalInitialItem {
    item_name: string;
    quantity: number | null;
    unit_name: string;
    unit_price: number | null;
}

interface SaleLineItemForm {
    id: string;
    item_name: string;
    quantity: string;
    unit_name: string;
    unit_price: string;
}

const SALE_TAX_RATE = 0.1;

function createLineItem(): SaleLineItemForm {
    return {
        id:
            globalThis.crypto?.randomUUID?.() ||
            `sale-item-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        item_name: "",
        quantity: "1",
        unit_name: "",
        unit_price: "",
    };
}

function createPrefilledLineItem(item: SalesModalInitialItem): SaleLineItemForm {
    return {
        ...createLineItem(),
        item_name: item.item_name,
        quantity: item.quantity != null ? String(item.quantity) : "",
        unit_name: item.unit_name,
        unit_price: item.unit_price != null ? String(item.unit_price) : "",
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

function calculateLineAmount(item: SaleLineItemForm): number {
    const quantity = parseDecimal(item.quantity);
    const unitPrice = parseDecimal(item.unit_price);

    if (quantity === null || quantity <= 0 || unitPrice === null || unitPrice < 0) {
        return 0;
    }

    return roundMoney(quantity * unitPrice);
}

export function SalesModal({
    onClose,
    onSuccess,
    initialSiteId,
    initialRecordedDate,
    initialDescription,
    initialItems,
}: SalesModalProps) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [sites, setSites] = useState<Site[]>([]);
    const [loadingSites, setLoadingSites] = useState(true);
    const [formData, setFormData] = useState({
        site_id: initialSiteId ?? "",
        recorded_date: initialRecordedDate ?? new Date().toISOString().split("T")[0],
        description: initialDescription ?? "",
    });
    const [lineItems, setLineItems] = useState<SaleLineItemForm[]>(
        initialItems && initialItems.length > 0
            ? initialItems.map(createPrefilledLineItem)
            : [createLineItem()]
    );

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

    const totals = useMemo(() => {
        const subtotal = roundMoney(
            lineItems.reduce((sum, item) => sum + calculateLineAmount(item), 0)
        );
        const taxAmount = roundMoney(subtotal * SALE_TAX_RATE);
        const total = roundMoney(subtotal + taxAmount);

        return { subtotal, taxAmount, total };
    }, [lineItems]);

    const handleFormChange = (field: keyof typeof formData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleLineItemChange = (
        id: string,
        field: keyof Omit<SaleLineItemForm, "id">,
        value: string
    ) => {
        setLineItems((prev) =>
            prev.map((item) => (item.id === id ? { ...item, [field]: value } : item))
        );
    };

    const handleAddLineItem = () => {
        setLineItems((prev) => [...prev, createLineItem()]);
    };

    const handleRemoveLineItem = (id: string) => {
        setLineItems((prev) => {
            if (prev.length === 1) {
                return prev;
            }

            return prev.filter((item) => item.id !== id);
        });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.site_id) {
            setError("現場を選択してください");
            return;
        }

        const normalizedItems = lineItems
            .map((item) => ({
                item_name: item.item_name.trim(),
                unit_name: item.unit_name.trim(),
                quantity: parseDecimal(item.quantity),
                unit_price: parseDecimal(item.unit_price),
            }))
            .filter(
                (item) =>
                    item.item_name ||
                    item.unit_name ||
                    item.quantity !== null ||
                    item.unit_price !== null
            );

        if (normalizedItems.length === 0) {
            setError("工事項目を1件以上入力してください");
            return;
        }

        const invalidIndex = normalizedItems.findIndex((item) => {
            if (!item.item_name || !item.unit_name) {
                return true;
            }

            if (item.quantity === null || item.quantity <= 0) {
                return true;
            }

            if (item.unit_price === null || item.unit_price < 0) {
                return true;
            }

            return false;
        });

        if (invalidIndex >= 0) {
            setError(`項目${invalidIndex + 1}の工事名・数量・単位・単価を入力してください`);
            return;
        }

        if (totals.total <= 0) {
            setError("合計金額が0円を超えるように入力してください");
            return;
        }

        setLoading(true);
        setError(null);

        try {
            await createSale({
                site_id: formData.site_id,
                description: formData.description.trim() || undefined,
                recorded_date: formData.recorded_date,
                items: normalizedItems.map((item) => ({
                    item_name: item.item_name,
                    unit_name: item.unit_name,
                    quantity: item.quantity as number,
                    unit_price: item.unit_price as number,
                })),
                amount_subtotal: totals.subtotal,
                tax_amount: totals.taxAmount,
                amount_total: totals.total,
                input_sources: {
                    site_id: "manual",
                    recorded_date: "manual",
                    description: "manual",
                    items: "manual",
                },
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
                initial={{ opacity: 0, y: 32 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 24 }}
                onClick={(e) => e.stopPropagation()}
            >
                <header className={styles.header}>
                    <h2 id="sales-modal-title" className={styles.title}>
                        売上登録
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
                    <div className={styles.formGroup}>
                        <label className={styles.label}>
                            <Building2 size={16} />
                            現場
                        </label>
                        <select
                            className={styles.select}
                            value={formData.site_id}
                            onChange={(e) => handleFormChange("site_id", e.target.value)}
                            disabled={loadingSites}
                            required
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
                                onChange={(e) => handleFormChange("recorded_date", e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className={styles.formGroup}>
                        <label className={styles.label}>摘要・メモ</label>
                        <input
                            type="text"
                            className={styles.input}
                            value={formData.description}
                            onChange={(e) => handleFormChange("description", e.target.value)}
                            placeholder="請求先向けの補足があれば入力"
                        />
                    </div>

                    <section className={styles.itemsSection}>
                        <div className={styles.itemsHeader}>
                            <div>
                                <p className={styles.sectionEyebrow}>Line Items</p>
                                <h3 className={styles.sectionTitle}>工事項目</h3>
                                <p className={styles.sectionDescription}>
                                    床工事、クロス工事などを行ごとに追加します
                                </p>
                            </div>
                            <button
                                type="button"
                                className={styles.addItemButton}
                                onClick={handleAddLineItem}
                            >
                                <Plus size={16} />
                                項目追加
                            </button>
                        </div>

                        <div className={styles.itemsList}>
                            {lineItems.map((item, index) => {
                                const lineAmount = calculateLineAmount(item);

                                return (
                                    <div key={item.id} className={styles.itemCard}>
                                        <div className={styles.itemCardHeader}>
                                            <span className={styles.itemIndex}>項目 {index + 1}</span>
                                            <button
                                                type="button"
                                                className={styles.removeItemButton}
                                                onClick={() => handleRemoveLineItem(item.id)}
                                                disabled={lineItems.length === 1}
                                                aria-label={`項目${index + 1}を削除`}
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>

                                        <div className={styles.formGroup}>
                                            <label className={styles.label}>工事名 *</label>
                                            <input
                                                type="text"
                                                className={styles.input}
                                                value={item.item_name}
                                                onChange={(e) =>
                                                    handleLineItemChange(
                                                        item.id,
                                                        "item_name",
                                                        e.target.value
                                                    )
                                                }
                                                placeholder="床工事"
                                            />
                                        </div>

                                        <div className={styles.itemGrid}>
                                            <div className={styles.formGroup}>
                                                <label className={styles.label}>数量 *</label>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0"
                                                    step="0.01"
                                                    className={styles.input}
                                                    value={item.quantity}
                                                    onChange={(e) =>
                                                        handleLineItemChange(
                                                            item.id,
                                                            "quantity",
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="1"
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label className={styles.label}>単位 *</label>
                                                <input
                                                    type="text"
                                                    className={styles.input}
                                                    value={item.unit_name}
                                                    onChange={(e) =>
                                                        handleLineItemChange(
                                                            item.id,
                                                            "unit_name",
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="人工 / ㎡ / 式"
                                                />
                                            </div>

                                            <div className={styles.formGroup}>
                                                <label className={styles.label}>単価 *</label>
                                                <input
                                                    type="number"
                                                    inputMode="decimal"
                                                    min="0"
                                                    step="0.01"
                                                    className={styles.input}
                                                    value={item.unit_price}
                                                    onChange={(e) =>
                                                        handleLineItemChange(
                                                            item.id,
                                                            "unit_price",
                                                            e.target.value
                                                        )
                                                    }
                                                    placeholder="0"
                                                />
                                            </div>
                                        </div>

                                        <div className={styles.formGroup}>
                                            <label className={styles.label}>
                                                <Calculator size={16} />
                                                行金額
                                            </label>
                                            <input
                                                type="number"
                                                className={`${styles.input} ${styles.readonlyInput}`}
                                                value={lineAmount}
                                                readOnly
                                                aria-readonly="true"
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>

                    <section className={styles.summaryCard}>
                        <div className={styles.summaryHeader}>
                            <div>
                                <p className={styles.sectionEyebrow}>Auto Total</p>
                                <h3 className={styles.sectionTitle}>金額サマリー</h3>
                            </div>
                            <span className={styles.taxBadge}>消費税 10% 自動計算</span>
                        </div>

                        <div className={styles.summaryGrid}>
                            <div className={styles.formGroup}>
                                <label className={styles.label}>小計（税抜）</label>
                                <input
                                    type="number"
                                    className={`${styles.input} ${styles.readonlyInput}`}
                                    value={totals.subtotal}
                                    readOnly
                                    aria-readonly="true"
                                />
                            </div>

                            <div className={styles.formGroup}>
                                <label className={styles.label}>消費税</label>
                                <input
                                    type="number"
                                    className={`${styles.input} ${styles.readonlyInput}`}
                                    value={totals.taxAmount}
                                    readOnly
                                    aria-readonly="true"
                                />
                            </div>
                        </div>

                        <div className={styles.formGroup}>
                            <label className={styles.label}>合計金額</label>
                            <input
                                type="number"
                                className={`${styles.input} ${styles.totalInput} ${styles.readonlyInput}`}
                                value={totals.total}
                                readOnly
                                aria-readonly="true"
                            />
                        </div>
                    </section>

                    <div className={styles.formActions}>
                        <button type="button" className={styles.cancelButton} onClick={onClose}>
                            キャンセル
                        </button>
                        <button type="submit" className={styles.submitButton} disabled={loading}>
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
