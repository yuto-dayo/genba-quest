/**
 * Verifies that business routers gate every request through
 * requireOrgMembership before reaching route handlers. The
 * middleware is invoked by feeding the routers a constructed
 * Express request via Router.handle, with resolveActiveOrgMembership
 * mocked to simulate various authorization outcomes.
 */

const mockResolveActiveOrgMembership = jest.fn();

jest.mock("../../lib/orgAccess", () => ({
  resolveActiveOrgMembership: (...args: any[]) => mockResolveActiveOrgMembership(...args),
}));

jest.mock("../../services/ProposalService", () => ({
  ProposalService: jest.fn().mockImplementation(() => ({})),
}));

import proposalsRouter from "../../routes/proposals";
import sitesRouter from "../../routes/sites";

function buildReq(overrides: Partial<{
  method: string;
  url: string;
  userId: string | undefined;
  headers: Record<string, string | string[] | undefined>;
}> = {}): any {
  return {
    method: overrides.method ?? "GET",
    url: overrides.url ?? "/",
    originalUrl: overrides.url ?? "/",
    baseUrl: "",
    path: overrides.url ?? "/",
    query: {},
    params: {},
    body: {},
    headers: overrides.headers ?? {},
    userId: overrides.userId,
  };
}

function runRouter(router: any, req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const res: any = {
      statusCode: 200,
      headersSent: false,
      locals: {},
      setHeader: jest.fn(),
      getHeader: jest.fn(),
    };
    res.status = jest.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }).mockImplementation(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    });
    res.json = jest.fn().mockImplementation(function (this: any, _body: unknown) {
      this.headersSent = true;
      resolve(this);
      return this;
    });
    res.send = jest.fn().mockImplementation(function (this: any, _body: unknown) {
      this.headersSent = true;
      resolve(this);
      return this;
    });
    res.end = jest.fn().mockImplementation(function (this: any) {
      this.headersSent = true;
      resolve(this);
      return this;
    });

    router.handle(req, res, (err?: unknown) => {
      if (err) {
        reject(err);
      } else if (!res.headersSent) {
        resolve(res);
      }
    });
  });
}

describe.each([
  ["proposals", proposalsRouter as any, "/"],
  ["sites", sitesRouter as any, "/"],
])("%s router membership guard", (_name, router, url) => {
  beforeEach(() => {
    mockResolveActiveOrgMembership.mockReset();
  });

  it("returns 401 when req.userId is missing", async () => {
    const req = buildReq({ url, userId: undefined });
    const res = await runRouter(router, req);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "USER_CONTEXT_REQUIRED" });
    expect(mockResolveActiveOrgMembership).not.toHaveBeenCalled();
  });

  it("returns 403 when the user has no membership", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("ORG_MEMBERSHIP_REQUIRED"));
    const req = buildReq({ url, userId: "user-without-org" });
    const res = await runRouter(router, req);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_MEMBERSHIP_REQUIRED" });
  });

  it("returns 403 when membership lookup rejects a forged x-org-id", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("ORG_MEMBERSHIP_REQUIRED"));
    const req = buildReq({
      url,
      userId: "user-1",
      headers: { "x-org-id": "99999999-9999-4999-8999-999999999999" },
    });
    const res = await runRouter(router, req);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(mockResolveActiveOrgMembership).toHaveBeenCalledWith(req, "member");
  });

  it("returns 400 when x-org-id is malformed", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("INVALID_ORG_ID"));
    const req = buildReq({
      url,
      userId: "user-1",
      headers: { "x-org-id": "not-a-uuid" },
    });
    const res = await runRouter(router, req);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "INVALID_ORG_ID" });
  });
});
