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
    "expense.create": "経費の登録",
    "expense.update": "経費の更新",
    "expense.void": "経費の取り消し",
    "income.create": "売上の登録",
    "income.update": "売上の更新",
};

const CATEGORY_JA: Record<string, string> = {
    material: "資材",
    tool: "工具",
    travel: "交通",
    food: "食費",
    fuel: "燃料",
    utility: "光熱",
    other: "その他",
};

const COST_CENTER_JA: Record<string, string> = {
    HQ: "本社",
    SITE: "現場",
};

export function AccountingBody({ proposal }: ProposalBodyProps): JSX.Element {
    const isExpense = proposal.type.startsWith("expense.");
    const typeLabel = TYPE_LABELS[proposal.type] || (isExpense ? "経費の確認" : "売上の確認");
    const payload = proposal.payload;

    const amount =
        toFiniteNumber(payload.amount_total) ??
        toFiniteNumber(payload.total_amount) ??
        toFiniteNumber(payload.amount);

    const vendorName = typeof payload.vendor_name === "string" ? payload.vendor_name : null;
    const siteName = isRecord(payload.site)
        ? typeof payload.site.name === "string"
            ? payload.site.name
            : null
        : null;
    const clientName = isRecord(payload.client)
        ? typeof payload.client.name === "string"
            ? payload.client.name
            : null
        : null;
    const categoryRaw = typeof payload.category === "string" ? payload.category : null;
    const categoryLabel = categoryRaw ? CATEGORY_JA[categoryRaw] || categoryRaw : null;
    const recordedDate =
        typeof payload.recorded_date === "string"
            ? payload.recorded_date
            : typeof payload.date === "string"
                ? payload.date
                : null;
    const costCenterRaw = typeof payload.cost_center === "string" ? payload.cost_center : null;
    const costCenterLabel = costCenterRaw ? COST_CENTER_JA[costCenterRaw] || costCenterRaw : null;
    const description =
        typeof payload.description === "string"
            ? payload.description
            : typeof payload.memo === "string"
                ? payload.memo
                : null;

    const title = vendorName || clientName || siteName || (isExpense ? "経費" : "売上");

    const stats = [];
    if (recordedDate) stats.push({ label: "日付", value: formatRecordedDate(recordedDate) });
    if (categoryLabel) stats.push({ label: "区分", value: categoryLabel });
    if (siteName) stats.push({ label: "現場", value: siteName });
    if (costCenterLabel && !siteName) stats.push({ label: "場所", value: costCenterLabel });

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

            {amount !== null && (
                <AmountHero
                    label="金額"
                    amount={amount}
                    sign={isExpense ? "expense" : "income"}
                />
            )}

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
