jest.mock("../../lib/supabaseClient", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

import { OrgMembershipManagementService } from "../../services/OrgMembershipManagementService";
import { supabaseAdmin } from "../../lib/supabaseClient";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const TARGET_ID = "33333333-3333-4333-8333-333333333333";

function membershipRow(overrides: Partial<{ role: "admin" | "member"; user_id: string }> = {}) {
    return {
        id: "44444444-4444-4444-8444-444444444444",
        org_id: ORG_ID,
        user_id: overrides.user_id ?? TARGET_ID,
        role: overrides.role ?? "member",
        status: "active" as const,
        title: null,
        approval_limit: null,
        joined_at: null,
    };
}

describe("OrgMembershipManagementService", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe("updateRole", () => {
        it("promotes a member to admin without checking admin count", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "member" }), error: null });
            const updateChain = createChain({ data: membershipRow({ role: "admin" }), error: null });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain, updateChain]);

            const service = new OrgMembershipManagementService();
            const result = await service.updateRole({
                orgId: ORG_ID,
                actorUserId: ACTOR_ID,
                targetUserId: TARGET_ID,
                newRole: "admin",
            });

            expect(result.role).toBe("admin");
            expect(updateChain.update).toHaveBeenCalledWith(
                expect.objectContaining({ role: "admin" }),
            );
        });

        it("demotes an admin to member when at least one other admin remains", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "admin" }), error: null });
            // The admin count query returns count via the chain "then" path.
            const countChain = createChain({ count: 2, error: null } as never);
            const updateChain = createChain({ data: membershipRow({ role: "member" }), error: null });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain, countChain, updateChain]);

            const service = new OrgMembershipManagementService();
            const result = await service.updateRole({
                orgId: ORG_ID,
                actorUserId: ACTOR_ID,
                targetUserId: TARGET_ID,
                newRole: "member",
            });

            expect(result.role).toBe("member");
        });

        it("refuses to demote the last admin", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "admin" }), error: null });
            const countChain = createChain({ count: 1, error: null } as never);
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain, countChain]);

            const service = new OrgMembershipManagementService();
            await expect(
                service.updateRole({
                    orgId: ORG_ID,
                    actorUserId: ACTOR_ID,
                    targetUserId: TARGET_ID,
                    newRole: "member",
                }),
            ).rejects.toThrow("ORG_MEMBER_LAST_ADMIN");
        });

        it("rejects invalid roles", async () => {
            const service = new OrgMembershipManagementService();
            await expect(
                service.updateRole({
                    orgId: ORG_ID,
                    actorUserId: ACTOR_ID,
                    targetUserId: TARGET_ID,
                    newRole: "owner" as never,
                }),
            ).rejects.toThrow("ORG_MEMBER_ROLE_INVALID");
        });

        it("throws ORG_MEMBER_NOT_FOUND when the target is missing", async () => {
            const loadChain = createChain({ data: null, error: null });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain]);

            const service = new OrgMembershipManagementService();
            await expect(
                service.updateRole({
                    orgId: ORG_ID,
                    actorUserId: ACTOR_ID,
                    targetUserId: TARGET_ID,
                    newRole: "admin",
                }),
            ).rejects.toThrow("ORG_MEMBER_NOT_FOUND");
        });

        it("returns the existing record when the role is already the requested one", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "admin" }), error: null });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain]);

            const service = new OrgMembershipManagementService();
            const result = await service.updateRole({
                orgId: ORG_ID,
                actorUserId: ACTOR_ID,
                targetUserId: TARGET_ID,
                newRole: "admin",
            });

            expect(result.role).toBe("admin");
            // Only loadChain should be consumed - no update call
            expect(supabaseAdmin.from).toHaveBeenCalledTimes(1);
        });
    });

    describe("remove", () => {
        it("removes a regular member by setting status to removed", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "member" }), error: null });
            const updateChain = createChain({
                data: { ...membershipRow({ role: "member" }), status: "removed" },
                error: null,
            });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain, updateChain]);

            const service = new OrgMembershipManagementService();
            const result = await service.remove({
                orgId: ORG_ID,
                actorUserId: ACTOR_ID,
                targetUserId: TARGET_ID,
            });

            expect(result.status).toBe("removed");
            expect(updateChain.update).toHaveBeenCalledWith(
                expect.objectContaining({ status: "removed" }),
            );
        });

        it("rejects self-removal", async () => {
            const service = new OrgMembershipManagementService();
            await expect(
                service.remove({
                    orgId: ORG_ID,
                    actorUserId: ACTOR_ID,
                    targetUserId: ACTOR_ID,
                }),
            ).rejects.toThrow("ORG_MEMBER_REMOVE_SELF");
        });

        it("refuses to remove the last admin", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "admin" }), error: null });
            const countChain = createChain({ count: 1, error: null } as never);
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain, countChain]);

            const service = new OrgMembershipManagementService();
            await expect(
                service.remove({
                    orgId: ORG_ID,
                    actorUserId: ACTOR_ID,
                    targetUserId: TARGET_ID,
                }),
            ).rejects.toThrow("ORG_MEMBER_LAST_ADMIN");
        });

        it("removes an admin when another admin remains", async () => {
            const loadChain = createChain({ data: membershipRow({ role: "admin" }), error: null });
            const countChain = createChain({ count: 2, error: null } as never);
            const updateChain = createChain({
                data: { ...membershipRow({ role: "admin" }), status: "removed" },
                error: null,
            });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain, countChain, updateChain]);

            const service = new OrgMembershipManagementService();
            const result = await service.remove({
                orgId: ORG_ID,
                actorUserId: ACTOR_ID,
                targetUserId: TARGET_ID,
            });

            expect(result.status).toBe("removed");
        });

        it("throws ORG_MEMBER_NOT_FOUND when the target is missing", async () => {
            const loadChain = createChain({ data: null, error: null });
            setupMockFromSequence(supabaseAdmin.from as jest.Mock, [loadChain]);

            const service = new OrgMembershipManagementService();
            await expect(
                service.remove({
                    orgId: ORG_ID,
                    actorUserId: ACTOR_ID,
                    targetUserId: TARGET_ID,
                }),
            ).rejects.toThrow("ORG_MEMBER_NOT_FOUND");
        });
    });
});
