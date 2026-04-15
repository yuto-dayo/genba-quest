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

jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

jest.mock("../../services/GmailWatcher", () => ({
  createGmailWatcher: jest.fn(),
}));

jest.mock("../../services/ocrService", () => ({
  analyzeDocument: jest.fn(),
}));

jest.mock("../../services/DocumentClassifier", () => ({
  getDocumentClassifier: jest.fn(),
}));

import { __webhooksTestables } from "../../routes/webhooks";
import { ProposalService } from "../../services/ProposalService";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const toBase64Url = (value: string) =>
  Buffer.from(value, "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

describe("webhooks route helpers", () => {
  const mockProposalServiceCtor = ProposalService as unknown as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("creates and submits integration proposal with deterministic id and metadata", async () => {
    mockCreateAndSubmit.mockResolvedValue({
      proposal: { id: "proposal-1", status: "pending" },
      autoApproved: false,
      autoExecuted: false,
    });

    const result = await __webhooksTestables.createOrReuseIntegrationProposal({
      type: "expense.create",
      payload: { amount: 12000, category: "material" },
      description: " webhook generated proposal ",
      source: " gmail ",
      externalId: " msg-123 ",
      integrationName: " Gmail Watcher ",
      submit: true,
    });

    expect(result).toEqual({
      proposalId: "proposal-1",
      status: "pending",
      deduplicated: false,
      autoApproved: false,
      autoExecuted: false,
    });

    const input = mockCreateAndSubmit.mock.calls[0]?.[0];
    expect(input.id).toMatch(UUID_REGEX);
    expect(input.description).toBe("webhook generated proposal");
    expect(input.created_by).toEqual({
      type: "integration",
      id: "integration:gmail",
      name: "Gmail Watcher",
    });
    expect(input.payload._integration).toEqual({
      source: "gmail",
      external_id: "msg-123",
    });
    expect(mockProposalServiceCtor).toHaveBeenCalledTimes(1);
  });

  it("supports draft creation when submit=false", async () => {
    mockCreate.mockResolvedValue({
      id: "draft-proposal-1",
      status: "draft",
    });

    const result = await __webhooksTestables.createOrReuseIntegrationProposal({
      type: "expense.create",
      payload: { amount: 5000 },
      description: "draft creation",
      source: "gmail",
      externalId: "draft-1",
      integrationName: "Gmail Watcher",
      submit: false,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreateAndSubmit).not.toHaveBeenCalled();
    expect(result).toEqual({
      proposalId: "draft-proposal-1",
      status: "draft",
      deduplicated: false,
      autoApproved: false,
      autoExecuted: false,
    });
  });

  it("reuses existing proposal on duplicate key conflict", async () => {
    mockCreateAndSubmit.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "proposals_pkey"')
    );
    mockGetById.mockResolvedValue({
      id: "existing-proposal-id",
      status: "executed",
    });

    const result = await __webhooksTestables.createOrReuseIntegrationProposal({
      type: "income.create",
      payload: { amount: 80000 },
      description: "duplicate event",
      source: "gmail",
      externalId: "dup-1",
      integrationName: "Gmail Watcher",
      submit: true,
    });

    expect(mockCreateAndSubmit).toHaveBeenCalledTimes(1);
    expect(mockGetById).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      proposalId: "existing-proposal-id",
      status: "executed",
      deduplicated: true,
      autoApproved: true,
      autoExecuted: true,
    });
  });

  it("rejects invalid integration input", async () => {
    await expect(
      __webhooksTestables.createOrReuseIntegrationProposal({
        type: "expense.create",
        payload: { amount: 1000 },
        description: "valid",
        source: " ",
        externalId: "ext-1",
        integrationName: "Gmail Watcher",
        submit: true,
      })
    ).rejects.toThrow("INVALID_INTEGRATION_INPUT");
  });

  it("extracts amount from multiple payload shapes", () => {
    expect(__webhooksTestables.extractAmountFromDocumentData({ amount: "¥12,345" })).toBe(12345);
    expect(__webhooksTestables.extractAmountFromDocumentData({ amount: { value: 9000 } })).toBe(9000);
    expect(__webhooksTestables.extractAmountFromDocumentData({ total_amount: "8,888" })).toBe(8888);
    expect(__webhooksTestables.extractAmountFromDocumentData({ category: "material" })).toBeNull();
  });

  it("maps document type to proposal type", () => {
    expect(__webhooksTestables.getIntegrationProposalType("order")).toBe("income.create");
    expect(__webhooksTestables.getIntegrationProposalType("invoice")).toBe("expense.create");
  });

  it("normalizes site keys by trimming symbols/suffixes", () => {
    expect(__webhooksTestables.normalizeSiteNameKey(" 渋谷タワー新築工事 ")).toBe("渋谷タワー");
    expect(__webhooksTestables.normalizeSiteNameKey("【新宿オフィスリノベ】")).toBe("新宿オフィス");
  });

  it("collects unique site name candidates from extracted data", () => {
    const candidates = __webhooksTestables.collectSiteNameCandidates({
      site_name: "渋谷タワー新築工事",
      site: { name: "渋谷タワー新築工事" },
      project: { site_name: "新宿オフィスリノベ" },
    });

    expect(candidates).toEqual(["渋谷タワー新築工事", "新宿オフィスリノベ"]);
  });

  it("selects best site match and rejects ambiguous ties", () => {
    const matched = __webhooksTestables.selectBestSiteMatch(
      ["渋谷タワー新築工事"],
      [
        { id: "site-1", name: "渋谷タワー新築工事", status: "in_progress" },
        { id: "site-2", name: "池袋商業施設", status: "completed" },
      ],
    );
    expect(matched?.id).toBe("site-1");

    const ambiguous = __webhooksTestables.selectBestSiteMatch(
      ["東京センター工事"],
      [
        { id: "site-a", name: "東京センター新築工事", status: "in_progress" },
        { id: "site-b", name: "東京センター改修工事", status: "in_progress" },
      ],
    );
    expect(ambiguous).toBeNull();
  });

  it("routes unknown low-confidence document to manual review", () => {
    const decision = __webhooksTestables.buildRoutingDecision(
      {
        type: "unknown",
        confidence: 55,
        reasoning: "判定できないため手動確認が必要",
        extracted_data: {},
        model_used: "haiku",
      },
      null,
    );

    expect(decision.mode).toBe("manual_review");
    expect(decision.proposalType).toBe("expense.create");
  });

  it("routes unknown high-confidence document with amount to expense proposal", () => {
    const decision = __webhooksTestables.buildRoutingDecision(
      {
        type: "unknown",
        confidence: 95,
        reasoning: "金額情報を十分に抽出できたため処理可能",
        extracted_data: {},
        model_used: "haiku",
      },
      32000,
    );

    expect(decision.mode).toBe("proposal");
    expect(decision.proposalType).toBe("expense.create");
  });

  it("normalizes historyId from string/number", () => {
    expect(__webhooksTestables.normalizeHistoryId(" 4518 ")).toBe("4518");
    expect(__webhooksTestables.normalizeHistoryId(4518)).toBe("4518");
    expect(__webhooksTestables.normalizeHistoryId(null)).toBeNull();
  });

  it("detects rate limit style errors", () => {
    expect(__webhooksTestables.isLikelyRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(__webhooksTestables.isLikelyRateLimitError(new Error("Quota exceeded"))).toBe(true);
    expect(__webhooksTestables.isLikelyRateLimitError(new Error("network timeout"))).toBe(false);
  });

  it("extracts body text from Gmail full payload", () => {
    const result = __webhooksTestables.extractMessageBody({
      payload: {
        mimeType: "multipart/alternative",
        parts: [
          {
            mimeType: "text/plain",
            body: { data: toBase64Url("本文テキストです。2/20までにご返信ください。") },
          },
        ],
      },
    });

    expect(result.text).toContain("本文テキストです");
  });

  it("analyzes communication email and creates reply task when response is needed", () => {
    const analysis = __webhooksTestables.analyzeCommunicationEmail(
      "工程変更のご相談",
      "日程変更のため、2月20日までにご返信をお願いします。",
      "現場監督 <boss@example.com>"
    );

    expect(analysis.tasks.length).toBeGreaterThan(1);
    expect(analysis.tasks.some((task: { kind: string }) => task.kind === "reply")).toBe(true);
    expect(analysis.dueDate).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
  });
});
