import type { PathModulePendingProposal, ProposalRecord } from "./api";
import { buildMoneyRedirectFromLegacyRoute } from "./legacyRouteRedirect";

type PathProposalLike = Pick<ProposalRecord, "id" | "type" | "description"> & {
    payload?: Record<string, unknown> | null;
};

export interface PathProposalContext {
    memberId: string | null;
    month: string | null;
    correctionMonth: string | null;
    reasonCode: string | null;
    rewardRunId: string | null;
    closeId: string | null;
    note: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringValue(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}

export function isPathModuleProposal(proposal: PathProposalLike | null | undefined): boolean {
    if (!proposal || !isRecord(proposal.payload)) {
        return false;
    }

    return (
        proposal.payload.module === "path" ||
        proposal.payload.path_module_version === "v2.2" ||
        proposal.payload.path_module_version === "v3.1" ||
        proposal.payload.path_module_version === "v3.2-simple" ||
        proposal.payload.calculation_system === "path_v22" ||
        proposal.payload.calculation_system === "path_v31" ||
        proposal.payload.calculation_system === "path_v32_simple"
    );
}

export function getPathProposalContext(
    proposal: PathProposalLike | PathModulePendingProposal | null | undefined,
): PathProposalContext | null {
    if (!proposal || !isRecord(proposal.payload)) {
        return null;
    }

    if (!isPathModuleProposal(proposal)) {
        return null;
    }

    return {
        memberId: toStringValue(proposal.payload.member_id),
        month:
            toStringValue(proposal.payload.month) ||
            toStringValue(proposal.payload.target_month) ||
            toStringValue(proposal.payload.period),
        correctionMonth: toStringValue(proposal.payload.correction_month),
        reasonCode: toStringValue(proposal.payload.reason_code),
        rewardRunId: toStringValue(proposal.payload.reward_run_id),
        closeId: toStringValue(proposal.payload.close_id),
        note:
            toStringValue(proposal.payload.note) ||
            toStringValue(proposal.payload.comment) ||
            toStringValue(proposal.payload.description),
    };
}

export function buildPathProposalHref(
    proposal: PathProposalLike | PathModulePendingProposal | null | undefined,
): string | null {
    if (!proposal) {
        return null;
    }

    const context = getPathProposalContext(proposal);
    if (!context) {
        return null;
    }

    const searchParams = new URLSearchParams();
    searchParams.set("tab", "path");
    searchParams.set("proposal", proposal.id);

    if (context.month) {
        searchParams.set("period", context.month);
    }
    if (context.memberId) {
        searchParams.set("member", context.memberId);
    }

    return buildMoneyRedirectFromLegacyRoute(searchParams);
}
