import type { FormEvent, ReactNode } from "react";
import styles from "./StepShell.module.css";

type StepShellProps = {
    step: number;
    totalSteps: number;
    title: string;
    description: string;
    children: ReactNode;
    nextLabel: string;
    nextDisabled: boolean;
    onNext: () => void;
    onBack?: () => void;
    backLabel?: string;
    secondaryAction?: ReactNode;
};

export function StepShell({
    step,
    totalSteps,
    title,
    description,
    children,
    nextLabel,
    nextDisabled,
    onNext,
    onBack,
    backLabel = "戻る",
    secondaryAction,
}: StepShellProps) {
    const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!nextDisabled) {
            onNext();
        }
    };

    return (
        <form className={styles.container} onSubmit={handleSubmit}>
            <div className={styles.progress} aria-label={`${step + 1}/${totalSteps}`}>
                {Array.from({ length: totalSteps }).map((_, index) => (
                    <span
                        key={index}
                        className={index === step ? styles.dotActive : styles.dot}
                        aria-hidden
                    />
                ))}
            </div>
            <header className={styles.header}>
                <h1>{title}</h1>
                <p>{description}</p>
            </header>
            <div className={styles.body}>{children}</div>
            <footer className={styles.footer}>
                <div className={styles.footerLeft}>
                    {secondaryAction}
                    {onBack && (
                        <button
                            type="button"
                            className={styles.backButton}
                            onClick={onBack}
                        >
                            {backLabel}
                        </button>
                    )}
                </div>
                <button type="submit" className={styles.nextButton} disabled={nextDisabled}>
                    {nextLabel}
                </button>
            </footer>
        </form>
    );
}
