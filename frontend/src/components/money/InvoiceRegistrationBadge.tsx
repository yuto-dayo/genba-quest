import { HelpCircle, ShieldCheck } from "lucide-react";
import type { MemberInvoiceRegistrationStatus } from "../../lib/api";
import { getTransitionalDeductionPercent } from "./payoutTaxUtils";
import styles from "./InvoiceRegistrationBadge.module.css";

export interface InvoiceRegistrationBadgeProps {
    status?: MemberInvoiceRegistrationStatus | null;
    registrationNumber?: string | null;
    asOf?: Date;
    size?: "default" | "small";
    settingsHref?: string;
}

function statusLabel(
    status: MemberInvoiceRegistrationStatus,
    registrationNumber: string | null | undefined,
    asOf: Date | undefined,
    compact: boolean,
): string {
    if (status === "registered") {
        if (compact) return "適格";
        return registrationNumber ? `適格 ${registrationNumber}` : "適格";
    }
    if (status === "exempt") {
        return `経過措置 ${getTransitionalDeductionPercent(asOf)}%`;
    }
    if (status === "transitional") {
        return compact ? "経過措置" : `経過措置 控除${getTransitionalDeductionPercent(asOf)}%`;
    }
    return "未確認";
}

export function InvoiceRegistrationBadge({
    status,
    registrationNumber,
    asOf,
    size = "default",
    settingsHref,
}: InvoiceRegistrationBadgeProps) {
    const normalizedStatus = status ?? "unknown";
    const compact = size === "small";
    const label = statusLabel(normalizedStatus, registrationNumber, asOf, compact);
    const className = [
        styles.badge,
        styles[normalizedStatus],
        compact ? styles.small : "",
    ].filter(Boolean).join(" ");
    const Icon = normalizedStatus === "registered" ? ShieldCheck : HelpCircle;

    return (
        <span className={className} aria-label={`インボイス登録状況 ${label}`}>
            <Icon size={compact ? 12 : 14} aria-hidden="true" />
            <span className={styles.number}>{label}</span>
            {normalizedStatus === "unknown" && settingsHref && !compact && (
                <a className={styles.link} href={settingsHref}>
                    設定
                </a>
            )}
        </span>
    );
}
