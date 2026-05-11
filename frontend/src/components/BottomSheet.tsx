/**
 * BottomSheet (PR #11) — 共通ボトムシート wrapper.
 *
 * 仕様 (v3.3 mock 準拠):
 *   - 下方向ドラッグ で閉じる: 30% 超 or 速度 500px/s 超
 *   - 背景 dim は drag 量に同期 (0.45 → 0)
 *   - Escape キー / overlay tap でも閉じる
 *   - drag handle (ハンドル) を上部に表示
 *
 * children には自由に header / form / footer を入れて使う。
 * MoneyFilterSheet の drag 実装をベースに、ExpenseModal/SalesModal/InvoiceModal
 * など登録系シートで再利用できるよう汎用化。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
    AnimatePresence,
    motion,
    useMotionValue,
    useTransform,
    type PanInfo,
} from "framer-motion";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./BottomSheet.module.css";

const BACKDROP_MAX = 0.45;
const DISMISS_HEIGHT_RATIO = 0.3;
const DISMISS_VELOCITY = 500;

interface BottomSheetProps {
    open: boolean;
    onClose: () => void;
    ariaLabel: string;
    children: ReactNode;
}

export function BottomSheet({ open, onClose, ariaLabel, children }: BottomSheetProps) {
    const y = useMotionValue(0);
    const sheetRef = useRef<HTMLElement>(null);
    const [sheetHeight, setSheetHeight] = useState(600);

    const overlayOpacity = useTransform(y, [0, sheetHeight], [BACKDROP_MAX, 0]);

    useEffect(() => {
        if (open) y.set(0);
    }, [open, y]);

    useEffect(() => {
        if (!open || !sheetRef.current) return;
        const h = sheetRef.current.offsetHeight;
        if (h > 0) setSheetHeight(h);
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
        const threshold = sheetHeight * DISMISS_HEIGHT_RATIO;
        if (info.offset.y > threshold || info.velocity.y > DISMISS_VELOCITY) {
            onClose();
        } else {
            y.set(0);
        }
    }

    return (
        <AnimatePresence>
            {open && (
                <motion.div
                    key="bs-overlay"
                    className={styles.overlay}
                    style={{ opacity: overlayOpacity }}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: BACKDROP_MAX }}
                    exit={{ opacity: 0 }}
                    transition={motionTokens.effects}
                    onClick={onClose}
                    aria-hidden
                />
            )}
            {open && (
                <motion.section
                    key="bs-sheet"
                    ref={sheetRef}
                    className={styles.sheet}
                    role="dialog"
                    aria-modal="true"
                    aria-label={ariaLabel}
                    initial={{ y: "100%" }}
                    animate={{ y: "0%" }}
                    exit={{ y: "100%" }}
                    transition={motionTokens.spatialDefault}
                    drag="y"
                    dragConstraints={{ top: 0, bottom: 0 }}
                    dragElastic={{ top: 0, bottom: 0.2 }}
                    onDragEnd={handleDragEnd}
                    style={{ y }}
                >
                    <div className={styles.handleArea} aria-hidden>
                        <div className={styles.handle} />
                    </div>
                    <div className={styles.body}>{children}</div>
                </motion.section>
            )}
        </AnimatePresence>
    );
}
