import { useRef } from "react";
import styles from "../OnboardingWizard.module.css";

type AvatarStepProps = {
    avatarUrl: string | null;
    busy: boolean;
    error: string | null;
    onSelectFile: (file: File) => void;
};

export function AvatarStep({ avatarUrl, busy, error, onSelectFile }: AvatarStepProps) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    return (
        <div className={styles.avatarBlock}>
            <input
                ref={fileInputRef}
                className={styles.hiddenInput}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) {
                        onSelectFile(file);
                    }
                    event.target.value = "";
                }}
            />
            <button
                type="button"
                className={styles.avatarPicker}
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
            >
                {avatarUrl ? (
                    <img src={avatarUrl} alt="アバタープレビュー" className={styles.avatarPreview} />
                ) : (
                    <div className={styles.avatarPlaceholder}>+追加</div>
                )}
            </button>
            {busy ? <p className={styles.helperText}>圧縮してアップロード中...</p> : null}
            {error ? <p className={styles.errorText}>{error}</p> : null}
            {!error && !busy ? <p className={styles.helperText}>大きな画像でも自動で小さくします</p> : null}
        </div>
    );
}
