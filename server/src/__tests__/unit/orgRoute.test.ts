import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import orgRouter from "../../routes/org";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH;
const ORIGINAL_DEFAULT_ORG_ID = process.env.DEFAULT_ORG_ID;

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

function getHandler(path: string, method: "get") {
  const layer = (orgRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function getPostHandler(path: string) {
  const layer = (orgRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post,
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("org router", () => {
  const listMembersHandler = getHandler("/members", "get");
  const contextHandler = getHandler("/context", "get");
  const bootstrapHandler = getPostHandler("/bootstrap");
  const acceptInviteHandler = getPostHandler("/invites/:inviteId/accept");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;
  const mockRpc = (supabaseAdmin as unknown as { rpc: jest.Mock }).rpc;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
    process.env.DEFAULT_ORG_ID = ORIGINAL_DEFAULT_ORG_ID;
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
    process.env.DEFAULT_ORG_ID = ORIGINAL_DEFAULT_ORG_ID;
  });

  it("GET /members resolves the active org and returns hydrated members", async () => {
    const activeMembershipsChain = createChain({
      data: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          role: "admin",
          status: "active",
          title: null,
          approval_limit: 50000,
          joined_at: "2026-04-01T00:00:00.000Z",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const orgMembersChain = createChain({
      data: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          role: "admin",
          status: "active",
          title: null,
          approval_limit: 50000,
          joined_at: "2026-04-01T00:00:00.000Z",
        },
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-2",
          role: "member",
          status: "active",
          title: "職長",
          approval_limit: 10000,
          joined_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const profilesChain = createChain({
      data: [
        { id: "user-1", full_name: "管理者", username: "admin", avatar_url: null },
        { id: "user-2", full_name: "田中一郎", username: "tanaka", avatar_url: "https://example.com/a.png" },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain, orgMembersChain, profilesChain]);

    const req = {
      userId: "user-1",
      headers: {},
      params: {},
    } as any;
    const res = createMockRes();

    await listMembersHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "user-1",
        user_id: "user-1",
        org_id: "11111111-1111-4111-8111-111111111111",
        role: "admin",
        display_name: "管理者",
      }),
      expect.objectContaining({
        id: "user-2",
        user_id: "user-2",
        role: "member",
        title: "職長",
        display_name: "田中一郎",
      }),
    ]);
    expect(activeMembershipsChain.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(activeMembershipsChain.eq).toHaveBeenCalledWith("status", "active");
    expect(orgMembersChain.eq).toHaveBeenCalledWith("org_id", "11111111-1111-4111-8111-111111111111");
    expect(orgMembersChain.eq).toHaveBeenCalledWith("status", "active");
    expect(profilesChain.in).toHaveBeenCalledWith("id", ["user-1", "user-2"]);
  });

  it("GET /members exposes the four dev auth users when development auth has no DB memberships", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";
    process.env.DEFAULT_ORG_ID = "11111111-1111-4111-8111-111111111111";

    const activeMembershipsChain = createChain({ data: [], error: null });
    const orgMembersChain = createChain({ data: [], error: null });
    const profilesChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [activeMembershipsChain, orgMembersChain, profilesChain]);

    const req = {
      userId: "22222222-2222-4222-8222-0000000000a2",
      headers: {},
      params: {},
    } as any;
    const res = createMockRes();

    await listMembersHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    const members = res.json.mock.calls[0]?.[0] as Array<{ user_id: string; display_name: string }>;
    expect(members).toHaveLength(4);
    expect(members).toEqual(expect.arrayContaining([
      expect.objectContaining({ user_id: "44444444-4444-4444-8444-0000000000a4", display_name: "ダイト" }),
      expect.objectContaining({ user_id: "33333333-3333-4333-8333-0000000000a3", display_name: "テル" }),
      expect.objectContaining({ user_id: "22222222-2222-4222-8222-0000000000a2", display_name: "ジェイ" }),
      expect.objectContaining({ user_id: "e93f3438-ae73-4c55-b2ab-a370d096bde0", display_name: "ユウト" }),
    ]));
    expect(profilesChain.in).toHaveBeenCalledWith("id", [
      "e93f3438-ae73-4c55-b2ab-a370d096bde0",
      "22222222-2222-4222-8222-0000000000a2",
      "33333333-3333-4333-8333-0000000000a3",
      "44444444-4444-4444-8444-0000000000a4",
    ]);
  });

  it("GET /members returns 409 when multiple active memberships require selection", async () => {
    const activeMembershipsChain = createChain({
      data: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          role: "member",
          status: "active",
          created_at: "2026-04-01T00:00:00.000Z",
        },
        {
          org_id: "22222222-2222-4222-8222-222222222222",
          user_id: "user-1",
          role: "member",
          status: "active",
          created_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain]);

    const req = {
      userId: "user-1",
      headers: {},
      params: {},
    } as any;
    const res = createMockRes();

    await listMembersHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_SELECTION_REQUIRED" });
  });

  it("GET /context returns the active org summary", async () => {
    const activeMembershipsChain = createChain({
      data: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          role: "admin",
          status: "active",
          title: null,
          approval_limit: 50000,
          joined_at: "2026-04-01T00:00:00.000Z",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const orgChain = createChain({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA本部",
        slug: "genba-hq",
        status: "active",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain, orgChain]);

    const req = {
      userId: "user-1",
      headers: {},
      params: {},
    } as any;
    const res = createMockRes();

    await contextHandler(req, res);

    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      org: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA本部",
        slug: "genba-hq",
        status: "active",
      },
      membership: expect.objectContaining({
        org_id: "11111111-1111-4111-8111-111111111111",
        role: "admin",
      }),
    });
  });

  it("POST /bootstrap returns 403 when the email is not allowlisted", async () => {
    process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS = "allowed@example.com";

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
      body: {
        name: "GENBA 本部",
      },
    } as any;
    const res = createMockRes();

    await bootstrapHandler(req, res);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_BOOTSTRAP_FORBIDDEN" });
  });

  it("POST /bootstrap allows bootstrap in dev mode without an allowlist", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";
    const activeMembershipsChain = createChain({
      data: [],
      error: null,
    });
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain, profilesUpsertChain]);
    mockRpc.mockResolvedValue({
      data: {
        org_id: "11111111-1111-4111-8111-111111111111",
        org_name: "GENBA 本部",
        org_slug: "genba-hq",
        org_status: "active",
        membership_org_id: "11111111-1111-4111-8111-111111111111",
        membership_user_id: "user-1",
        membership_role: "admin",
        membership_status: "active",
      },
      error: null,
    });

    const req = {
      userId: "user-1",
      userEmail: "dev@example.com",
      body: {
        name: "GENBA 本部",
        slug: "genba-hq",
      },
    } as any;
    const res = createMockRes();

    await bootstrapHandler(req, res);

    expect(profilesUpsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
      }),
      expect.objectContaining({
        onConflict: "id",
        ignoreDuplicates: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      active_org: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA 本部",
        slug: "genba-hq",
        status: "active",
      },
      membership: {
        org_id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        role: "admin",
        status: "active",
      },
    });
  });

  it("POST /invites/:inviteId/accept accepts a pending invite through the atomic RPC", async () => {
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [profilesUpsertChain]);
    mockRpc.mockResolvedValue({
      data: {
        org_id: "11111111-1111-4111-8111-111111111111",
        org_name: "GENBA 本部",
        org_slug: "genba-hq",
        org_status: "active",
        membership_org_id: "11111111-1111-4111-8111-111111111111",
        membership_user_id: "user-1",
        membership_role: "member",
        membership_status: "active",
      },
      error: null,
    });

    const req = {
      userId: "user-1",
      userEmail: "Worker@Example.com",
      params: {
        inviteId: "invite-1",
      },
    } as any;
    const res = createMockRes();

    await acceptInviteHandler(req, res);

    expect(profilesUpsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
      }),
      expect.objectContaining({
        onConflict: "id",
        ignoreDuplicates: true,
      }),
    );
    expect(mockRpc).toHaveBeenCalledWith("accept_org_invite", {
      p_invite_id: "invite-1",
      p_user_id: "user-1",
      p_email: "worker@example.com",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      active_org: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA 本部",
        slug: "genba-hq",
        status: "active",
      },
      membership: {
        org_id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        role: "member",
        status: "active",
      },
    });
  });

  it("POST /invites/:inviteId/accept maps invite email mismatch to 409", async () => {
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [profilesUpsertChain]);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "ORG_INVITE_EMAIL_MISMATCH" },
    });

    const req = {
      userId: "user-1",
      userEmail: "wrong@example.com",
      params: {
        inviteId: "invite-1",
      },
    } as any;
    const res = createMockRes();

    await acceptInviteHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_INVITE_EMAIL_MISMATCH" });
  });

  it("POST /bootstrap returns 409 when the user already has an active membership", async () => {
    process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS = "worker@example.com";
    const activeMembershipsChain = createChain({
      data: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          role: "member",
          status: "active",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain]);

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
      body: {
        name: "GENBA 本部",
      },
    } as any;
    const res = createMockRes();

    await bootstrapHandler(req, res);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_BOOTSTRAP_NOT_IN_ONBOARDING" });
  });

  it("POST /bootstrap normalizes slug and returns the created org", async () => {
    process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS = "worker@example.com";
    const activeMembershipsChain = createChain({
      data: [],
      error: null,
    });
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain, profilesUpsertChain]);
    mockRpc.mockResolvedValue({
      data: {
        org_id: "11111111-1111-4111-8111-111111111111",
        org_name: "GENBA 本部",
        org_slug: "genba-hq",
        org_status: "active",
        membership_org_id: "11111111-1111-4111-8111-111111111111",
        membership_user_id: "user-1",
        membership_role: "admin",
        membership_status: "active",
      },
      error: null,
    });

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
      body: {
        name: " GENBA 本部 ",
        slug: " Genba-HQ ",
      },
    } as any;
    const res = createMockRes();

    await bootstrapHandler(req, res);

    expect(mockRpc).toHaveBeenCalledWith("bootstrap_org", {
      p_user_id: "user-1",
      p_name: "GENBA 本部",
      p_slug: "genba-hq",
    });
    expect(profilesUpsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
      }),
      expect.objectContaining({
        onConflict: "id",
        ignoreDuplicates: true,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      active_org: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA 本部",
        slug: "genba-hq",
        status: "active",
      },
      membership: {
        org_id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        role: "admin",
        status: "active",
      },
    });
  });

  it("POST /bootstrap maps slug conflicts to 409", async () => {
    process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS = "worker@example.com";
    const activeMembershipsChain = createChain({
      data: [],
      error: null,
    });
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [activeMembershipsChain, profilesUpsertChain]);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "ORG_BOOTSTRAP_SLUG_CONFLICT" },
    });

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
      body: {
        name: "GENBA 本部",
        slug: "genba-hq",
      },
    } as any;
    const res = createMockRes();

    await bootstrapHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_BOOTSTRAP_SLUG_CONFLICT" });
  });

  it("POST /bootstrap falls back to direct inserts when bootstrap_org RPC is unavailable", async () => {
    process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS = "worker@example.com";
    const activeMembershipsChain = createChain({
      data: [],
      error: null,
    });
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    const organizationsInsertChain = createChain({
      data: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA 本部",
        slug: "genba-hq",
        status: "active",
      },
      error: null,
    });
    const membershipsInsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [
      activeMembershipsChain,
      profilesUpsertChain,
      organizationsInsertChain,
      membershipsInsertChain,
    ]);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "Could not find the function public.bootstrap_org(p_user_id, p_name, p_slug)" },
    });

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
      body: {
        name: " GENBA 本部 ",
        slug: " Genba-HQ ",
      },
    } as any;
    const res = createMockRes();

    await bootstrapHandler(req, res);

    expect(mockRpc).toHaveBeenCalledWith("bootstrap_org", {
      p_user_id: "user-1",
      p_name: "GENBA 本部",
      p_slug: "genba-hq",
    });
    expect(profilesUpsertChain.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "user-1",
      }),
      expect.objectContaining({
        onConflict: "id",
        ignoreDuplicates: true,
      }),
    );
    expect(organizationsInsertChain.insert).toHaveBeenCalledWith({
      name: "GENBA 本部",
      slug: "genba-hq",
      status: "active",
    });
    expect(membershipsInsertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        role: "admin",
        status: "active",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      active_org: {
        id: "11111111-1111-4111-8111-111111111111",
        name: "GENBA 本部",
        slug: "genba-hq",
        status: "active",
      },
      membership: {
        org_id: "11111111-1111-4111-8111-111111111111",
        user_id: "user-1",
        role: "admin",
        status: "active",
      },
    });
  });
});
