import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Plus, X } from "lucide-react";
import styles from "./FloatingActionButton.module.css";

// --- SherpaFAB (simple single-action FAB) ---

interface SherpaFABProps {
    onClick: () => void;
}

export function SherpaFAB({ onClick }: SherpaFABProps) {
    return (
        <div className={styles.fabContainer}>
            <motion.button
                className={styles.fab}
                onClick={onClick}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                aria-label="シェルパを開く"
            >
                <Bot size={28} />
            </motion.button>
        </div>
    );
}

// --- FloatingActionButton (expandable menu FAB) ---

export interface FabMenuItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
}

interface FloatingActionButtonProps {
    items: FabMenuItem[];
}

export function FloatingActionButton({ items }: FloatingActionButtonProps) {
    const [open, setOpen] = useState(false);

    return (
        <div className={styles.fabContainer}>
            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            className={styles.fabOverlay}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => setOpen(false)}
                        />
                        <div className={styles.fabMenu}>
                            {items.map((item, i) => (
                                <motion.button
                                    key={item.id}
                                    className={styles.fabMenuItem}
                                    initial={{ opacity: 0, y: 10, scale: 0.8 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.8 }}
                                    transition={{ delay: i * 0.05 }}
                                    onClick={() => {
                                        item.onClick();
                                        setOpen(false);
                                    }}
                                >
                                    <span className={styles.fabMenuLabel}>{item.label}</span>
                                    <span className={styles.fabMenuIcon}>{item.icon}</span>
                                </motion.button>
                            ))}
                        </div>
                    </>
                )}
            </AnimatePresence>
            <motion.button
                className={styles.fab}
                onClick={() => setOpen(!open)}
                whileTap={{ scale: 0.95 }}
                animate={{ rotate: open ? 45 : 0 }}
                aria-label={open ? "メニューを閉じる" : "メニューを開く"}
            >
                {open ? <X size={28} /> : <Plus size={28} />}
            </motion.button>
        </div>
    );
}
