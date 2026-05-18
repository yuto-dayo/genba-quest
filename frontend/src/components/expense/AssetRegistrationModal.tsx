import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, PackageCheck, X } from "lucide-react";
import { BottomSheet } from "../BottomSheet";
import {
    fetchSpecialDepreciationUsage,
    registerDepreciableAsset,
    type AccountingTransaction,
    type DepreciableAssetClassification,
    type SpecialDepreciationUsage,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./AssetRegistrationModal.module.css";

interface AssetRegistrationModalProps {
    open: boolean;
    transaction: AccountingTransaction;
    onRegistered: () => void;
    onSkip: () => void;
}

const CATEGORY_OPTIONS = ["工具", "車両", "PC", "機械", "その他"] as const;

const CATEGORY_DEFAULT_LIFE: Record<string, number> = {
    工具: 5,
    車両: 6,
    PC: 4,
    機械: 8,
    その他: 5,
};

const CLASSIFICATION_LABEL: Record<DepreciableAssetClassification, string> = {
    expense_immediate: "一括費用",
    three_year_special: "3年均等",
    small_amount_special: "少額特例",
    standard_depreciation: "通常償却",
};

const formatYen = (amount: number) =>
    new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);

function fiscalYearOf(date: string): number {
    return Number((date || new Date().toISOString()).slice(0, 4));
}

function inferCategory(transaction: AccountingTransaction): string {
    if (transaction.category === "tool") return "工具";
    if (transaction.category === "travel" || transaction.category === "fuel") return "車両";
    return "その他";
}

function classify(amount: number, remaining: number): DepreciableAssetClassification {
    if (amount < 100000) return "expense_immediate";
    if (amount < 200000) return "three_year_special";
    if (amount < 300000) return remaining >= amount ? "small_amount_special" : "standard_depreciation";
    return "standard_depreciation";
}

function monthlyEstimate(amount: number, classification: DepreciableAssetClassification, usefulLifeYears: number) {
    if (classification === "expense_immediate") return null;
    if (classification === "small_amount_special") return { months: 1, amount };
    const months = classification === "three_year_special" ? 36 : usefulLifeYears * 12;
    return { months, amount: Math.round(amount / months) };
}

export function AssetRegistrationModal({
    open,
    transaction,
    onRegistered,
    onSkip,
}: AssetRegistrationModalProps) {
    const [category, setCategory] = useState(inferCategory(transaction));
    const [title, setTitle] = useState(transaction.description || transaction.vendor_name || "資産");
    const [usefulLifeYears, setUsefulLifeYears] = useState(String(CATEGORY_DEFAULT_LIFE[inferCategory(transaction)] || 5));
    const [usage, setUsage] = useState<SpecialDepreciationUsage | null>(null);
    const [requestedClassification, setRequestedClassification] = useState<DepreciableAssetClassification | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);

    const amount = Number(transaction.amount_total) || 0;
    const fiscalYear = fiscalYearOf(transaction.recorded_date);
    const remaining = usage?.remaining_amount ?? 3000000;
    const suggestedClassification = classify(amount, remaining);
    const selectedClassification = requestedClassification || suggestedClassification;
    const estimate = monthlyEstimate(amount, selectedClassification, Number(usefulLifeYears) || 1);
    const specialLimitExceeded =
        amount >= 200000 &&
        amount < 300000 &&
        remaining < amount;

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchSpecialDepreciationUsage(fiscalYear)
            .then((result) => {
                if (!cancelled) setUsage(result);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(getErrorMessage(err));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [fiscalYear, open]);

    useEffect(() => {
        setUsefulLifeYears(String(CATEGORY_DEFAULT_LIFE[category] || 5));
    }, [category]);

    useEffect(() => {
        setRequestedClassification(null);
    }, [amount, remaining]);

    const classificationOptions = useMemo(() => {
        if (amount < 200000) return ["three_year_special"] as DepreciableAssetClassification[];
        if (amount < 300000) return ["small_amount_special", "standard_depreciation"] as DepreciableAssetClassification[];
        return ["standard_depreciation"] as DepreciableAssetClassification[];
    }, [amount]);

    const handleSubmit = async () => {
        setSaving(true);
        setError(null);
        setNotice(null);
        try {
            const result = await registerDepreciableAsset({
                category,
                title: title.trim() || "資産",
                acquisition_amount: amount,
                acquisition_date: transaction.recorded_date.slice(0, 10),
                useful_life_years: Number(usefulLifeYears) || null,
                depreciation_method: selectedClassification === "standard_depreciation" ? "straight_line" : null,
                residual_value: 0,
                source_transaction_id: transaction.id,
                requested_classification: selectedClassification,
            });
            if (result.warnings.includes("SPECIAL_LIMIT_EXCEEDED_FALLBACK_STANDARD")) {
                setNotice("年300万円枠を超えたため、通常償却で登録しました。");
            }
            onRegistered();
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setSaving(false);
        }
    };

    return (
        <BottomSheet open={open} onClose={onSkip} ariaLabel="減価償却資産の登録">
            <div className={styles.modal}>
                <header className={styles.header}>
                    <div>
                        <p className={styles.eyebrow}>10万円以上の経費</p>
                        <h2 className={styles.title}>資産として登録</h2>
                    </div>
                    <button type="button" className={styles.iconButton} onClick={onSkip} aria-label="閉じる">
                        <X size={22} />
                    </button>
                </header>

                <div className={styles.summary}>
                    <PackageCheck size={20} />
                    <span>
                        <strong>{formatYen(amount)}</strong>
                        <small>{transaction.vendor_name || transaction.description || "取得資産"}</small>
                    </span>
                </div>

                {error && (
                    <div className={styles.error}>
                        <AlertTriangle size={16} />
                        {error}
                    </div>
                )}
                {notice && <p className={styles.notice}>{notice}</p>}

                <div className={styles.formGrid}>
                    <label className={styles.field}>
                        <span>資産名</span>
                        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
                    </label>
                    <label className={styles.field}>
                        <span>分類</span>
                        <select value={category} onChange={(event) => setCategory(event.target.value)}>
                            {CATEGORY_OPTIONS.map((option) => (
                                <option key={option} value={option}>{option}</option>
                            ))}
                        </select>
                    </label>
                    <label className={styles.field}>
                        <span>耐用年数</span>
                        <input
                            inputMode="numeric"
                            value={usefulLifeYears}
                            onChange={(event) => setUsefulLifeYears(event.target.value)}
                            disabled={selectedClassification !== "standard_depreciation"}
                        />
                    </label>
                </div>

                <section className={styles.decisionPanel} aria-label="税務処理">
                    <div className={styles.limitRow}>
                        <span>少額特例枠</span>
                        <strong>{loading ? "確認中" : `${formatYen(remaining)} / ${fiscalYear}年`}</strong>
                    </div>

                    {specialLimitExceeded && (
                        <div className={styles.warning}>
                            <AlertTriangle size={16} />
                            残枠は {formatYen(remaining)}。この取得は通常償却に切り替わります。
                        </div>
                    )}

                    <div className={styles.segmented}>
                        {classificationOptions.map((option) => {
                            const disabled = option === "small_amount_special" && specialLimitExceeded;
                            const selected = selectedClassification === option;
                            return (
                                <button
                                    key={option}
                                    type="button"
                                    className={selected ? styles.segmentActive : styles.segment}
                                    onClick={() => setRequestedClassification(option)}
                                    disabled={disabled}
                                >
                                    {CLASSIFICATION_LABEL[option]}
                                </button>
                            );
                        })}
                    </div>

                    {estimate && (
                        <p className={styles.estimate}>
                            {estimate.months}回 / 月 {formatYen(estimate.amount)}
                        </p>
                    )}
                </section>

                <footer className={styles.footer}>
                    <button type="button" className={styles.secondaryButton} onClick={onSkip}>
                        後で
                    </button>
                    <button type="button" className={styles.primaryButton} onClick={() => void handleSubmit()} disabled={saving || loading}>
                        {saving ? <Loader2 size={16} className={styles.spinner} /> : <Check size={16} />}
                        登録
                    </button>
                </footer>
            </div>
        </BottomSheet>
    );
}
