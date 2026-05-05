import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

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
