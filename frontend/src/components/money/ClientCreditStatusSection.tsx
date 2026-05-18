import { AlertCircle, Ban, CheckCircle2, Loader2, ShieldAlert } from "lucide-react";
import type { ClientCreditSummary, CreditTier } from "../../lib/api";
import styles from "./ClientCreditStatusSection.module.css";

interface ClientCreditStatusSectionProps {
    clients: ClientCreditSummary[];
    loading?: boolean;
    error?: string | null;
    onOpenClient: (client: ClientCreditSummary) => void;
}

interface TierConfig {
    tier: CreditTier;
    title: string;
    icon: string;
    tone: "warning" | "caution" | "healthy" | "blocked";
}

const TIERS: TierConfig[] = [
    { tier: "warning", title: "警戒", icon: "🔴", tone: "warning" },
    { tier: "caution", title: "注意", icon: "🟡", tone: "caution" },
    { tier: "healthy", title: "良好", icon: "🟢", tone: "healthy" },
    { tier: "blocked", title: "取引停止推奨", icon: "⚫", tone: "blocked" },
];

function formatYen(amount: number): string {
    return `¥${new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 0 }).format(amount)}`;
}

function formatDso(days: number | null): string {
    return days === null ? "算出外" : `${days.toFixed(days % 1 === 0 ? 0 : 1)}日`;
}

function tierIcon(tier: CreditTier) {
    switch (tier) {
        case "blocked":
            return <Ban size={16} aria-hidden />;
        case "warning":
            return <ShieldAlert size={16} aria-hidden />;
        case "caution":
            return <AlertCircle size={16} aria-hidden />;
        case "healthy":
            return <CheckCircle2 size={16} aria-hidden />;
    }
}

export function ClientCreditStatusSection({
    clients,
    loading,
    error,
    onOpenClient,
}: ClientCreditStatusSectionProps) {
    if (loading) {
        return (
            <section className={styles.root} aria-labelledby="client-credit-title">
                <div className={styles.header}>
                    <div>
                        <p className={styles.kicker}>与信状況</p>
                        <h3 id="client-credit-title" className={styles.title}>取引先の回収リスク</h3>
                    </div>
                </div>
                <div className={styles.state} role="status">
                    <Loader2 size={18} className={styles.spinIcon} aria-hidden />
                    与信状況を読み込み中
                </div>
            </section>
        );
    }

    if (error) {
        return (
            <section className={styles.root} aria-labelledby="client-credit-title">
                <div className={styles.header}>
                    <div>
                        <p className={styles.kicker}>与信状況</p>
                        <h3 id="client-credit-title" className={styles.title}>取引先の回収リスク</h3>
                    </div>
                </div>
                <div className={styles.error} role="alert">
                    <AlertCircle size={18} aria-hidden />
                    与信状況の取得に失敗: {error}
                </div>
            </section>
        );
    }

    return (
        <section className={styles.root} aria-labelledby="client-credit-title">
            <div className={styles.header}>
                <div>
                    <p className={styles.kicker}>与信状況</p>
                    <h3 id="client-credit-title" className={styles.title}>取引先の回収リスク</h3>
                </div>
                <span className={styles.count}>{clients.length}社</span>
            </div>

            <div className={styles.groups}>
                {TIERS.map((config) => {
                    const tierClients = clients.filter((client) => client.credit_tier === config.tier);
                    return (
                        <div key={config.tier} className={styles.group}>
                            <div className={styles.groupHead}>
                                <h4 className={`${styles.groupTitle} ${styles[config.tone]}`}>
                                    <span aria-hidden>{config.icon}</span>
                                    {config.title}
                                </h4>
                                <span>{tierClients.length}社</span>
                            </div>

                            {tierClients.length === 0 ? (
                                <div className={styles.empty}>該当なし</div>
                            ) : (
                                <div className={styles.cardGrid}>
                                    {tierClients.map((client) => (
                                        <button
                                            key={client.client_id}
                                            type="button"
                                            className={`${styles.card} ${styles[config.tone]}`}
                                            onClick={() => onOpenClient(client)}
                                            aria-label={`${client.client_name} の与信詳細を開く`}
                                        >
                                            <span className={styles.cardHead}>
                                                <span className={styles.clientName} title={client.client_name}>
                                                    {client.client_name}
                                                </span>
                                                <span className={styles.tierMark}>{tierIcon(client.credit_tier)}</span>
                                            </span>
                                            <span className={styles.metrics}>
                                                <span>
                                                    <b>{formatYen(client.accounts_receivable_balance)}</b>
                                                    <small>売掛残</small>
                                                </span>
                                                <span>
                                                    <b>{formatDso(client.dso_days)}</b>
                                                    <small>DSO</small>
                                                </span>
                                                <span>
                                                    <b>{client.overdue_count}件</b>
                                                    <small>延滞</small>
                                                </span>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
