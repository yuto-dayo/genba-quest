import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import styles from "./FloatingActionButton.module.css";

type DockSide = "left" | "right";

const FAB_DRAG_THRESHOLD = 6;
const FAB_EDGE_THRESHOLD = 8;
const FAB_MARGIN_X = 8;
// 92px = 76px(底タブバー) + 16px(余白) — タブバー右端の🔔チップを物理的に隠さないため
const FAB_MARGIN_BOTTOM = 92;
const FAB_MIN_TOP = 88;
const FAB_SIZE = 56;
const FAB_LABELED_WIDTH = 92;
const FAB_STASHED_WIDTH = 40;
const FAB_DOCKED_VISIBLE_WIDTH = 26;
const FAB_PROJECTION_DECELERATION_RATE = 0.998;

function getProjectedDistance(velocity: number, decelerationRate = FAB_PROJECTION_DECELERATION_RATE) {
    return (velocity / 1000) * decelerationRate / (1 - decelerationRate);
}

function getFabDockedHiddenX(dockSide: DockSide, buttonWidth: number, viewportWidth: number) {
    return dockSide === "left"
        ? FAB_DOCKED_VISIBLE_WIDTH - buttonWidth
        : viewportWidth - FAB_DOCKED_VISIBLE_WIDTH;
}

function clampFabPosition(x: number, y: number, width: number, height: number) {
    const minX = FAB_MARGIN_X;
    const maxX = Math.max(FAB_MARGIN_X, window.innerWidth - width - FAB_MARGIN_X);
    const minY = FAB_MIN_TOP;
    const maxY = Math.max(FAB_MIN_TOP, window.innerHeight - height - FAB_MARGIN_BOTTOM);

    return {
        x: Math.min(Math.max(x, minX), maxX),
        y: Math.min(Math.max(y, minY), maxY),
    };
}

function getDockSide(x: number, width: number, viewportWidth: number): DockSide | null {
    if (x <= FAB_EDGE_THRESHOLD) {
        return "left";
    }

    if (x + width >= viewportWidth - FAB_EDGE_THRESHOLD) {
        return "right";
    }

    return null;
}

function useIsMobileViewport() {
    const [isMobile, setIsMobile] = useState(false);

    useEffect(() => {
        const checkViewport = () => {
            setIsMobile(window.innerWidth <= 768 || "ontouchstart" in window);
        };

        checkViewport();
        window.addEventListener("resize", checkViewport);
        return () => window.removeEventListener("resize", checkViewport);
    }, []);

    return isMobile;
}

function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

    useEffect(() => {
        if (!window.matchMedia) {
            return;
        }

        const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
        const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);

        updatePreference();
        mediaQuery.addEventListener("change", updatePreference);
        return () => mediaQuery.removeEventListener("change", updatePreference);
    }, []);

    return prefersReducedMotion;
}

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

export interface FabMenuItem {
    id: string;
    label: string;
    icon: ReactNode;
    onClick: () => void;
}

interface FloatingActionButtonProps {
    items: FabMenuItem[];
    behavior?: "fixed" | "draggable";
    hideOnDesktop?: boolean;
    buttonLabel?: string;
    openLabel?: string;
    closeLabel?: string;
}

export function FloatingActionButton({
    items,
    behavior = "fixed",
    hideOnDesktop = false,
    buttonLabel,
    openLabel = "メニューを開く",
    closeLabel = "メニューを閉じる",
}: FloatingActionButtonProps) {
    const isMobile = useIsMobileViewport();
    const supportsDragging = behavior === "draggable" && isMobile;
    const prefersReducedMotion = usePrefersReducedMotion();
    const fabWidth = buttonLabel ? FAB_LABELED_WIDTH : FAB_SIZE;
    const [open, setOpen] = useState(false);
    const [fabPosition, setFabPosition] = useState<{ x: number; y: number } | null>(null);
    const [fabDockSide, setFabDockSide] = useState<DockSide | null>(null);
    const [fabDragging, setFabDragging] = useState(false);
    const fabRef = useRef<HTMLButtonElement | null>(null);
    const fabDragRef = useRef({
        pointerId: -1,
        startX: 0,
        startY: 0,
        originX: 0,
        originY: 0,
        moved: false,
        suppressClick: false,
        lastX: 0,
        lastY: 0,
        lastTime: 0,
        velocityX: 0,
        velocityY: 0,
    });

    const stashFabToDock = useCallback((dockSide: DockSide, y: number) => {
        setFabDockSide(dockSide);
        setFabPosition({
            x: getFabDockedHiddenX(dockSide, FAB_STASHED_WIDTH, window.innerWidth),
            y: clampFabPosition(0, y, FAB_STASHED_WIDTH, FAB_SIZE).y,
        });
    }, []);

    const closeMenu = useCallback(() => {
        setOpen(false);

        if (supportsDragging && fabDockSide) {
            stashFabToDock(fabDockSide, fabPosition?.y ?? FAB_MIN_TOP);
        }
    }, [fabDockSide, fabPosition?.y, stashFabToDock, supportsDragging]);

    useEffect(() => {
        if (!supportsDragging) {
            const rafId = window.requestAnimationFrame(() => {
                setFabPosition(null);
                setFabDockSide(null);
                setFabDragging(false);
            });
            return () => window.cancelAnimationFrame(rafId);
        }

        const updateFabBounds = () => {
            const fabEl = fabRef.current;
            if (!fabEl) {
                return;
            }

            const rect = fabEl.getBoundingClientRect();
            const width = fabDockSide ? FAB_STASHED_WIDTH : rect.width || fabWidth;
            const height = rect.height || FAB_SIZE;

            setFabPosition((prev) => {
                if (!prev) {
                    return clampFabPosition(
                        window.innerWidth - width - FAB_MARGIN_X,
                        window.innerHeight - height - FAB_MARGIN_BOTTOM,
                        width,
                        height
                    );
                }

                if (fabDockSide) {
                    return {
                        x: getFabDockedHiddenX(fabDockSide, width, window.innerWidth),
                        y: clampFabPosition(prev.y, prev.y, width, height).y,
                    };
                }

                return clampFabPosition(prev.x, prev.y, width, height);
            });
        };

        const rafId = window.requestAnimationFrame(updateFabBounds);
        window.addEventListener("resize", updateFabBounds);

        return () => {
            window.cancelAnimationFrame(rafId);
            window.removeEventListener("resize", updateFabBounds);
        };
    }, [fabDockSide, fabWidth, supportsDragging]);

    if (hideOnDesktop && !isMobile) {
        return null;
    }

    const handleFabPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!supportsDragging || open) {
            return;
        }

        const currentTarget = event.currentTarget;
        const rect = currentTarget.getBoundingClientRect();
        const origin = fabPosition ?? { x: rect.left, y: rect.top };

        currentTarget.setPointerCapture(event.pointerId);
        fabDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: origin.x,
            originY: origin.y,
            moved: false,
            suppressClick: false,
            lastX: event.clientX,
            lastY: event.clientY,
            lastTime: event.timeStamp,
            velocityX: 0,
            velocityY: 0,
        };
    };

    const handleFabPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!supportsDragging || fabDragRef.current.pointerId !== event.pointerId) {
            return;
        }

        const deltaX = event.clientX - fabDragRef.current.startX;
        const deltaY = event.clientY - fabDragRef.current.startY;
        const distance = Math.hypot(deltaX, deltaY);

        if (!fabDragRef.current.moved && distance < FAB_DRAG_THRESHOLD) {
            return;
        }

        const fabEl = fabRef.current;
        if (!fabEl) {
            return;
        }

        if (!fabDragRef.current.moved) {
            fabDragRef.current.moved = true;
            fabDragRef.current.suppressClick = true;
            setFabDragging(true);
        }

        const rect = fabEl.getBoundingClientRect();
        const width = rect.width || fabWidth;
        const height = rect.height || FAB_SIZE;
        const elapsed = Math.max(event.timeStamp - fabDragRef.current.lastTime, 1);
        fabDragRef.current.velocityX = ((event.clientX - fabDragRef.current.lastX) / elapsed) * 1000;
        fabDragRef.current.velocityY = ((event.clientY - fabDragRef.current.lastY) / elapsed) * 1000;
        fabDragRef.current.lastX = event.clientX;
        fabDragRef.current.lastY = event.clientY;
        fabDragRef.current.lastTime = event.timeStamp;

        setFabPosition(
            clampFabPosition(
                fabDragRef.current.originX + deltaX,
                fabDragRef.current.originY + deltaY,
                width,
                height
            )
        );
    };

    const handleFabPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!supportsDragging || fabDragRef.current.pointerId !== event.pointerId) {
            return;
        }

        const currentTarget = event.currentTarget;
        if (currentTarget.hasPointerCapture(event.pointerId)) {
            currentTarget.releasePointerCapture(event.pointerId);
        }

        const dragged = fabDragRef.current.moved;
        const fabEl = fabRef.current;

        if (dragged && fabEl) {
            const rect = fabEl.getBoundingClientRect();
            const current = fabPosition ?? { x: rect.left, y: rect.top };
            const width = rect.width || FAB_SIZE;
            const projectedX = current.x + getProjectedDistance(fabDragRef.current.velocityX);
            const dockSide = getDockSide(projectedX, width, window.innerWidth);

            if (dockSide) {
                stashFabToDock(dockSide, current.y);
            } else {
                setFabDockSide(null);
                setFabPosition(clampFabPosition(current.x, current.y, fabWidth, FAB_SIZE));
            }
        }

        setFabDragging(false);
        fabDragRef.current.pointerId = -1;
    };

    const handleFabClick = () => {
        if (fabDragRef.current.suppressClick) {
            fabDragRef.current.suppressClick = false;
            return;
        }

        if (open) {
            closeMenu();
            return;
        }

        if (supportsDragging && fabDockSide) {
            const y = fabPosition?.y ?? FAB_MIN_TOP;
            const x = fabDockSide === "left"
                ? FAB_MARGIN_X
                : window.innerWidth - fabWidth - FAB_MARGIN_X;

            setFabDockSide(null);
            setFabPosition(clampFabPosition(x, y, fabWidth, FAB_SIZE));
            return;
        }

        setOpen(true);
    };

    const fabStashed = Boolean(supportsDragging && fabDockSide && !open);
    const fabContainerStyle: CSSProperties | undefined = supportsDragging
        ? fabPosition
            ? {
                left: `${fabPosition.x}px`,
                top: `${fabPosition.y}px`,
                width: fabDockSide ? `${FAB_STASHED_WIDTH}px` : `${fabWidth}px`,
                height: `${FAB_SIZE}px`,
            }
            : {
                right: `${FAB_MARGIN_X}px`,
                bottom: `${FAB_MARGIN_BOTTOM}px`,
                width: `${fabWidth}px`,
                height: `${FAB_SIZE}px`,
            }
        : undefined;
    const fabButtonStyle: CSSProperties | undefined = supportsDragging ? { width: "100%" } : undefined;
    const menuAlignLeft = Boolean(
        supportsDragging &&
        fabPosition &&
        fabPosition.x < window.innerWidth / 2
    );

    return (
        <div
            className={`${styles.fabContainer} ${supportsDragging ? styles.mobileFabDock : ""}`}
            style={fabContainerStyle}
        >
            <AnimatePresence>
                {open && (
                    <>
                        <motion.div
                            className={styles.fabOverlay}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={closeMenu}
                        />
                        <div className={`${styles.fabMenu} ${menuAlignLeft ? styles.fabMenuLeft : ""}`}>
                            {items.map((item, index) => (
                                <motion.button
                                    key={item.id}
                                    className={`${styles.fabMenuItem} ${menuAlignLeft ? styles.fabMenuItemLeft : ""}`}
                                    initial={{ opacity: 0, y: 10, scale: 0.8 }}
                                    animate={{ opacity: 1, y: 0, scale: 1 }}
                                    exit={{ opacity: 0, y: 10, scale: 0.8 }}
                                    transition={{ delay: prefersReducedMotion ? 0 : index * 0.05 }}
                                    onClick={() => {
                                        item.onClick();
                                        closeMenu();
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
                ref={fabRef}
                className={supportsDragging
                    ? styles.mobileFab
                    : `${styles.fab} ${buttonLabel ? styles.fabLabeled : ""}`}
                onClick={handleFabClick}
                onPointerDown={supportsDragging ? handleFabPointerDown : undefined}
                onPointerMove={supportsDragging ? handleFabPointerMove : undefined}
                onPointerUp={supportsDragging ? handleFabPointerEnd : undefined}
                onPointerCancel={supportsDragging ? handleFabPointerEnd : undefined}
                whileHover={supportsDragging ? undefined : { scale: 1.05 }}
                whileTap={fabDragging ? undefined : { scale: 0.95 }}
                animate={buttonLabel ? undefined : { rotate: open ? 45 : 0 }}
                aria-label={open ? closeLabel : openLabel}
                aria-haspopup="dialog"
                data-open={open ? "true" : undefined}
                data-dragging={fabDragging ? "true" : undefined}
                data-dock-side={fabDockSide ?? undefined}
                data-docked={fabDockSide ? "true" : undefined}
                data-stashed={fabStashed ? "true" : undefined}
                style={fabButtonStyle}
            >
                {supportsDragging ? (
                    <span className={styles.mobileFabContent}>
                        <span className={styles.mobileFabIcon}>
                            {open ? (
                                <X size={22} />
                            ) : fabStashed ? (
                                fabDockSide === "left" ? <ChevronRight size={20} /> : <ChevronLeft size={20} />
                            ) : (
                                <Plus size={22} />
                            )}
                        </span>
                        {buttonLabel && !fabStashed && (
                            <span className={styles.mobileFabLabel}>{buttonLabel}</span>
                        )}
                    </span>
                ) : buttonLabel ? (
                    <span className={styles.fabContent}>
                        {open ? <X size={22} /> : <Plus size={22} />}
                        <span>{buttonLabel}</span>
                    </span>
                ) : open ? (
                    <X size={28} />
                ) : (
                    <Plus size={28} />
                )}
            </motion.button>
        </div>
    );
}
