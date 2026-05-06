# Production Login Handoff - 2026-05-06

## Completed

- Added a Supabase Auth email-link login gate before app-entry API calls.
- Added logout control to the authenticated app header.
- Verified frontend build, server build, desktop login gate snapshot, and mobile-width login gate snapshot.

## Remaining

- Configure Supabase Auth URL settings for production:
  - Site URL: `https://genba-quest.onrender.com`
  - Redirect URLs: `https://genba-quest.onrender.com/**` and local dev URL(s)
- Deploy the login-gate commit to Render via `master`.
- On smartphone, request a login link for the allowed owner email and verify app-entry/bootstrap flow.

## Validation

- `npm --prefix frontend run build`
- `npm --prefix server run build && npm --prefix frontend run build`
- Playwright CLI snapshot at `390x844` viewport showed the login form without console warnings.
