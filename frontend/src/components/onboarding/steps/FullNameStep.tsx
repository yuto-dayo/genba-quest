import styles from "../OnboardingWizard.module.css";

type FullNameStepProps = {
    value: string;
    onChange: (value: string) => void;
};

export function FullNameStep({ value, onChange }: FullNameStepProps) {
    return (
        <label className={styles.fieldBlock}>
            <span className={styles.fieldLabel}>本名</span>
            <input
                autoFocus
                className={styles.textInput}
                name="full_name"
                aria-label="本名"
                value={value}
                maxLength={50}
                onChange={(event) => onChange(event.target.value)}
                placeholder="例: 山田 太郎"
            />
            <span className={styles.helperText}>請求書や税書類で使う正式名称です</span>
        </label>
    );
}
