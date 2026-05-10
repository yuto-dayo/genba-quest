# Accounting v2.2 Document Boundary Test

Date: 2026-05-09

## Scope

- Target org_id: local multi-org fixture
- Remote DB migration: not executed
- Remote DB push: not executed
- Migration repair: not executed
- Local Supabase Storage service: disabled in this repo's local config

## Scenario

This verifies the v2.2 P0 evidence boundary contract for document/PDF/OCR/signed URL surfaces.

Covered by this slice:

- Site document upload now stores new files under an org-prefixed path:
  - `<org_id>/sites/<site_id>/documents/<user_id>/<timestamp>.<ext>`
- Site document listing now filters `documents.org_id = active org`.
- Site document signed URL generation is skipped for storage paths that do not begin with `<active_org_id>/`.
- Accounting OCR refuses to download a document whose `storage_path` does not begin with `<active_org_id>/`.
- Invoice PDF generation now creates new paths under:
  - `<org_id>/generated/invoices/<invoice_id>/<invoice_no>.pdf`
- Active org A cannot list site documents/drawings for org B site IDs, so signed URL issuance is not reached for foreign site documents/drawings.

## Commands

```bash
node artifacts/accounting-v2.2/local_document_boundary_negative_test.mjs
cd server && npm test -- --runTestsByPath src/__tests__/unit/sitesRoute.test.ts src/__tests__/unit/accountingRoute.test.ts --runInBand
```

## Local API Result Snapshot

```json
{
  "fixture": {
    "active_org_id": "ca17414d-192c-4f36-9cf5-d84e4d11fc16",
    "foreign_org_id": "70fdd6de-03c4-4ea8-9c91-09127e42c296",
    "actor_user_id": "e93f3438-ae73-4c55-b2ab-a370d096bde0",
    "active_membership_id": "26016045-ddc0-4ab6-8882-331c30915ccf",
    "foreign_membership_id": "f8f2bd33-d631-49c0-8ec7-2ec2e26ba8ea",
    "foreign_site_id": "f8a311cc-c36d-4340-b027-5e1b802d855a",
    "foreign_document_id": "a3152dd0-1c59-4e19-bfe6-e369d59dbbb9",
    "foreign_drawing_id": "dd2aabac-e5ac-4dbc-ae0b-91b9f57e5893",
    "foreign_drawing_version_id": "b64dca85-221a-4ad7-8cae-e94601592510"
  },
  "negative_results": [
    {
      "name": "site_documents_foreign_site",
      "expected_status": 404,
      "status": 404,
      "error": "Site not found"
    },
    {
      "name": "site_drawings_foreign_site",
      "expected_status": 404,
      "status": 404,
      "error": "Site not found"
    }
  ],
  "row_counts": {
    "org_a_documents": 0,
    "org_a_drawing_versions": 0,
    "org_b_documents": 1,
    "org_b_drawing_versions": 1,
    "org_b_document_paths_prefixed": 1,
    "org_b_drawing_paths_prefixed": 1
  },
  "assertions": {
    "active_org_foreign_site_document_routes_hidden_as_404": true,
    "active_org_foreign_site_drawing_routes_hidden_as_404": true,
    "foreign_document_and_drawing_paths_are_org_prefixed": true,
    "no_active_org_document_rows_from_foreign_ids": true
  }
}
```

## Unit Contract Results

Targeted unit tests cover behavior that cannot rely on local Storage because local Supabase Storage is disabled:

- `GET /:id/documents scopes documents and signed URLs to the active org`
  - asserts `documents.org_id = active org`
  - signs only org-prefixed paths
  - returns `signed_url=null` for legacy/unprefixed paths
- `POST /:id/documents stores files under an org-prefixed site document path`
  - asserts upload path begins with active org id
  - asserts inserted `documents.storage_path` matches the same org-prefixed path
- `POST /ocr/analyze rejects document storage paths outside the active org`
  - asserts Storage download is not called
  - returns `403`
- `GET /invoices/:id/download streams the stored invoice PDF`
  - updated expected path shape to the org-prefixed invoice PDF path

## Notes

- Previous org-boundary evidence already covered active-org foreign `document_id` OCR and foreign `invoice_id` PDF download returning `404`.
- This is local-only evidence. Remote DB migration, push, repair, and production writes were not executed.
- Existing legacy document paths may remain unprefixed until backfill; this slice prevents new site document paths from being created without an org prefix and avoids signing legacy/unprefixed paths.
