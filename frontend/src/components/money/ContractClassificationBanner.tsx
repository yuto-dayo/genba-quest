import { AlertTriangle, HelpCircle } from "lucide-react";
import type { ClassificationCheckStatus, MemberContractType } from "../../lib/api";
import styles from "./ContractClassificationBanner.module.css";

export interface ContractClassificationBannerProps {
    contractType?: MemberContractType | null;
    checkStatus?: ClassificationCheckStatus | null;
    settingsHref?: string;
}

interface BannerState {
    tone: "warning" | "neutral";
    role: "alert" | "status";
    message: string;
    showSettings: boolean;
}

function getContractClassificationBannerState({
    contractType,
    checkStatus,
}: Pick<ContractClassificationBannerProps, "contractType" | "checkStatus">): BannerState | null {
    if (contractType === "employee_like") {
        return {
            tone: "warning",
            role: "alert",
            message: "契約区分の見直しを推奨（給与扱いリスク）",
            showSettings: true,
        };
    }
    if (contractType === "undetermined" || !contractType) {
        return {
            tone: "neutral",
            role: "status",
            message: "契約区分が未設定です",
            showSettings: true,
        };
    }
    if (checkStatus === "review_needed") {
        return {
            tone: "warning",
            role: "alert",
            message: "年次レビューが必要です",
            showSettings: true,
        };
    }
    return null;
}

export function ContractClassificationBanner({
    contractType,
    checkStatus,
    settingsHref,
}: ContractClassificationBannerProps) {
    const state = getContractClassificationBannerState({ contractType, checkStatus });
    if (!state) return null;

    const Icon = state.tone === "warning" ? AlertTriangle : HelpCircle;

    return (
        <div className={`${styles.banner} ${styles[state.tone]}`} role={state.role}>
            <Icon className={styles.icon} size={18} aria-hidden="true" />
            <div className={styles.content}>
                <span className={styles.message}>{state.message}</span>
                {state.showSettings && settingsHref && (
                    <a className={styles.link} href={settingsHref}>
                        設定する
                    </a>
                )}
            </div>
        </div>
    );
}
