# Production Deployment

GENBA QUEST is deployed as one Node web service: the Express server serves the API and the built Vite frontend from `frontend/dist`.

## Cost-Aware Default

The default `render.yaml` uses Render `plan: free` to avoid monthly hosting cost while the beta is being tested on a phone.

Tradeoffs:

- Free web services can spin down after idle time and need a cold start on the next request.
- Render can suspend free services if included usage is exhausted.
- Upgrade `plan: free` to `plan: starter` when daily use needs always-on behavior.

Supabase remains the production database and auth provider, so do not create a Render Postgres database for this app.

## Render Blueprint

1. Open Render Dashboard.
2. Create a new Blueprint from `https://github.com/yuto-dayo/genba-quest`.
3. Select the repo root `render.yaml`.
4. Fill the prompted secret values.
5. Deploy.

Required values:

| Key | Source |
| --- | --- |
| `SUPABASE_URL` | Supabase project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `VITE_SUPABASE_URL` | Same value as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon public key |
| `ORG_BOOTSTRAP_ALLOWED_EMAILS` | Comma-separated email addresses allowed to create the first org |

Supabase prerequisite:

- The production Supabase project must already have the beta MVP proposal RPC migrations applied.
- `render.yaml` sets `PROPOSAL_RPC_FALLBACK_MODE=disabled`, so proposal write paths intentionally fail instead of falling back when the atomic RPC is missing.
- Before going live, run `npm --prefix server run verify:beta-mvp` against the same Supabase project.

Optional values to add manually after first deploy:

| Key | Purpose |
| --- | --- |
| `AI_PROVIDER` | `gemini`, `anthropic`, or `openai`; Render default is `gemini` |
| `GEMINI_API_KEY` | Sherpa/monster generation with Gemini |
| `ANTHROPIC_API_KEY` | Sherpa/document classification with Anthropic |
| `OPENAI_API_KEY` | Optional OpenAI provider |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / refresh tokens | Gmail and OAuth-based Drive integrations |
| `GOOGLE_DRIVE_ROOT_FOLDER_ID` | Drive folder used for document attachment storage |
| `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` | Service-account based Drive storage; alternatively use split email/private-key vars |

Sherpa routes boot with the app, but AI-backed actions require the matching provider key. To keep the first beta deployment cheap, leave the AI keys unset until Sherpa usage is needed.

## Build And Start

Render runs:

```bash
npm --prefix server ci --include=dev
npm --prefix frontend ci --include=dev
npm --prefix frontend run build
npm --prefix server run build
npm --prefix server start
```

The service exposes:

- `GET /health` for Render health checks
- `/api/*` for backend routes
- all other paths as the React SPA
