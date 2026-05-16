import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
    api,
    fetchMemberReimbursementBalance,
    fetchMemberReimbursementsSummary,
    fetchTeamRewardSummary,
    type AccountingTransaction,
    type CreateExpenseRequest,
    type MemberReimbursementBalance,
    type MemberReimbursementsSummary,
    type TeamRewardSummary,
} from "./api";

const getAuthToken = vi.fn();
const getActiveOrgId = vi.fn();
const getDevAuthUserKey = vi.fn();

vi.mock("./supabase", () => ({
    getAuthToken: (...args: unknown[]) => getAuthToken(...args),
}));

vi.mock("../stores/activeOrg", () => ({
    getActiveOrgId: (...args: unknown[]) => getActiveOrgId(...args),
}));

vi.mock("./devAuth", () => ({
    getDevAuthUserKey: (...args: unknown[]) => getDevAuthUserKey(...args),
}));

describe("api", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
        getAuthToken.mockResolvedValue("token");
        getActiveOrgId.mockReturnValue("11111111-1111-4111-8111-111111111111");
        getDevAuthUserKey.mockReturnValue(null);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it("sends x-org-id when an active org is selected", async () => {
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );

        await api("/api/test");

        const requestInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
        const headers = requestInit.headers as Headers;

        expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe("/api/test");
        expect(headers.get("Authorization")).toBe("Bearer token");
        expect(headers.get("x-org-id")).toBe("11111111-1111-4111-8111-111111111111");
    });

    it("omits x-org-id when no active org is selected", async () => {
        getActiveOrgId.mockReturnValue(null);
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );

        await api("/api/test");

        const requestInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
        const headers = requestInit.headers as Headers;

        expect(headers.has("x-org-id")).toBe(false);
    });

    it("sends x-dev-user-key when a development user is selected", async () => {
        getDevAuthUserKey.mockReturnValue("jay");
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    "Content-Type": "application/json",
                },
            }),
        );

        await api("/api/test");

        const requestInit = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
        const headers = requestInit.headers as Headers;

        expect(headers.get("x-dev-user-key")).toBe("jay");
    });

    it("wraps fetch connection failures with a clearer network error", async () => {
        vi.mocked(fetch).mockRejectedValue(new TypeError("Failed to fetch"));

        await expect(api("/api/test")).rejects.toThrow(
            "NETWORK_ERROR: API server is unreachable. Start the server or set VITE_API_URL.",
        );
    });
});

describe("money redesign api types", () => {
    it("exposes typed member reimbursement and team reward fetchers", () => {
        expectTypeOf(fetchMemberReimbursementsSummary).returns.toEqualTypeOf<Promise<MemberReimbursementsSummary>>();
        expectTypeOf(fetchMemberReimbursementBalance).returns.toEqualTypeOf<Promise<MemberReimbursementBalance>>();
        expectTypeOf(fetchTeamRewardSummary).returns.toEqualTypeOf<Promise<TeamRewardSummary>>();
        expectTypeOf<MemberReimbursementsSummary["self_member_id"]>().toEqualTypeOf<string | null>();
        expectTypeOf<TeamRewardSummary["self_member_id"]>().toEqualTypeOf<string | null>();
    });

    it("keeps reimbursement accounting fields optional during migration", () => {
        expectTypeOf<AccountingTransaction["paid_by"]>().toEqualTypeOf<"org" | "member" | undefined>();
        expectTypeOf<AccountingTransaction["claimant_member_id"]>().toEqualTypeOf<string | null | undefined>();
        expectTypeOf<AccountingTransaction["settlement_type"]>().toEqualTypeOf<"paid" | "unpaid" | undefined>();
        expectTypeOf<AccountingTransaction["payment_account"]>().toEqualTypeOf<"cash" | "bank" | null | undefined>();
        expectTypeOf<AccountingTransaction["reimbursement_status"]>().toEqualTypeOf<
            "unsubmitted" | "submitted" | "approved" | "reimbursed" | null | undefined
        >();

        expectTypeOf<CreateExpenseRequest["paid_by"]>().toEqualTypeOf<"org" | "member" | undefined>();
        expectTypeOf<CreateExpenseRequest["claimant_member_id"]>().toEqualTypeOf<string | null | undefined>();
        expectTypeOf<CreateExpenseRequest["settlement_type"]>().toEqualTypeOf<"paid" | "unpaid" | undefined>();
        expectTypeOf<CreateExpenseRequest["payment_account"]>().toEqualTypeOf<"cash" | "bank" | null | undefined>();
        expectTypeOf<CreateExpenseRequest["reimbursement_status"]>().toEqualTypeOf<
            "unsubmitted" | "submitted" | "approved" | "reimbursed" | null | undefined
        >();
    });
});
