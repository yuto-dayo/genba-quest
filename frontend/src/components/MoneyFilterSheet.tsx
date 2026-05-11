import { useEffect, useRef, useState } from "react";
import {
    AnimatePresence,
    motion,
    useMotionValue,
    useTransform,
    type PanInfo,
} from "framer-motion";
import { X } from "lucide-react";
import { motion as motionTokens } from "../lib/motion/tokens";
import type { Client } from "../lib/api";
import styles from "./MoneyFilterSheet.module.css";

export type FilterKind = "all" | "expense" | "sale" | "invoice";
export type DatePreset = "all" | "thisMonth" | "lastMonth" | "custom";
export type ExpenseCategory =
    | "material"
    | "tool"
    | "travel"
    | "food"
    | "fuel"
    | "utility"
    | "other";

export interface MoneyFilters {
    kind: FilterKind;
    datePreset: DatePreset;
    dateFrom: string;
    dateTo: string;
    query: string;
    clientId: string | null;
    category: ExpenseCategory | null;
}

interface MoneyFilterSheetProps {
    open: boolean;
    onClose: () => void;
    filters: MoneyFilters;
    onFiltersChange: (next: MoneyFilters) => void;
    clients: Client[] | null;
    /** Number of transactions matching the current filters — shown in the apply button. */
    matchedCount?: number;
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

const CATEGORY_OPTIONS: Array<{ value: ExpenseCategory; label: string }> = [
    { value: "material", label: "仕入れ" },
    { value: "tool", label: "工具" },
    { value: "travel", label: "駐車代" },
    { value: "fuel", label: "ガソリン" },
    { value: "food", label: "食事" },
    { value: "utility", label: "光熱通信" },
    { value: "other", label: "その他" },
];

const VENDOR_VISIBLE_LIMIT = 5;
const DISMISS_HEIGHT_RATIO = 0.3;
const DISMISS_VELOCITY = 500;
const BACKDROP_MAX = 0.45;

export function MoneyFilterSheet({
    open,
    onClose,
    filters,
    onFiltersChange,
    clients,
    matchedCount,
}: MoneyFilterSheetProps) {
    const y = useMotionValue(0);
    const sheetRef = useRef<HTMLElement>(null);
    const [sheetHeight, setSheetHeight] = useState(600);
    const [showAllVendors, setShowAllVendors] = useState(false);

    // 背景 dim を drag に比例 (mock spec: 0.45 * (1 - dy/h))
    const overlayOpacity = useTransform(y, [0, sheetHeight], [BACKDROP_MAX, 0]);

    useEffect(() => {
        if (open) y.set(0);
    }, [open, y]);

    // シート高さを実測 — dismiss 閾値 & 背景 dim 比率に使う
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

    function setKind(kind: FilterKind) {
        onFiltersChange({ ...filters, kind });
    }

    function setDatePreset(preset: DatePreset) {
        onFiltersChange({
            ...filters,
            datePreset: preset,
            dateFrom: preset === "all" ? "" : filters.dateFrom,
            dateTo: preset === "all" ? "" : filters.dateTo,
        });
    }

    function toggleClient(id: string) {
        onFiltersChange({
            ...filters,
            clientId: filters.clientId === id ? null : id,
        });
    }

    function toggleCategory(cat: ExpenseCategory) {
        onFiltersChange({
            ...filters,
            category: filters.category === cat ? null : cat,
        });
    }

    function clearAll() {
        onFiltersChange({
            kind: "all",
            datePreset: "all",
            dateFrom: "",
            dateTo: "",
            query: filters.query,
            clientId: null,
            category: null,
        });
    }

    const hasAny =
        filters.kind !== "all" ||
        filters.datePreset !== "all" ||
        filters.query !== "" ||
        filters.clientId !== null ||
        filters.category !== null;

    const visibleClients = clients
        ? showAllVendors
            ? clients
            : clients.slice(0, VENDOR_VISIBLE_LIMIT)
        : [];
    const hiddenVendorCount = clients
        ? Math.max(0, clients.length - VENDOR_VISIBLE_LIMIT)
        : 0;

    return (
        <AnimatePresence>
            {open && (
                <>
                    <motion.div
                        className={styles.overlay}
                        style={{ opacity: overlayOpacity }}
                        initial={{ opacity: 0 }}
                        animate={{ opacity: BACKDROP_MAX }}
                        exit={{ opacity: 0 }}
                        transition={motionTokens.effects}
                        onClick={onClose}
                        aria-hidden
                    />
                    <motion.section
                        ref={sheetRef}
                        className={styles.sheet}
                        role="dialog"
                        aria-modal="true"
                        aria-label="絞り込み"
                        initial={{ y: "100%" }}
                        animate={{ y: 0 }}
                        exit={{ y: "100%" }}
                        transition={motionTokens.spatialDefault}
                        drag="y"
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={{ top: 0, bottom: 0.2 }}
                        onDragEnd={handleDragEnd}
                        style={{ y }}
                    >
                        <div className={styles.handleArea}>
                            <div className={styles.handle} aria-hidden />
                        </div>

                        <header className={styles.header}>
                            <div className={styles.headerText}>
                                <h2 className={styles.title}>絞り込み</h2>
                                <p className={styles.sub}>ハンドル下方向にドラッグで閉じる</p>
                            </div>
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

                            {clients && clients.length > 0 && (
                                <section className={styles.group}>
                                    <h3 className={styles.groupLabel}>取引先</h3>
                                    <div className={styles.chipRow}>
                                        {visibleClients.map((c) => (
                                            <button
                                                key={c.id}
                                                type="button"
                                                className={`${styles.chip} ${
                                                    filters.clientId === c.id ? styles.chipActive : ""
                                                }`}
                                                onClick={() => toggleClient(c.id)}
                                                aria-pressed={filters.clientId === c.id}
                                            >
                                                {c.name}
                                            </button>
                                        ))}
                                        {!showAllVendors && hiddenVendorCount > 0 && (
                                            <button
                                                type="button"
                                                className={styles.chipMore}
                                                onClick={() => setShowAllVendors(true)}
                                            >
                                                + {hiddenVendorCount}社
                                            </button>
                                        )}
                                    </div>
                                </section>
                            )}

                            <section className={styles.group}>
                                <h3 className={styles.groupLabel}>カテゴリ</h3>
                                <div className={styles.chipRow}>
                                    {CATEGORY_OPTIONS.map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            className={`${styles.chip} ${
                                                filters.category === opt.value ? styles.chipActive : ""
                                            }`}
                                            onClick={() => toggleCategory(opt.value)}
                                            aria-pressed={filters.category === opt.value}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            <section className={styles.group}>
                                <h3 className={styles.groupLabel}>期間</h3>
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
                                適用{typeof matchedCount === "number" ? ` (${matchedCount}件)` : ""}
                            </button>
                        </footer>
                    </motion.section>
                </>
            )}
        </AnimatePresence>
    );
}
