import {
  buildInvoiceDisplayLineItems,
  resolveExplicitInvoiceLineItems,
} from "../../services/InvoiceLineItemsService";

describe("InvoiceLineItemsService", () => {
  it("preserves explicit empty corrected_line_items overrides", () => {
    expect(resolveExplicitInvoiceLineItems({
      documentType: "standard_invoice",
      eligibilitySnapshot: {
        corrected_line_items: [],
      },
    })).toEqual({
      items: [],
      hasExplicitOverride: true,
    });
  });

  it("falls back to frozen transaction items instead of mutable site data", () => {
    expect(buildInvoiceDisplayLineItems({
      documentType: "standard_invoice",
      eligibilitySnapshot: {},
      sourceTransactions: [{
        id: "tx-1",
        description: "内装工事 3月分",
        amount_subtotal: 100000,
        amount_total: 110000,
        site: { name: "渋谷現場" },
      }],
      itemRows: [{
        transaction_id: "tx-1",
        item_name: "軽鉄下地",
        quantity: 1,
        unit_name: "式",
        unit_price: 100000,
        amount: 100000,
      }],
    })).toEqual({
      hasExplicitOverride: false,
      items: [{
        item_name: "軽鉄下地",
        quantity: 1,
        unit_name: "式",
        unit_price: 100000,
        amount: 100000,
      }],
    });
  });
});
