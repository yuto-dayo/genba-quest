# GENBA QUEST システム概要仕様書

この文書は、`AGENTS.md` に含まれていたプロダクト/設計の要点を、
人間が参照しやすい仕様書として `docs/` に切り出したものです。

運用手順やエージェント固有ルールは仕様書の対象外とし、以下を正本として参照します。

- Agent運用: `docs/AGENT_OPS.md`
- エージェント向け入口: `AGENTS.md`

## 1. Project Overview

建設現場の経費・請求管理をゲーミフィケーションで効率化するWebアプリケーション。
DAO的な透明性とAIによる最小限の人的介入で、職人チーム（ギルド）の現場運営・会計・報酬分配を実現する。

> 「近未来に自然に存在しているはずの仕事用OS」

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 7 + TypeScript 5.9 + CSS Modules |
| State | Zustand 5 (client) + Supabase (server) |
| Animation | Framer Motion 12 |
| Backend | Node.js 20+ + Express 5 + TypeScript |
| Database | Supabase (PostgreSQL + RLS) |
| AI | Anthropic Claude (Sherpa), Google Gemini (OCR), googleapis (Gmail) |
| Auth | Supabase Auth (JWT) |

## 3. File Structure

```text
genba-quest/
├── frontend/
│   └── src/
│       ├── pages/          # Dashboard, Accounting, Perks, Sherpa, Sites
│       ├── components/     # Reusable UI components
│       ├── lib/api.ts      # API client (fetch wrapper)
│       └── styles/         # Global CSS
├── server/
│   └── src/
│       ├── routes/         # Express handlers
│       ├── services/       # Business logic
│       ├── middleware/     # authMiddleware (JWT verification)
│       ├── lib/            # supabaseAdmin client
│       └── scripts/        # Utility scripts
├── server/sql/             # Sequential migration files
├── docs/                   # Architecture and specification documents
├── design-system/          # Design specifications
└── AGENTS.md               # Agent-facing entrypoint
```

## 4. Architecture: 3 Core Principles

### 4.1 Proposal-Centric State Management

All state changes go through Proposals. No direct DB writes.

```text
User/AI → Proposal作成 → Policy評価 → 承認/自動承認 → 実行 → Event発行
```

Proposal lifecycle:

```text
draft → pending → approved → executed
              ↘ rejected
```

### 4.2 Event-Oriented Ledger

Accounting data is append-only. Corrections use reverse journal entries.

```text
Proposal(approved) → LedgerEvent → LedgerTransaction → LedgerEntry[]
```

- Immutable: recorded events never change
- Balanced: `SUM(debit) = SUM(credit)` always
- No direct `UPDATE` on accounting data

### 4.3 AI as Policy-Bound Actor

AI (Sherpa) is a first-class organization member, but constrained by Policy.

AI self-approval prohibition:

```typescript
if (proposal.created_by.type === 'ai' && approver.type === 'ai') {
  throw new Error('AI_SELF_APPROVAL_PROHIBITED');
}
```

## 5. Actor Types

| Actor | Role | Permission |
|-------|------|-----------|
| `human` | Guild member | Create, approve, reject proposals |
| `ai` | Sherpa | Create proposals, approve (policy-permitted only) |
| `system` | Automated | Scheduled jobs, triggers, auto-approval |
| `integration` | External service | Create proposals only (no approval) |

## 6. Approval Policy

| Amount | Approval |
|--------|----------|
| `<= 5,000 JPY` | Auto-approved |
| `5,001 - 30,000 JPY` | 1 approver |
| `> 30,000 JPY` | 2 approvers |

## 7. Key Implementation Rules

1. Transaction Boundary: Approval + Event + State update = 1 DB transaction
2. Idempotency: All proposal execution must be idempotent
3. Ledger Balance: Every transaction must satisfy `SUM(debit) = SUM(credit)`
4. No AI Self-Approval: AI cannot approve proposals created by AI
5. Policy Server-Side: Policy evaluation always happens server-side, never frontend

## 8. Implementation Phases

| Phase | Content | Status |
|-------|---------|--------|
| A-0 | MVP: Proposal CRUD + log recording | Current |
| A-1 | PolicyEngine + approval flow | Next |
| B | Sherpa integration + AI constraints | Planned |
| C | UI overhaul (Today/Calendar/Sites/Money) | Planned |
| D | Advanced features (multi-approval, audit dashboard) | Planned |

## 9. Coding Conventions

### Frontend

- Components: Functional React components with hooks
- Styling: CSS Modules (`Component.module.css`)
- State: Zustand stores for client state
- Animation: Framer Motion for transitions
- Icons: Lucide React

### Backend

- Routes: Express router with `requireAuth` middleware
- Auth: JWT verification via Supabase Auth
- DB: Supabase JS client with RLS policies
- Error handling: `try/catch` with `res.status(500).json({ error: message })`
- Logging: `console.log('[FEATURE] action:', data)`

### Database

- RLS: Always enable Row Level Security
- Migrations: Sequential numbered files in `server/sql/`
- `org_id`: Data boundary for all scoped queries

## 10. Detailed Documentation

| Document | Content |
|----------|---------|
| `docs/DESIGN_PHILOSOPHY.md` | Full architecture design |
| `docs/PROPOSAL_SYSTEM.md` | Proposal workflow and types |
| `docs/LEDGER_SYSTEM.md` | Double-entry accounting |
| `docs/POLICY_SYSTEM.md` | Policy and rules framework |
| `docs/SHERPA_ARCHITECTURE.md` | AI orchestrator design |
| `docs/UI_ARCHITECTURE.md` | Frontend UI structure |
| `docs/REWARD_SYSTEM.md` | T-score reward distribution |
| `docs/EVOLUTION_ROADMAP.md` | Project timeline and phases |

## 11. Reading Order

1. This document for a concise system overview
2. Task-specific docs only
3. Large documents via partial reads when needed

| Task | Read First | Detailed Reference |
|------|-----------|-------------------|
| Design decisions | This document | `docs/DESIGN_PHILOSOPHY.md` |
| Adding Proposal types | This document | `docs/PROPOSAL_SYSTEM.md` |
| UI implementation | This document | `docs/UI_ARCHITECTURE.md` |
| Accounting/Ledger | This document | `docs/LEDGER_SYSTEM.md` |
| AI/Sherpa features | This document | `docs/SHERPA_ARCHITECTURE.md` |
