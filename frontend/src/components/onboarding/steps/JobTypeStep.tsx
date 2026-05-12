import styles from "../OnboardingWizard.module.css";

type JobTypeStepProps = {
    value: string;
    onChange: (value: string) => void;
};

const PRESET_JOB_TYPES = ["内装", "塗装", "大工", "左官", "電工", "設備"];

export function JobTypeStep({ value, onChange }: JobTypeStepProps) {
    return (
        <div className={styles.jobTypeBlock}>
            <div className={styles.chips}>
                {PRESET_JOB_TYPES.map((jobType) => (
                    <button
                        key={jobType}
                        type="button"
                        className={jobType === value ? styles.chipActive : styles.chip}
                        onClick={() => onChange(jobType)}
                    >
                        {jobType}
                    </button>
                ))}
            </div>
            <label className={styles.fieldBlock}>
                <span className={styles.fieldLabel}>その他</span>
                <input
                    className={styles.textInput}
                    value={value}
                    maxLength={40}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder="例: 防水"
                />
            </label>
        </div>
    );
}
