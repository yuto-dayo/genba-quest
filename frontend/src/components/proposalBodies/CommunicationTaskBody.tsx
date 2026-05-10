import {
    BodyHeader,
    DecisionSummaryGrid,
    DescriptionBlock,
    DriveLinkSection,
    EmailContext,
    TechnicalDetails,
} from "./_shared";
import {
    ACTOR_TYPE_LABELS,
    getLedgerImpactLabel,
    getRiskLabel,
    getStatusLabel,
} from "./_shared-utils";
import { PathRewardBody } from "./PathRewardBody";
import type { ProposalBodyProps } from "./types";

const PATH_CONFIRMATION_SOURCES = new Set(["path_reward_confirmation", "path_module"]);

const getString = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

export function CommunicationTaskBody({ proposal }: ProposalBodyProps): JSX.Element {
    const payload = proposal.payload;
    const sourceRaw = getString(payload.source);
    const isPathConfirmation =
        sourceRaw !== null && PATH_CONFIRMATION_SOURCES.has(sourceRaw) && payload.summary_snapshot
            ? true
            : false;

    // PATH 確認依頼の場合は PathRewardBody に処理を委譲し、
    // typeLabel だけ "PATH 確認依頼" に書き換える(中身は PATH の判断材料)。
    if (isPathConfirmation) {
        return <PathRewardBody proposal={{ ...proposal, type: "reward.calculate" }} />;
    }

    const emailSubject =
        getString(payload.source_message_subject) ?? getString(payload.email_subject);
    const emailFrom = getString(payload.source_message_from) ?? getString(payload.email_from);
    const emailBodyPreview =
        getString(payload.source_message_body_preview) ?? getString(payload.email_body_preview);
    const emailBodyFull =
        getString(payload.source_message_body_full) ?? getString(payload.email_body_full);
    const driveUrl = getString(payload.drive_file_url);

    const title = proposal.description || emailSubject || "メール対応タスク";
    const subtitle = emailSubject && emailSubject !== title ? emailSubject : undefined;

    const approvedCount = proposal.approvals.filter((a) => a.decision === "approve").length;
    const requiredApprovals = Math.max(proposal.required_approvals, 1);

    return (
        <>
            <BodyHeader
                typeLabel="メール対応タスク"
                statusLabel={getStatusLabel(proposal.status)}
                statusKey={proposal.status}
                actorTypeLabel={ACTOR_TYPE_LABELS[proposal.created_by.type]}
                actorTypeKey={proposal.created_by.type}
                title={title}
                subtitle={subtitle}
                dateIso={proposal.created_at}
            />

            <EmailContext
                subject={emailSubject}
                from={emailFrom}
                bodyPreview={emailBodyPreview}
                bodyFull={emailBodyFull}
            />

            {driveUrl && <DriveLinkSection url={driveUrl} />}

            {proposal.description && proposal.description !== title && proposal.description !== subtitle && (
                <DescriptionBlock label="依頼内容" text={proposal.description} />
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
