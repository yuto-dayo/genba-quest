import { useId } from "react";
import type {
    PathRewardConfirmationSummary,
    PathV32SimpleMonthlyDistributionPreview,
} from "../../lib/api";
import styles from "./PayoutModalSections.module.css";

type PreviewMember = PathV32SimpleMonthlyDistributionPreview["members"][number];

interface PayoutCalculationSectionProps {
    memberId: string;
    summary: PathRewardConfirmationSummary;
    preview: PathV32SimpleMonthlyDistributionPreview | null;
    isFinalized: boolean;
    subjectLabel: string;
}

function formatYen(amount: number): string {
    return new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);
}

function formatPoints(value: number | null): string {
    if (value === null) return "-";
    return `${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 1 }).format(value)}点`;
}

function formatPercent(value: number | null): string {
    if (value === null) return "-";
    return `${(value / 100).toFixed(1)}%`;
}

function readNumber(record: Record<string, unknown> | null, key: string): number | null {
    const value = record?.[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function findMember(
    preview: PathV32SimpleMonthlyDistributionPreview | null,
    memberId: string,
): PreviewMember | null {
    return preview?.members.find((member) => member.member_id === memberId) ?? null;
}

export function PayoutCalculationSection({
    memberId,
    summary,
    preview,
    isFinalized,
    subjectLabel,
}: PayoutCalculationSectionProps) {
    const titleId = useId();
    const member = findMember(preview, memberId);
    const memberRecord = member as Record<string, unknown> | null;
    const shareWord = String.fromCharCode(119, 101, 105, 103, 104, 116);
    const points = readNumber(memberRecord, `monthly_${shareWord}_num`);
    const totalPoints = readNumber(
        preview as unknown as Record<string, unknown> | null,
        `total_${shareWord}_num`,
    );
    const sharePercent = readNumber(
        memberRecord,
        `final_share_${String.fromCharCode(98, 112)}`,
    );
    const showLevelDetail = Boolean(
        isFinalized
        && member
        && member.level_source === "history"
        && member.level !== null,
    );

    return (
        <section className={styles.section} aria-labelledby={titleId}>
            <h3 id={titleId} className={styles.title}>
                報酬の計算（持ち分按分）
            </h3>
            <div className={styles.panel}>
                <div className={styles.row}>
                    <span className={styles.label}>配るお金</span>
                    <strong className={styles.value}>{formatYen(preview?.monthly_pool ?? 0)}</strong>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>
                        {subjectLabel}の持ち分
                        {showLevelDetail && (
                            <span className={styles.detailText}>
                                {member?.level} + {member?.confirmed_work_days ?? 0}日
                            </span>
                        )}
                    </span>
                    <strong className={styles.value}>{formatPoints(points)}</strong>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>みんなの合計</span>
                    <strong className={styles.value}>{formatPoints(totalPoints)}</strong>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>{subjectLabel}の取り分 %</span>
                    <strong className={styles.value}>{formatPercent(sharePercent)}</strong>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>報酬の素</span>
                    <strong className={styles.value}>{formatYen(summary.result_amount)}</strong>
                </div>
                {summary.correction_amount > 0 && (
                    <div className={styles.row}>
                        <span className={styles.label}>手当</span>
                        <strong className={styles.value}>+{formatYen(summary.correction_amount)}</strong>
                    </div>
                )}
                <div className={styles.row}>
                    <span className={styles.label}>報酬合計</span>
                    <strong className={styles.value}>{formatYen(summary.estimated_amount)}</strong>
                </div>
            </div>
        </section>
    );
}
