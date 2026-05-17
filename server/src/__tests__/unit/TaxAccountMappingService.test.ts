jest.mock("../../lib/supabaseAdmin", () => ({
  supabaseAdmin: { from: jest.fn(), rpc: jest.fn() },
}));

import type { SupabaseClient } from "@supabase/supabase-js";
import { createChain, setupMockFromSequence } from "../helpers/mockSupabase";
import { TaxAccountMappingService } from "../../services/TaxAccountMappingService";
import { bookLedgerEntry } from "../../lib/ledger-helpers";
import { actors, TEST_ORG_ID, TEST_PROPOSAL_ID } from "../helpers/fixtures";

function makeMapping(overrides: Record<string, unknown> = {}) {
  return {
    id: "mapping-1",
    org_id: TEST_ORG_ID,
    display_label: "手当",
    tax_account_code: "5410",
    tax_account_name: "外注費",
    category: "expense",
    applicable_proposal_types: ["reward.adjust"],
    effective_from: "2026-01-01",
    effective_until: null,
    created_by: "user-1",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("TaxAccountMappingService", () => {
  it("resolves an active display label to a statutory account code", async () => {
    const from = jest.fn();
    const mappingChain = createChain({ data: makeMapping(), error: null });
    setupMockFromSequence(from, [mappingChain]);
    const client = { from } as unknown as SupabaseClient;

    const service = new TaxAccountMappingService(TEST_ORG_ID, client);
    const mapping = await service.getMapping("手当", new Date("2026-12-01T00:00:00Z"));

    expect(mapping.tax_account_code).toBe("5410");
    expect(mapping.tax_account_name).toBe("外注費");
    expect(mappingChain.eq).toHaveBeenCalledWith("display_label", "手当");
    expect(mappingChain.or).toHaveBeenCalledWith("effective_until.is.null,effective_until.gt.2026-12-01");
  });

  it("returns null when reverse mapping has no active row", async () => {
    const from = jest.fn();
    setupMockFromSequence(from, [createChain({ data: null, error: null })]);
    const client = { from } as unknown as SupabaseClient;

    const service = new TaxAccountMappingService(TEST_ORG_ID, client);

    await expect(service.getReverseMapping("5410", new Date("2026-12-01T00:00:00Z"))).resolves.toBeNull();
  });
});

describe("bookLedgerEntry", () => {
  it("books balanced entries with tax account codes and frozen display labels", async () => {
    const from = jest.fn();
    const debitMapping = createChain({
      data: makeMapping({
        display_label: "報酬の素",
        tax_account_code: "5410",
        applicable_proposal_types: ["reward.calculate"],
      }),
      error: null,
    });
    const creditMapping = createChain({
      data: makeMapping({
        id: "mapping-2",
        display_label: "普通預金",
        tax_account_code: "1010",
        tax_account_name: "普通預金",
        category: "asset",
        applicable_proposal_types: ["reward.calculate"],
      }),
      error: null,
    });
    const eventChain = createChain({
      data: { id: "event-1", created_at: "2026-05-17T00:00:00Z" },
      error: null,
    });
    const transactionChain = createChain({ data: { id: "transaction-1" }, error: null });
    const entriesChain = createChain({ data: null, error: null });
    setupMockFromSequence(from, [debitMapping, creditMapping, eventChain, transactionChain, entriesChain]);
    const tx = { from } as unknown as SupabaseClient;

    const result = await bookLedgerEntry(
      "reward.calculate",
      [
        { display_label: "報酬の素", debit_amount: 10000 },
        { display_label: "普通預金", credit_amount: 10000 },
      ],
      { org_id: TEST_ORG_ID, proposal_id: TEST_PROPOSAL_ID, actor: actors.human },
      tx,
    );

    expect(result).toEqual({ ledger_event_id: "event-1" });
    expect(entriesChain.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        transaction_id: "transaction-1",
        account_code: "5410",
        debit_amount: 10000,
        credit_amount: 0,
        display_label_snapshot: "報酬の素",
      }),
      expect.objectContaining({
        transaction_id: "transaction-1",
        account_code: "1010",
        debit_amount: 0,
        credit_amount: 10000,
        display_label_snapshot: "普通預金",
      }),
    ]);
  });

  it("rejects labels outside their applicable proposal types", async () => {
    const from = jest.fn();
    setupMockFromSequence(from, [
      createChain({
        data: makeMapping({
          display_label: "手当",
          applicable_proposal_types: ["reward.adjust"],
        }),
        error: null,
      }),
      createChain({
        data: makeMapping({
          id: "mapping-2",
          display_label: "普通預金",
          tax_account_code: "1010",
          tax_account_name: "普通預金",
          category: "asset",
          applicable_proposal_types: ["reward.calculate"],
        }),
        error: null,
      }),
    ]);
    const tx = { from } as unknown as SupabaseClient;

    await expect(
      bookLedgerEntry(
        "reward.calculate",
        [
          { display_label: "手当", debit_amount: 10000 },
          { display_label: "普通預金", credit_amount: 10000 },
        ],
        { org_id: TEST_ORG_ID, proposal_id: TEST_PROPOSAL_ID, actor: actors.human },
        tx,
      ),
    ).rejects.toThrow('Mapping "手当" not applicable to event "reward.calculate"');
  });
});
