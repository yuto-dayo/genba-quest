jest.mock("../../lib/supabaseAdmin", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

jest.mock("../../lib/ledger-helpers", () => ({
    bookLedgerEntry: jest.fn(),
}));

import { bookLedgerEntry } from "../../lib/ledger-helpers";
import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { DisputeCorrectionService } from "../../services/DisputeCorrectionService";
import type { Proposal } from "../../services/PolicyEngine";
import { createChain } from "../helpers/mockSupabase";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "33333333-3333-4333-8333-333333333333";
const REWARD_MEMBER_ID = "44444444-4444-4444-8444-444444444444";

function proposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
        id: PROPOSAL_ID,
        org_id: ORG_ID,
        type: "reward.dispute_correction",
        status: "approved",
        created_by: { type: "human", id: USER_ID, name: "Me" },
        payload: {
            target_member_id: USER_ID,
            reward_member_id: REWARD_MEMBER_ID,
            month: "2026-05",
            correction_kind: "reward_amount",
            from_amount: 192500,
            to_amount: 210000,
            reason: "6/3現場漏れ",
        },
        description: "計算修正申立",
        approvals: [],
        required_approvals: 1,
        created_at: "2026-05-18T00:00:00.000Z",
        updated_at: "2026-05-18T00:00:00.000Z",
        ...overrides,
    };
}

describe("DisputeCorrectionService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("rejects creation when the human actor is not the target member", async () => {
        const service = new DisputeCorrectionService();

        await expect(service.createProposal({
            orgId: ORG_ID,
            actor: { type: "human", id: USER_ID, name: "Me" },
            targetMemberId: REWARD_MEMBER_ID,
            month: "2026-05",
            correctionKind: "reward_amount",
            fromAmount: 1000,
            toAmount: 2000,
            reason: "計算違い",
        })).rejects.toThrow("DISPUTE_CORRECTION_CREATOR_MUST_BE_TARGET");
    });

    it("appends reversal and adjustment ledger events when executing", async () => {
        const updated = proposal({ status: "executed", result_event_id: "adjustment-event" });
        (bookLedgerEntry as jest.Mock)
            .mockResolvedValueOnce({ ledger_event_id: "reversal-event" })
            .mockResolvedValueOnce({ ledger_event_id: "adjustment-event" });
        (supabaseAdmin.from as jest.Mock)
            .mockImplementationOnce(() => createChain({ data: null, error: null }))
            .mockImplementationOnce(() => createChain({ data: null, error: null }))
            .mockImplementationOnce(() => createChain({ data: updated, error: null }));

        const service = new DisputeCorrectionService();
        const result = await service.executeApprovedProposal(
            proposal(),
            { type: "system", id: "system", name: "System" },
        );

        expect(result.status).toBe("executed");
        expect(bookLedgerEntry).toHaveBeenNthCalledWith(
            1,
            "reward.dispute_correction.reversal",
            [
                { display_label: "普通預金", debit_amount: 192500 },
                { display_label: "報酬の素", credit_amount: 192500 },
            ],
            expect.objectContaining({ org_id: ORG_ID, proposal_id: PROPOSAL_ID }),
            supabaseAdmin,
        );
        expect(bookLedgerEntry).toHaveBeenNthCalledWith(
            2,
            "reward.dispute_correction.adjustment",
            [
                { display_label: "報酬の素", debit_amount: 210000 },
                { display_label: "普通預金", credit_amount: 210000 },
            ],
            expect.objectContaining({ org_id: ORG_ID, proposal_id: PROPOSAL_ID }),
            supabaseAdmin,
        );
    });
});
