import {
    ACTOR_TYPE_LABELS,
    BodyHeader,
    DecisionSummaryGrid,
    DescriptionBlock,
    DriveLinkSection,
    EmailContext,
    TechnicalDetails,
    getLedgerImpactLabel,
    getRiskLabel,
    getStatusLabel,
} from "./_shared";
import type { ProposalBodyProps } from "./types";

const getString = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

export function CommunicationReviewBody({ proposal }: ProposalBodyProps): JSX.Element {
    const payload = proposal.payload;
    const emailSubject =
        getString(payload.source_message_subject) ?? getString(payload.email_subject);
    const emailFrom = getString(payload.source_message_from) ?? getString(payload.email_from);
    const emailBodyPreview =
        getString(payload.source_message_body_preview) ?? getString(payload.email_body_preview);
    const emailBodyFull =
        getString(payload.source_message_body_full) ?? getString(payload.email_body_full);
    const driveUrl = getString(payload.drive_file_url);

    const title = emailSubject || proposal.description || "メールの要点確認";
    const subtitle = proposal.description && proposal.description !== title
        ? proposal.description
        : undefined;

    const approvedCount = proposal.approvals.filter((a) => a.decision === "approve").length;
    const requiredApprovals = Math.max(proposal.required_approvals, 1);

    return (
        <>
            <BodyHeader
                typeLabel="メールの要点確認"
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
                <DescriptionBlock label="要点" text={proposal.description} />
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
