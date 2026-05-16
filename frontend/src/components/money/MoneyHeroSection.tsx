import { type ReactNode, useId } from "react";
import styles from "./MoneyHeroSection.module.css";

interface MoneyHeroSectionProps {
    title: string;
    shield?: ReactNode;
    children: ReactNode;
}

export function MoneyHeroSection({ title, shield, children }: MoneyHeroSectionProps) {
    const headingId = useId();

    return (
        <section className={styles.section} aria-labelledby={headingId}>
            <div className={styles.header}>
                <h2 id={headingId} className={styles.title}>
                    {title}
                </h2>
                {shield}
            </div>
            <div className={styles.body}>{children}</div>
        </section>
    );
}
