import styles from "./ErrorScreen.module.css";

interface ErrorScreenProps {
  title?: string;
  body?: string;
  detail?: string;
  retryLabel?: string;
  onRetry?: () => void;
}

export function ErrorScreen({
  title = "うまくつながりませんでした",
  body = "少し時間をおいて、もう一度試してみてください。",
  detail,
  retryLabel = "もう一度試す",
  onRetry,
}: ErrorScreenProps) {
  return (
    <div className={styles.root} role="alert">
      <div className={styles.card}>
        <picture>
          <source srcSet="/error.webp" type="image/webp" />
          <img src="/error.png" alt="" className={styles.illustration} />
        </picture>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.body}>{body}</p>
        {detail ? <p className={styles.detail}>{detail}</p> : null}
        {onRetry ? (
          <button type="button" className={styles.retryButton} onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
