import styles from "./LoadingScreen.module.css";

interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({ label = "読み込み中" }: LoadingScreenProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite" aria-label={label}>
      <div className={styles.stage}>
        <p className={styles.label}>{label}</p>
        <div className={styles.bar} aria-hidden="true">
          <div className={styles.fill} />
        </div>
      </div>
    </div>
  );
}
