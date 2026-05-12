import type { EmploymentKind } from "../../../lib/api";
import styles from "../OnboardingWizard.module.css";

type EmploymentKindStepProps = {
    value: EmploymentKind;
    onChange: (value: EmploymentKind) => void;
};

const OPTIONS: Array<{
    value: EmploymentKind;
    title: string;
    description: string;
}> = [
    { value: "employee", title: "社員", description: "会社から給料" },
    { value: "sole_proprietor", title: "一人親方", description: "自分で請求書" },
    { value: "helper", title: "応援", description: "日当でスポット" },
];

export function EmploymentKindStep({ value, onChange }: EmploymentKindStepProps) {
    return (
        <div className={styles.cardList} role="radiogroup" aria-label="雇用区分">
            {OPTIONS.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={option.value === value ? styles.choiceCardActive : styles.choiceCard}
                    onClick={() => onChange(option.value)}
                    role="radio"
                    aria-checked={option.value === value}
                >
                    <strong>{option.title}</strong>
                    <span>{option.description}</span>
                </button>
            ))}
        </div>
    );
}
