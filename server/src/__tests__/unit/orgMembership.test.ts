const mockResolveActiveOrgMembership = jest.fn();

jest.mock("../../lib/orgAccess", () => ({
  resolveActiveOrgMembership: (...args: any[]) => mockResolveActiveOrgMembership(...args),
}));

import { requireOrgMembership } from "../../middleware/orgMembership";

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

describe("requireOrgMembership", () => {
  beforeEach(() => {
    mockResolveActiveOrgMembership.mockReset();
  });

  it("rejects with 401 when req.userId is not set", async () => {
    const req = { headers: {} } as any;
    const res = createMockRes();
    const next = jest.fn();

    await requireOrgMembership()(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "USER_CONTEXT_REQUIRED" });
    expect(mockResolveActiveOrgMembership).not.toHaveBeenCalled();
  });

  it("sets req.orgId from resolved membership and calls next()", async () => {
    mockResolveActiveOrgMembership.mockResolvedValueOnce({
      id: "membership-1",
      org_id: "00000000-0000-4000-8000-000000000001",
      user_id: "user-1",
      role: "member",
      status: "active",
    });
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();
    const next = jest.fn();

    await requireOrgMembership("member")(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.orgId).toBe("00000000-0000-4000-8000-000000000001");
    expect(req.orgMembershipId).toBe("membership-1");
    expect(mockResolveActiveOrgMembership).toHaveBeenCalledWith(req, "member");
  });

  it("maps ORG_MEMBERSHIP_REQUIRED to 403", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("ORG_MEMBERSHIP_REQUIRED"));
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();
    const next = jest.fn();

    await requireOrgMembership()(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_MEMBERSHIP_REQUIRED" });
  });

  it("maps ORG_ROLE_REQUIRED to 403", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("ORG_ROLE_REQUIRED"));
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();

    await requireOrgMembership("admin")(req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_ROLE_REQUIRED" });
  });

  it("maps INVALID_ORG_ID to 400", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("INVALID_ORG_ID"));
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();

    await requireOrgMembership()(req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "INVALID_ORG_ID" });
  });

  it("maps ORG_SELECTION_REQUIRED to 409", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("ORG_SELECTION_REQUIRED"));
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();

    await requireOrgMembership()(req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_SELECTION_REQUIRED" });
  });

  it("maps ORG_ONBOARDING_REQUIRED to 409", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("ORG_ONBOARDING_REQUIRED"));
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();

    await requireOrgMembership()(req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_ONBOARDING_REQUIRED" });
  });

  it("returns 500 for unknown errors", async () => {
    mockResolveActiveOrgMembership.mockRejectedValueOnce(new Error("BOOM"));
    const req = { headers: {}, userId: "user-1" } as any;
    const res = createMockRes();
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    await requireOrgMembership()(req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_ACCESS_ERROR" });
    errorSpy.mockRestore();
  });
});
