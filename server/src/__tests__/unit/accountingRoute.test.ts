import { createChain } from "../helpers/mockSupabase";

jest.mock("../../lib/supabaseClient", () => ({
  supabaseAdmin: {
    from: jest.fn(),
    rpc: jest.fn(),
    storage: {
      from: jest.fn(),
    },
  },
}));

jest.mock("../../services/ocrService", () => ({
  analyzeDocument: jest.fn(),
  assessExpenseRisk: jest.fn(() => ({ level: "LOW" })),
}));

jest.mock("../../services/DriveStorageService", () => ({
  getDriveStorageService: jest.fn(() => ({
    downloadAttachmentFromDrive: jest.fn(),
  })),
}));

jest.mock("../../services/InvoicePdfService", () => ({
  ensureInvoicePdfStored: jest.fn(),
  INVOICE_PDF_BUCKET: "genba-documents",
}));

import accountingRouter from "../../routes/accounting";
import { supabaseAdmin } from "../../lib/supabaseClient";
import { ensureInvoicePdfStored } from "../../services/InvoicePdfService";

type MockRes = {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  send: jest.Mock;
};

function createMockRes(): MockRes {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    send: jest.fn(),
  } as unknown as MockRes;
  res.status.mockReturnValue(res);
  return res;
}

function getPostHandler(path: string) {
  const layer = (accountingRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.post
  );

  if (!layer) {
    throw new Error(`POST handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function getGetHandler(path: string) {
  const layer = (accountingRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.get
  );

  if (!layer) {
    throw new Error(`GET handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function getPutHandler(path: string) {
  const layer = (accountingRouter as any).stack.find(
    (entry: any) => entry.route?.path === path && entry.route?.methods?.put
  );

  if (!layer) {
    throw new Error(`PUT handler not found for path: ${path}`);
  }

  return layer.route.stack[0].handle as (req: any, res: any) => Promise<void>;
}

function setupMockFromSequence(
  mockFrom: jest.Mock,
  chains: ReturnType<typeof createChain>[],
  idempotencyChains: ReturnType<typeof createChain>[] = [],
  proposalChains: ReturnType<typeof createChain>[] = []
): void {
  let callIndex = 0;
  let idempotencyIndex = 0;
  let proposalIndex = 0;

  mockFrom.mockImplementation((table: string) => {
    if (table === "accounting_write_idempotency_keys") {
      if (idempotencyChains.length > 0) {
        return idempotencyChains.shift()!;
      }

      idempotencyIndex += 1;
      if (idempotencyIndex % 2 === 1) {
        return createChain({
          data: {
            id: `idem-${idempotencyIndex}`,
            request_hash: null,
            status: "in_progress",
            response_status: 200,
            response_json: null,
          },
          error: null,
        });
      }

      return createChain({ data: null, error: null });
    }

    if (table === "proposals") {
      if (proposalChains.length > 0) {
        return proposalChains.shift()!;
      }

      proposalIndex += 1;
      return createChain({
        data: {
          id: `proposal-${proposalIndex}`,
          type: "expense.create",
          status: "executed",
          policy_ref: "legacy_direct_transition",
        },
        error: null,
      });
    }

    const chain = chains[callIndex] || createChain();
    callIndex += 1;
    return chain;
  });
}

describe("accounting router", () => {
  const createExpenseHandler = getPostHandler("/expenses");
  const createSaleHandler = getPostHandler("/sales");
  const getTransactionsHandler = getGetHandler("/transactions");
  const getPlHandler = getGetHandler("/pl");
  const getInvoiceSettingsHandler = getGetHandler("/invoice-settings");
  const updateInvoiceSettingsHandler = getPutHandler("/invoice-settings");
  const getInvoiceEligibilityHandler = getGetHandler("/invoice-eligibility/:transactionId");
  const getInvoicesHandler = getGetHandler("/invoices");
  const createInvoiceHandler = getPostHandler("/invoices");
  const correctInvoiceHandler = getPostHandler("/invoices/:id/correct");
  const createInvoiceSupplementHandler = getPostHandler("/invoices/:id/supplement");
  const createPaymentAllocationHandler = getPostHandler("/payments/allocations");
  const downloadInvoiceHandler = getGetHandler("/invoices/:id/download");
  const voidTransactionHandler = getPostHandler("/void/:id");
  const mockFrom = (supabaseAdmin as unknown as { from: jest.Mock }).from;
  const mockRpc = (supabaseAdmin as unknown as { rpc: jest.Mock }).rpc;
  const mockStorageFrom = (supabaseAdmin as unknown as { storage: { from: jest.Mock } }).storage.from;
  const mockEnsureInvoicePdfStored = ensureInvoicePdfStored as jest.MockedFunction<typeof ensureInvoicePdfStored>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStorageFrom.mockReset();
  });

  it("POST /expenses posts low-risk expense immediately and creates journal entries", async () => {
    const siteChain = createChain({ data: { id: "site-1", status: "active" }, error: null });
    const txInsertChain = createChain({
      data: {
        id: "tx-1",
        kind: "expense",
        amount_subtotal: 1000,
        tax_amount: 100,
        amount_total: 1100,
        category: "material",
        recorded_date: "2026-03-18",
        tax_category: "10_STANDARD",
      },
      error: null,
    });
    const existingEntryChain = createChain({ data: null, error: null });
    const entryInsertChain = createChain({ data: { id: "entry-1" }, error: null });
    const lineInsertChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      siteChain,
      txInsertChain,
      existingEntryChain,
      entryInsertChain,
      lineInsertChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "expense-low-risk-1",
        cost_center: "SITE",
        site_id: "site-1",
        vendor_name: "資材屋",
        amount_subtotal: 1000,
        tax_amount: 100,
        amount_total: 1100,
        category: "material",
        description: "ビス購入",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(txInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      kind: "expense",
      site_id: "site-1",
      category: "material",
      tax_category: "10_STANDARD",
      risk_level: "LOW",
      status: "posted",
      review_status: "not_required",
      created_by: "user-1",
    }));
    expect(existingEntryChain.maybeSingle).toHaveBeenCalled();
    expect(entryInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      transaction_id: "tx-1",
      created_by: "user-1",
    }));
    expect(lineInsertChain.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ account_code: "5100", debit: 1000, credit: 0 }),
      expect.objectContaining({ account_code: "1500", debit: 100, credit: 0 }),
      expect.objectContaining({ account_code: "1100", debit: 0, credit: 1100 }),
    ]));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /expenses requires an idempotency key for accounting writes", async () => {
    const siteChain = createChain({ data: { id: "site-1", status: "active" }, error: null });
    setupMockFromSequence(mockFrom, [siteChain]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 1100,
        category: "material",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "idempotency_key is required" });
  });

  it("POST /expenses replays a completed idempotent write without inserting another transaction", async () => {
    const siteChain = createChain({ data: { id: "site-1", status: "active" }, error: null });
    const txInsertChain = createChain({ data: { id: "tx-new" }, error: null });
    const idempotencyInsertChain = createChain({
      data: null,
      error: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    const idempotencyExistingChain = createChain({
      data: {
        id: "idem-existing",
        request_hash: null,
        status: "succeeded",
        response_status: 201,
        response_json: { id: "tx-existing", kind: "expense" },
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [siteChain, txInsertChain], [idempotencyInsertChain, idempotencyExistingChain]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "expense-replay-1",
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 1100,
        category: "material",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(txInsertChain.insert).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "tx-existing", kind: "expense" });
  });

  it("GET /transactions applies creator and month filters", async () => {
    const queryChain = createChain({
      data: [],
      error: null,
    });
    setupMockFromSequence(mockFrom, [queryChain]);

    const req = {
      orgId: "org-1",
      query: {
        kind: "expense",
        created_by: "user-42",
        date_from: "2026-04-01",
        date_to: "2026-04-30",
        limit: "20",
        offset: "0",
      },
    } as any;
    const res = createMockRes();

    await getTransactionsHandler(req, res);

    expect(queryChain.eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(queryChain.eq).toHaveBeenCalledWith("kind", "expense");
    expect(queryChain.eq).toHaveBeenCalledWith("created_by", "user-42");
    expect(queryChain.gte).toHaveBeenCalledWith("recorded_date", "2026-04-01");
    expect(queryChain.lte).toHaveBeenCalledWith("recorded_date", "2026-04-30");
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("POST /expenses stores misc expenses as tax-free when selected", async () => {
    const siteChain = createChain({ data: { id: "site-1", status: "active" }, error: null });
    const txInsertChain = createChain({
      data: {
        id: "tx-misc",
        kind: "expense",
        amount_subtotal: 5000,
        tax_amount: 0,
        amount_total: 5000,
        category: "other",
        recorded_date: "2026-03-18",
        tax_category: "00_TAXFREE",
      },
      error: null,
    });
    const existingEntryChain = createChain({ data: null, error: null });
    const entryInsertChain = createChain({ data: { id: "entry-misc" }, error: null });
    const lineInsertChain = createChain({ data: null, error: null });
    const proposalChain = createChain({
      data: {
        id: "proposal-expense-misc",
        type: "expense.create",
        status: "executed",
        policy_ref: "legacy_direct_transition",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [
      siteChain,
      txInsertChain,
      existingEntryChain,
      entryInsertChain,
      lineInsertChain,
    ], [], [proposalChain]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "expense-misc-1",
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 5000,
        category: "other",
        tax_category: "00_TAXFREE",
        expense_item_code: "fee",
        description: "現場雑費",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(txInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      category: "other",
      amount_subtotal: 5000,
      tax_amount: 0,
      amount_total: 5000,
      tax_category: "00_TAXFREE",
      expense_item_code: "fee",
    }));
    expect(lineInsertChain.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ account_code: "5900", debit: 5000, credit: 0, tax_type: "taxfree" }),
      expect.objectContaining({ account_code: "1100", debit: 0, credit: 5000 }),
    ]));
    expect(lineInsertChain.insert).toHaveBeenCalledWith(expect.not.arrayContaining([
      expect.objectContaining({ account_code: "1500" }),
    ]));
    expect(proposalChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      type: "expense.create",
      status: "executed",
      policy_ref: "legacy_direct_transition",
      idempotency_key: "accounting.expenses.create:expense-misc-1",
      payload: expect.objectContaining({
        category: "other",
        amount_total: 5000,
        projection: expect.objectContaining({
          legacy_transaction_id: "tx-misc",
          legacy_transaction_kind: "expense",
        }),
        transition: expect.objectContaining({
          mode: "legacy_direct_projection",
          endpoint_name: "accounting.expenses.create",
        }),
      }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      proposal: expect.objectContaining({
        id: "proposal-expense-misc",
        type: "expense.create",
        status: "executed",
      }),
      execution: expect.objectContaining({
        mode: "legacy_direct_projection",
        proposal_id: "proposal-expense-misc",
      }),
      projection: expect.objectContaining({
        legacy_transaction_id: "tx-misc",
        proposal_id: "proposal-expense-misc",
      }),
    }));
  });

  it("POST /expenses retries without misc columns when schema migrations are missing", async () => {
    const siteChain = createChain({ data: { id: "site-1", status: "active" }, error: null });
    const txInsertMissingCategoryChain = createChain({
      data: null,
      error: { message: "Could not find the 'category' column of 'accounting_transactions' in the schema cache" },
    });
    const txInsertMissingMiscChain = createChain({
      data: null,
      error: { message: "Could not find the 'expense_item_code' column of 'accounting_transactions' in the schema cache" },
    });
    const txInsertSuccessChain = createChain({
      data: {
        id: "tx-misc-compat",
        kind: "expense",
        amount_subtotal: 5000,
        tax_amount: 0,
        amount_total: 5000,
        recorded_date: "2026-03-18",
        tax_category: "00_TAXFREE",
      },
      error: null,
    });
    const existingEntryChain = createChain({ data: null, error: null });
    const entryInsertChain = createChain({ data: { id: "entry-misc-compat" }, error: null });
    const lineInsertChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      siteChain,
      txInsertMissingCategoryChain,
      txInsertMissingMiscChain,
      txInsertSuccessChain,
      existingEntryChain,
      entryInsertChain,
      lineInsertChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "expense-misc-retry-1",
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 5000,
        category: "other",
        tax_category: "00_TAXFREE",
        expense_item_code: "fee",
        description: "現場雑費",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(txInsertMissingCategoryChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      category: "other",
      expense_item_code: "fee",
    }));
    expect(txInsertMissingMiscChain.insert).toHaveBeenCalledWith(expect.not.objectContaining({
      category: expect.anything(),
    }));
    expect(txInsertMissingMiscChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      expense_item_code: "fee",
    }));
    expect(txInsertSuccessChain.insert).toHaveBeenCalledWith(expect.not.objectContaining({
      category: expect.anything(),
      expense_item_code: expect.anything(),
      expense_item_other: expect.anything(),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /expenses keeps high-risk expense in review flow", async () => {
    const siteChain = createChain({ data: { id: "site-1", status: "active" }, error: null });
    const txInsertChain = createChain({
      data: {
        id: "tx-2",
        kind: "expense",
        amount_total: 40000,
        risk_level: "HIGH",
        reviewer_id: "reviewer-1",
        status: "pending_review",
        review_status: "pending",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [siteChain, txInsertChain]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "expense-high-risk-1",
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 40000,
        category: "material",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(txInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      category: "material",
      risk_level: "HIGH",
      status: undefined,
      review_status: undefined,
    }));
    expect(mockFrom).toHaveBeenCalledTimes(5);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      status: "pending_review",
      review_status: "pending",
    }));
  });

  it("POST /expenses rejects invalid category before hitting DB constraints", async () => {
    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 1200,
        category: "construction",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "category must be one of material, tool, travel, food, fuel, utility, other",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST /expenses rejects invalid tax category before hitting DB constraints", async () => {
    const req = {
      userId: "user-1",
      body: {
        cost_center: "SITE",
        site_id: "site-1",
        amount_total: 1200,
        category: "other",
        tax_category: "05_UNKNOWN",
      },
    } as any;
    const res = createMockRes();

    await createExpenseHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "tax_category must be one of 10_STANDARD, 08_REDUCED, 00_EXEMPT, 00_TAXFREE",
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST /sales rejects missing site_id", async () => {
    const req = {
      userId: "user-1",
      body: {
        amount_total: 50000,
      },
    } as any;
    const res = createMockRes();

    await createSaleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "site_id is required" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST /sales stores a single item when unit price and quantity are provided", async () => {
    const siteLookupChain = createChain({
      data: {
        id: "site-1",
        status: "active",
      },
      error: null,
    });
    const txInsertChain = createChain({
      data: {
        id: "sale-1",
        kind: "sale",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        recorded_date: "2026-03-18",
      },
      error: null,
    });
    const saleItemInsertChain = createChain({ data: null, error: null });
    const existingEntryChain = createChain({ data: null, error: null });
    const entryInsertChain = createChain({ data: { id: "entry-2" }, error: null });
    const lineInsertChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      siteLookupChain,
      txInsertChain,
      saleItemInsertChain,
      existingEntryChain,
      entryInsertChain,
      lineInsertChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "sale-single-1",
        site_id: "site-1",
        description: "足場工事",
        unit_price: 50000,
        quantity: 2,
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
      },
    } as any;
    const res = createMockRes();

    await createSaleHandler(req, res);

    expect(txInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      kind: "sale",
      site_id: "site-1",
      amount_total: 110000,
      created_by: "user-1",
    }));
    expect(saleItemInsertChain.insert).toHaveBeenCalledWith([
      {
        org_id: "org-1",
        transaction_id: "sale-1",
        item_name: "足場工事",
        unit_name: "式",
        unit_price: 50000,
        quantity: 2,
      },
    ]);
    expect(entryInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      transaction_id: "sale-1",
      created_by: "user-1",
    }));
    expect(lineInsertChain.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ account_code: "1200", debit: 110000, credit: 0 }),
      expect.objectContaining({ account_code: "4100", debit: 0, credit: 100000 }),
      expect.objectContaining({ account_code: "2500", debit: 0, credit: 10000 }),
    ]));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /sales stores multiple line items and recalculates totals from them", async () => {
    const siteLookupChain = createChain({
      data: {
        id: "site-1",
        status: "active",
      },
      error: null,
    });
    const txInsertChain = createChain({
      data: {
        id: "sale-2",
        kind: "sale",
        amount_subtotal: 170000,
        tax_amount: 17000,
        amount_total: 187000,
        recorded_date: "2026-03-18",
        tax_category: "10_STANDARD",
      },
      error: null,
    });
    const saleItemInsertChain = createChain({ data: null, error: null });
    const existingEntryChain = createChain({ data: null, error: null });
    const entryInsertChain = createChain({ data: { id: "entry-3" }, error: null });
    const lineInsertChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      siteLookupChain,
      txInsertChain,
      saleItemInsertChain,
      existingEntryChain,
      entryInsertChain,
      lineInsertChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "org-1",
      body: {
        idempotency_key: "sale-multiple-1",
        site_id: "site-1",
        description: "",
        amount_subtotal: 1,
        tax_amount: 1,
        amount_total: 1,
        items: [
          {
            item_name: "床工事",
            quantity: 20,
            unit_name: "㎡",
            unit_price: 5000,
          },
          {
            item_name: "クロス工事",
            quantity: 7,
            unit_name: "人工",
            unit_price: 10000,
          },
        ],
      },
    } as any;
    const res = createMockRes();

    await createSaleHandler(req, res);

    expect(txInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "org-1",
      kind: "sale",
      site_id: "site-1",
      description: "床工事、クロス工事",
      amount_subtotal: 170000,
      tax_amount: 17000,
      amount_total: 187000,
      tax_category: "10_STANDARD",
    }));
    expect(saleItemInsertChain.insert).toHaveBeenCalledWith([
      {
        org_id: "org-1",
        transaction_id: "sale-2",
        item_name: "床工事",
        unit_name: "㎡",
        unit_price: 5000,
        quantity: 20,
      },
      {
        org_id: "org-1",
        transaction_id: "sale-2",
        item_name: "クロス工事",
        unit_name: "人工",
        unit_price: 10000,
        quantity: 7,
      },
    ]);
    expect(lineInsertChain.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ org_id: "org-1", account_code: "1200", debit: 187000, credit: 0 }),
      expect.objectContaining({ account_code: "4100", debit: 0, credit: 170000 }),
      expect.objectContaining({ account_code: "2500", debit: 0, credit: 17000 }),
    ]));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("POST /sales rejects completed sites", async () => {
    const siteLookupChain = createChain({
      data: {
        id: "site-1",
        status: "completed",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [siteLookupChain]);

    const req = {
      userId: "user-1",
      body: {
        site_id: "site-1",
        description: "足場工事",
        unit_price: 50000,
        quantity: 2,
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
      },
    } as any;
    const res = createMockRes();

    await createSaleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "SITE_COMPLETED_SALES_IMMUTABLE" });
  });

  it("POST /sales rejects when only unit price is provided", async () => {
    const siteLookupChain = createChain({
      data: {
        id: "site-1",
        status: "active",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [siteLookupChain]);

    const req = {
      userId: "user-1",
      body: {
        site_id: "site-1",
        unit_price: 50000,
        amount_total: 50000,
      },
    } as any;
    const res = createMockRes();

    await createSaleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "unit_price and quantity must be provided together" });
  });

  it("POST /sales rejects item rows without unit_name", async () => {
    const siteLookupChain = createChain({
      data: {
        id: "site-1",
        status: "active",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [siteLookupChain]);

    const req = {
      userId: "user-1",
      body: {
        site_id: "site-1",
        items: [
          {
            item_name: "床工事",
            quantity: 10,
            unit_price: 6000,
          },
        ],
      },
    } as any;
    const res = createMockRes();

    await createSaleHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "items[0].unit_name is required" });
  });

  it("GET /invoice-settings returns default values when org settings do not exist", async () => {
    const settingsChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [settingsChain]);

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
    } as any;
    const res = createMockRes();

    await getInvoiceSettingsHandler(req, res);

    expect(settingsChain.eq).toHaveBeenCalledWith("org_id", "11111111-1111-4111-8111-111111111111");
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "11111111-1111-4111-8111-111111111111",
      invoice_issuer_status: "unregistered",
    }));
  });

  it("PUT /invoice-settings rejects non-manager updates", async () => {
    const profileChain = createChain({
      data: { role: "worker" },
      error: null,
    });
    setupMockFromSequence(mockFrom, [profileChain]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        issuer_name: "GENBA QUEST株式会社",
        invoice_issuer_status: "registered",
        qualified_invoice_registration_number: "T1234567890123",
        qualified_invoice_registered_at: "2026-03-01",
      },
    } as any;
    const res = createMockRes();

    await updateInvoiceSettingsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invoice settings can only be updated by admin or manager",
    });
  });

  it("PUT /invoice-settings allows updates during dev auth bypass", async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDevSkipAuth = process.env.DEV_SKIP_AUTH;

    process.env.NODE_ENV = "development";
    process.env.DEV_SKIP_AUTH = "true";

    try {
      const profileChain = createChain({
        data: { role: "member" },
        error: null,
      });
      const settingsChain = createChain({ data: null, error: null });
      const insertChain = createChain({
        data: {
          org_id: "11111111-1111-4111-8111-111111111111",
          issuer_name: "GENBA QUEST株式会社",
          invoice_issuer_status: "registered",
        },
        error: null,
      });
      setupMockFromSequence(mockFrom, [profileChain, settingsChain, insertChain]);

      const req = {
        userId: "user-1",
        orgId: "11111111-1111-4111-8111-111111111111",
        body: {
          issuer_name: "GENBA QUEST株式会社",
          invoice_issuer_status: "registered",
          qualified_invoice_registration_number: "T1234567890123",
          qualified_invoice_registered_at: "2026-03-01",
        },
      } as any;
      const res = createMockRes();

      await updateInvoiceSettingsHandler(req, res);

      expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
        org_id: "11111111-1111-4111-8111-111111111111",
        issuer_name: "GENBA QUEST株式会社",
        created_by: "user-1",
      }));
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        issuer_name: "GENBA QUEST株式会社",
        invoice_issuer_status: "registered",
      }));
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalDevSkipAuth === undefined) {
        delete process.env.DEV_SKIP_AUTH;
      } else {
        process.env.DEV_SKIP_AUTH = originalDevSkipAuth;
      }
    }
  });

  it("GET /invoice-eligibility reports standard invoice when issuer is not registered", async () => {
    const transactionChain = createChain({
      data: {
        id: "tx-1",
        kind: "sale",
        recorded_date: "2026-03-10",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
      },
      error: null,
    });
    const settingsChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [transactionChain, settingsChain, sourceLinksChain]);

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { transactionId: "tx-1" },
    } as any;
    const res = createMockRes();

    await getInvoiceEligibilityHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      transaction_id: "tx-1",
      eligible_for_qualified_invoice: false,
      resolved_document_type: "standard_invoice",
      reason_codes: ["ISSUER_NOT_REGISTERED"],
    }));
  });

  it("GET /invoices returns invoice snapshots with source transaction context", async () => {
    const invoiceChain = createChain({
      data: [{
        id: "inv-1",
        transaction_id: "tx-1",
        invoice_no: "INV-2026-0003",
        document_type: "qualified_invoice",
        issue_date: "2026-03-20",
        due_date: "2026-04-20",
        billing_name: "株式会社現場",
        billing_address: "東京都港区1-2-3",
        notes: "銀行振込",
        pdf_render_status: "generated",
        created_at: "2026-03-20T09:00:00.000Z",
        source_transaction_id: "tx-1",
        source_transaction_date: "2026-03-18",
        eligibility_snapshot: {
          resolved_document_type: "qualified_invoice",
          corrected_line_items: [{
            item_name: "請求書上の修正版明細",
            quantity: 1,
            unit_name: "式",
            unit_price: 220000,
            amount: 220000,
          }],
        },
      }],
      error: null,
    });
    const sourceLinksChain = createChain({
      data: [{
        invoice_id: "inv-1",
        source_transaction_id: "tx-1",
        source_transaction_date: "2026-03-18",
        sort_order: 0,
        is_primary_document: true,
      }],
      error: null,
    });
    const transactionChain = createChain({
      data: [{
        id: "tx-1",
        description: "内装工事 3月分",
        amount_total: 220000,
        status: "posted",
        recorded_date: "2026-03-18",
        site: { id: "site-1", name: "渋谷現場" },
        client: { id: "client-1", name: "株式会社クライアント" },
      }],
      error: null,
    });
    const transactionItemsChain = createChain({
      data: [{
        transaction_id: "tx-1",
        item_name: "売上登録時の明細",
        quantity: 1,
        unit_name: "式",
        unit_price: 220000,
        amount: 220000,
      }],
      error: null,
    });
    setupMockFromSequence(mockFrom, [invoiceChain, sourceLinksChain, transactionChain, transactionItemsChain]);

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      query: { limit: "20", offset: "0" },
    } as any;
    const res = createMockRes();

    await getInvoicesHandler(req, res);

    expect(invoiceChain.eq).toHaveBeenCalledWith("org_id", "11111111-1111-4111-8111-111111111111");
    expect(sourceLinksChain.in).toHaveBeenCalledWith("invoice_id", ["inv-1"]);
    expect(transactionChain.in).toHaveBeenCalledWith("id", ["tx-1"]);
    expect(transactionItemsChain.in).toHaveBeenCalledWith("transaction_id", ["tx-1"]);
    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "inv-1",
        invoice_no: "INV-2026-0003",
        display_line_items: [
          expect.objectContaining({
            item_name: "請求書上の修正版明細",
          }),
        ],
        source_transaction: expect.objectContaining({
          id: "tx-1",
          amount_total: 220000,
          site: { id: "site-1", name: "渋谷現場" },
          client: { id: "client-1", name: "株式会社クライアント" },
        }),
      }),
    ]);
  });

  it("GET /invoices filters by source transaction id when provided", async () => {
    const sourceLinksChain = createChain({
      data: [],
      error: null,
    });
    setupMockFromSequence(mockFrom, [sourceLinksChain]);

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      query: {
        limit: "20",
        offset: "0",
        source_transaction_id: "tx-42",
      },
    } as any;
    const res = createMockRes();

    await getInvoicesHandler(req, res);

    expect(sourceLinksChain.in).toHaveBeenCalledWith("source_transaction_id", ["tx-42"]);
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("GET /invoices falls back when invoice source migration 044 is not applied", async () => {
    const invoiceListMissingColumnChain = createChain({
      data: null,
      error: { message: "Could not find the 'source_summary_snapshot' column of 'accounting_invoices' in the schema cache" },
    });
    const invoiceListFallbackChain = createChain({
      data: [{
        id: "inv-legacy",
        transaction_id: "tx-legacy",
        invoice_no: "INV-2026-0099",
        document_type: "standard_invoice",
        issue_date: "2026-04-01",
        due_date: "2026-04-30",
        billing_name: "株式会社現場",
        billing_address: "東京都港区1-2-3",
        notes: "旧環境請求書",
        pdf_render_status: "generated",
        created_at: "2026-04-01T00:00:00.000Z",
        source_transaction_id: "tx-legacy",
        source_transaction_date: "2026-03-25",
        eligibility_snapshot: {},
      }],
      error: null,
    });
    const sourceLinksMissingTableChain = createChain({
      data: null,
      error: { message: "relation \"accounting_invoice_sources\" does not exist" },
    });
    const transactionsChain = createChain({
      data: [{
        id: "tx-legacy",
        amount_subtotal: 80000,
        description: "旧環境の請求対象",
        amount_total: 88000,
        status: "posted",
        recorded_date: "2026-03-25",
        site: { id: "site-1", name: "渋谷現場" },
        client: { id: "client-1", name: "株式会社現場" },
      }],
      error: null,
    });
    const transactionItemsChain = createChain({
      data: [],
      error: null,
    });
    setupMockFromSequence(mockFrom, [
      invoiceListMissingColumnChain,
      invoiceListFallbackChain,
      sourceLinksMissingTableChain,
      transactionsChain,
      transactionItemsChain,
    ]);

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      query: {
        limit: "24",
        offset: "0",
      },
    } as any;
    const res = createMockRes();

    await getInvoicesHandler(req, res);

    expect(res.json).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "inv-legacy",
        source_transaction: expect.objectContaining({
          id: "tx-legacy",
          description: "旧環境の請求対象",
        }),
        source_summary: expect.objectContaining({
          source_count: 1,
          amount_total: 88000,
        }),
      }),
    ]);
  });

  it("POST /invoices requires billing_name before issuing invoice numbers", async () => {
    const req = {
      userId: "user-1",
      body: {
        transaction_id: "tx-1",
      },
    } as any;
    const res = createMockRes();

    await createInvoiceHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "billing_name is required" });
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("POST /invoices rejects already invoiced transactions before issuing a new number", async () => {
    const transactionChain = createChain({
      data: {
        id: "tx-1",
        kind: "sale",
        recorded_date: "2026-03-10",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
      },
      error: null,
    });
    const settingsChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({
      data: [{
        invoice_id: "inv-1",
        source_transaction_id: "tx-1",
        source_transaction_date: "2026-03-10",
        sort_order: 0,
        is_primary_document: true,
      }],
      error: null,
    });
    const existingInvoiceChain = createChain({
      data: [{
        id: "inv-1",
        invoice_no: "INV-2026-0001",
        document_type: "standard_invoice",
      }],
      error: null,
    });
    setupMockFromSequence(mockFrom, [transactionChain, settingsChain, sourceLinksChain, existingInvoiceChain]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        idempotency_key: "invoice-standard-1",
        transaction_id: "tx-1",
        billing_name: "株式会社現場",
      },
    } as any;
    const res = createMockRes();

    await createInvoiceHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Invoice already exists: INV-2026-0001" });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("POST /invoices creates standard invoice through the atomic RPC when available", async () => {
    const transactionChain = createChain({
      data: {
        id: "tx-1",
        kind: "sale",
        site_id: "site-1",
        recorded_date: "2026-03-10",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
      },
      error: null,
    });
    const settingsChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({ data: [], error: null });
    const existingInvoicesFallbackChain = createChain({ data: [], error: null });
    const revenueBasisPreflightChain = createChain({
      data: [{
        id: "rb-1",
        site_id: "site-1",
        recognition_date: "2026-03-10",
        recognized_on: "2026-03-10",
        amount_inc_tax: 220000,
        receivable_account_type: "accounts_receivable",
      }],
      error: null,
    });
    const invoiceAllocationExistingChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [
      transactionChain,
      settingsChain,
      sourceLinksChain,
      existingInvoicesFallbackChain,
      revenueBasisPreflightChain,
      invoiceAllocationExistingChain,
    ]);
    mockRpc.mockResolvedValue({
      data: {
        invoice: {
          id: "inv-atomic",
          invoice_no: "INV-2026-0002",
          document_type: "standard_invoice",
          pdf_render_status: "pending",
        },
      },
      error: null,
    });

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        idempotency_key: "invoice-atomic-1",
        transaction_id: "tx-1",
        billing_name: "株式会社現場",
        requested_document_type: "auto",
      },
    } as any;
    const res = createMockRes();

    await createInvoiceHandler(req, res);

    expect(mockRpc).toHaveBeenCalledWith("rpc_create_accounting_invoice", expect.objectContaining({
      p_org_id: "11111111-1111-4111-8111-111111111111",
      p_source_transaction_ids: ["tx-1"],
      p_representative_transaction_id: "tx-1",
      p_document_type: "standard_invoice",
      p_created_by: "user-1",
    }));
    expect(mockFrom).not.toHaveBeenCalledWith("accounting_journal_entries");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: "inv-atomic",
      eligibility: expect.objectContaining({
        resolved_document_type: "standard_invoice",
      }),
    }));
  });

  it("POST /invoices stores standard invoice snapshots when issuer is not registered", async () => {
    const transactionChain = createChain({
      data: {
        id: "tx-1",
        kind: "sale",
        site_id: "site-1",
        recorded_date: "2026-03-10",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
      },
      error: null,
    });
    const settingsChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({ data: [], error: null });
    const existingInvoicesFallbackChain = createChain({ data: [], error: null });
    const revenueBasisPreflightChain = createChain({
      data: [{
        id: "rb-1",
        site_id: "site-1",
        recognition_date: "2026-03-10",
        recognized_on: "2026-03-10",
        amount_inc_tax: 220000,
        receivable_account_type: "accounts_receivable",
      }],
      error: null,
    });
    const invoiceAllocationExistingChain = createChain({ data: [], error: null });
    const invoiceInsertChain = createChain({
      data: {
        id: "inv-2",
        invoice_no: "INV-2026-0002",
        document_type: "standard_invoice",
        pdf_render_status: "pending",
      },
      error: null,
    });
    const invoiceSourcesInsertChain = createChain({ data: null, error: null });
    const revenueBasisChain = createChain({
      data: [{
        id: "rb-1",
        site_id: "site-1",
        recognition_date: "2026-03-10",
        recognized_on: "2026-03-10",
        amount_inc_tax: 220000,
        receivable_account_type: "accounts_receivable",
      }],
      error: null,
    });
    const invoiceAllocationInsertChain = createChain({ data: null, error: null });
    const txUpdateChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      transactionChain,
      settingsChain,
      sourceLinksChain,
      existingInvoicesFallbackChain,
      revenueBasisPreflightChain,
      invoiceAllocationExistingChain,
      invoiceInsertChain,
      invoiceSourcesInsertChain,
      revenueBasisChain,
      invoiceAllocationInsertChain,
      txUpdateChain,
    ]);
    mockRpc.mockImplementation((functionName: string) => {
      if (functionName === "rpc_create_accounting_invoice") {
        return Promise.resolve({
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.rpc_create_accounting_invoice",
          },
        });
      }

      return Promise.resolve({ data: "INV-2026-0002", error: null });
    });

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        idempotency_key: "invoice-standard-1",
        transaction_id: "tx-1",
        billing_name: "株式会社現場",
        requested_document_type: "auto",
      },
    } as any;
    const res = createMockRes();

    await createInvoiceHandler(req, res);

    expect(invoiceInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: "11111111-1111-4111-8111-111111111111",
      transaction_id: "tx-1",
      source_transaction_id: "tx-1",
      document_type: "standard_invoice",
      pdf_render_status: "pending",
      eligibility_snapshot: expect.objectContaining({
        resolved_document_type: "standard_invoice",
        reason_codes: ["ISSUER_NOT_REGISTERED"],
      }),
    }));
    expect(invoiceSourcesInsertChain.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        org_id: "11111111-1111-4111-8111-111111111111",
        invoice_id: "inv-2",
        source_transaction_id: "tx-1",
        is_primary_document: true,
      }),
    ]));
    expect(revenueBasisPreflightChain.in).toHaveBeenCalledWith("site_id", ["site-1"]);
    expect(invoiceAllocationExistingChain.in).toHaveBeenCalledWith("revenue_basis_id", ["rb-1"]);
    expect(revenueBasisChain.in).toHaveBeenCalledWith("site_id", ["site-1"]);
    expect(invoiceAllocationInsertChain.insert).toHaveBeenCalledWith([
      expect.objectContaining({
        org_id: "11111111-1111-4111-8111-111111111111",
        invoice_id: "inv-2",
        invoice_line_key: "source_transaction:tx-1",
        revenue_basis_id: "rb-1",
        allocation_amount_ex_tax: 100000,
        tax_amount: 10000,
        amount_inc_tax: 110000,
        allocation_kind: "invoice_issue",
        metadata_json: expect.objectContaining({
          source_transaction_id: "tx-1",
          posting_mode: "no_pl_journal",
        }),
      }),
    ]);
    expect(txUpdateChain.in).toHaveBeenCalledWith("id", ["tx-1"]);
    expect(mockFrom).not.toHaveBeenCalledWith("accounting_journal_entries");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      eligibility: expect.objectContaining({
        resolved_document_type: "standard_invoice",
        reason_codes: ["ISSUER_NOT_REGISTERED"],
      }),
    }));
  });

  it("POST /invoices rejects allocations that exceed the revenue basis uninvoiced balance before issuing a number", async () => {
    const transactionChain = createChain({
      data: {
        id: "tx-1",
        kind: "sale",
        site_id: "site-1",
        recorded_date: "2026-03-10",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
      },
      error: null,
    });
    const settingsChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({ data: [], error: null });
    const existingInvoicesFallbackChain = createChain({ data: [], error: null });
    const revenueBasisPreflightChain = createChain({
      data: [{
        id: "rb-1",
        site_id: "site-1",
        recognition_date: "2026-03-10",
        recognized_on: "2026-03-10",
        amount_inc_tax: 110000,
        receivable_account_type: "accounts_receivable",
      }],
      error: null,
    });
    const invoiceAllocationExistingChain = createChain({
      data: [{
        revenue_basis_id: "rb-1",
        amount_inc_tax: 100000,
      }],
      error: null,
    });
    setupMockFromSequence(mockFrom, [
      transactionChain,
      settingsChain,
      sourceLinksChain,
      existingInvoicesFallbackChain,
      revenueBasisPreflightChain,
      invoiceAllocationExistingChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        idempotency_key: "invoice-over-allocated-1",
        transaction_id: "tx-1",
        billing_name: "株式会社現場",
        requested_document_type: "auto",
      },
    } as any;
    const res = createMockRes();

    await createInvoiceHandler(req, res);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "INVOICE_ALLOCATION_EXCEEDS_UNINVOICED_BALANCE" });
  });

  it("POST /invoices rejects explicit qualified invoice requests when eligibility fails", async () => {
    const transactionChain = createChain({
      data: {
        id: "tx-1",
        kind: "sale",
        recorded_date: "2026-03-10",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
      },
      error: null,
    });
    const settingsChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({ data: [], error: null });
    setupMockFromSequence(mockFrom, [transactionChain, settingsChain, sourceLinksChain]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        transaction_id: "tx-1",
        billing_name: "株式会社現場",
        requested_document_type: "qualified_invoice",
      },
    } as any;
    const res = createMockRes();

    await createInvoiceHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: "Requested qualified invoice is not allowed",
      reason_codes: ["ISSUER_NOT_REGISTERED"],
      reason_messages: ["登録事業者ではないため適格請求書を発行できません"],
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("POST /invoices/:id/correct updates invoice fields and records correction metadata", async () => {
    const invoiceFetchChain = createChain({
      data: {
        id: "inv-1",
        org_id: "11111111-1111-4111-8111-111111111111",
        document_type: "standard_invoice",
        billing_name: "旧宛名",
        billing_address: "旧住所",
        notes: "旧備考",
        eligibility_snapshot: {
          resolved_document_type: "standard_invoice",
          correction_history: [],
        },
      },
      error: null,
    });
    const invoiceUpdateChain = createChain({
      data: {
        id: "inv-1",
        billing_name: "新宛名",
        pdf_render_status: "pending",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [invoiceFetchChain, invoiceUpdateChain]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "inv-1" },
      body: {
        billing_name: "新宛名",
        billing_address: "新住所",
        notes: "修正版備考",
        correction_reason_type: "recipient_error",
        correction_note: "宛名を修正",
        corrected_line_items: [{
          item_name: "外壁補修工事",
          quantity: 2,
          unit_name: "式",
          unit_price: 50000,
        }],
      },
    } as any;
    const res = createMockRes();

    await correctInvoiceHandler(req, res);

    expect(invoiceUpdateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      billing_name: "新宛名",
      billing_address: "新住所",
      notes: "修正版備考",
      pdf_render_status: "pending",
      eligibility_snapshot: expect.objectContaining({
        corrected_line_items: [
          expect.objectContaining({
            item_name: "外壁補修工事",
            quantity: 2,
            unit_name: "式",
            unit_price: 50000,
            amount: 100000,
          }),
        ],
        last_correction: expect.objectContaining({
          mode: "document_only",
          reason_type: "recipient_error",
          note: "宛名を修正",
          corrected_by: "user-1",
          corrected_line_items: [
            expect.objectContaining({
              item_name: "外壁補修工事",
              quantity: 2,
              unit_name: "式",
              unit_price: 50000,
              amount: 100000,
            }),
          ],
        }),
      }),
    }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: "inv-1",
      billing_name: "新宛名",
    }));
  });

  it("POST /invoices/:id/correct preserves explicit empty corrected_line_items to clear invoice display items", async () => {
    const invoiceFetchChain = createChain({
      data: {
        id: "inv-1",
        org_id: "11111111-1111-4111-8111-111111111111",
        document_type: "standard_invoice",
        billing_name: "旧宛名",
        billing_address: "旧住所",
        notes: "旧備考",
        eligibility_snapshot: {
          resolved_document_type: "standard_invoice",
          corrected_line_items: [{
            item_name: "残っている明細",
            quantity: 1,
            unit_name: "式",
            unit_price: 100000,
            amount: 100000,
          }],
        },
      },
      error: null,
    });
    const invoiceUpdateChain = createChain({
      data: {
        id: "inv-1",
        billing_name: "旧宛名",
        pdf_render_status: "pending",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [invoiceFetchChain, invoiceUpdateChain]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "inv-1" },
      body: {
        billing_name: "旧宛名",
        correction_reason_type: "recipient_error",
        correction_note: "明細を外す",
        corrected_line_items: [],
      },
    } as any;
    const res = createMockRes();

    await correctInvoiceHandler(req, res);

    expect(invoiceUpdateChain.update).toHaveBeenCalledWith(expect.objectContaining({
      eligibility_snapshot: expect.objectContaining({
        corrected_line_items: [],
        last_correction: expect.objectContaining({
          corrected_line_items: [],
        }),
      }),
    }));
  });

  it("POST /invoices/:id/supplement creates a supplement invoice linked to the original", async () => {
    const baseInvoiceChain = createChain({
      data: {
        id: "inv-1",
        org_id: "11111111-1111-4111-8111-111111111111",
        transaction_id: "tx-1",
        source_transaction_id: "tx-1",
        document_type: "standard_invoice",
        due_date: "2026-04-20",
        source_transaction_date: "2026-03-18",
        billing_name: "株式会社現場",
        billing_address: "東京都港区1-2-3",
        issuer_registration_no: null,
        issuer_snapshot: {},
        registration_number_snapshot: null,
        registered_at_snapshot: null,
        tax_summary_snapshot: { by_rate: [], currency: "JPY" },
        source_summary_snapshot: {
          source_count: 1,
          site_count: 1,
          client_id: "client-1",
          client_name: "株式会社現場",
          period_start: "2026-03-18",
          period_end: "2026-03-18",
          site_names: ["渋谷現場"],
          amount_subtotal: 100000,
          tax_amount: 10000,
          amount_total: 110000,
          currency: "JPY",
        },
        eligibility_snapshot: { resolved_document_type: "standard_invoice" },
      },
      error: null,
    });
    const settingsChain = createChain({
      data: {
        org_id: "11111111-1111-4111-8111-111111111111",
        issuer_name: "GENBA QUEST",
        issuer_address: "東京都港区4-5-6",
        issuer_contact: "03-0000-0000",
        bank_account_text: "みずほ銀行",
        invoice_issuer_status: "registered",
        qualified_invoice_registration_number: "T1234567890123",
        qualified_invoice_registered_at: "2026-03-01",
        invoice_notes_default: "既定備考",
      },
      error: null,
    });
    const existingSupplementChain = createChain({ data: null, error: null });
    const sourceLinksChain = createChain({
      data: [{
        invoice_id: "inv-1",
        source_transaction_id: "tx-1",
        source_transaction_date: "2026-03-18",
        sort_order: 0,
        is_primary_document: true,
      }],
      error: null,
    });
    const sourceTransactionChain = createChain({
      data: [{
        id: "tx-1",
        kind: "invoice",
        recorded_date: "2026-03-18",
        amount_subtotal: 100000,
        tax_amount: 10000,
        amount_total: 110000,
        tax_category: "10_STANDARD",
        currency: "JPY",
        client_id: "client-1",
        site_id: "site-1",
        description: "内装工事 3月分",
        site: { id: "site-1", name: "渋谷現場" },
        client: { id: "client-1", name: "株式会社現場" },
      }],
      error: null,
    });
    const insertChain = createChain({
      data: {
        id: "inv-s1",
        invoice_no: "INV-2026-0004",
        document_type: "invoice_supplement",
      },
      error: null,
    });
    const sourceLinkInsertChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      baseInvoiceChain,
      settingsChain,
      existingSupplementChain,
      sourceLinksChain,
      sourceTransactionChain,
      insertChain,
      sourceLinkInsertChain,
    ]);
    mockRpc.mockResolvedValue({ data: "INV-2026-0004", error: null });

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "inv-1" },
      body: {
        correction_reason_type: "legal_field_missing",
        correction_note: "登録番号の追完",
        issue_date: "2026-03-21",
        supplement_line_items: [{
          item_name: "外壁補修工事",
          quantity: 2,
          unit_name: "式",
          unit_price: 50000,
        }],
      },
    } as any;
    const res = createMockRes();

    await createInvoiceSupplementHandler(req, res);

    expect(insertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      source_transaction_id: "tx-1",
      transaction_id: "tx-1",
      document_type: "invoice_supplement",
      supplements_invoice_id: "inv-1",
      notes: "登録番号の追完",
      issuer_registration_no: "T1234567890123",
      registration_number_snapshot: "T1234567890123",
      pdf_render_status: "pending",
      eligibility_snapshot: expect.objectContaining({
        supplement_line_items: [
          expect.objectContaining({
            item_name: "外壁補修工事",
            quantity: 2,
            unit_name: "式",
            unit_price: 50000,
            amount: 100000,
          }),
        ],
      }),
    }));
    expect(sourceLinkInsertChain.insert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        invoice_id: "inv-s1",
        source_transaction_id: "tx-1",
        is_primary_document: false,
      }),
    ]));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      id: "inv-s1",
      document_type: "invoice_supplement",
    }));
  });

  it("POST /payments/allocations records payment allocation through the atomic RPC without PL journal writes", async () => {
    setupMockFromSequence(mockFrom, []);
    mockRpc.mockResolvedValue({
      data: {
        payment: { id: "payment-1", amount: 110000, status: "allocated" },
        allocation: { id: "allocation-1", invoice_id: "inv-1", allocated_amount: 110000 },
        invoice: { id: "inv-1", amount_total: 110000, allocated_total: 110000, uncollected_balance: 0 },
      },
      error: null,
    });

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        idempotency_key: "payment-allocation-1",
        invoice_id: "inv-1",
        received_on: "2026-03-31",
        amount: 110000,
        payment_method: "bank_transfer",
        payment_account: "main_bank",
      },
    } as any;
    const res = createMockRes();

    await createPaymentAllocationHandler(req, res);

    expect(mockRpc).toHaveBeenCalledWith("rpc_record_accounting_payment_allocation", expect.objectContaining({
      p_org_id: "11111111-1111-4111-8111-111111111111",
      p_invoice_id: "inv-1",
      p_received_on: "2026-03-31",
      p_amount: 110000,
      p_payment_method: "bank_transfer",
      p_payment_account: "main_bank",
      p_created_by: "user-1",
    }));
    expect(mockFrom).not.toHaveBeenCalledWith("accounting_journal_entries");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      payment: expect.objectContaining({ id: "payment-1" }),
      allocation: expect.objectContaining({ id: "allocation-1" }),
    }));
  });

  it("POST /payments/allocations rejects over-collection without recording a payment", async () => {
    setupMockFromSequence(mockFrom, []);
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "PAYMENT_ALLOCATION_EXCEEDS_UNCOLLECTED_BALANCE" },
    });

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      body: {
        idempotency_key: "payment-over-allocated-1",
        invoice_id: "inv-1",
        received_on: "2026-03-31",
        amount: 120000,
      },
    } as any;
    const res = createMockRes();

    await createPaymentAllocationHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "PAYMENT_ALLOCATION_EXCEEDS_UNCOLLECTED_BALANCE" });
  });

  it("GET /invoices/:id/download streams the stored invoice PDF", async () => {
    const pdfBlob = new Blob([Buffer.from("%PDF-1.4 test")], { type: "application/pdf" });
    const download = jest.fn().mockResolvedValue({ data: pdfBlob, error: null });
    mockStorageFrom.mockReturnValue({ download });
    mockEnsureInvoicePdfStored.mockResolvedValue({
      invoiceId: "inv-1",
      invoiceNo: "INV-2026-0001",
      storagePath: "generated/invoices/org/inv-1/INV-2026-0001.pdf",
      filename: "INV-2026-0001.pdf",
    });

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "inv-1" },
    } as any;
    const res = createMockRes();

    await downloadInvoiceHandler(req, res);

    expect(mockEnsureInvoicePdfStored).toHaveBeenCalledWith({
      invoiceId: "inv-1",
      orgId: "11111111-1111-4111-8111-111111111111",
    });
    expect(mockStorageFrom).toHaveBeenCalledWith("genba-documents");
    expect(download).toHaveBeenCalledWith("generated/invoices/org/inv-1/INV-2026-0001.pdf");
    expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "application/pdf");
    expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store, no-cache, must-revalidate");
    expect(res.setHeader).toHaveBeenCalledWith("Pragma", "no-cache");
    expect(res.setHeader).toHaveBeenCalledWith("Expires", "0");
    expect(res.setHeader).toHaveBeenCalledWith(
      "Content-Disposition",
      expect.stringContaining("INV-2026-0001.pdf")
    );
    expect(res.send).toHaveBeenCalledWith(expect.any(Buffer));
  });

  it("GET /invoices/:id/download returns 404 when the invoice does not exist", async () => {
    mockEnsureInvoicePdfStored.mockResolvedValue(null);

    const req = {
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "missing-invoice" },
    } as any;
    const res = createMockRes();

    await downloadInvoiceHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Invoice not found" });
    expect(mockStorageFrom).not.toHaveBeenCalled();
  });

  it("GET /pl nets original sale and reversal from the same signed source", async () => {
    const plChain = createChain({
      data: [
        {
          id: "tx-sale-1",
          kind: "sale",
          status: "voided",
          amount_total: 110000,
          recorded_date: "2026-05-07",
          voids_transaction_id: null,
        },
        {
          id: "tx-sale-reversal-1",
          kind: "sale",
          status: "posted",
          amount_total: -110000,
          recorded_date: "2026-05-07",
          voids_transaction_id: "tx-sale-1",
        },
      ],
      error: null,
    });
    setupMockFromSequence(mockFrom, [plChain]);

    const req = {
      orgId: "org-1",
      query: { month: "2026-05" },
    } as any;
    const res = createMockRes();

    await getPlHandler(req, res);

    expect(plChain.eq).toHaveBeenCalledWith("org_id", "org-1");
    expect(plChain.in).toHaveBeenCalledWith("status", ["posted", "approved", "voided"]);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      sales: 0,
      expenses: 0,
      profit: 0,
      distributable: 0,
      transaction_count: 2,
    }));
  });

  it("POST /void/:id keeps the original posted and creates a reversal entry", async () => {
    const originalFetchChain = createChain({
      data: {
        id: "tx-void-1",
        kind: "expense",
        status: "posted",
        cost_center: "SITE",
        site_id: "site-1",
        client_id: null,
        vendor_name: "RECEIPT SAMPLE",
        description: "開発テスト",
        amount_subtotal: 3100,
        tax_amount: 310,
        amount_total: 3410,
        category: "material",
        tax_category: "10_STANDARD",
        voids_transaction_id: null,
      },
      error: null,
    });
    const invoiceSourceLinksChain = createChain({ data: [], error: null });
    const linkedInvoicesChain = createChain({ data: [], error: null });
    const existingReversalChain = createChain({ data: null, error: null });
    const reversalInsertChain = createChain({
      data: {
        id: "tx-reversal-1",
        kind: "expense",
        recorded_date: "2026-04-15",
        amount_subtotal: -3100,
        tax_amount: -310,
        amount_total: -3410,
        category: "material",
        tax_category: "10_STANDARD",
        description: "【取消】開発テスト - 入力ミス",
      },
      error: null,
    });
    const existingEntryChain = createChain({ data: null, error: null });
    const entryInsertChain = createChain({ data: { id: "journal-1" }, error: null });
    const lineInsertChain = createChain({ data: null, error: null });
    setupMockFromSequence(mockFrom, [
      originalFetchChain,
      invoiceSourceLinksChain,
      linkedInvoicesChain,
      existingReversalChain,
      reversalInsertChain,
      existingEntryChain,
      entryInsertChain,
      lineInsertChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "tx-void-1" },
      body: { idempotency_key: "void-success-1", reason: "入力ミス" },
    } as any;
    const res = createMockRes();

    await voidTransactionHandler(req, res);

    expect(mockFrom).toHaveBeenCalledTimes(10);
    expect(originalFetchChain.eq).toHaveBeenCalledWith("org_id", "11111111-1111-4111-8111-111111111111");
    expect(existingReversalChain.eq).toHaveBeenCalledWith("org_id", "11111111-1111-4111-8111-111111111111");
    expect(reversalInsertChain.insert).toHaveBeenCalledWith(expect.objectContaining({
      status: "posted",
      voids_transaction_id: "tx-void-1",
      amount_total: -3410,
      tax_category: "10_STANDARD",
      void_reason: "入力ミス",
      created_by: "user-1",
    }));
    expect(lineInsertChain.insert).toHaveBeenCalledWith([
      expect.objectContaining({ account_code: "1100", debit: 3410, credit: 0 }),
      expect.objectContaining({ account_code: "5100", debit: 0, credit: 3100 }),
      expect.objectContaining({ account_code: "1500", debit: 0, credit: 310 }),
    ]);
    expect(res.json).toHaveBeenCalledWith({
      original_voided: "tx-void-1",
      original_reversed: "tx-void-1",
      reversal_created: "tx-reversal-1",
    });
  });

  it("POST /void/:id rejects re-voiding a transaction that already has a reversal", async () => {
    const originalFetchChain = createChain({
      data: {
        id: "tx-void-2",
        kind: "expense",
        status: "posted",
        voids_transaction_id: null,
      },
      error: null,
    });
    const invoiceSourceLinksChain = createChain({ data: [], error: null });
    const linkedInvoicesChain = createChain({ data: [], error: null });
    const existingReversalChain = createChain({ data: { id: "tx-reversal-existing" }, error: null });
    setupMockFromSequence(mockFrom, [
      originalFetchChain,
      invoiceSourceLinksChain,
      linkedInvoicesChain,
      existingReversalChain,
    ]);

    const req = {
      userId: "user-1",
      orgId: "11111111-1111-4111-8111-111111111111",
      params: { id: "tx-void-2" },
      body: { idempotency_key: "void-existing-reversal-1", reason: "再取消テスト" },
    } as any;
    const res = createMockRes();

    await voidTransactionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "この取引はすでに取消済みです" });
  });

  it("POST /void/:id rejects voiding a reversal transaction", async () => {
    const originalFetchChain = createChain({
      data: {
        id: "tx-reversal-2",
        kind: "expense",
        status: "posted",
        voids_transaction_id: "tx-original-2",
      },
      error: null,
    });
    setupMockFromSequence(mockFrom, [originalFetchChain]);

    const req = {
      userId: "user-1",
      params: { id: "tx-reversal-2" },
      body: { idempotency_key: "void-reversal-1", reason: "やり直し" },
    } as any;
    const res = createMockRes();

    await voidTransactionHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "取消で作成された逆仕訳は再度取消できません" });
  });
});
