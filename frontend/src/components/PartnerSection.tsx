import { ReactNode } from "react";
import styles from "./PartnerSection.module.css";

interface PartnerSectionProps {
    title: string;
    total: number;
    warn?: boolean;
    emptyLabel?: string;
    children: ReactNode;
    /** child の count を渡す (empty 判定用) */
    count: number;
}

function formatYenShort(amount: number): string {
    if (amount >= 10_000) {
        const man = Math.round(amount / 10_000);
        return `${man}万`;
    }
    return `¥${amount.toLocaleString()}`;
}

export function PartnerSection({ title, total, warn, emptyLabel, children, count }: PartnerSectionProps) {
    return (
        <div className={styles.section}>
            <div className={styles.head}>
                <span className={`${styles.title} ${warn ? styles.warn : ""}`}>{title}</span>
                {count > 0 && <span className={styles.total}>合計 {formatYenShort(total)}</span>}
            </div>
            {count === 0 ? (
                <div className={styles.empty}>{emptyLabel ?? "該当データなし"}</div>
            ) : (
                <div className={styles.list}>{children}</div>
            )}
        </div>
    );
}
