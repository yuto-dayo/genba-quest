jest.mock("../../lib/supabaseAdmin", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

import { ProfileViewConsentService } from "../../services/ProfileViewConsentService";
import type { Proposal } from "../../services/PolicyEngine";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PROPOSAL_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";
const ADMIN_ID = "44444444-4444-4444-8444-444444444444";
const GRANT_ID = "55555555-5555-4555-8555-555555555555";

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
    return {
        id: PROPOSAL_ID,
        org_id: ORG_ID,
        type: "profile.view_request",
        status: "executed",
        document_id: null,
        site_id: null,
        created_by: { type: "human", id: ADMIN_ID, name: "Admin" },
        payload: {
            target_user_id: TARGET_ID,
            requesting_admin_id: ADMIN_ID,
            purpose: "振込エラーの調査のため口座情報を確認したい",
            duration_hours: 12,
        },
        description: "test",
        approvals: [],
        required_approvals: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...overrides,
    } as Proposal;
}

function grantRow(overrides: Partial<{
    revoked_at: string | null;
    revoked_by: string | null;
    expires_at: string;
    target_user_id: string;
    requesting_admin_id: string;
}> = {}) {
    return {
        id: GRANT_ID,
        org_id: ORG_ID,
        proposal_id: PROPOSAL_ID,
        target_user_id: overrides.target_user_id ?? TARGET_ID,
        requesting_admin_id: overrides.requesting_admin_id ?? ADMIN_ID,
        purpose: "test purpose",
        granted_at: new Date().toISOString(),
        expires_at: overrides.expires_at ?? new Date(Date.now() + 3600_000).toISOString(),
        revoked_at: overrides.revoked_at ?? null,
        revoked_by: overrides.revoked_by ?? null,
        revocation_reason: null,
        created_at: new Date().toISOString(),
    };
}

function buildMockClient(chains: ReturnType<typeof createChain>[]): { from: jest.Mock } {
    const from = jest.fn();
    setupMockFromSequence(from, chains);
    return { from };
}

describe("ProfileViewConsentService", () => {
    describe("createGrantFromExecutedProposal", () => {
        it("issues a single grant with computed expiry and is idempotent on second call", async () => {
            // 1st call: existing lookup (none) + insert
            const lookupChain = createChain({ data: null, error: null });
            const insertChain = createChain({ data: grantRow(), error: null });
            const client = buildMockClient([lookupChain, insertChain]);

            const service = new ProfileViewConsentService(client as never);
            const result = await service.createGrantFromExecutedProposal(makeProposal());

            expect(result.alreadyExisted).toBe(false);
            expect(result.grant.target_user_id).toBe(TARGET_ID);
            expect(insertChain.insert).toHaveBeenCalledWith(
                expect.objectContaining({
                    proposal_id: PROPOSAL_ID,
                    target_user_id: TARGET_ID,
                    requesting_admin_id: ADMIN_ID,
                }),
            );
        });

        it("returns existing grant without inserting again (冪等)", async () => {
            const lookupChain = createChain({ data: grantRow(), error: null });
            const client = buildMockClient([lookupChain]);

            const service = new ProfileViewConsentService(client as never);
            const result = await service.createGrantFromExecutedProposal(makeProposal());

            expect(result.alreadyExisted).toBe(true);
            expect(result.grant.id).toBe(GRANT_ID);
        });

        it("rejects proposal of wrong type", async () => {
            const service = new ProfileViewConsentService({ from: jest.fn() } as never);
            const bad = makeProposal({ type: "expense.create" });
            await expect(service.createGrantFromExecutedProposal(bad)).rejects.toThrow(
                "PROFILE_VIEW_CONSENT_INVALID_PROPOSAL_TYPE",
            );
        });

        it("rejects self-grant (target === requester)", async () => {
            const service = new ProfileViewConsentService({ from: jest.fn() } as never);
            const bad = makeProposal({
                payload: {
                    target_user_id: ADMIN_ID,
                    requesting_admin_id: ADMIN_ID,
                    purpose: "self",
                    duration_hours: 12,
                },
            });
            await expect(service.createGrantFromExecutedProposal(bad)).rejects.toThrow(
                "PROFILE_VIEW_CONSENT_SELF_GRANT_PROHIBITED",
            );
        });
    });

    describe("revokeGrant", () => {
        it("allows target to revoke and records governance.profile_view.revoked", async () => {
            const lookupChain = createChain({ data: grantRow(), error: null });
            const updateChain = createChain({
                data: grantRow({ revoked_at: new Date().toISOString(), revoked_by: TARGET_ID }),
                error: null,
            });
            const governanceChain = createChain({ data: null, error: null });
            const client = buildMockClient([lookupChain, updateChain, governanceChain]);

            const service = new ProfileViewConsentService(client as never);
            const result = await service.revokeGrant({
                grantId: GRANT_ID,
                revokingUserId: TARGET_ID,
                revokingUserName: "Target Person",
                reason: "もう必要ない",
            });

            expect(result.revoked_at).not.toBeNull();
            expect(governanceChain.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_type: "governance.profile_view.revoked",
                    actor: expect.objectContaining({ id: TARGET_ID, type: "human" }),
                }),
                expect.any(Object),
            );
        });

        it("refuses revoke if the caller is not the target user (admin cannot self-revoke)", async () => {
            const lookupChain = createChain({ data: grantRow(), error: null });
            const client = buildMockClient([lookupChain]);

            const service = new ProfileViewConsentService(client as never);
            await expect(
                service.revokeGrant({ grantId: GRANT_ID, revokingUserId: ADMIN_ID }),
            ).rejects.toThrow("PROFILE_VIEW_GRANT_REVOKE_NOT_ALLOWED");
        });

        it("is idempotent on already-revoked grant", async () => {
            const alreadyRevoked = grantRow({
                revoked_at: new Date().toISOString(),
                revoked_by: TARGET_ID,
            });
            const lookupChain = createChain({ data: alreadyRevoked, error: null });
            const client = buildMockClient([lookupChain]);

            const service = new ProfileViewConsentService(client as never);
            const result = await service.revokeGrant({
                grantId: GRANT_ID,
                revokingUserId: TARGET_ID,
            });

            expect(result.revoked_at).toBe(alreadyRevoked.revoked_at);
        });

        it("404s when grant not found", async () => {
            const lookupChain = createChain({ data: null, error: null });
            const client = buildMockClient([lookupChain]);

            const service = new ProfileViewConsentService(client as never);
            await expect(
                service.revokeGrant({ grantId: GRANT_ID, revokingUserId: TARGET_ID }),
            ).rejects.toThrow("PROFILE_VIEW_GRANT_NOT_FOUND");
        });
    });

    describe("getExtendedProfileForViewer", () => {
        it("returns own profile without requiring a grant (no governance event)", async () => {
            const profileChain = createChain({
                data: { id: TARGET_ID, phone: "090-0000-0000" },
                error: null,
            });
            const client = buildMockClient([profileChain]);

            const service = new ProfileViewConsentService(client as never);
            const result = await service.getExtendedProfileForViewer({
                orgId: ORG_ID,
                targetUserId: TARGET_ID,
                viewer: { type: "human", id: TARGET_ID, name: "self" },
            });

            expect(result.grant).toBeNull();
            expect(result.profile.id).toBe(TARGET_ID);
        });

        it("returns target profile when a non-expired non-revoked grant exists and records access event", async () => {
            const grantLookupChain = createChain({ data: grantRow(), error: null });
            const profileChain = createChain({
                data: { id: TARGET_ID, phone: "090-9999-9999" },
                error: null,
            });
            const governanceChain = createChain({ data: null, error: null });
            const client = buildMockClient([grantLookupChain, profileChain, governanceChain]);

            const service = new ProfileViewConsentService(client as never);
            const result = await service.getExtendedProfileForViewer({
                orgId: ORG_ID,
                targetUserId: TARGET_ID,
                viewer: { type: "human", id: ADMIN_ID, name: "Admin" },
            });

            expect(result.grant?.id).toBe(GRANT_ID);
            expect(result.profile.id).toBe(TARGET_ID);
            expect(governanceChain.upsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    event_type: "governance.profile_view.accessed",
                    actor: expect.objectContaining({ id: ADMIN_ID }),
                }),
                expect.any(Object),
            );
        });

        it("refuses access when no active grant exists", async () => {
            const grantLookupChain = createChain({ data: null, error: null });
            const client = buildMockClient([grantLookupChain]);

            const service = new ProfileViewConsentService(client as never);
            await expect(
                service.getExtendedProfileForViewer({
                    orgId: ORG_ID,
                    targetUserId: TARGET_ID,
                    viewer: { type: "human", id: ADMIN_ID, name: "Admin" },
                }),
            ).rejects.toThrow("PROFILE_VIEW_GRANT_REQUIRED");
        });
    });
});
