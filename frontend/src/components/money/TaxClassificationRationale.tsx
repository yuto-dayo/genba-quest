import { HelpCircle } from "lucide-react";
import type { PayoutTaxClassification } from "./payoutTaxUtils";
import {
    contractTypeLabel,
    getContractType,
    getInvoiceStatus,
    withholdingCategoryLabel,
} from "./payoutTaxUtils";
import styles from "./TaxClassificationRationale.module.css";

interface TaxClassificationRationaleProps {
    classification: PayoutTaxClassification;
}

const invoiceStatusLabel = {
    registered: "適格",
    exempt: "免税 / 経過措置",
    transitional: "経過措置",
    unknown: "未確認",
} as const;

function formatDateTime(value: string | null | undefined): string {
    if (!value) return "未確認";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(date);
}

function yesCount(classification: PayoutTaxClassification): number {
    if (!classification?.classification_check_results) return 0;
    return Object.values(classification.classification_check_results).filter(Boolean).length;
}

export function TaxClassificationRationale({ classification }: TaxClassificationRationaleProps) {
    const contractType = getContractType(classification);
    const invoiceStatus = getInvoiceStatus(classification);
    const withholdingCategory = classification?.tax_withholding_category ?? "none";
    const checkedAt = formatDateTime(classification?.decided_at);
    const decidedBy = classification?.decided_by ?? "未確認";

    return (
        <details className={styles.details}>
            <summary className={styles.summary}>
                <HelpCircle size={18} aria-hidden="true" />
                税務判定の根拠
            </summary>
            <div className={styles.grid}>
                <div className={styles.row}>
                    <span className={styles.label}>契約区分</span>
                    <span className={styles.value}>{contractTypeLabel(contractType)}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>5項目チェック</span>
                    <span className={styles.value}>{checkedAt} / YES {yesCount(classification)}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>判定者</span>
                    <span className={styles.value}>{decidedBy}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>インボイス</span>
                    <span className={styles.value}>{invoiceStatusLabel[invoiceStatus]}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>源泉徴収</span>
                    <span className={styles.value}>{withholdingCategoryLabel(withholdingCategory)}</span>
                </div>
                <div className={styles.row}>
                    <span className={styles.label}>最終確認</span>
                    <span className={styles.value}>{checkedAt} by {decidedBy}</span>
                </div>
            </div>
        </details>
    );
}
