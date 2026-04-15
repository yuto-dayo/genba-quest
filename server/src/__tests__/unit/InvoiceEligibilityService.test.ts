import {
  buildDefaultInvoiceSettings,
  buildTaxSummarySnapshot,
  evaluateInvoiceEligibility,
  resolveRequestedDocumentType,
} from "../../services/InvoiceEligibilityService";

describe("InvoiceEligibilityService", () => {
  it("marks qualified invoices as eligible when issuer is registered and transaction is after registration", () => {
    const settings = {
      ...buildDefaultInvoiceSettings("org-1"),
      issuer_name: "GENBA QUEST株式会社",
      invoice_issuer_status: "registered" as const,
      qualified_invoice_registration_number: "T1234567890123",
      qualified_invoice_registered_at: "2026-03-01",
    };
    const transaction = {
      id: "tx-1",
      kind: "sale",
      recorded_date: "2026-03-10",
      amount_subtotal: 100000,
      tax_amount: 10000,
      amount_total: 110000,
      tax_category: "10_STANDARD",
      currency: "JPY",
    };

    const taxSummary = buildTaxSummarySnapshot(transaction);
    const eligibility = evaluateInvoiceEligibility({
      settings,
      transaction,
      taxSummary,
      existingInvoices: [],
    });

    expect(eligibility).toEqual(expect.objectContaining({
      transaction_id: "tx-1",
      issuer_status: "registered",
      eligible_for_qualified_invoice: true,
      resolved_document_type: "qualified_invoice",
      reason_codes: [],
    }));
    expect(resolveRequestedDocumentType("auto", eligibility)).toBe("qualified_invoice");
  });

  it("falls back to standard invoice when issuer is applied but not registered", () => {
    const settings = {
      ...buildDefaultInvoiceSettings("org-1"),
      issuer_name: "GENBA QUEST株式会社",
      invoice_issuer_status: "applied" as const,
    };
    const transaction = {
      id: "tx-1",
      kind: "sale",
      recorded_date: "2026-03-10",
      amount_subtotal: 100000,
      tax_amount: 10000,
      amount_total: 110000,
      tax_category: "10_STANDARD",
      currency: "JPY",
    };

    const eligibility = evaluateInvoiceEligibility({
      settings,
      transaction,
      taxSummary: buildTaxSummarySnapshot(transaction),
      existingInvoices: [],
    });

    expect(eligibility.eligible_for_qualified_invoice).toBe(false);
    expect(eligibility.resolved_document_type).toBe("standard_invoice");
    expect(eligibility.reason_codes).toEqual(["ISSUER_NOT_REGISTERED"]);
    expect(resolveRequestedDocumentType("standard_invoice", eligibility)).toBe("standard_invoice");
  });

  it("adds duplicate reason codes when an invoice already exists", () => {
    const settings = {
      ...buildDefaultInvoiceSettings("org-1"),
      issuer_name: "GENBA QUEST株式会社",
      invoice_issuer_status: "registered" as const,
      qualified_invoice_registration_number: "T1234567890123",
      qualified_invoice_registered_at: "2026-03-01",
    };
    const transaction = {
      id: "tx-1",
      kind: "sale",
      recorded_date: "2026-03-10",
      amount_subtotal: 100000,
      tax_amount: 10000,
      amount_total: 110000,
      tax_category: "10_STANDARD",
      currency: "JPY",
    };

    const eligibility = evaluateInvoiceEligibility({
      settings,
      transaction,
      taxSummary: buildTaxSummarySnapshot(transaction),
      existingInvoices: [{
        id: "inv-1",
        invoice_no: "INV-2026-0001",
        document_type: "standard_invoice",
      }],
    });

    expect(eligibility.eligible_for_qualified_invoice).toBe(false);
    expect(eligibility.reason_codes).toEqual(["INVOICE_ALREADY_EXISTS"]);
  });
});
