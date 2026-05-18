import { AlertTriangle, CheckCircle2, Clock3, FileEdit } from "lucide-react";
import styles from "./InvoiceStatusBadge.module.css";

export type ClientInvoiceStatus = "awaiting_payment" | "issued" | "unissued" | "paid";

const LABELS: Record<ClientInvoiceStatus, string> = {
    awaiting_payment: "入金待ち",
    issued: "発行済",
    unissued: "未発行",
    paid: "入金済",
};

const ICONS = {
    awaiting_payment: AlertTriangle,
    issued: Clock3,
    unissued: FileEdit,
    paid: CheckCircle2,
} satisfies Record<ClientInvoiceStatus, typeof AlertTriangle>;

interface InvoiceStatusBadgeProps {
    status: ClientInvoiceStatus;
}

export function InvoiceStatusBadge({ status }: InvoiceStatusBadgeProps) {
    const Icon = ICONS[status];
    return (
        <span className={`${styles.badge} ${styles[status]}`}>
            <Icon size={14} aria-hidden="true" />
            {LABELS[status]}
        </span>
    );
}
