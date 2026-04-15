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

    it("POST / creates a focus item with a site snapshot", async () => {
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
});
