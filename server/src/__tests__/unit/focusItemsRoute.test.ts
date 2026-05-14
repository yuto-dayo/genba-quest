import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import focusItemsRouter from "../../routes/focusItems";

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

function getHandler(method: "get" | "post" | "put", path: string) {
    const layer = (focusItemsRouter as any).stack.find(
        (entry: any) => entry.route?.path === path && entry.route?.methods?.[method]
    );

    if (!layer) {
        throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
    }

    return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("focus items router", () => {
    const listHandler = getHandler("get", "/");
    const createHandler = getHandler("post", "/");
    const completeHandler = getHandler("post", "/:id/complete");
    const resolveHandler = getHandler("post", "/:id/resolve");
    const reopenHandler = getHandler("post", "/:id/reopen");
    const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("GET / returns org items plus caller-owned personal items", async () => {
        const chain = createChain({
            data: [
                { id: "org-1", scope: "org", created_by: "member-2", horizon: "today", status: "open" },
                { id: "personal-own", scope: "personal", created_by: "member-1", horizon: "today", status: "open" },
                { id: "personal-other", scope: "personal", created_by: "member-2", horizon: "today", status: "open" },
            ],
            error: null,
        });
        mockFrom.mockReturnValue(chain);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            query: { status: "open" },
        } as any;
        const res = createMockRes();

        await listHandler(req, res);

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith([
            { id: "org-1", scope: "org", created_by: "member-2", horizon: "today", status: "open" },
            { id: "personal-own", scope: "personal", created_by: "member-1", horizon: "today", status: "open" },
        ]);
    });

    it("GET / applies focus/resolved range filters and include_legacy_done flag", async () => {
        const chain = createChain({
            data: [
                { id: "done-1", scope: "org", created_by: "member-2", horizon: "today", status: "done" },
                { id: "done-2", scope: "personal", created_by: "member-1", horizon: "today", status: "done" },
            ],
            error: null,
        });
        mockFrom.mockReturnValue(chain);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            query: {
                status: "done",
                focus_date_from: "2026-05-10",
                focus_date_to: "2026-05-12",
                resolved_from: "2026-05-12T00:00:00.000Z",
                resolved_to: "2026-05-13T00:00:00.000Z",
                include_legacy_done: "true",
            },
        } as any;
        const res = createMockRes();

        await listHandler(req, res);

        expect(chain.gte).toHaveBeenCalledWith("focus_date", "2026-05-10");
        expect(chain.lte).toHaveBeenCalledWith("focus_date", "2026-05-12");
        expect(chain.gte).toHaveBeenCalledWith("resolved_at", "2026-05-12T00:00:00.000Z");
        expect(chain.lt).toHaveBeenCalledWith("resolved_at", "2026-05-13T00:00:00.000Z");
        expect(chain.not).not.toHaveBeenCalledWith("resolution_kind", "is", null);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith([
            { id: "done-1", scope: "org", created_by: "member-2", horizon: "today", status: "done" },
            { id: "done-2", scope: "personal", created_by: "member-1", horizon: "today", status: "done" },
        ]);
    });

    it("GET / returns 400 when include_legacy_done is invalid", async () => {
        const chain = createChain({ data: [], error: null });
        mockFrom.mockReturnValue(chain);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            query: {
                status: "done",
                include_legacy_done: "maybe",
            },
        } as any;
        const res = createMockRes();

        await listHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "include_legacy_done must be true or false" });
    });

    it("POST / creates a focus item with a site snapshot and focus_date", async () => {
        const siteLookupChain = createChain({
            data: { id: "site-1", name: "A現場" },
            error: null,
        });
        const insertChain = createChain({
            data: {
                id: "focus-1",
                scope: "org",
                horizon: "today",
                title: "A現場の段取り確認",
                site_id: "site-1",
                site_name_snapshot: "A現場",
                focus_date: "2026-05-13",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [siteLookupChain, insertChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            body: {
                title: "A現場の段取り確認",
                scope: "org",
                horizon: "today",
                site_id: "site-1",
                focus_date: "2026-05-13",
            },
        } as any;
        const res = createMockRes();

        await createHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(insertChain.insert).toHaveBeenCalledWith(
            expect.objectContaining({
                org_id: "org-1",
                created_by: "member-1",
                site_id: "site-1",
                site_name_snapshot: "A現場",
                focus_date: "2026-05-13",
            })
        );
    });

    it("POST /:id/complete blocks other users from completing personal items", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "personal",
                created_by: "member-2",
                status: "open",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
        } as any;
        const res = createMockRes();

        await completeHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({
            error: "personal focus item は作成者のみ更新できます",
        });
    });

    it("POST /:id/complete sets completed_as_planned for open items", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "org",
                created_by: "member-2",
                status: "open",
            },
            error: null,
        });
        const updateChain = createChain({
            data: {
                id: "focus-1",
                status: "done",
                resolution_kind: "completed_as_planned",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain, updateChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
        } as any;
        const res = createMockRes();

        await completeHandler(req, res);

        expect(updateChain.update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "done",
                resolution_kind: "completed_as_planned",
                completed_by: "member-1",
                resolved_by: "member-1",
            })
        );
        expect(res.status).not.toHaveBeenCalled();
    });

    it("POST /:id/complete keeps existing resolution_kind when item is already done", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "org",
                created_by: "member-2",
                status: "done",
                resolution_kind: "not_completed",
            },
            error: null,
        });
        const currentRowChain = createChain({
            data: {
                id: "focus-1",
                status: "done",
                resolution_kind: "not_completed",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain, currentRowChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
        } as any;
        const res = createMockRes();

        await completeHandler(req, res);

        expect(currentRowChain.update).not.toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                id: "focus-1",
                status: "done",
                resolution_kind: "not_completed",
            })
        );
    });

    it("POST /:id/resolve marks open item as done with the provided resolution", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "org",
                created_by: "member-2",
                status: "open",
            },
            error: null,
        });
        const updateChain = createChain({
            data: {
                id: "focus-1",
                status: "done",
                resolution_kind: "completed_with_change",
                resolution_note: "工程を分割して対応",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain, updateChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
            body: {
                resolution_kind: "completed_with_change",
                resolution_note: "工程を分割して対応",
            },
        } as any;
        const res = createMockRes();

        await resolveHandler(req, res);

        expect(updateChain.update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "done",
                resolution_kind: "completed_with_change",
                resolution_note: "工程を分割して対応",
                completed_by: "member-1",
                resolved_by: "member-1",
            })
        );
        expect(res.status).not.toHaveBeenCalled();
    });

    it("POST /:id/resolve keeps resolved_at on done -> done updates", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "org",
                created_by: "member-2",
                status: "done",
                resolved_at: "2026-05-13T01:00:00.000Z",
                resolved_by: "member-9",
                completed_at: "2026-05-13T01:00:00.000Z",
                completed_by: "member-9",
                resolution_note: "旧メモ",
            },
            error: null,
        });
        const updateChain = createChain({
            data: {
                id: "focus-1",
                status: "done",
                resolution_kind: "not_completed",
                resolved_at: "2026-05-13T01:00:00.000Z",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain, updateChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
            body: {
                resolution_kind: "not_completed",
            },
        } as any;
        const res = createMockRes();

        await resolveHandler(req, res);

        expect(updateChain.update).toHaveBeenCalledWith(
            expect.objectContaining({
                resolution_kind: "not_completed",
                resolved_at: "2026-05-13T01:00:00.000Z",
                resolved_by: "member-9",
                completed_at: "2026-05-13T01:00:00.000Z",
                completed_by: "member-9",
            })
        );
    });

    it("POST /:id/resolve returns 400 for invalid resolution_kind", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "org",
                created_by: "member-2",
                status: "open",
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
            body: { resolution_kind: "blocked" },
        } as any;
        const res = createMockRes();

        await resolveHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({ error: "Invalid resolution_kind" });
    });

    it("POST /:id/reopen clears resolution and completion fields", async () => {
        const lookupChain = createChain({
            data: {
                id: "focus-1",
                org_id: "org-1",
                scope: "org",
                created_by: "member-2",
                status: "done",
            },
            error: null,
        });
        const updateChain = createChain({
            data: {
                id: "focus-1",
                status: "open",
                resolution_kind: null,
                resolved_at: null,
            },
            error: null,
        });
        setupMockFromSequence(mockFrom, [lookupChain, updateChain]);

        const req = {
            orgId: "org-1",
            userId: "member-1",
            params: { id: "focus-1" },
        } as any;
        const res = createMockRes();

        await reopenHandler(req, res);

        expect(updateChain.update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "open",
                completed_at: null,
                completed_by: null,
                resolution_kind: null,
                resolution_note: null,
                resolved_at: null,
                resolved_by: null,
            })
        );
        expect(res.status).not.toHaveBeenCalled();
    });
});
