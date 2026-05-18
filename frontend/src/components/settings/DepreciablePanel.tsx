import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import {
    fetchDepreciableAssets,
    fetchSpecialDepreciationUsage,
    type DepreciableAsset,
    type SpecialDepreciationUsage,
} from "../../lib/api";
import { getErrorMessage } from "../../lib/error";
import styles from "./DepreciablePanel.module.css";

const CLASSIFICATION_LABEL: Record<string, string> = {
    expense_immediate: "一括費用",
    three_year_special: "3年均等",
    small_amount_special: "少額特例",
    standard_depreciation: "通常償却",
};

const formatYen = (amount: number | string | null | undefined) =>
    new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(Number(amount) || 0);

const formatDate = (value: string) => value.replace(/-/g, "/");

export function DepreciablePanel() {
    const [assets, setAssets] = useState<DepreciableAsset[]>([]);
    const [usage, setUsage] = useState<SpecialDepreciationUsage | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const fiscalYear = new Date().getFullYear();

    const loadData = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [assetData, usageData] = await Promise.all([
                fetchDepreciableAssets(),
                fetchSpecialDepreciationUsage(fiscalYear),
            ]);
            setAssets(assetData.assets);
            setUsage(usageData);
        } catch (err: unknown) {
            setError(getErrorMessage(err));
        } finally {
            setLoading(false);
        }
    }, [fiscalYear]);

    useEffect(() => {
        void loadData();
    }, [loadData]);

    const usedAmount = usage?.used_amount ?? 0;
    const limitAmount = usage?.annual_limit_amount ?? 3000000;
    const remainingAmount = usage?.remaining_amount ?? limitAmount;
    const usageRate = Math.min(100, Math.round((usedAmount / limitAmount) * 100));

    return (
        <div className={styles.panel}>
            <div className={styles.header}>
                <div>
                    <h3>減価償却資産</h3>
                    <p>{fiscalYear}年の少額特例枠と登録資産</p>
                </div>
                <button type="button" className={styles.iconButton} onClick={() => void loadData()} disabled={loading} aria-label="更新">
                    {loading ? <Loader2 size={16} className={styles.spinner} /> : <RefreshCw size={16} />}
                </button>
            </div>

            {error && (
                <div className={styles.error}>
                    <AlertTriangle size={16} />
                    {error}
                </div>
            )}

            <section className={styles.limitPanel} aria-label="少額特例枠">
                <div className={styles.limitTop}>
                    <span>年300万円枠</span>
                    <strong>{formatYen(remainingAmount)} 残</strong>
                </div>
                <div className={styles.progressTrack} aria-hidden="true">
                    <span style={{ width: `${usageRate}%` }} />
                </div>
                <div className={styles.limitMeta}>
                    <span>使用 {formatYen(usedAmount)}</span>
                    <span>{usage?.asset_count ?? 0}件</span>
                </div>
            </section>

            <div className={styles.assetList}>
                {loading ? (
                    <div className={styles.empty}>読み込み中...</div>
                ) : assets.length === 0 ? (
                    <div className={styles.empty}>登録資産はありません</div>
                ) : (
                    assets.map((asset) => (
                        <article key={asset.id} className={styles.assetRow}>
                            <span>
                                <strong>{asset.title}</strong>
                                <small>
                                    {asset.category} / {CLASSIFICATION_LABEL[asset.classification] ?? asset.classification} / {formatDate(asset.acquisition_date)}
                                </small>
                            </span>
                            <span className={styles.amountGroup}>
                                <b>{formatYen(asset.acquisition_amount)}</b>
                                <small>{asset.schedule_count ?? 0}回</small>
                            </span>
                        </article>
                    ))
                )}
            </div>
        </div>
    );
}
