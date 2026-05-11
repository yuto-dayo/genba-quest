import { useEffect } from "react";
import {
    AnimatePresence,
    motion,
    useMotionValue,
    useTransform,
    type PanInfo,
} from "framer-motion";
import { Calendar, X } from "lucide-react";
import { motion as motionTokens } from "../lib/motion/tokens";
import styles from "./MoneyFilterSheet.module.css";

export type FilterKind = "all" | "expense" | "sale" | "invoice";
export type DatePreset = "all" | "thisMonth" | "lastMonth" | "custom";

export interface MoneyFilters {
    kind: FilterKind;
    datePreset: DatePreset;
    dateFrom: string;
    dateTo: string;
    query: string;
}

interface MoneyFilterSheetProps {
    open: boolean;
    onClose: () => void;
    filters: MoneyFilters;
    onFiltersChange: (next: MoneyFilters) => void;
}

const KIND_OPTIONS: Array<{ value: FilterKind; label: string }> = [
    { value: "all", label: "全て" },
    { value: "expense", label: "経費" },
    { value: "sale", label: "売上" },
    { value: "invoice", label: "請求" },
];

const DATE_OPTIONS: Array<{ value: DatePreset; label: string }> = [
    { value: "all", label: "全期間" },
    { value: "thisMonth", label: "今月" },
    { value: "lastMonth", label: "先月" },
    { value: "custom", label: "指定" },
];

const DISMISS_OFFSET = 120;
const DISMISS_VELOCITY = 500;

export function MoneyFilterSheet({
    open,
    onClose,
    filters,
    onFiltersChange,
}: MoneyFilterSheetProps) {
    const y = useMotionValue(0);
    // 背景 dim を drag に追従させる: 0px→0.42, DISMISS_OFFSET→0
    const overlayOpacity = useTransform(y, [0, DISMISS_OFFSET], [0.42, 0]);

    useEffect(() => {
        if (open) y.set(0);
    }, [open, y]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [open, onClose]);

    function handleDragEnd(_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) {
        if (info.offset.y > DISMISS_OFFSET || info.velocity.y > DISMISS_VELOCITY) {
            onClose();
        } else {
            y.set(0);
        }
    }

    function setKind(kind: FilterKind) {
        onFiltersChange({ ...filters, kind });
    }

    function setDatePreset(preset: DatePreset) {
        if (preset === "custom") {
            onFiltersChange({ ...filters, datePreset: preset });
        } else {
            onFiltersChange({
                ...filters,
                datePreset: preset,
                dateFrom: preset === "all" ? "" : filters.dateFrom,
                dateTo: preset === "all" ? "" : filters.dateTo,
            });
        }
    }

    function clearAll() {
        onFiltersChange({
            kind: "all",
            datePreset: "all",
            dateFrom: "",
            dateTo: "",
            query: filters.query,
        });
    }

    const hasAny =
        filters.kind !== "all" || filters.datePreset !== "all" || filters.query !== "";

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        className={styles.overlay}
                        style={{ opacity: overlayOpacity }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 0.42 }}
                        exit={{ opacity: 0 }}
                        transition={motionTokens.effects}
                        onClick={onClose}
                        aria-hidden
                    />
                    <motion.section
                        className={styles.sheet}
                        role="dialog"
                        aria-modal="true"
                        aria-label="取引フィルタ"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={motionTokens.spatialDefault}
                        drag="y"
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.6 }}
                        onDragEnd={handleDragEnd}
                        style={{ y }}
                    >
                        <div className={styles.handleArea}>
                            <div className={styles.handle} aria-hidden />
                        </div>

                        <header className={styles.header}>
                            <h2 className={styles.title}>フィルタ</h2>
                            <button
                                type="button"
                                className={styles.closeBtn}
                                onClick={onClose}
                                aria-label="閉じる"
                            >
                                <X size={18} />
                            </button>
                        </header>

                        <div className={styles.body}>
                            <section className={styles.group}>
                                <h3 className={styles.groupLabel}>種別</h3>
                                <div className={styles.chipRow}>
                                    {KIND_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            className={`${styles.chip} ${
                                                filters.kind === opt.value ? styles.chipActive : ""
                                            }`}
                                            onClick={() => setKind(opt.value)}
                                            aria-pressed={filters.kind === opt.value}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <section className={styles.group}>
                                <h3 className={styles.groupLabel}>
                                    <Calendar size={14} aria-hidden /> 期間
                                </h3>
                                <div className={styles.chipRow}>
                                    {DATE_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            className={`${styles.chip} ${
                                                filters.datePreset === opt.value ? styles.chipActive : ""
                                            }`}
                                            onClick={() => setDatePreset(opt.value)}
                                            aria-pressed={filters.datePreset === opt.value}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                {filters.datePreset === "custom" && (
                                    <div className={styles.dateInputs}>
                                        <label className={styles.dateField}>
                                            <span>開始</span>
                                            <input
                                                type="date"
                                                value={filters.dateFrom}
                                                max={filters.dateTo || undefined}
                                                onChange={(e) =>
                                                    onFiltersChange({
                                                        ...filters,
                                                        datePreset: "custom",
                                                        dateFrom: e.target.value,
                                                    })
                                                }
                                            />
                                        </label>
                                        <label className={styles.dateField}>
                                            <span>終了</span>
                                            <input
                                                type="date"
                                                value={filters.dateTo}
                                                min={filters.dateFrom || undefined}
                                                onChange={(e) =>
                                                    onFiltersChange({
                                                        ...filters,
                                                        datePreset: "custom",
                                                        dateTo: e.target.value,
                                                    })
                                                }
                                            />
                                        </label>
                                    </div>
                                )}
                            </section>
                        </div>

                        <footer className={styles.footer}>
                            <button
                                type="button"
                                className={styles.clearBtn}
                                onClick={clearAll}
                                disabled={!hasAny}
                            >
                                クリア
                            </button>
                            <button
                                type="button"
                                className={styles.applyBtn}
                                onClick={onClose}
                            >
                                適用
                            </button>
                        </footer>
                    </motion.section>
                </>
            )}
        </AnimatePresence>
    );
}
