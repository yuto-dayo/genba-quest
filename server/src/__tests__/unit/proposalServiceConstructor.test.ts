jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
  },
}));

import { ProposalService } from "../../services/ProposalService";

describe("ProposalService constructor", () => {
  it("throws when orgId is missing", () => {
    expect(() => new (ProposalService as any)()).toThrow("PROPOSAL_SERVICE_ORG_ID_REQUIRED");
  });

  it("throws when orgId is an empty string", () => {
    expect(() => new ProposalService("")).toThrow("PROPOSAL_SERVICE_ORG_ID_REQUIRED");
  });

  it("throws when orgId is whitespace-only", () => {
    expect(() => new ProposalService("   ")).toThrow("PROPOSAL_SERVICE_ORG_ID_REQUIRED");
  });

  it("constructs with a valid orgId", () => {
    expect(
      () => new ProposalService("11111111-1111-4111-8111-111111111111"),
    ).not.toThrow();
  });
});
