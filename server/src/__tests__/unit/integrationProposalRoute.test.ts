const mockCreate = jest.fn();
const mockCreateAndSubmit = jest.fn();
const mockGetById = jest.fn();

jest.mock("../../services/ProposalService", () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    createAndSubmit: mockCreateAndSubmit,
    getById: mockGetById,
  })),
}));

import proposalsRouter from "../../routes/proposals";
import { ProposalService } from "../../services/ProposalService";

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getPostHandler(path: string) {
  const layer = (proposalsRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("integration proposal route", () => {
  const createIntegrationHandler = getPostHandler("/integration");
  const mockProposalServiceCtor = ProposalService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects missing integration fields", async () => {
    const req = {
      body: {
        type: "income.create",
        payload: { amount: 120000 },
        description: "受注登録",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createIntegrationHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "type, payload, description, source, external_id are required",
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
  });

  it("creates and submits proposal as integration actor", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-1", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      body: {
        type: "income.create",
        payload: { amount: 120000, category: "construction" },
        description: " Gmail受信の注文書を売上提案へ ",
        source: "gmail",
        external_id: "msg-12345",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createIntegrationHandler(req, res);

    const input = mockCreateAndSubmit.mock.calls[0]?.[0];
    expect(input.id).toMatch(UUID_REGEX);
    expect(input.type).toBe("income.create");
    expect(input.description).toBe("Gmail受信の注文書を売上提案へ");
    expect(input.created_by).toEqual({
      type: "integration",
      id: "integration:gmail",
      name: "Integration(gmail)",
    });
    expect(input.payload._integration).toEqual({
      source: "gmail",
      external_id: "msg-12345",
    });

    expect(mockProposalServiceCtor).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: "proposal-1", status: "pending" },
      auto_approved: false,
      auto_executed: false,
      submitted: true,
      deduplicated: false,
    });
  });

  it("returns existing proposal when duplicate event is received", async () => {
    mockCreateAndSubmit.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "proposals_pkey"')
    );
    mockGetById.mockResolvedValue({
      id: "existing-proposal-id",
      status: "pending",
    });

    const req = {
      body: {
        type: "income.create",
        payload: { amount: 80000 },
        description: "duplicate event",
        source: "gmail",
        external_id: "msg-dup-001",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createIntegrationHandler(req, res);

    expect(mockCreateAndSubmit).toHaveBeenCalledTimes(1);
    expect(mockGetById).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      proposal: {
        id: "existing-proposal-id",
        status: "pending",
      },
      auto_approved: false,
      auto_executed: false,
      submitted: true,
      deduplicated: true,
    });
  });
});
