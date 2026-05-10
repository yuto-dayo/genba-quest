import {
    ACTOR_TYPE_LABELS,
    AmountHero,
    BodyHeader,
    DecisionSummaryGrid,
    DescriptionBlock,
    StatsGrid,
    TechnicalDetails,
    formatRecordedDate,
    getLedgerImpactLabel,
    getRiskLabel,
    getStatusLabel,
    isRecord,
    toFiniteNumber,
} from "./_shared";
import type { ProposalBodyProps } from "./types";

const TYPE_LABELS: Record<string, string> = {
    "invoice.create": "請求書の作成",
    "invoice.send": "請求書の送付",
    "invoice.mark_paid": "入金の記録",
};

export function InvoiceBody({ proposal }: ProposalBodyProps): JSX.Element {
    const typeLabel = TYPE_LABELS[proposal.type] || "請求書の確認";
    const payload = proposal.payload;

    const amount =
        toFiniteNumber(payload.amount_total) ??
        toFiniteNumber(payload.total_amount) ??
        toFiniteNumber(payload.amount);

    const clientName = isRecord(payload.client)
        ? typeof payload.client.name === "string"
            ? payload.client.name
            : null
        : typeof payload.client_name === "string"
            ? payload.client_name
            : null;
    const siteName = isRecord(payload.site)
        ? typeof payload.site.name === "string"
            ? payload.site.name
            : null
        : null;
    const invoiceNumber =
        typeof payload.invoice_number === "string" ? payload.invoice_number : null;
    const dueDate =
        typeof payload.due_date === "string"
            ? payload.due_date
            : typeof payload.payment_due_date === "string"
                ? payload.payment_due_date
                : null;
    const issuedDate =
        typeof payload.issued_date === "string"
            ? payload.issued_date
            : typeof payload.recorded_date === "string"
                ? payload.recorded_date
                : null;
    const description = typeof payload.description === "string" ? payload.description : null;

    const title = clientName || siteName || invoiceNumber || "請求書";

    const stats = [];
    if (invoiceNumber) stats.push({ label: "請求番号", value: invoiceNumber });
    if (issuedDate) stats.push({ label: "発行日", value: formatRecordedDate(issuedDate) });
    if (dueDate) stats.push({ label: "支払期限", value: formatRecordedDate(dueDate) });
    if (siteName && clientName) stats.push({ label: "現場", value: siteName });

    const amountLabel = amount !== null ? `¥${Math.abs(amount).toLocaleString()}` : "金額なし";
    const approvedCount = proposal.approvals.filter((a) => a.decision === "approve").length;
    const requiredApprovals = Math.max(proposal.required_approvals, 1);

    return (
        <>
            <BodyHeader
                typeLabel={typeLabel}
                statusLabel={getStatusLabel(proposal.status)}
                statusKey={proposal.status}
                actorTypeLabel={ACTOR_TYPE_LABELS[proposal.created_by.type]}
                actorTypeKey={proposal.created_by.type}
                title={title}
                subtitle={proposal.description !== title ? proposal.description : undefined}
                dateIso={proposal.created_at}
            />

            {amount !== null && <AmountHero label="請求金額" amount={amount} sign="income" />}

            {stats.length > 0 && <StatsGrid items={stats} />}

            {description && <DescriptionBlock label="摘要" text={description} />}

            <DecisionSummaryGrid
                headlineValue={amountLabel}
                items={[
                    { label: "作成者", value: proposal.created_by.name },
                    { label: "必要承認", value: `${requiredApprovals}名 / 現在 ${approvedCount}名` },
                    { label: "反映先", value: getLedgerImpactLabel(proposal) },
                    { label: "リスク", value: getRiskLabel(proposal, amountLabel) },
                ]}
            />

            <TechnicalDetails proposal={proposal} />
        </>
    );
}
