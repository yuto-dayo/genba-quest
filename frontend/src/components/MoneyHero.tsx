import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { AnimatedYen } from "./AnimatedYen";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./MoneyHero.module.css";

interface MoneyHeroProps {
    profit: number;
    sales: number;
    expenses: number;
    monthLabel: string;
    onPrevMonth: () => void;
    onNextMonth: () => void;
    disabled?: boolean;
}

/**
 * Money ページの新ヒーロー。
 *
 * 設計:
 * - 利益（手残り）を最大文字、売上/経費を補助表示
 * - 赤字時は背景グラデを紫→赤にクロスフェード（位置・サイズは不変）
 * - 数値は spring カウントアップ
 * - 月切替は控えめなピル型
 */
export function MoneyHero({
    profit,
    sales,
    expenses,
    monthLabel,
    onPrevMonth,
    onNextMonth,
    disabled = false,
}: MoneyHeroProps) {
    const isLoss = profit < 0;

    return (
        <motion.section
            className={styles.hero}
            data-mode={isLoss ? "loss" : "profit"}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={motionTokens.spatialDefault}
        >
            <motion.div
                className={`${styles.bg} ${styles.bgProfit}`}
                animate={{ opacity: isLoss ? 0 : 1 }}
                transition={motionTokens.emphasized}
                aria-hidden="true"
            />
            <motion.div
                className={`${styles.bg} ${styles.bgLoss}`}
                animate={{ opacity: isLoss ? 1 : 0 }}
                transition={motionTokens.emphasized}
                aria-hidden="true"
            />

            <div className={styles.row}>
                <div className={styles.monthPill} aria-label="表示月">
                    <button
                        type="button"
                        className={styles.monthBtn}
                        onClick={onPrevMonth}
                        disabled={disabled}
                        aria-label="前月"
                    >
                        <ChevronLeft size={14} />
                    </button>
                    <span className={styles.monthLabel}>{monthLabel}</span>
                    <button
                        type="button"
                        className={styles.monthBtn}
                        onClick={onNextMonth}
                        disabled={disabled}
                        aria-label="翌月"
                    >
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            <AnimatedYen value={profit} className={styles.profitNum} />
            <div className={styles.profitCap}>{isLoss ? "赤字（手残りマイナス）" : "利益（手残り）"}</div>

            <div className={styles.breakdown}>
                <div className={styles.pair}>
                    <span className={styles.pairLabel}>売上</span>
                    <AnimatedYen value={sales} className={styles.pairValue} />
                </div>
                <div className={styles.pair}>
                    <span className={styles.pairLabel}>経費</span>
                    <AnimatedYen value={expenses} className={styles.pairValue} />
                </div>
            </div>
        </motion.section>
    );
}
