const mockCreateAndSubmit = jest.fn();

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock("../../services/ProposalService", () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    createAndSubmit: mockCreateAndSubmit,
  })),
}));

import pathRewardsRouter from "../../routes/pathRewards";

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

function getPostHandler(path: string) {
  const layer = (pathRewardsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post,
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("pathRewards router", () => {
  const previewHandler = getPostHandler("/preview");
  const proposalHandler = getPostHandler("/proposals");

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("POST /preview returns PATH reward preview", async () => {
    const req = {
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month: "2026-04",
        profit_inputs: {
          sales: 50000,
          outsourcing_cost: 5000,
          materials_cost: 0,
          parking_cost: 0,
          transport_cost: 0,
          other_direct_cost: 0,
          common_cost: 0,
          reserve_amount: 0,
        },
        members: [
          {
            member_id: "11111111-1111-4111-8111-111111111111",
            name: "田中",
            work_days: 10,
            level: "L2",
            A: 1,
            R: 1,
            Q: 1,
          },
        ],
      },
    } as any;
    const res = createMockRes();

    await previewHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      month: "2026-04",
      total_amount: 45000,
      members: [
        expect.objectContaining({
          member_id: "11111111-1111-4111-8111-111111111111",
          total_reward: 45000,
        }),
      ],
    }));
  });

  it("POST /proposals creates canonical reward.calculate proposal", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-1", type: "reward.calculate", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      userId: "33333333-3333-4333-8333-333333333333",
      userName: "管理者",
      orgId: "00000000-0000-0000-0000-000000000001",
      body: {
        month: "2026-04",
        profit_inputs: {
          sales: 50000,
          outsourcing_cost: 5000,
          materials_cost: 0,
          parking_cost: 0,
          transport_cost: 0,
          other_direct_cost: 0,
          common_cost: 0,
          reserve_amount: 0,
        },
        members: [
          {
            member_id: "11111111-1111-4111-8111-111111111111",
            name: "田中",
            work_days: 10,
            level: "L2",
            A: 1,
            R: 1,
            Q: 1,
          },
        ],
      },
    } as any;
    const res = createMockRes();

    await proposalHandler(req, res);

    expect(mockCreateAndSubmit).toHaveBeenCalledWith(expect.objectContaining({
      type: "reward.calculate",
      description: "2026-04 PATH報酬計算",
      created_by: {
        type: "human",
        id: "33333333-3333-4333-8333-333333333333",
        name: "管理者",
      },
      payload: expect.objectContaining({
        calculation_system: "path_v2",
        amount_total: 45000,
        total_amount: 45000,
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      proposal: expect.objectContaining({ id: "proposal-1" }),
      preview: expect.objectContaining({ total_amount: 45000 }),
    }));
  });
});
