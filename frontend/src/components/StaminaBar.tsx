import { motion } from "framer-motion";
import styles from "./StaminaBar.module.css";

interface StaminaBarProps {
    value: number;
    max?: number;
    showLabel?: boolean;
    size?: "sm" | "md" | "lg";
}

export function StaminaBar({
    value,
    max = 100,
    showLabel = true,
    size = "md"
}: StaminaBarProps) {
    const percentage = Math.min(100, Math.max(0, (value / max) * 100));

    const getStatus = () => {
        if (percentage > 60) return "good";
        if (percentage > 30) return "warning";
        return "critical";
    };

    const status = getStatus();

    return (
        <div className={`${styles.container} ${styles[size]}`}>
            <div className={styles.bar}>
                <motion.div
                    className={`${styles.fill} ${styles[status]}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                />
            </div>
            {showLabel && (
                <span className={`${styles.label} ${styles[status]}`}>
                    {Math.round(value)}%
                </span>
            )}
        </div>
    );
}
