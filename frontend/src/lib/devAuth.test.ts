import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevAuthUiEnabled } from "./devAuth";

describe("dev auth safety", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("enables development auth for local Supabase targets", () => {
        vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
        vi.stubEnv("VITE_API_URL", "http://localhost:4001");

        expect(isDevAuthUiEnabled()).toBe(true);
    });

    it("disables development auth when Supabase points at a hosted project", () => {
        vi.stubEnv("VITE_SUPABASE_URL", "https://example-ref.supabase.co");
        vi.stubEnv("VITE_API_URL", "http://localhost:4001");

        expect(isDevAuthUiEnabled()).toBe(false);
    });

    it("disables development auth when API points at a remote host", () => {
        vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321");
        vi.stubEnv("VITE_API_URL", "https://api.example.com");

        expect(isDevAuthUiEnabled()).toBe(false);
    });
});
