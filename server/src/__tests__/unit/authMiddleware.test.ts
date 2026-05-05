jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    auth: {
      getUser: jest.fn(),
    },
  },
}));

import { authMiddleware } from "../../middleware/authMiddleware";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH;
const ORIGINAL_DEV_USER_UUID = process.env.DEV_USER_UUID;
const ORIGINAL_DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

describe("authMiddleware dev auth", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";
    delete process.env.DEV_USER_UUID;
    process.env.DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
    process.env.DEV_USER_UUID = ORIGINAL_DEV_USER_UUID;
    process.env.DEFAULT_ORG_ID = ORIGINAL_DEFAULT_ORG_ID;
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
});
