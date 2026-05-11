import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./MoneyTabs.module.css";

export type MoneyTab = "transactions" | "vendors";

interface MoneyTabsProps {
    value: MoneyTab;
    onChange: (tab: MoneyTab) => void;
    txCount?: number;
    vendorCount?: number;
    /** Optional trailing content rendered on the right (filter / search icon buttons). */
    trailing?: ReactNode;
}

const TABS: Array<{ id: MoneyTab; label: string }> = [
    { id: "transactions", label: "取引" },
    { id: "vendors", label: "取引先" },
];

export function MoneyTabs({ value, onChange, txCount, vendorCount, trailing }: MoneyTabsProps) {
    return (
        <div className={styles.tabs} role="tablist" aria-label="Moneyビュー切替">
            {TABS.map(({ id, label }) => {
                const isActive = value === id;
                const count = id === "transactions" ? txCount : vendorCount;
                return (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className={`${styles.tab} ${isActive ? styles.tabActive : ""}`}
                        onClick={() => onChange(id)}
                    >
                        <span className={styles.label}>{label}</span>
                        {typeof count === "number" && (
                            <span className={styles.badge}>{count}</span>
                        )}
                        {isActive && (
                            <motion.span
                                layoutId="moneyTabUnderline"
                                className={styles.underline}
                                transition={motionTokens.spatialFast}
                                aria-hidden
                            />
                        )}
                    </button>
                );
            })}
            {trailing && <div className={styles.trailing}>{trailing}</div>}
        </div>
    );
}
