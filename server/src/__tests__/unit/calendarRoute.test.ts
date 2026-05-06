import { createChain } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

jest.mock("../../lib/orgAccess", () => ({
    resolveActiveOrgMembership: jest.fn(),
}));

jest.mock("../../services/OrgMemberDirectoryService", () => ({
    listOrgMembers: jest.fn(),
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import { resolveActiveOrgMembership } from "../../lib/orgAccess";
import { listOrgMembers } from "../../services/OrgMemberDirectoryService";
import calendarRouter from "../../routes/calendar";

type MockRes = {
    status: jest.Mock;
    json: jest.Mock;
};

function createMockRes(): MockRes {
    const res = {
        status: jest.fn(),
        json: jest.fn(),
    } as unknown as MockRes;
    res.status.mockReturnValue(res);
    return res;
}

function getHandler(method: "get" | "delete", path: string) {
    const layer = (calendarRouter as any).stack.find(
        (entry: any) => entry.route?.path === path && entry.route?.methods?.[method]
    );

    if (!layer) {
        throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
    }

    return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("calendar router", () => {
    const personalSchedulesHandler = getHandler("get", "/personal-schedules");
    const deletePersonalScheduleHandler = getHandler("delete", "/personal-schedules/:id");
    const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;
    const mockResolveMembership = resolveActiveOrgMembership as jest.Mock;
    const mockListOrgMembers = listOrgMembers as jest.Mock;

    beforeEach(() => {
        jest.clearAllMocks();
        mockResolveMembership.mockResolvedValue({
            org_id: "org-1",
            user_id: "member-1",
            role: "member",
            status: "active",
        });
    });

    it("GET /personal-schedules lists organization member schedules by date overlap", async () => {
        mockListOrgMembers.mockResolvedValue([
            { user_id: "member-1" },
            { user_id: "member-2" },
        ]);
        const scheduleChain = createChain({
            data: [{ id: "schedule-1", user_id: "member-2", start_date: "2026-04-25", end_date: "2026-04-25" }],
            error: null,
        });
        mockFrom.mockReturnValue(scheduleChain);

        const req = {
            query: { from: "2026-04-01", to: "2026-04-30", scope: "organization" },
        } as any;
        const res = createMockRes();

        await personalSchedulesHandler(req, res);

        expect(mockListOrgMembers).toHaveBeenCalledWith("org-1");
        expect(scheduleChain.in).toHaveBeenCalledWith("user_id", ["member-1", "member-2"]);
        expect(scheduleChain.eq).toHaveBeenCalledWith("visibility", "organization");
        expect(scheduleChain.lte).toHaveBeenCalledWith("start_date", "2026-04-30");
        expect(scheduleChain.gte).toHaveBeenCalledWith("end_date", "2026-04-01");
        expect(res.json).toHaveBeenCalledWith([
            { id: "schedule-1", user_id: "member-2", start_date: "2026-04-25", end_date: "2026-04-25" },
        ]);
    });

    it("GET /personal-schedules validates date range", async () => {
        const req = {
            query: { from: "2026-04-30", to: "2026-04-01" },
        } as any;
        const res = createMockRes();

        await personalSchedulesHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "from must be before or equal to to" });
        expect(mockFrom).not.toHaveBeenCalled();
    });

    it("DELETE /personal-schedules/:id removes only the current member schedule", async () => {
        const deleteChain = createChain({
            data: { id: "schedule-1" },
            error: null,
        });
        mockFrom.mockReturnValue(deleteChain);

        const req = {
            params: { id: "schedule-1" },
        } as any;
        const res = createMockRes();

        await deletePersonalScheduleHandler(req, res);

        expect(deleteChain.delete).toHaveBeenCalled();
        expect(deleteChain.eq).toHaveBeenCalledWith("id", "schedule-1");
        expect(deleteChain.eq).toHaveBeenCalledWith("user_id", "member-1");
        expect(res.json).toHaveBeenCalledWith({ ok: true, id: "schedule-1" });
    });
});
