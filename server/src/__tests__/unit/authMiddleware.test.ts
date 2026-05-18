const mockGetUser = jest.fn();

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    auth: {
      getUser: (...args: any[]) => mockGetUser(...args),
    },
  },
}));

import { authMiddleware } from "../../middleware/authMiddleware";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH;
const ORIGINAL_DEV_USER_UUID = process.env.DEV_USER_UUID;
const ORIGINAL_DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;
const ORIGINAL_SUPABASE_URL = process.env.SUPABASE_URL;

describe("authMiddleware dev auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";
    delete process.env.DEV_USER_UUID;
    delete process.env.SUPABASE_URL;
    process.env.DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
    process.env.DEV_USER_UUID = ORIGINAL_DEV_USER_UUID;
    process.env.DEFAULT_ORG_ID = ORIGINAL_DEFAULT_ORG_ID;
    process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  });

  it("selects the requested development user from x-dev-user-key", async () => {
    const req = {
      headers: { "x-dev-user-key": "teru" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("33333333-3333-4333-8333-0000000000a3");
    expect(req.userName).toBe("テル");
    expect(req.userEmail).toBe("teru@genba-quest.test");
    expect(req.orgId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("rejects development auth when the server is pointed at hosted Supabase", async () => {
    process.env.SUPABASE_URL = "https://example-ref.supabase.co";
    const req = {
      headers: { "x-dev-user-key": "yuto" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining("DEV_SKIP_AUTH=true cannot be used with hosted Supabase"),
    });
  });

  it("ignores DEV_SKIP_AUTH when NODE_ENV is staging", async () => {
    process.env.NODE_ENV = "staging";
    process.env.DEV_SKIP_AUTH = "true";
    const req = {
      headers: { "x-dev-user-key": "yuto" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    // No bearer token present, so we expect the real-auth branch to
    // reject the request rather than the dev branch to short-circuit.
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.userId).toBeUndefined();
  });

  it("ignores DEV_SKIP_AUTH when NODE_ENV is test", async () => {
    process.env.NODE_ENV = "test";
    process.env.DEV_SKIP_AUTH = "true";
    const req = {
      headers: { "x-dev-user-key": "yuto" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.userId).toBeUndefined();
  });
});

describe("authMiddleware production auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockReset();
    process.env.NODE_ENV = "production";
    delete process.env.DEV_SKIP_AUTH;
    delete process.env.DEV_USER_UUID;
    process.env.SUPABASE_URL = "https://example-ref.supabase.co";
    process.env.DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
    process.env.DEV_USER_UUID = ORIGINAL_DEV_USER_UUID;
    process.env.DEFAULT_ORG_ID = ORIGINAL_DEFAULT_ORG_ID;
    process.env.SUPABASE_URL = ORIGINAL_SUPABASE_URL;
  });

  it("does not derive req.orgId from app_metadata.org_id", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "auth-user-1",
          email: "user@example.com",
          app_metadata: { org_id: "22222222-2222-4222-8222-222222222222" },
          user_metadata: { name: "User One" },
        },
      },
      error: null,
    });
    const req = {
      headers: { authorization: "Bearer real-jwt-token" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("auth-user-1");
    expect(req.userEmail).toBe("user@example.com");
    expect(req.userName).toBe("User One");
    expect(req.orgId).toBeUndefined();
  });

  it("does not derive req.orgId from user_metadata.org_id", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "auth-user-2",
          email: "user2@example.com",
          app_metadata: {},
          user_metadata: {
            name: "User Two",
            org_id: "33333333-3333-4333-8333-333333333333",
          },
        },
      },
      error: null,
    });
    const req = {
      headers: { authorization: "Bearer real-jwt-token" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("auth-user-2");
    expect(req.orgId).toBeUndefined();
  });

  it("does not fall back to DEFAULT_ORG_ID when metadata has none", async () => {
    mockGetUser.mockResolvedValueOnce({
      data: {
        user: {
          id: "auth-user-3",
          email: "user3@example.com",
          app_metadata: {},
          user_metadata: {},
        },
      },
      error: null,
    });
    const req = {
      headers: { authorization: "Bearer real-jwt-token" },
      query: {},
    } as any;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const next = jest.fn();

    await authMiddleware(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(req.userId).toBe("auth-user-3");
    expect(req.orgId).toBeUndefined();
  });
});
