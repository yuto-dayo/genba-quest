jest.mock("../../lib/supabaseAdmin", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

import { MemberInvoiceService } from "../../services/MemberInvoiceService";
import type { Proposal } from "../../services/PolicyEngine";
import { createChain, setupMockFrom, setupMockFromSequence } from "../helpers/mockSupabase";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const PROPOSAL_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const CLOSE_ID = "55555555-5555-4555-8555-555555555555";
const LINE_ID = "66666666-6666-4666-8666-666666666666";

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
        id: PROPOSAL_ID,
        org_id: ORG_ID,
        type: "invoice.member_issue",
        status: "executed",
        document_id: null,
        site_id: null,
        created_by: { type: "human", id: MEMBER_ID, name: "Yamada" },
        payload: {
            member_id: MEMBER_ID,
            period_month: "2026-04",
            source: "path_reward",
            source_ref_id: RUN_ID,
            amount_total: 180000,
            line_items: [
                {
                    description: "PATH 報酬 2026-04",
                    quantity: 1,
                    unit_amount: 180000,
                    amount: 180000,
                },
            ],
            snapshot_profile: {
                trade_name: "山田内装",
                invoice_registration_no: "T1234567890123",
                bank: {
                    bank_name: "みずほ銀行",
                    branch_name: "新宿支店",
                    account_type: "普通",
                    account_number: "1234567",
                    account_holder_kana: "ヤマダタロウ",
                },
                address: {
                    postal_code: "1600022",
                    prefecture: "東京都",
                    city: "新宿区",
                    address_line1: "新宿1-1-1",
                    address_line2: null,
                },
            },
        },
        description: "test",
        approvals: [],
        required_approvals: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    } as Proposal;
}

function invoiceRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        org_id: ORG_ID,
        proposal_id: PROPOSAL_ID,
        member_id: MEMBER_ID,
        source: "path_reward",
        source_ref_id: RUN_ID,
        period_month: "2026-04",
        amount_total: 180000,
        line_items: [],
        snapshot_trade_name: "山田内装",
        snapshot_invoice_registration_no: "T1234567890123",
        snapshot_bank: {},
        snapshot_address: {},
        status: "issued",
        invoice_no: "MI-202604-22222222-33333333",
        issued_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    };
}

function buildMockClient(chains: ReturnType<typeof createChain>[]): {
    from: jest.Mock;
    rpc?: jest.Mock;
} {
    const from = jest.fn();
    setupMockFromSequence(from, chains);
    return { from };
}

describe("MemberInvoiceService", () => {
    describe("issueFromExecutedProposal", () => {
        it("inserts a single invoice row with snapshot intact (idempotent on second call)", async () => {
            const lookupChain = createChain({ data: null, error: null });
            const insertChain = createChain({ data: invoiceRow(), error: null });
            const client = buildMockClient([lookupChain, insertChain]);

            const service = new MemberInvoiceService(client as never);
            const result = await service.issueFromExecutedProposal(makeProposal());

            expect(result.alreadyExisted).toBe(false);
            expect(result.invoice.proposal_id).toBe(PROPOSAL_ID);
            expect(insertChain.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    proposal_id: PROPOSAL_ID,
                    member_id: MEMBER_ID,
                    source: "path_reward",
                    source_ref_id: RUN_ID,
                    period_month: "2026-04",
                    amount_total: 180000,
                    status: "issued",
                    snapshot_trade_name: "山田内装",
                    snapshot_invoice_registration_no: "T1234567890123",
                }),
            );
        });

        it("returns existing invoice without inserting again (冪等)", async () => {
            const lookupChain = createChain({ data: invoiceRow(), error: null });
            const client = buildMockClient([lookupChain]);

            const service = new MemberInvoiceService(client as never);
            const result = await service.issueFromExecutedProposal(makeProposal());

            expect(result.alreadyExisted).toBe(true);
            expect(result.invoice.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        });

        it("refuses if the proposal creator is not the same human as the invoice member (no proxy issuing)", async () => {
            const service = new MemberInvoiceService({ from: jest.fn() } as never);
            const bad = makeProposal({
                created_by: { type: "human", id: "different-user", name: "Other" },
            });
            await expect(service.issueFromExecutedProposal(bad)).rejects.toThrow(
                "MEMBER_INVOICE_CREATOR_MUST_BE_SELF",
            );
        });

        it("refuses if the proposal creator is an AI (AI cannot front-run a member invoice)", async () => {
            const service = new MemberInvoiceService({ from: jest.fn() } as never);
            const bad = makeProposal({
                created_by: { type: "ai", id: "sherpa-1", name: "Sherpa" },
            });
            await expect(service.issueFromExecutedProposal(bad)).rejects.toThrow(
                "MEMBER_INVOICE_CREATOR_MUST_BE_SELF",
            );
        });

        it("rejects proposals of the wrong type", async () => {
            const service = new MemberInvoiceService({ from: jest.fn() } as never);
            const bad = makeProposal({ type: "expense.create" });
            await expect(service.issueFromExecutedProposal(bad)).rejects.toThrow(
                "MEMBER_INVOICE_INVALID_PROPOSAL_TYPE",
            );
        });

        it("rejects an invalid period_month format", async () => {
            const service = new MemberInvoiceService({ from: jest.fn() } as never);
            const bad = makeProposal({
                payload: { ...makeProposal().payload, period_month: "2026/04" },
            });
            await expect(service.issueFromExecutedProposal(bad)).rejects.toThrow(
                "MEMBER_INVOICE_INVALID_PERIOD",
            );
        });
    });

    describe("listDraftCandidatesForMember", () => {
        function buildClientByTable(
            chains: Record<string, ReturnType<typeof createChain>>,
        ): { from: jest.Mock } {
            const from = jest.fn();
            setupMockFrom(from, chains);
            return { from };
        }

        it("returns finalized monthly distribution lines minus those already invoiced", async () => {
            const client = buildClientByTable({
                path_reward_runs: createChain({ data: [], error: null }),
                monthly_distribution_lines: createChain({
                    data: [
                        {
                            id: LINE_ID,
                            member_id: MEMBER_ID,
                            total_pay_amount: 120000,
                            total_pay: 120000,
                            monthly_distribution_close_id: CLOSE_ID,
                        },
                    ],
                    error: null,
                }),
                monthly_distribution_closes: createChain({
                    data: [{ id: CLOSE_ID, month: "2026-04", status: "approved" }],
                    error: null,
                }),
                member_invoices: createChain({ data: [], error: null }),
            });

            const service = new MemberInvoiceService(client as never);
            const drafts = await service.listDraftCandidatesForMember({
                orgId: ORG_ID,
                memberId: MEMBER_ID,
            });

            expect(drafts).toHaveLength(1);
            expect(drafts[0]).toMatchObject({
                source: "monthly_distribution",
                source_ref_id: LINE_ID,
                period_month: "2026-04",
                amount_total: 120000,
            });
        });

        it("excludes lines that already have an invoice issued (same source/ref/period)", async () => {
            const client = buildClientByTable({
                path_reward_runs: createChain({ data: [], error: null }),
                monthly_distribution_lines: createChain({
                    data: [
                        {
                            id: LINE_ID,
                            member_id: MEMBER_ID,
                            total_pay_amount: 120000,
                            total_pay: 120000,
                            monthly_distribution_close_id: CLOSE_ID,
                        },
                    ],
                    error: null,
                }),
                monthly_distribution_closes: createChain({
                    data: [{ id: CLOSE_ID, month: "2026-04", status: "approved" }],
                    error: null,
                }),
                member_invoices: createChain({
                    data: [
                        {
                            source: "monthly_distribution",
                            source_ref_id: LINE_ID,
                            period_month: "2026-04",
                            status: "issued",
                        },
                    ],
                    error: null,
                }),
            });

            const service = new MemberInvoiceService(client as never);
            const drafts = await service.listDraftCandidatesForMember({
                orgId: ORG_ID,
                memberId: MEMBER_ID,
            });

            expect(drafts).toHaveLength(0);
        });

        it("ignores non-finalized monthly distribution closes (draft_preview / disputed)", async () => {
            const client = buildClientByTable({
                path_reward_runs: createChain({ data: [], error: null }),
                monthly_distribution_lines: createChain({
                    data: [
                        {
                            id: LINE_ID,
                            member_id: MEMBER_ID,
                            total_pay_amount: 120000,
                            total_pay: 120000,
                            monthly_distribution_close_id: CLOSE_ID,
                        },
                    ],
                    error: null,
                }),
                monthly_distribution_closes: createChain({
                    data: [{ id: CLOSE_ID, month: "2026-04", status: "draft_preview" }],
                    error: null,
                }),
                member_invoices: createChain({ data: [], error: null }),
            });

            const service = new MemberInvoiceService(client as never);
            const drafts = await service.listDraftCandidatesForMember({
                orgId: ORG_ID,
                memberId: MEMBER_ID,
            });

            expect(drafts).toHaveLength(0);
        });

        it("picks up path_reward_runs.breakdown matching the member", async () => {
            const client = buildClientByTable({
                path_reward_runs: createChain({
                    data: [
                        {
                            id: RUN_ID,
                            month: "2026-04",
                            status: "approved",
                            reward_payload: {
                                breakdown: [
                                    { member_id: MEMBER_ID, total_pay_amount: 250000 },
                                    {
                                        member_id: "another-member",
                                        total_pay_amount: 100000,
                                    },
                                ],
                            },
                        },
                    ],
                    error: null,
                }),
                monthly_distribution_lines: createChain({ data: [], error: null }),
                member_invoices: createChain({ data: [], error: null }),
            });

            const service = new MemberInvoiceService(client as never);
            const drafts = await service.listDraftCandidatesForMember({
                orgId: ORG_ID,
                memberId: MEMBER_ID,
            });

            expect(drafts).toHaveLength(1);
            expect(drafts[0]).toMatchObject({
                source: "path_reward",
                source_ref_id: RUN_ID,
                period_month: "2026-04",
                amount_total: 250000,
            });
        });
    });

    describe("buildSnapshotForMember", () => {
        it("returns trimmed snapshot data when bank info is complete", async () => {
            const profileChain = createChain({
                data: {
                    id: MEMBER_ID,
                    trade_name: "山田内装",
                    invoice_registration_number: "T1234567890123",
                    bank_name: "みずほ",
                    branch_name: "新宿",
                    account_type: "普通",
                    account_number: "1234567",
                    account_holder_kana: "ヤマダタロウ",
                    postal_code: "1600022",
                    prefecture: "東京都",
                    city: "新宿区",
                    address_line1: "新宿1-1-1",
                    address_line2: null,
                },
                error: null,
            });
            const client = buildMockClient([profileChain]);

            const service = new MemberInvoiceService(client as never);
            const snap = await service.buildSnapshotForMember(MEMBER_ID);
            expect(snap.bank.bank_name).toBe("みずほ");
            expect(snap.invoice_registration_no).toBe("T1234567890123");
        });

        it("refuses to build snapshot when bank info is missing (請求書だけ出るのを防ぐ)", async () => {
            const profileChain = createChain({
                data: {
                    id: MEMBER_ID,
                    trade_name: "山田内装",
                    invoice_registration_number: null,
                    bank_name: null,
                    branch_name: null,
                    account_type: null,
                    account_number: null,
                    account_holder_kana: null,
                },
                error: null,
            });
            const client = buildMockClient([profileChain]);

            const service = new MemberInvoiceService(client as never);
            await expect(service.buildSnapshotForMember(MEMBER_ID)).rejects.toThrow(
                "MEMBER_BANK_INFO_INCOMPLETE",
            );
        });
    });

    describe("getOutstandingSummary", () => {
        it("forwards to rpc and never leaks PII", async () => {
            const rpc = jest.fn().mockResolvedValue({
                data: [
                    {
                        status: "issued",
                        period_month: "2026-04",
                        invoice_count: 3,
                        total_amount: 540000,
                    },
                ],
                error: null,
            });
            const client = { from: jest.fn(), rpc };

            const service = new MemberInvoiceService(client as never);
            const summary = await service.getOutstandingSummary({ orgId: ORG_ID });
            expect(rpc).toHaveBeenCalledWith(
                "rpc_org_invoices_outstanding_summary",
                { p_org_id: ORG_ID },
            );
            expect(summary).toEqual([
                {
                    status: "issued",
                    period_month: "2026-04",
                    invoice_count: 3,
                    total_amount: 540000,
                },
            ]);
        });

        it("re-throws ADMIN_ROLE_REQUIRED when the RPC enforces admin role", async () => {
            const rpc = jest.fn().mockResolvedValue({
                data: null,
                error: { message: "ADMIN_ROLE_REQUIRED" },
            });
            const client = { from: jest.fn(), rpc };

            const service = new MemberInvoiceService(client as never);
            await expect(service.getOutstandingSummary({ orgId: ORG_ID })).rejects.toThrow(
                "ADMIN_ROLE_REQUIRED",
            );
        });
    });
});
