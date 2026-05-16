jest.mock("../../lib/supabaseAdmin", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

import {
    InvoiceReviewerAssignmentService,
    type InvoiceReviewAssignmentRecord,
} from "../../services/InvoiceReviewerAssignmentService";
import { createChain } from "../helpers/mockSupabase";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ISSUER_ID = "22222222-2222-4222-8222-222222222222";
const REVIEWER_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";

function invoiceRow(overrides: Record<string, unknown> = {}) {
    return {
        id: INVOICE_ID,
        org_id: ORG_ID,
        member_id: ISSUER_ID,
        status: "issued",
        amount_total: 180000,
        issued_at: "2026-05-16T00:00:00.000Z",
        invoice_no: "MI-202605-22222222-aaaaaaaa",
        ...overrides,
    };
}

function assignmentRow(overrides: Partial<InvoiceReviewAssignmentRecord> = {}): InvoiceReviewAssignmentRecord {
    return {
        id: "99999999-9999-4999-8999-999999999999",
        invoice_id: INVOICE_ID,
        reviewer_user_id: REVIEWER_ID,
        org_id: ORG_ID,
        assigned_at: "2026-05-16T00:00:00.000Z",
        expires_at: "2026-05-23T00:00:00.000Z",
        completed_at: null,
        reassigned_from: null,
        ...overrides,
    };
}

function buildClient(
    tableChains: Record<string, ReturnType<typeof createChain>[]>,
): { from: jest.Mock } {
    const from = jest.fn((table: string) => {
        const queue = tableChains[table] || [];
        return queue.shift() || createChain();
    });
    return { from };
}

describe("InvoiceReviewerAssignmentService", () => {
    it("assigns the only active non-issuer candidate and sends approval_required", async () => {
        const insertAssignment = createChain({ data: assignmentRow(), error: null });
        const notify = createChain({ data: null, error: null });
        const client = buildClient({
            member_invoices: [createChain({ data: invoiceRow(), error: null })],
            invoice_review_assignments: [
                createChain({ data: null, error: null }),
                insertAssignment,
            ],
            org_settings: [createChain({ data: { finance_review_window_hours: 168 }, error: null })],
            org_memberships: [
                createChain({ data: [{ user_id: REVIEWER_ID }], error: null }),
            ],
            notifications: [notify],
        });

        const service = new InvoiceReviewerAssignmentService(
            client as never,
            () => 0,
            () => new Date("2026-05-16T00:00:00.000Z"),
        );
        const result = await service.assignFinanceReviewer(INVOICE_ID);

        expect(result.candidateCount).toBe(1);
        expect(result.assignment?.reviewer_user_id).toBe(REVIEWER_ID);
        expect(insertAssignment.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                invoice_id: INVOICE_ID,
                org_id: ORG_ID,
                reviewer_user_id: REVIEWER_ID,
                expires_at: "2026-05-23T00:00:00.000Z",
            }),
        );
        expect(notify.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                user_id: REVIEWER_ID,
                type: "approval_required",
                data: { invoice_id: INVOICE_ID, kind: "member_invoice_pay" },
            }),
        );
    });

    it("creates no assignment and notifies admins when the candidate pool is empty", async () => {
        const adminFallbackNotify = createChain({ data: null, error: null });
        const client = buildClient({
            member_invoices: [createChain({ data: invoiceRow(), error: null })],
            invoice_review_assignments: [createChain({ data: null, error: null })],
            org_settings: [createChain({ data: null, error: null })],
            org_memberships: [
                createChain({ data: [], error: null }),
                createChain({ data: [{ user_id: ADMIN_ID }], error: null }),
            ],
            notifications: [adminFallbackNotify],
        });

        const service = new InvoiceReviewerAssignmentService(client as never);
        const result = await service.assignFinanceReviewer(INVOICE_ID);

        expect(result).toEqual({ assignment: null, candidateCount: 0 });
        expect(adminFallbackNotify.insert).toHaveBeenCalledWith([
            expect.objectContaining({
                user_id: ADMIN_ID,
                type: "approval_required",
                data: expect.objectContaining({
                    invoice_id: INVOICE_ID,
                    kind: "member_invoice_pay",
                    candidate_pool_empty: true,
                }),
            }),
        ]);
    });

    it("excludes the invoice issuer from the reviewer candidate query", async () => {
        const candidates = createChain({ data: [{ user_id: REVIEWER_ID }], error: null });
        const client = buildClient({
            member_invoices: [createChain({ data: invoiceRow(), error: null })],
            invoice_review_assignments: [
                createChain({ data: null, error: null }),
                createChain({ data: assignmentRow(), error: null }),
            ],
            org_settings: [createChain({ data: null, error: null })],
            org_memberships: [candidates],
            notifications: [createChain({ data: null, error: null })],
        });

        const service = new InvoiceReviewerAssignmentService(client as never);
        await service.assignFinanceReviewer(INVOICE_ID);

        expect(candidates.neq).toHaveBeenCalledWith("user_id", ISSUER_ID);
    });

    it("rejects payout detail after the assignment expires before loading invoice snapshots", async () => {
        const expired = createChain({
            data: assignmentRow({ expires_at: "2026-05-16T01:00:00.000Z" }),
            error: null,
        });
        const client = buildClient({
            invoice_review_assignments: [expired],
        });
        const service = new InvoiceReviewerAssignmentService(
            client as never,
            Math.random,
            () => new Date("2026-05-16T02:00:00.000Z"),
        );

        await expect(
            service.getPayoutDetail({
                invoiceId: INVOICE_ID,
                orgId: ORG_ID,
                reviewerUserId: REVIEWER_ID,
            }),
        ).rejects.toThrow("INVOICE_REVIEW_ASSIGNMENT_EXPIRED");
        expect(client.from).not.toHaveBeenCalledWith("member_invoices");
    });
});
