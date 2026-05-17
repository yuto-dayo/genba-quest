import styles from "./InvoiceFilterRow.module.css";

export type InvoiceBucket = "overdue" | "this_week" | "draft" | "all";

export interface InvoiceBucketCounts {
    overdue: number;
    this_week: number;
    draft: number;
    all: number;
}

interface InvoiceFilterRowProps {
    value: InvoiceBucket;
    counts: InvoiceBucketCounts;
    onChange: (bucket: InvoiceBucket) => void;
}

const FILTERS: Array<{ bucket: InvoiceBucket; label: string; hideWhenZero?: boolean }> = [
    { bucket: "overdue", label: "期限超過", hideWhenZero: true },
    { bucket: "this_week", label: "今週入金予定" },
    { bucket: "draft", label: "下書き", hideWhenZero: true },
    { bucket: "all", label: "全部" },
];

export function InvoiceFilterRow({ value, counts, onChange }: InvoiceFilterRowProps) {
    return (
        <div className={styles.row} role="toolbar" aria-label="請求書フィルタ">
            {FILTERS.map(({ bucket, label, hideWhenZero }) => {
                const count = counts[bucket];
                if (hideWhenZero && count === 0) {
                    return null;
                }
                const active = value === bucket;
                return (
                    <button
                        key={bucket}
                        type="button"
                        className={`${styles.chip} ${active ? styles.chipActive : ""}`}
                        aria-pressed={active}
                        onClick={() => onChange(bucket)}
                    >
                        <span>{label}</span>
                        {bucket === "all" ? null : (
                            <span className={styles.badge}>{count}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}
