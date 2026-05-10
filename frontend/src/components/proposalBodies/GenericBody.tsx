import type { JSX } from "react";
import {
    BodyHeader,
    DecisionSummaryGrid,
    DescriptionBlock,
    TechnicalDetails,
} from "./_shared";
import {
    ACTOR_TYPE_LABELS,
    getLedgerImpactLabel,
    getRiskLabel,
    getStatusLabel,
} from "./_shared-utils";
import type { ProposalBodyProps } from "./types";

const FALLBACK_TYPE_LABELS: Record<string, string> = {
    "skill.achieve": "技能の認定",
    "skill.revoke": "技能の取り消し",
    "evaluation.submit": "評価の提出",
    "assignment.create": "アサインの作成",
    "assignment.update": "アサインの更新",
    "assignment.cancel": "アサインの取り消し",
    "site.create": "現場の登録",
    "site.complete": "現場の完了",
    "policy.update": "運用ルールの更新",
    "task.revision.request": "修正の指示",
    "luqo.catalog.add": "技能項目の追加",
    "luqo.star.achieve": "スター達成の申請",
    "luqo.score.update": "スコアの更新",
    "luqo.reward.calculate": "月次報酬の計算",
};

export function GenericBody({ proposal }: ProposalBodyProps): JSX.Element {
    const typeLabel = FALLBACK_TYPE_LABELS[proposal.type] || proposal.type;
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
                title={proposal.description || typeLabel}
                dateIso={proposal.created_at}
            />

            {proposal.description && (
                <DescriptionBlock label="内容" text={proposal.description} />
            )}

            <DecisionSummaryGrid
                items={[
                    { label: "作成者", value: proposal.created_by.name },
                    { label: "必要承認", value: `${requiredApprovals}名 / 現在 ${approvedCount}名` },
                    { label: "反映先", value: getLedgerImpactLabel(proposal) },
                    { label: "リスク", value: getRiskLabel(proposal, "金額なし") },
                ]}
            />

            <TechnicalDetails proposal={proposal} />
        </>
    );
}
