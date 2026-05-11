import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CalendarClock, ChevronRight, Coins, Loader2 } from "lucide-react";
import {
    fetchActiveBillingRule,
    type ActiveBillingRulePreview,
    type Client,
} from "../lib/api";
import { describeClosing, describePayment, formatDateJa } from "../lib/billingRuleFormat";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./VendorCard.module.css";

interface VendorCardProps {
    client: Client;
    onClick?: () => void;
}

export function VendorCard({ client, onClick }: VendorCardProps) {
    const [preview, setPreview] = useState<ActiveBillingRulePreview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    // 各 VendorCard は key={client.id} で render されるので client.id は不変。
    // 初期 state (loading=true, error=false) を effect 内で再代入しない
    // (lint: react-hooks/set-state-in-effect — cascading render を避ける)
    useEffect(() => {
        let cancelled = false;
        fetchActiveBillingRule(client.id)
            .then((result) => {
                if (!cancelled) setPreview(result);
            })
            .catch(() => {
                if (!cancelled) setError(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [client.id]);

    const rule = preview?.rule ?? null;
    const next = preview?.next_period ?? null;

    return (
        <motion.button
            type="button"
            className={styles.card}
            onClick={onClick}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.spatialDefault}
            whileTap={{ scale: 0.985 }}
        >
            <div className={styles.head}>
                <div className={styles.headText}>
                    <span className={styles.name}>{client.name}</span>
                    {client.department && (
                        <span className={styles.dept}>{client.department}</span>
                    )}
                </div>
                <ChevronRight size={18} className={styles.chevron} aria-hidden />
            </div>

            <div className={styles.body}>
                {loading ? (
                    <span className={styles.muted}>
                        <Loader2 size={14} className={styles.spin} aria-hidden /> 締めルール確認中
                    </span>
                ) : error ? (
                    <span className={styles.muted}>ルール取得失敗</span>
                ) : rule ? (
                    <>
                        <span className={styles.rulePill}>
                            <CalendarClock size={13} aria-hidden />
                            {describeClosing(rule)}・{describePayment(rule)}
                        </span>
                        {next && (
                            <div className={styles.previewRow}>
                                <span className={styles.previewItem}>
                                    <span className={styles.previewLabel}>次の締め</span>
                                    <strong>{formatDateJa(next.period_end)}</strong>
                                </span>
                                <span className={styles.previewItem}>
                                    <Coins size={13} aria-hidden className={styles.previewIcon} />
                                    <span className={styles.previewLabel}>入金</span>
                                    <strong>{formatDateJa(next.payment_due_date)}</strong>
                                </span>
                            </div>
                        )}
                    </>
                ) : (
                    <span className={styles.unset}>
                        締めルール未設定 — 取引先設定から登録
                    </span>
                )}
            </div>
        </motion.button>
    );
}
