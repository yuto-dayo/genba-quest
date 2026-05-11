import { AnimatePresence, motion } from "framer-motion";
import { Bell } from "lucide-react";
import styles from "./FloatingBellButton.module.css";

interface FloatingBellButtonProps {
    enabled: boolean;
    needsAttention: boolean;
    badgeLabel: string | null;
    label: string;
    onOpen: () => void;
}

export function FloatingBellButton({
    enabled,
    needsAttention,
    badgeLabel,
    label,
    onOpen,
}: FloatingBellButtonProps) {
    return (
        <AnimatePresence>
            {enabled && (
                <motion.div
                    className={styles.bellContainer}
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    transition={{ type: "spring", stiffness: 460, damping: 22 }}
                >
                    <motion.button
                        type="button"
                        className={`${styles.bell} ${needsAttention ? styles.bellPending : ""}`}
                        onClick={onOpen}
                        aria-label={label}
                        title={label}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                    >
                        <motion.span
                            key={`bell-icon-${badgeLabel || "0"}`}
                            className={styles.bellIconWrap}
                            aria-hidden="true"
                            initial={false}
                            animate={
                                needsAttention
                                    ? { rotate: [0, -10, 10, -6, 6, -3, 3, 0] }
                                    : { rotate: 0 }
                            }
                            transition={{ duration: 0.7, ease: "easeInOut" }}
                        >
                            <Bell size={24} />
                        </motion.span>
                        {badgeLabel && (
                            <motion.span
                                key={`bell-badge-${badgeLabel}`}
                                className={styles.bellBadge}
                                initial={{ scale: 0.5, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                transition={{ type: "spring", stiffness: 540, damping: 18 }}
                            >
                                {badgeLabel}
                            </motion.span>
                        )}
                    </motion.button>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
