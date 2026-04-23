import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { supabaseAdmin } from "../../lib/supabaseClient";
import systemRouter from "../../routes/system";

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

function getPostHandler(path: string) {
  const layer = (systemRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post,
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("system router", () => {
  const bootstrapFirstOrgHandler = getPostHandler("/bootstrap-first-org");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;
  const mockRpc = (supabaseAdmin as unknown as { rpc: jest.Mock }).rpc;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /bootstrap-first-org creates the first organization", async () => {
    const orgCountChain = createOrganizationCountChain(0);
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [orgCountChain, profilesUpsertChain]);
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
      body: {
        name: " GENBA 本部 ",
        slug: " Genba-HQ ",
      },
    } as any;
    const res = createMockRes();

    await bootstrapFirstOrgHandler(req, res);

    expect(mockRpc).toHaveBeenCalledWith("bootstrap_first_org", {
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

  it("POST /bootstrap-first-org returns 409 when initialization is already completed", async () => {
    const orgCountChain = createOrganizationCountChain(1);
    setupMockFromSequence(mockFrom, [orgCountChain]);

    const req = {
      userId: "user-1",
      body: {
        name: "GENBA 本部",
      },
    } as any;
    const res = createMockRes();

    await bootstrapFirstOrgHandler(req, res);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "SYSTEM_BOOTSTRAP_ALREADY_COMPLETED" });
  });

  it("POST /bootstrap-first-org maps slug conflicts to 409", async () => {
    const orgCountChain = createOrganizationCountChain(0);
    const profilesUpsertChain = createChain({
      data: null,
      error: null,
    });
    setupMockFromSequence(mockFrom, [orgCountChain, profilesUpsertChain]);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "SYSTEM_BOOTSTRAP_SLUG_CONFLICT" },
    });

    const req = {
      userId: "user-1",
      body: {
        name: "GENBA 本部",
        slug: "genba-hq",
      },
    } as any;
    const res = createMockRes();

    await bootstrapFirstOrgHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "SYSTEM_BOOTSTRAP_SLUG_CONFLICT" });
  });
});
