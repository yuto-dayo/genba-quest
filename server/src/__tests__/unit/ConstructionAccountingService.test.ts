jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn() },
}));

import { supabaseAdmin } from "../../lib/supabaseAdmin";
import { ConstructionAccountingService } from "../../services/ConstructionAccountingService";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";

const mockFrom = supabaseAdmin.from as jest.Mock;

describe("ConstructionAccountingService", () => {
  const orgId = "00000000-0000-0000-0000-000000000001";
  const siteId = "11111111-1111-4111-8111-111111111111";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sums posted site expenses as accumulated construction cost", async () => {
    const chain = createChain({
      data: [
        { amount_total: 120000 },
        { amount_total: "30000.50" },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(chain);

    const service = new ConstructionAccountingService(orgId);
    const result = await service.getSiteAccumulatedCost(siteId);

    expect(result).toBe(150000.5);
    expect(mockFrom).toHaveBeenCalledWith("accounting_transactions");
    expect(chain.eq).toHaveBeenCalledWith("org_id", orgId);
    expect(chain.eq).toHaveBeenCalledWith("site_id", siteId);
    expect(chain.eq).toHaveBeenCalledWith("status", "posted");
    expect(chain.eq).toHaveBeenCalledWith("kind", "expense");
  });

  it("returns an existing transfer without creating duplicate entries", async () => {
    const costChain = createChain({ data: [{ amount_total: 50000 }], error: null });
    const transferChain = createChain({
      data: {
        id: "transfer-1",
        org_id: orgId,
        site_id: siteId,
        accumulated_amount: 50000,
        from_account_code: "1230",
        to_account_code: "5420",
        proposal_id: "22222222-2222-4222-8222-222222222222",
        ledger_event_id: "33333333-3333-4333-8333-333333333333",
        transferred_at: "2026-05-22T00:00:00.000Z",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [costChain, transferChain]);

    const service = new ConstructionAccountingService(orgId);
    const result = await service.transferOnSiteClose(siteId, {
      type: "human",
      id: "44444444-4444-4444-8444-444444444444",
      name: "現場担当",
    });

    expect(result?.id).toBe("transfer-1");
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });
});
