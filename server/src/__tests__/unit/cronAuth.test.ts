import { requireCronAuth } from "../../middleware/cronAuth";

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

describe("requireCronAuth", () => {
  const originalSecret = process.env.CRON_SECRET;

  afterEach(() => {
    process.env.CRON_SECRET = originalSecret;
  });

  it("accepts a matching bearer token", () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const req = { headers: { authorization: "Bearer test-cron-secret" } } as any;
    const res = createMockRes();
    const next = jest.fn();

    requireCronAuth(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("fails fast when CRON_SECRET is missing", () => {
    delete process.env.CRON_SECRET;
    const req = { headers: { authorization: "Bearer anything" } } as any;
    const res = createMockRes();

    requireCronAuth(req, res as any, jest.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "CRON_SECRET is not configured" });
  });
});
