import styles from "./LoadingScreen.module.css";

interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({ label = "読み込み中" }: LoadingScreenProps) {
  return (
    <div className={styles.root} role="status" aria-live="polite" aria-label={label}>
      <div className={styles.stage}>
        <picture>
          <source srcSet="/loading.webp" type="image/webp" />
          <img src="/loading.png" alt="" className={styles.image} />
        </picture>
        <div className={styles.bar} aria-hidden="true">
          <div className={styles.fill} />
        </div>
      </div>
    </div>
  );
}
