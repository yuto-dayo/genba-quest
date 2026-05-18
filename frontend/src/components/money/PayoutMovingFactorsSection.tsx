import { Info } from "lucide-react";
import type {
    PathRewardConfirmationSummary,
    PathV32SimpleMonthlyDistributionPreview,
} from "../../lib/api";
import styles from "./PayoutModalSections.module.css";

interface PayoutMovingFactorsSectionProps {
    summary: PathRewardConfirmationSummary;
    preview: PathV32SimpleMonthlyDistributionPreview | null;
}

function readSiteList(preview: PathV32SimpleMonthlyDistributionPreview | null): Array<Record<string, unknown>> {
    const list = preview?.calculation_snapshot?.site_closes;
    return Array.isArray(list)
        ? list.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        : [];
}

function countOpenSites(summary: PathRewardConfirmationSummary, preview: PathV32SimpleMonthlyDistributionPreview | null): number {
    const fromPending = summary.pending_close_sites.length;
    if (fromPending > 0) return fromPending;

    return readSiteList(preview).filter((site) => {
        const status = String(site.status ?? site.close_status ?? "");
        return status && status !== "closed" && status !== "finalized";
    }).length;
}

export function PayoutMovingFactorsSection({
    summary,
    preview,
}: PayoutMovingFactorsSectionProps) {
    const openSiteCount = countOpenSites(summary, preview);
    const reflectedSiteCount = summary.site_breakdown.length || readSiteList(preview).length;
    const reasonCount = summary.top_reasons.length;

    return (
        <section className={styles.section} aria-labelledby="payout-moving-factors-title">
            <h3 id="payout-moving-factors-title" className={styles.title}>
                動くポイント
            </h3>
            <details className={styles.moving}>
                <summary className={styles.summary}>
                    <Info size={18} aria-hidden="true" />
                    金額がまだ動くところ
                </summary>
                <ul className={styles.movingList}>
                    <li className={styles.movingItem}>
                        <span className={styles.movingMain}>
                            <span>未締め現場数</span>
                            <strong>{openSiteCount}件</strong>
                        </span>
                        <span className={styles.movingSub}>締まると配るお金が増えます</span>
                    </li>
                    <li className={styles.movingItem}>
                        <span className={styles.movingMain}>
                            <span>今月の出勤予定残</span>
                            <strong>{reasonCount > 0 ? "反映中" : "確認中"}</strong>
                        </span>
                        <span className={styles.movingSub}>出勤が増えると持ち分が増えます</span>
                    </li>
                    <li className={styles.movingItem}>
                        <span className={styles.movingMain}>
                            <span>他メンバーの確定</span>
                            <strong>{reflectedSiteCount}現場を反映</strong>
                        </span>
                        <span className={styles.movingSub}>みんなの確定で取り分%が動きます</span>
                    </li>
                </ul>
            </details>
        </section>
    );
}
