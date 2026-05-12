import styles from "../OnboardingWizard.module.css";

type NicknameStepProps = {
    value: string;
    onChange: (value: string) => void;
};

export function NicknameStep({ value, onChange }: NicknameStepProps) {
    const remaining = Math.max(0, 5 - value.length);

    return (
        <label className={styles.fieldBlock}>
            <span className={styles.fieldLabel}>ニックネーム</span>
            <input
                autoFocus
                className={styles.textInput}
                name="nickname"
                aria-label="ニックネーム"
                value={value}
                maxLength={5}
                onChange={(event) => onChange(event.target.value)}
                placeholder="例: ユウト"
            />
            <span className={styles.helperText}>あと {remaining} 文字</span>
        </label>
    );
}
