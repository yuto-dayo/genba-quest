const mockCalcRewardPreview = jest.fn();
const mockGetRewardCalculations = jest.fn();

jest.mock("../../services/LUQOService", () => ({
  LUQOService: jest.fn().mockImplementation(() => ({
    calcRewardPreview: mockCalcRewardPreview,
    getRewardCalculations: mockGetRewardCalculations,
    getCategories: jest.fn(),
    getCatalog: jest.fn(),
    getCatalogMaxPoints: jest.fn(),
    getMemberAchievements: jest.fn(),
    getMemberStarTotals: jest.fn(),
    getPeriodScores: jest.fn(),
  })),
}));

import luqoRouter from "../../routes/luqo";
import { LUQOService } from "../../services/LUQOService";

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

function getHandler(path: string, method: "get" | "post") {
  const layer = (luqoRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.[method],
  );

  if (!layer) {
    throw new Error(`${method.toUpperCase()} handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("luqo router", () => {
  const rewardPreviewHandler = getHandler("/reward/preview", "post");
  const calculationsHandler = getHandler("/reward/calculations", "get");
  const serviceCtor = LUQOService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("GET /reward/calculations resolves org from auth context", async () => {
    mockGetRewardCalculations.mockResolvedValue([{ id: "calc-1" }]);
    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      query: { period: "2026-04" },
    } as any;
    const res = createMockRes();

    await calculationsHandler(req, res);

    expect(serviceCtor).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockGetRewardCalculations).toHaveBeenCalledWith("2026-04");
    expect(res.json).toHaveBeenCalledWith({ calculations: [{ id: "calc-1" }] });
  });

  it("POST /reward/preview rejects requests without org context", async () => {
    const req = {
      body: {
        period: "2026-04",
        profit: 10000,
        members: [{ member_id: "x", name: "田中", days: 10, tech_stars: 2, speed_stars: 1 }],
      },
    } as any;
    const res = createMockRes();

    await rewardPreviewHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "ORG_CONTEXT_REQUIRED" });
  });

  it("POST /reward/preview maps invalid member errors to 400", async () => {
    mockCalcRewardPreview.mockRejectedValue(new Error("INVALID_MEMBER_ID"));
    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        period: "2026-04",
        profit: 10000,
        members: [{ member_id: "", name: "田中", days: 10, tech_stars: 2, speed_stars: 1 }],
      },
    } as any;
    const res = createMockRes();

    await rewardPreviewHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "INVALID_MEMBER_ID" });
  });
});
