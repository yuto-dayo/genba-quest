import { useEffect, useMemo } from "react";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";

const yenFmt = new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
});

interface AnimatedYenProps {
    value: number;
    /** 文字色を value の符号で切り替える場合に使用 (省略時は親が指定) */
    negativeClassName?: string;
    positiveClassName?: string;
    className?: string;
    /** spring 設定をカスタマイズしたい場合 (デフォルトは spatialSlow 相当) */
    stiffness?: number;
    damping?: number;
}

/**
 * spring 物理で 0 → value にカウントアップする ¥ 表示。
 *
 * 実装ポイント:
 * - motion.span のテキストノードを useTransform で直接書き換え (React 再レンダリング回避)
 * - restDelta を value の桁数に応じて広げ、桁が大きくても 600-900ms で着地
 * - prefers-reduced-motion なら即値表示
 * - value 変更時は再アニメ
 */
export function AnimatedYen({
    value,
    negativeClassName,
    positiveClassName,
    className,
    stiffness = 120,
    damping = 20,
}: AnimatedYenProps) {
    const reduce = useReducedMotion();
    const mv = useMotionValue(0);
    const text = useTransform(mv, (v) => yenFmt.format(Math.round(v)));

    useEffect(() => {
        if (reduce) {
            mv.set(value);
            return;
        }
        const restDelta = Math.max(1, Math.abs(value) * 0.0005);
        const controls = animate(mv, value, {
            type: "spring",
            stiffness,
            damping,
            mass: 1,
            restDelta,
        });
        return () => controls.stop();
    }, [value, reduce, mv, stiffness, damping]);

    const computedClassName = useMemo(() => {
        const classes = [className];
        if (value < 0 && negativeClassName) classes.push(negativeClassName);
        if (value >= 0 && positiveClassName) classes.push(positiveClassName);
        return classes.filter(Boolean).join(" ");
    }, [value, className, negativeClassName, positiveClassName]);

    return <motion.span className={computedClassName}>{text}</motion.span>;
}
