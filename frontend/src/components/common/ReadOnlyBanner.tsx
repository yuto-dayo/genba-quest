import { LockKeyhole } from "lucide-react";
import styles from "./ReadOnlyBanner.module.css";

export function ReadOnlyBanner() {
    return (
        <div className={styles.banner} role="status" aria-live="polite">
            <div className={styles.icon} aria-hidden="true">
                <LockKeyhole size={18} />
            </div>
            <div className={styles.copy}>
                <h2 className={styles.title}>過去月の閲覧モード</h2>
                <p className={styles.text}>修正は新しい月の逆仕訳で行います</p>
            </div>
        </div>
    );
}
