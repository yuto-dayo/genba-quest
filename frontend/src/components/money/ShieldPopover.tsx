import { useEffect, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import styles from "./ShieldPopover.module.css";

interface ShieldPopoverProps {
    open: boolean;
    onToggle: () => void;
    onClose: () => void;
}

export function ShieldPopover({ open, onToggle, onClose }: ShieldPopoverProps) {
    const rootRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;

        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("pointerdown", handlePointerDown);
        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose, open]);

    return (
        <div className={styles.root} ref={rootRef}>
            <button
                type="button"
                className={styles.button}
                onClick={onToggle}
                aria-label="報酬の見え方"
                aria-expanded={open}
            >
                <ShieldCheck size={17} aria-hidden="true" />
            </button>
            {open && (
                <div className={styles.popover} role="dialog" aria-label="報酬の見え方">
                    <div>
                        <h3>見えるもの</h3>
                        <ul>
                            <li>自分の報酬</li>
                            <li>各メンバーの月額</li>
                            <li>請求書の状態</li>
                        </ul>
                    </div>
                    <div>
                        <h3>見えないもの</h3>
                        <ul>
                            <li>振込先</li>
                            <li>住所</li>
                            <li>税番号</li>
                            <li>本人書類</li>
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
}
