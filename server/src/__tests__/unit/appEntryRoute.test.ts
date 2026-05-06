import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import appEntryRouter from "../../routes/appEntry";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_DEV_SKIP_AUTH = process.env.DEV_SKIP_AUTH;

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

function createOrganizationCountChain(count: number) {
  const chain = createChain({ data: null, error: null }) as any;
  chain._result = { data: null, error: null, count };
  return chain;
}

function getHandler(path: string, method: "get") {
  const layer = (appEntryRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("app entry router", () => {
  const handler = getHandler("/", "get");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS;
    delete process.env.ORG_CREATION_MODE;
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
  });

  afterAll(() => {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    process.env.DEV_SKIP_AUTH = ORIGINAL_DEV_SKIP_AUTH;
  });

  it("returns needs_system_bootstrap when there are no organizations yet", async () => {
    const orgCountChain = createOrganizationCountChain(0);
    setupMockFromSequence(mockFrom, [orgCountChain]);

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "needs_system_bootstrap",
      viewer_email: "worker@example.com",
    });
  });

  it("returns needs_onboarding when there are organizations but no memberships or invites", async () => {
    process.env.ORG_BOOTSTRAP_ALLOWED_EMAILS = "worker@example.com";
    const orgCountChain = createOrganizationCountChain(1);
    const membershipsChain = createChain({ data: [], error: null });
    const invitesChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [orgCountChain, membershipsChain, invitesChain]);

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "needs_onboarding",
      viewer_email: "worker@example.com",
      bootstrap_allowed: true,
      memberships: [],
      pending_invites: [],
    });
  });

  it("returns bootstrap_allowed=true in dev mode even without an allowlist", async () => {
    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";

    const orgCountChain = createOrganizationCountChain(1);
    const membershipsChain = createChain({ data: [], error: null });
    const invitesChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [orgCountChain, membershipsChain, invitesChain]);

    const req = {
      userId: "user-1",
      userEmail: "dev@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "needs_onboarding",
      viewer_email: "dev@example.com",
      bootstrap_allowed: true,
      memberships: [],
      pending_invites: [],
    });
  });

  it("returns bootstrap_allowed=true for signed-in users when org creation mode is authenticated", async () => {
    process.env.ORG_CREATION_MODE = "authenticated";

    const orgCountChain = createOrganizationCountChain(1);
    const membershipsChain = createChain({ data: [], error: null });
    const invitesChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [orgCountChain, membershipsChain, invitesChain]);

    const req = {
      userId: "user-1",
      userEmail: "new-owner@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "needs_onboarding",
      viewer_email: "new-owner@example.com",
      bootstrap_allowed: true,
      memberships: [],
      pending_invites: [],
    });
  });

  it("returns needs_invite_action when there are pending invites and no memberships", async () => {
    const orgCountChain = createOrganizationCountChain(1);
    const membershipsChain = createChain({ data: [], error: null });
    const invitesChain = createChain({
      data: [
        {
          id: "invite-1",
          org_id: "11111111-1111-4111-8111-111111111111",
          role: "member",
          email_normalized: "worker@example.com",
        },
      ],
      error: null,
    });
    const organizationsChain = createChain({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "GENBA 本部",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [orgCountChain, membershipsChain, invitesChain, organizationsChain]);

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "needs_invite_action",
      viewer_email: "worker@example.com",
      bootstrap_allowed: false,
      memberships: [],
      pending_invites: [
        {
          invite_id: "invite-1",
          org_id: "11111111-1111-4111-8111-111111111111",
          org_name: "GENBA 本部",
          role: "member",
          email_normalized: "worker@example.com",
        },
      ],
    });
  });

  it("returns ready when there is exactly one active membership even if pending invites exist", async () => {
    const orgCountChain = createOrganizationCountChain(1);
    const membershipsChain = createChain({
      data: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          user_id: "user-1",
          role: "admin",
          status: "active",
          created_at: "2026-04-01T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const organizationsChain = createChain({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "GENBA 本部",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [orgCountChain, membershipsChain, organizationsChain]);

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "ready",
      viewer_email: "worker@example.com",
      active_org: {
        org_id: "11111111-1111-4111-8111-111111111111",
        org_name: "GENBA 本部",
        role: "admin",
      },
      memberships: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          org_name: "GENBA 本部",
          role: "admin",
        },
      ],
    });
  });

  it("returns needs_org_selection when there are multiple active memberships", async () => {
    const orgCountChain = createOrganizationCountChain(1);
    const membershipsChain = createChain({
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
          role: "admin",
          status: "active",
          created_at: "2026-04-02T00:00:00.000Z",
        },
      ],
      error: null,
    });
    const organizationsChain = createChain({
      data: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          name: "Org One",
        },
        {
          id: "22222222-2222-4222-8222-222222222222",
          name: "Org Two",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [orgCountChain, membershipsChain, organizationsChain]);

    const req = {
      userId: "user-1",
      userEmail: "worker@example.com",
    } as any;
    const res = createMockRes();

    await handler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      state: "needs_org_selection",
      viewer_email: "worker@example.com",
      memberships: [
        {
          org_id: "11111111-1111-4111-8111-111111111111",
          org_name: "Org One",
          role: "member",
        },
        {
          org_id: "22222222-2222-4222-8222-222222222222",
          org_name: "Org Two",
          role: "admin",
        },
      ],
    });
  });
});
