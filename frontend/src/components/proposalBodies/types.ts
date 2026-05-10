import type { ProposalRecord } from "../../lib/api";

export interface ProposalBodyProps {
    proposal: ProposalRecord;
}

export type ProposalBodyComponent = (props: ProposalBodyProps) => JSX.Element;
