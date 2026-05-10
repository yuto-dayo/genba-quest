import { AccountingBody } from "./AccountingBody";
import { CommunicationReviewBody } from "./CommunicationReviewBody";
import { CommunicationTaskBody } from "./CommunicationTaskBody";
import { GenericBody } from "./GenericBody";
import { InvoiceBody } from "./InvoiceBody";
import { PathRewardBody } from "./PathRewardBody";
import type { ProposalBodyComponent } from "./types";

const REGISTRY: Record<string, ProposalBodyComponent> = {
    "expense.create": AccountingBody,
    "expense.update": AccountingBody,
    "expense.void": AccountingBody,
    "income.create": AccountingBody,
    "income.update": AccountingBody,

    "invoice.create": InvoiceBody,
    "invoice.send": InvoiceBody,
    "invoice.mark_paid": InvoiceBody,

    "reward.calculate": PathRewardBody,
    "reward.adjust": PathRewardBody,
    "evaluation.finalize": PathRewardBody,

    "communication.task": CommunicationTaskBody,
    "communication.review": CommunicationReviewBody,
};

export function resolveProposalBody(type: string): ProposalBodyComponent {
    return REGISTRY[type] ?? GenericBody;
}
