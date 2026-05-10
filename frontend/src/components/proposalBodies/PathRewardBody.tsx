import {
    ACTOR_TYPE_LABELS,
    AmountHero,
    BodyHeader,
    DecisionSummaryGrid,
    OpenLink,
    ReasonsList,
    StatsGrid,
    TechnicalDetails,
    formatYen,
    getLedgerImpactLabel,
    getRiskLabel,
    getStatusLabel,
    isRecord,
    toFiniteNumber,
    toMonthLabel,
    type ReasonEntry,
    type StatItem,
} from "./_shared";
import { buildPathProposalHref } from "../../lib/pathProposal";
import type { ProposalBodyProps } from "./types";

const TYPE_LABELS: Record<string, string> = {
    "reward.calculate": "PATH 月次報酬",
    "reward.adjust": "PATH 補正",
    "evaluation.finalize": "PATH 月次確定",
};

const parsePathReasons = (snapshot: Record<string, unknown>): ReasonEntry[] => {
    const list = snapshot.top_reasons;
    if (!Array.isArray(list)) return [];
    return list
        .map((entry, index): ReasonEntry | null => {
            if (!isRecord(entry)) return null;
            const label = typeof entry.label === "string" ? entry.label : "";
            const summary = typeof entry.summary === "string" ? entry.summary : undefined;
            if (!label && !summary) return null;
            const direction =
                entry.direction === "positive" || entry.direction === "negative"
                    ? entry.direction
                    : "neutral";
            return {
                key: typeof entry.key === "string" ? entry.key : `reason-${index}`,
                label,
                summary,
                direction,
                impactAmount: toFiniteNumber(entry.impact_amount),
            };
        })
        .filter((r): r is ReasonEntry => r !== null)
        .slice(0, 3);
};

export function PathRewardBody({ proposal }: ProposalBodyProps): JSX.Element {
    const typeLabel = TYPE_LABELS[proposal.type] || "PATH 月次報酬";
    const snapshot = isRecord(proposal.payload.summary_snapshot)
        ? (proposal.payload.summary_snapshot as Record<string, unknown>)
        : null;

    const monthLabel =
        toMonthLabel(snapshot?.month) ||
        toMonthLabel(proposal.payload.month) ||
        (typeof snapshot?.month === "string" ? snapshot.month : "対象月不明");

    const statusLabel = typeof snapshot?.status_label === "string" ? snapshot.status_label : null;
    const isFinalized =
        snapshot?.status === "finalized" || snapshot?.status === "confirmed";

    const resultAmount = toFiniteNumber(snapshot?.result_amount);
    const estimatedAmount = toFiniteNumber(snapshot?.estimated_amount);
    const baseAmount = toFiniteNumber(snapshot?.base_amount);
    const correctionAmount = toFiniteNumber(snapshot?.correction_amount);

    const displayAmount =
        resultAmount !== null && resultAmount !== 0
            ? resultAmount
            : estimatedAmount !== null
                ? estimatedAmount
                : baseAmount;

    const workUnits = toFiniteNumber(snapshot?.work_units);
    const standardUnits = toFiniteNumber(snapshot?.standard_units);
    const includedSiteCount = toFiniteNumber(snapshot?.included_site_count);
    const closedSiteCount = toFiniteNumber(snapshot?.closed_site_count);
    const pendingSiteCount = toFiniteNumber(snapshot?.pending_site_count);

    const correctionsRaw = snapshot?.corrections;
    const correctionCount = isRecord(correctionsRaw)
        ? toFiniteNumber(correctionsRaw.count)
        : null;

    const stats: StatItem[] = [];
    if (workUnits !== null) {
        stats.push({
            label: "稼働",
            value:
                standardUnits !== null
                    ? `${workUnits} / ${standardUnits} 単位`
                    : `${workUnits} 単位`,
        });
    }
    if (includedSiteCount !== null) {
        stats.push({
            label: "対象現場",
            value:
                closedSiteCount !== null
                    ? `${includedSiteCount} 件 (完了 ${closedSiteCount})`
                    : `${includedSiteCount} 件`,
        });
    }
    if (pendingSiteCount !== null && pendingSiteCount > 0) {
        stats.push({ label: "未完了現場", value: `${pendingSiteCount} 件` });
    }
    if (correctionCount !== null) {
        stats.push({
            label: "補正",
            value: correctionCount === 0 ? "なし" : `${correctionCount} 件`,
            muted: correctionCount === 0,
        });
    }

    const reasons = snapshot ? parsePathReasons(snapshot) : [];
    const pathHref = buildPathProposalHref(proposal);

    const amountLabel =
        displayAmount !== null ? formatYen(displayAmount) : "金額なし";
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
                title={monthLabel}
                subtitle={statusLabel || proposal.description}
                dateIso={proposal.created_at}
            />

            {displayAmount !== null && (
                <AmountHero
                    label={isFinalized ? "確定金額" : "試算金額"}
                    amount={displayAmount}
                    sign={displayAmount === 0 ? "neutral" : "income"}
                    subMeta={
                        correctionAmount !== null && correctionAmount !== 0
                            ? `うち補正 ${formatYen(correctionAmount)}`
                            : undefined
                    }
                />
            )}

            {stats.length > 0 && <StatsGrid items={stats} />}

            <ReasonsList title="主な理由" reasons={reasons} />

            {pathHref && <OpenLink to={pathHref} label="今月の評価で開く" />}

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
