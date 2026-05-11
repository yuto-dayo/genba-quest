import { motion } from "framer-motion";
import { Receipt, Users } from "lucide-react";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./MoneyTabs.module.css";

export type MoneyTab = "transactions" | "vendors";

interface MoneyTabsProps {
    value: MoneyTab;
    onChange: (tab: MoneyTab) => void;
    txCount?: number;
    vendorCount?: number;
}

const TABS: Array<{ id: MoneyTab; label: string; Icon: typeof Receipt }> = [
    { id: "transactions", label: "取引", Icon: Receipt },
    { id: "vendors", label: "取引先", Icon: Users },
];

export function MoneyTabs({ value, onChange, txCount, vendorCount }: MoneyTabsProps) {
    return (
        <div className={styles.tabs} role="tablist" aria-label="Moneyビュー切替">
            {TABS.map(({ id, label, Icon }) => {
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
                        <span className={styles.tabContent}>
                            <Icon size={16} aria-hidden />
                            <span>{label}</span>
                            {typeof count === "number" && (
                                <span className={styles.tabCount}>{count}</span>
                            )}
                        </span>
                        {isActive && (
                            <motion.span
                                layoutId="moneyTabIndicator"
                                className={styles.indicator}
                                transition={motionTokens.spatialFast}
                                aria-hidden
                            />
                        )}
                    </button>
                );
            })}
        </div>
    );
}
