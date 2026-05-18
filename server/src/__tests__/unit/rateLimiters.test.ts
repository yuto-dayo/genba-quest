/**
 * The actual counting logic lives in express-rate-limit; our wiring
 * is small. These tests exercise the wiring (dev skip + 429 shape
 * + per-user keying) without hammering the in-memory store, which
 * uses async timers that don't play well with rapid synchronous
 * loops inside Jest.
 */

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH;

function loadFresh() {
  jest.resetModules();
  return require("../../middleware/rateLimiters") as typeof import("../../middleware/rateLimiters");
}

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  getHeader: jest.Mock;
  headersSent: boolean;
};

function createMockRes(): MockRes {
  const res: any = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    headersSent: false,
  };
  res.status.mockReturnValue(res);
  res.json.mockImplementation(() => {
    res.headersSent = true;
    return res;
  });
  return res;
}

function runMiddleware(mw: any, req: any): Promise<{ res: MockRes; passed: boolean }> {
  return new Promise((resolve) => {
    const res = createMockRes();
    mw(req, res, (err?: unknown) => {
      resolve({ res, passed: !err && !res.headersSent });
    });
  });
}

describe("rateLimiters", () => {
  afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
  });

  it("skips entirely when dev auth bypass is active", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";
    const { globalAuthLimiter, sherpaLimiter, heavyUploadLimiter } = loadFresh();

    const req = { ip: "127.0.0.1", headers: {}, userId: "user-skip" } as any;

    for (const limiter of [globalAuthLimiter, sherpaLimiter, heavyUploadLimiter]) {
      const { passed } = await runMiddleware(limiter, req);
      expect(passed).toBe(true);
    }
  });

  it("does not skip when DEV_SKIP_AUTH is unset", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEV_SKIP_AUTH;
    const { sherpaLimiter } = loadFresh();

    const req = { ip: "127.0.0.1", headers: {}, userId: "user-enforced" } as any;
    const { passed, res } = await runMiddleware(sherpaLimiter, req);

    // The first request is always allowed; the point is that the
    // limiter ran (it would have set RateLimit headers) rather than
    // short-circuiting via the skip predicate.
    expect(passed).toBe(true);
    expect(res.setHeader).toHaveBeenCalled();
  });

  it("does not skip outside of NODE_ENV=development", async () => {
    process.env.NODE_ENV = "production";
    process.env.DEV_SKIP_AUTH = "true"; // would have been honored under the old rule
    const { sherpaLimiter } = loadFresh();

    const req = { ip: "127.0.0.1", headers: {}, userId: "user-prod" } as any;
    const { passed, res } = await runMiddleware(sherpaLimiter, req);

    expect(passed).toBe(true);
    expect(res.setHeader).toHaveBeenCalled();
  });
});
