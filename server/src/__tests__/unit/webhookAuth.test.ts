import { requireGmailWebhookAuth } from "../../middleware/webhookAuth";

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

describe("requireGmailWebhookAuth", () => {
  const originalSecret = process.env.GMAIL_WEBHOOK_SECRET;

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.GMAIL_WEBHOOK_SECRET;
    } else {
      process.env.GMAIL_WEBHOOK_SECRET = originalSecret;
    }
  });

  it("rejects with 500 when GMAIL_WEBHOOK_SECRET is not set", () => {
    delete process.env.GMAIL_WEBHOOK_SECRET;
    const req = { headers: { authorization: "Bearer anything" } } as any;
    const res = createMockRes();
    const next = jest.fn();

    requireGmailWebhookAuth(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "WEBHOOK_SECRET_NOT_CONFIGURED" });
  });

  it("rejects with 401 when authorization header is missing", () => {
    process.env.GMAIL_WEBHOOK_SECRET = "expected-secret";
    const req = { headers: {} } as any;
    const res = createMockRes();
    const next = jest.fn();

    requireGmailWebhookAuth(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "WEBHOOK_AUTH_REQUIRED" });
  });

  it("rejects with 401 when the bearer token does not match", () => {
    process.env.GMAIL_WEBHOOK_SECRET = "expected-secret";
    const req = { headers: { authorization: "Bearer wrong-secret" } } as any;
    const res = createMockRes();
    const next = jest.fn();

    requireGmailWebhookAuth(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "WEBHOOK_AUTH_REQUIRED" });
  });

  it("rejects with 401 when the scheme is not Bearer", () => {
    process.env.GMAIL_WEBHOOK_SECRET = "expected-secret";
    const req = { headers: { authorization: "Basic expected-secret" } } as any;
    const res = createMockRes();
    const next = jest.fn();

    requireGmailWebhookAuth(req, res as any, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls next() when the bearer token matches", () => {
    process.env.GMAIL_WEBHOOK_SECRET = "expected-secret";
    const req = { headers: { authorization: "Bearer expected-secret" } } as any;
    const res = createMockRes();
    const next = jest.fn();

    requireGmailWebhookAuth(req, res as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
