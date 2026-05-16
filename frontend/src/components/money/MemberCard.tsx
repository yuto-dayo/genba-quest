import styles from "./MemberCard.module.css";

export type MoneyMemberMode = "reward" | "expense";
export type MoneyStatusTone = "pending" | "overdue" | "completed" | "draft";

interface MemberCardProps {
    mode: MoneyMemberMode;
    variant: "self" | "other";
    name: string;
    amount: number;
    statusLabel: string;
    statusTone: MoneyStatusTone;
    subLabel?: string;
    ctaLabel?: string;
    onTap: () => void;
}

interface SeeAllCardProps {
    onTap: () => void;
}

const formatYen = (amount: number) =>
    new Intl.NumberFormat("ja-JP", {
        style: "currency",
        currency: "JPY",
        maximumFractionDigits: 0,
    }).format(amount);

export function MemberCard({
    mode,
    variant,
    name,
    amount,
    statusLabel,
    statusTone,
    subLabel,
    ctaLabel,
    onTap,
}: MemberCardProps) {
    const isSelf = variant === "self";
    const label = `${isSelf ? "自分" : name}、${mode === "reward" ? "報酬" : "立替"} ${formatYen(amount)}、${statusLabel}`;

    return (
        <button
            type="button"
            className={`${styles.card} ${isSelf ? styles.self : ""}`}
            onClick={onTap}
            aria-label={label}
        >
            <span className={styles.name} title={name}>
                {isSelf ? "自分" : name}
            </span>
            <span className={styles.amount}>{formatYen(amount)}</span>
            {subLabel && <span className={styles.subLabel}>{subLabel}</span>}
            <span className={`${styles.status} ${styles[statusTone]}`}>
                {statusLabel}
            </span>
            {ctaLabel && <span className={styles.cta}>{ctaLabel}</span>}
        </button>
    );
}

export function SeeAllCard({ onTap }: SeeAllCardProps) {
    return (
        <button
            type="button"
            className={`${styles.card} ${styles.seeAll}`}
            onClick={onTap}
            aria-label="全員を見る"
        >
            <span className={styles.seeAllMain}>全員を見る</span>
            <span className={styles.seeAllSub}>一覧へ</span>
        </button>
    );
}
