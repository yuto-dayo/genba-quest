/**
 * Framer Motion + M3 Expressive モーショントークン
 *
 * Calm Cockpit を保ちつつお金の重みを出すための共通トークン。
 * 詳細: design-system/mocks/money-redesign-v3.3.html + memory project_motion_design_playbook
 *
 * 鉄則:
 * - 数値・カードなど「お金の重み」を持つ要素は spatialSlow 寄りで余韻
 * - タブ下線・チップトグルは spatialFast で即応
 * - 色/不透明は spring を使わず emphasized easing 240ms
 * - prefers-reduced-motion 対応は <MotionConfig reducedMotion="user"> で全体適用
 */

import type { Transition } from "framer-motion";

export const motion = {
    /** タブ下線・チップ・スイッチなど小要素の位置 */
    spatialFast: { type: "spring", stiffness: 600, damping: 40, mass: 1 } as Transition,

    /** カード・リスト挿入・モーダル */
    spatialDefault: { type: "spring", stiffness: 300, damping: 30, mass: 1 } as Transition,

    /** ヒーロー数値・全画面遷移 */
    spatialSlow: { type: "spring", stiffness: 120, damping: 20, mass: 1 } as Transition,

    /** opacity / color 変化 */
    effects: { duration: 0.24, ease: [0.2, 0, 0, 1] } as Transition,

    /** 強調遷移（ヒーロー赤字色フェード等） */
    emphasized: { duration: 0.42, ease: [0.2, 0, 0, 1] } as Transition,
} as const;

/**
 * stagger 用ヘルパー。60-80ms が「重み」と「テンポ」の両立点
 * (memory project_motion_design_playbook 参照)
 */
export const staggerStep = {
    list: 0.06,
    bars: 0.06,
    fabMenu: 0.05,
} as const;
