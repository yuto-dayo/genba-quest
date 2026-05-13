import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import profileRouter from "../../routes/profile";

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

function getHandler(method: "get" | "patch", path: string) {
  const layer = (profileRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("profile router", () => {
  const getMeHandler = getHandler("get", "/me");
  const patchMeHandler = getHandler("patch", "/me");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /me creates a profile row when missing", async () => {
    const lookupChain = createChain({ data: null, error: null });
    const upsertChain = createChain({
      data: {
        id: "user-1",
        username: null,
        nickname: null,
        full_name: null,
        avatar_url: null,
        onboarding_completed_at: null,
        phone: null,
        job_type: null,
        employment_kind: "employee",
        trade_name: null,
        invoice_registration_number: null,
        bank_name: null,
        branch_name: null,
        account_type: null,
        account_number: null,
        account_holder_kana: null,
        postal_code: null,
        prefecture: null,
        city: null,
        address_line1: null,
        address_line2: null,
        emergency_contact_name: null,
        emergency_phone: null,
      },
      error: null,
    });

    setupMockFromSequence(mockFrom, [lookupChain, upsertChain]);

    const req = { userId: "user-1" } as any;
    const res = createMockRes();

    await getMeHandler(req, res);

    expect(upsertChain.upsert).toHaveBeenCalledWith({ id: "user-1" }, { onConflict: "id" });
    expect(res.json).toHaveBeenCalledWith({
      profile: expect.objectContaining({ id: "user-1" }),
    });
  });

  it("PATCH /me rejects direct onboarding timestamp writes", async () => {
    const req = {
      userId: "user-1",
      body: { onboarding_completed_at: "2026-05-12T00:00:00.000Z" },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "PROFILE_ONBOARDING_COMPLETED_AT_FORBIDDEN" });
  });

  it("PATCH /me validates nickname length", async () => {
    const req = {
      userId: "user-1",
      body: { nickname: "123456" },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "PROFILE_NICKNAME_TOO_LONG" });
  });

  it("PATCH /me saves a valid avatar_url scoped to the caller", async () => {
    const validUrl =
      "https://example.supabase.co/storage/v1/object/public/avatars/user-1/avatar.jpg";
    const updateChain = createChain({
      data: {
        id: "user-1",
        avatar_url: validUrl,
        employment_kind: "employee",
      },
      error: null,
    });
    mockFrom.mockReturnValue(updateChain);

    const req = {
      userId: "user-1",
      body: { avatar_url: validUrl },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(updateChain.update).toHaveBeenCalledTimes(1);
    const payload = updateChain.update.mock.calls[0][0] as Record<string, string | null>;
    expect(payload.avatar_url).toBe(validUrl);
    expect(res.json).toHaveBeenCalledWith({
      profile: expect.objectContaining({ avatar_url: validUrl }),
    });
  });

  it("PATCH /me clears avatar_url when given null", async () => {
    const updateChain = createChain({
      data: { id: "user-1", avatar_url: null, employment_kind: "employee" },
      error: null,
    });
    mockFrom.mockReturnValue(updateChain);

    const req = {
      userId: "user-1",
      body: { avatar_url: null },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(updateChain.update).toHaveBeenCalledTimes(1);
    const payload = updateChain.update.mock.calls[0][0] as Record<string, string | null>;
    expect(payload.avatar_url).toBeNull();
  });

  it("PATCH /me rejects avatar_url scoped to a different user", async () => {
    const otherUserUrl =
      "https://example.supabase.co/storage/v1/object/public/avatars/other-user/avatar.jpg";

    const req = {
      userId: "user-1",
      body: { avatar_url: otherUserUrl },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "PROFILE_AVATAR_URL_INVALID" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("PATCH /me rejects non-Supabase avatar_url", async () => {
    const req = {
      userId: "user-1",
      body: { avatar_url: "https://evil.example.com/pwn.jpg" },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "PROFILE_AVATAR_URL_INVALID" });
  });

  it("PATCH /me sets onboarding_completed_at on complete_onboarding", async () => {
    const updateChain = createChain({
      data: {
        id: "user-1",
        nickname: "ユト",
        full_name: "山田 太郎",
        onboarding_completed_at: "2026-05-12T10:00:00.000Z",
        employment_kind: "employee",
      },
      error: null,
    });
    mockFrom.mockReturnValue(updateChain);

    const req = {
      userId: "user-1",
      body: {
        nickname: "ユト",
        full_name: "山田 太郎",
        employment_kind: "employee",
        job_type: "大工",
        complete_onboarding: true,
      },
    } as any;
    const res = createMockRes();

    await patchMeHandler(req, res);

    expect(updateChain.update).toHaveBeenCalledTimes(1);
    const payload = updateChain.update.mock.calls[0][0] as Record<string, string | null>;
    expect(typeof payload.onboarding_completed_at).toBe("string");
    expect(Number.isNaN(new Date(payload.onboarding_completed_at as string).getTime())).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(payload, "complete_onboarding")).toBe(false);
    expect(res.json).toHaveBeenCalledWith({
      profile: expect.objectContaining({ id: "user-1", nickname: "ユト" }),
    });
  });
});
