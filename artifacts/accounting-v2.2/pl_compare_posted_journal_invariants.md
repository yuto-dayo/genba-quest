# v2.2 PL Compare / Posted Journal Invariants Local Evidence

Generated: 2026-05-10 JST

Remote DB status: not used. This evidence was produced against local Supabase (`http://127.0.0.1:54321`) and a local Express server on `http://127.0.0.1:4021`.

## Command

```bash
node artifacts/accounting-v2.2/local_pl_compare_invariants_test.mjs
```

## Fixture

| Field | Value |
| --- | --- |
| target org_id | `ac41fa5f-f025-4332-bd59-c6e4336c134f` |
| actor_user_id | `e93f3438-ae73-4c55-b2ab-a370d096bde0` |
| membership_id | `d143d67a-ed80-4666-b99e-e8e9f1ac7f98` |
| claimant_user_id | `effd80c1-226c-4566-865f-39eac105cbc8` |
| site_id | `57cda381-d334-405f-a09a-2446a2725c75` |
| month | `2026-05` |

The script creates a fresh org fixture on every run because posted journals are intentionally immutable and should not be cleaned up.

## API Requests

The script starts the local server with:

```text
DEV_SKIP_AUTH=true
DEFAULT_ORG_ID=<target org_id>
SUPABASE_URL=http://127.0.0.1:54321
```

Then it calls the real API endpoints:

```http
GET /api/v1/accounting/pl?source=legacy&month=2026-05
GET /api/v1/accounting/pl?source=journal&month=2026-05
GET /api/v1/accounting/pl?source=compare&month=2026-05
```

## Scenario Summary

| Step | Action | Posting mode | PL impact |
| --- | --- | --- | --- |
| 1 | Canonical sale A | `canonical_sales_posting` | revenue yes |
| 2 | Member overhead expense | `canonical_expense_posting` | expense yes |
| 3 | Invoice issue for sale A | `invoice_issue_no_pl_revenue` | no revenue increase |
| 4 | Payment received | `payment_received_no_pl_revenue` | no revenue increase |
| 5 | Payment allocation | `payment_allocation_no_pl_revenue` | no revenue increase |
| 6 | Canonical sale B | `canonical_sales_posting` | temporary revenue yes |
| 7 | Sale B reversal | `canonical_sales_reversal` | reverses sale B |

All transition lineage responses included `lineage_mode=transition`, `lifecycle_engine=money_transition`, and `full_proposal_lifecycle=false`.

## Row Counts

| Checkpoint | Proposals | Executions | Posting groups | Journal entries | Journal lines | Transactions | Invoices | Payments | Payment allocations |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| after sale | 1 | 1 | 1 | 1 | 3 | 1 | 0 | 0 | 0 |
| after expense | 2 | 2 | 2 | 2 | 6 | 2 | 0 | 0 | 0 |
| after invoice/payment | 5 | 5 | 5 | 5 | 12 | 2 | 1 | 1 | 1 |
| after reversal | 7 | 7 | 7 | 7 | 18 | 4 | 1 | 1 | 1 |

## Journal Balance

All posted journal entries balanced. `unbalanced_count = 0`.

| Group type | Entry date | Debit | Credit | Line count |
| --- | --- | ---: | ---: | ---: |
| `manual_adjustment` sale B | 2026-05-09 | 110000 | 110000 | 3 |
| `manual_adjustment` expense | 2026-05-09 | 33000 | 33000 | 3 |
| `manual_adjustment` sale A | 2026-05-09 | 110000 | 110000 | 3 |
| `invoice_transfer` | 2026-05-10 | 110000 | 110000 | 2 |
| `payment_allocation` | 2026-05-11 | 110000 | 110000 | 2 |
| `payment_receipt` | 2026-05-11 | 110000 | 110000 | 2 |
| `manual_adjustment` reversal | 2026-05-11 | 110000 | 110000 | 3 |

## PL Compare Results

### After Sale

| Source | Sales | Expenses | Profit | Distributable |
| --- | ---: | ---: | ---: | ---: |
| legacy gross | 110000 | 0 | 110000 | 77000 |
| journal net | 100000 | 0 | 100000 | 70000 |
| journal gross-compatible | 110000 | 0 | 110000 | 77000 |
| diff | 0 | 0 | 0 | 0 |

`mismatches = []`

### After Expense

| Source | Sales | Expenses | Profit | Distributable |
| --- | ---: | ---: | ---: | ---: |
| legacy gross | 110000 | 33000 | 77000 | 53900 |
| journal net | 100000 | 30000 | 70000 | 49000 |
| journal gross-compatible | 110000 | 33000 | 77000 | 53900 |
| diff | 0 | 0 | 0 | 0 |

`mismatches = []`

### After Invoice / Payment

| Source | Sales | Expenses | Profit | Distributable |
| --- | ---: | ---: | ---: | ---: |
| legacy gross | 110000 | 33000 | 77000 | 53900 |
| journal net | 100000 | 30000 | 70000 | 49000 |
| journal gross-compatible | 110000 | 33000 | 77000 | 53900 |
| diff | 0 | 0 | 0 | 0 |

`mismatches = []`

Invoice/payment no-PL-revenue check:

| Check | Result |
| --- | ---: |
| no-PL group line count | 6 |
| revenue/output-tax lines in invoice/payment groups | 0 |
| posting modes | `invoice_issue_no_pl_revenue`, `payment_received_no_pl_revenue`, `payment_allocation_no_pl_revenue` |

### After Reversal

| Source | Sales | Expenses | Profit | Distributable |
| --- | ---: | ---: | ---: | ---: |
| legacy gross | 110000 | 33000 | 77000 | 53900 |
| journal net | 100000 | 30000 | 70000 | 49000 |
| journal gross-compatible | 110000 | 33000 | 77000 | 53900 |
| diff | 0 | 0 | 0 | 0 |

`mismatches = []`

Reversal check:

| Field | Value |
| --- | --- |
| original sale B transaction | `b5bf81f1-e5dd-4cbf-bccb-f0932fb40ea0` |
| original amount_total | `110000` |
| original journal still posted | `true` |
| reversal transaction | `ac914082-590d-4073-a40b-3b329f570998` |
| reversal amount_total | `-110000` |
| reversal voids_transaction_id | `b5bf81f1-e5dd-4cbf-bccb-f0932fb40ea0` |
| reversal journal posted | `true` |

The original sale remains present. The reversal is an additional posted transaction/journal, and final net sales return to sale A only.

## Posted Journal Immutability

The script attempted four forbidden mutations against posted journal rows.

| Mutation | Expected error | SQLSTATE | Result |
| --- | --- | --- | --- |
| entry update | `POSTED_JOURNAL_IMMUTABLE` | `23514` | failed as expected |
| entry delete | `POSTED_JOURNAL_IMMUTABLE` | `23514` | failed as expected |
| line update | `POSTED_JOURNAL_IMMUTABLE` | `23514` | failed as expected |
| line delete | `POSTED_JOURNAL_IMMUTABLE` | `23514` | failed as expected |

## Assertions

- `compare_diff_zero_after_sale = true`
- `compare_diff_zero_after_expense = true`
- `invoice_payment_no_pl_revenue = true`
- `compare_diff_zero_after_reversal = true`
- `reversal_preserves_original_and_adds_reversal = true`
- `posted_journal_immutability_enforced = true`
- `remote_db_not_used = true`

## Notes

This evidence also surfaced and fixed two local API issues in `GET /api/v1/accounting/pl?source=journal|compare`:

- PostgREST relation embeds became ambiguous after adding composite org FKs, so the PL journal query now uses explicit relationship names.
- Journal PL should skip invoice/payment no-revenue posting groups by `posting_groups.group_type`; it should not skip a revenue journal solely because the linked legacy projection row is later represented as `kind=invoice`.
