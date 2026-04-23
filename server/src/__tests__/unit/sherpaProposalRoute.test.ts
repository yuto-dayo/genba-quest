import { proposalPayloads } from "../helpers/fixtures";

const mockCreate = jest.fn();
const mockCreateAndSubmit = jest.fn();

jest.mock("@google/generative-ai", () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn(),
  })),
}));

jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn(),
    },
  })),
}));

jest.mock("../../services/ProposalService", () => ({
  ProposalService: jest.fn().mockImplementation(() => ({
    create: mockCreate,
    createAndSubmit: mockCreateAndSubmit,
  })),
}));

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import sherpaRouter from "../../routes/sherpa";
import { ProposalService } from "../../services/ProposalService";

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
  const layer = (sherpaRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

describe("sherpa proposal route", () => {
  const createProposalHandler = getPostHandler("/proposals");
  const mockProposalServiceCtor = ProposalService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects missing required fields", async () => {
    const req = {
      body: {
        type: "expense.create",
        payload: null,
        description: "",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createProposalHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "type, payload (object), description are required",
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
  });

  it("rejects disallowed proposal type", async () => {
    const req = {
      body: {
        type: "policy.update",
        payload: { key: "value" },
        description: "update policy from sherpa",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createProposalHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "proposal type is not allowed for sherpa: policy.update",
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
  });

  it("creates and submits proposal by default", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-1", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      body: {
        type: "expense.create",
        payload: { amount: 1000, category: "material" },
        description: "資材購入を提案",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createProposalHandler(req, res);

    expect(mockProposalServiceCtor).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
    expect(mockCreateAndSubmit).toHaveBeenCalledWith({
      type: "expense.create",
      payload: { amount: 1000, category: "material" },
      description: "資材購入を提案",
      created_by: { type: "ai", id: "sherpa", name: "Sherpa" },
      org_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: "proposal-1", status: "pending" },
      auto_approved: false,
      auto_executed: false,
      submitted: true,
    });
  });

  it("creates draft only when submit=false", async () => {
    mockCreate.mockResolvedValue({ id: "proposal-2", status: "draft" });

    const req = {
      body: {
        type: "site.create",
        payload: { name: "渋谷ビル改修" },
        description: "  新規現場を登録  ",
        submit: false,
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createProposalHandler(req, res);

    expect(mockCreate).toHaveBeenCalledWith({
      type: "site.create",
      payload: { name: "渋谷ビル改修" },
      description: "新規現場を登録",
      created_by: { type: "ai", id: "sherpa", name: "Sherpa" },
      org_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: "proposal-2", status: "draft" },
      auto_approved: false,
      auto_executed: false,
      submitted: false,
    });
  });

  it.each([
    {
      type: "assignment.update",
      payload: proposalPayloads.assignmentUpdate,
      description: "既存アサインを移動",
    },
    {
      type: "assignment.cancel",
      payload: proposalPayloads.assignmentCancel,
      description: "既存アサインを取り消し",
    },
  ])("accepts $type payload contract for sherpa proposal creation", async ({ type, payload, description }) => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-contract", type, status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const req = {
      body: {
        type,
        payload,
        description,
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createProposalHandler(req, res);

    expect(mockCreateAndSubmit).toHaveBeenCalledWith({
      type,
      payload,
      description,
      created_by: { type: "ai", id: "sherpa", name: "Sherpa" },
      org_id: "11111111-1111-4111-8111-111111111111",
    });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      proposal: { id: "proposal-contract", type, status: "pending" },
      auto_approved: false,
      auto_executed: false,
      submitted: true,
    });
  });

  it("rejects site.complete because canonical RPC is required", async () => {
    const req = {
      body: {
        type: "site.complete",
        payload: proposalPayloads.siteComplete,
        description: "現場完了を提案",
      },
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await createProposalHandler(req, res);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: "SITE_COMPLETE_CANONICAL_RPC_REQUIRED",
      code: "SITE_COMPLETE_CANONICAL_RPC_REQUIRED",
    });
  });
});
