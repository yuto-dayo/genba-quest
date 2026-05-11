import styles from "./InlineLoader.module.css";

type Size = "sm" | "md" | "lg" | "xl";
type Tone = "primary" | "onSurface" | "onPrimary" | "muted";

interface InlineLoaderProps {
  size?: Size;
  tone?: Tone;
  label?: string;
  /** Render as a centered block with an optional label below — for whole-section loads. */
  block?: boolean;
}

const TONE_CLASS: Record<Tone, string> = {
  primary: styles.tonePrimary,
  onSurface: styles.toneOnSurface,
  onPrimary: styles.toneOnPrimary,
  muted: styles.toneMuted,
};

export function InlineLoader({
  size = "md",
  tone = "primary",
  label,
  block = false,
}: InlineLoaderProps) {
  const spinner = (
    <span
      className={[styles.root, styles[size], TONE_CLASS[tone]].join(" ")}
      role="status"
      aria-live="polite"
      aria-label={label ?? "読み込み中"}
    >
      {/* Material Symbols: progress_activity (M3 official indeterminate progress) */}
      <svg
        className={styles.icon}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 -960 960 960"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-133 0-226.5 93.5T160-480q0 133 93.5 226.5T480-160q133 0 226.5-93.5T800-480q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Z" />
      </svg>
    </span>
  );

  if (!block) return spinner;

  return (
    <div className={styles.block}>
      {spinner}
      {label ? <span>{label}</span> : null}
    </div>
  );
}
