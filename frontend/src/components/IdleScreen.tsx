import styles from "./IdleScreen.module.css";

interface IdleScreenProps {
  /** Short context line shown above the illustration, e.g. "Sherpaが考えています". */
  caption?: string;
  /** Subtext shown below the caption. */
  hint?: string;
  /** Render inline (no fixed full-screen overlay) for use inside cards/sheets. */
  inline?: boolean;
}

export function IdleScreen({ caption, hint, inline = false }: IdleScreenProps) {
  return (
    <div
      className={[styles.root, inline ? styles.inline : ""].join(" ")}
      role="status"
      aria-live="polite"
      aria-label={caption ?? "処理中"}
    >
      <div className={styles.card}>
        {caption ? <p className={styles.caption}>{caption}</p> : null}
        {hint ? <p className={styles.hint}>{hint}</p> : null}
        <picture>
          <source srcSet="/idle.webp" type="image/webp" />
          <img src="/idle.png" alt="" className={styles.illustration} />
        </picture>
      </div>
    </div>
  );
}
