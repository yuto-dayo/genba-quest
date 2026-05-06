# GENBA QUEST - Codex Agent Instructions

## Project Overview

建設現場の経費・請求管理をゲーミフィケーションで効率化するWebアプリケーション。
DAO的な透明性とAIによる最小限の人的介入で、職人チーム（ギルド）の現場運営・会計・報酬分配を実現する。

> 「近未来に自然に存在しているはずの仕事用OS」

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite 7 + TypeScript 5.9 + CSS Modules |
| State | Zustand 5 (client) + Supabase (server) |
| Animation | Framer Motion 12 |
| Backend | Node.js 20+ + Express 5 + TypeScript |
| Database | Supabase (PostgreSQL + RLS) |
| AI | Anthropic Claude (Sherpa), Google Gemini (OCR), googleapis (Gmail) |
| Auth | Supabase Auth (JWT) |

## File Structure

```
genba-quest/
├── frontend/
│   └── src/
│       ├── pages/          # Dashboard, Accounting, Perks, Sherpa, Sites
│       ├── components/     # Reusable UI components
│       ├── lib/api.ts      # API client (fetch wrapper)
│       └── styles/         # Global CSS
├── server/
│   └── src/
│       ├── routes/         # Express handlers (accounting, badges, monsters, party, perks, proposals, sherpa, sites, stamina, webhooks)
│       ├── services/       # Business logic
│       ├── middleware/     # authMiddleware (JWT verification)
│       ├── lib/            # supabaseAdmin client
│       └── scripts/        # Utility scripts
├── server/sql/             # Migration files (000-012, sequential)
├── docs/                   # Architecture documents (9 files)
├── design-system/          # Design specs (8 files)
└── AGENTS.md               # This file
```

## Architecture: 3 Core Principles

### 1. Proposal-Centric State Management

All state changes go through Proposals. No direct DB writes.

```
User/AI → Proposal作成 → Policy評価 → 承認/自動承認 → 実行 → Event発行
```

**Proposal Lifecycle:**
```
draft → pending → approved → executed
              ↘ rejected
```

### 2. Event-Oriented Ledger

Accounting data is append-only. Corrections use reverse journal entries.

```
Proposal(approved) → LedgerEvent → LedgerTransaction → LedgerEntry[]
```

- Immutable: recorded events never change
- Balanced: SUM(debit) = SUM(credit) always
- No direct UPDATE on accounting data

### 3. AI as Policy-Bound Actor

AI (Sherpa) is a first-class organization member, but constrained by Policy.

**AI Self-Approval Prohibition (Absolute Gate):**
```typescript
if (proposal.created_by.type === 'ai' && approver.type === 'ai') {
  throw new Error('AI_SELF_APPROVAL_PROHIBITED');
}
```

## Actor Types

| Actor | Role | Permission |
|-------|------|-----------|
| `human` | Guild member | Create, approve, reject proposals |
| `ai` | Sherpa | Create proposals, approve (policy-permitted only) |
| `system` | Automated | Scheduled jobs, triggers, auto-approval |
| `integration` | External service | Create proposals only (no approval) |

## Approval Policy (Default Rules)

| Amount | Approval |
|--------|----------|
| ≤ 5,000 JPY | Auto-approved |
| 5,001 - 30,000 JPY | 1 approver |
| > 30,000 JPY | 2 approvers |

## Key Implementation Rules

1. **Transaction Boundary** - Approval + Event + State update = 1 DB transaction
2. **Idempotency** - All proposal execution must be idempotent
3. **Ledger Balance** - Every transaction: SUM(debit) = SUM(credit)
4. **No AI Self-Approval** - AI cannot approve proposals created by AI
5. **Policy Server-Side** - Policy evaluation always happens server-side (never frontend)

## Implementation Phases

| Phase | Content | Status |
|-------|---------|--------|
| A-0 | MVP: Proposal CRUD + log recording | Current |
| A-1 | PolicyEngine + approval flow | Next |
| B | Sherpa integration + AI constraints | Planned |
| C | UI overhaul (Today/Calendar/Sites/Money) | Planned |
| D | Advanced features (multi-approval, audit dashboard) | Planned |

## Session Rules (MUST follow)

Canonical protocol: `docs/AGENT_OPS.md`

- Use the common workflow from `docs/AGENT_OPS.md` for Codex / Claude / Gemini.
- Before implementation, always reference `docs/DESIGN_PHILOSOPHY.md` (at minimum `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`).
- Session end must always update the active profile handoff automatically.
- Root `HANDOFF.md` is the index/resume map. Detailed logs go to `handoff/local.md` for local work and `handoff/deploy/production.md` for production/deploy work.
- Keep using:
  - `scripts/session/session-start.sh --agent codex|claude|gemini --profile local [--baseline]`
  - `scripts/session/session-start.sh --agent codex|claude|gemini --profile production [--baseline]`
  - `scripts/session/session-start.sh --agent codex|claude|gemini [--baseline]` (legacy backward compatible only; not preferred)
  - `scripts/session/session-update.sh --done ... --next ... --validation ...`
  - `scripts/session/session-end.sh`
- Profile-specific records:
  - `local`: Branch, uncommitted count, local DB/migration state, local server status, typecheck/lint/test results, env names only, locks, next local command.
  - `production`: deploy target, deployed branch/commit, Supabase project/ref and migration state, release/smoke check results, production config names only, rollback plan, incident/blocker status.
- Keep pre-commit guard enabled (`.githooks/pre-commit`).
- **v2: session-start/end は `## Session Events (audit log)` にのみ書き込む**。Completed や L1/L2/L3 を偽の "Session started" エントリで汚さない。Quality Gate 結果は `--quality-gate "key=result|notes"` で表に流し込む。

## Coding Conventions

### Frontend
- **Components**: Functional React components with hooks
- **Styling**: CSS Modules (`Component.module.css`)
- **State**: Zustand stores for client state
- **Animation**: Framer Motion for transitions
- **Icons**: Lucide React

### Backend
- **Routes**: Express router with `requireAuth` middleware
- **Auth**: JWT verification via Supabase Auth
- **DB**: Supabase JS client with RLS policies
- **Error handling**: try/catch with `res.status(500).json({ error: message })`
- **Logging**: `console.log('[FEATURE] action:', data)`

### Database
- **RLS**: Always enable Row Level Security
- **Migrations**: Sequential numbered files in `server/sql/` (e.g., `000_fix_profiles.sql`)
- **org_id**: Data boundary - all queries scoped by org_id

## Detailed Documentation

| Document | Content | Lines |
|----------|---------|-------|
| `docs/DESIGN_PHILOSOPHY.md` | Full architecture design | 1,007 |
| `docs/PROPOSAL_SYSTEM.md` | Proposal workflow & types | 336 |
| `docs/LEDGER_SYSTEM.md` | Double-entry accounting | 439 |
| `docs/POLICY_SYSTEM.md` | Policy/rules framework | 413 |
| `docs/SHERPA_ARCHITECTURE.md` | AI Orchestrator design | 611 |
| `docs/UI_ARCHITECTURE.md` | Frontend UI structure | 745 |
| `docs/REWARD_SYSTEM.md` | T-score reward distribution | 312 |
| `docs/EVOLUTION_ROADMAP.md` | Project timeline & phases | 308 |

## Context Efficiency

When working on this project, follow this reading order to minimize context consumption:

1. **Read this file first** (AGENTS.md) - project overview
2. **Task-specific docs only** - don't read all docs upfront
3. **Partial reads** - use offset/limit for large files

| Task | Read First | Detailed Reference |
|------|-----------|-------------------|
| Design decisions | This file (Architecture section) | `docs/DESIGN_PHILOSOPHY.md` |
| Adding Proposal types | This file (Proposal section) | `docs/PROPOSAL_SYSTEM.md` |
| UI implementation | This file (Conventions section) | `docs/UI_ARCHITECTURE.md` |
| Accounting/Ledger | This file (Ledger section) | `docs/LEDGER_SYSTEM.md` |
| AI/Sherpa features | This file (AI section) | `docs/SHERPA_ARCHITECTURE.md` |

## Skills (shared with Claude Code)

Skills are available at `.agents/skills/` (symlink → `.claude/skills/`).
Both Codex and Claude Code share the same SKILL.md files — single source of truth.

Invoke with `$skill-name` or let Codex auto-select based on task.

### Skill Listing Guardrail (Context Window)

When asked to list available skills:

1. Use a single shell command (`awk`/`grep`/`sed`) to extract only YAML frontmatter fields (`name`, `description`) from `.claude/skills/*/SKILL.md` (or symlinked `.agents/skills/*/SKILL.md`, `.agent/skills/*/SKILL.md`).
2. Do **not** open every `SKILL.md` one by one with `view_file`, `cat`, or similar tools.
3. Read full `SKILL.md` content only for the specific skill(s) selected for the current task.
4. If a `SKILL.md` is missing, report it explicitly.

### Project-Specific Skills

| Skill | Purpose | Lines |
| ----- | ------- | ----- |
| `genba-quest-dao-principles` | DAO設計原則（凝縮版） | 75 |
| `genba-quest-tech-stack` | 技術スタック定義 | 67 |
| `genba-quest-design-system` | UIデザイン仕様 | 180 |
| `ux-writing` | UI文言・マイクロコピー（4基準＋アクセシビリティ） | — |
| `genba-quest-principles` | コーディング原則 | 98 |
| `proposal-type-generator` | Proposal型スキャフォールド | 188 |
| `phase-progress-checker` | フェーズ進捗確認 | 178 |
| `dao-impl-checker` | DAO実装チェック | 130 |
| `design-executor` | 設計書→実装 | 204 |
| `accounting-sherpa` | 自然言語で経理操作 | 267 |
| `document-classifier` | OCR書類タイプ判定 | — |
| `generating-cartoon-monsters` | モンスター画像生成 | — |
| `cleaning-dirty-worktrees` | dirty worktree の安全な退避・クリーン化 | — |

### Context Map (task → skill)

| Task | Skill to Use | Detailed Reference |
| ---- | ----------- | ----------------- |
| 設計判断・レビュー | `$genba-quest-dao-principles` | `docs/DESIGN_PHILOSOPHY.md` |
| 技術選定 | `$genba-quest-tech-stack` | `server/package.json` |
| UI実装 | `$genba-quest-design-system` | `docs/UI_ARCHITECTURE.md` |
| UI文言・マイクロコピー | `$ux-writing` | `.claude/skills/ux-writing/references/` |
| コーディング規約 | `$genba-quest-principles` | — |
| Proposal型追加 | `$proposal-type-generator` | `docs/PROPOSAL_SYSTEM.md` |
| 進捗確認 | `$phase-progress-checker` | `docs/EVOLUTION_ROADMAP.md` |
| DAO実装チェック | `$dao-impl-checker` | — |
| 設計書の実装 | `$design-executor` | `design-system/*.md` |
| 会計操作 | `$accounting-sherpa` | `docs/LEDGER_SYSTEM.md` |
| セキュリティ監査 | `$ln-621-security-auditor` | — |
| コード品質監査 | `$ln-620-codebase-auditor` | — |
| セッション引き継ぎ | `$handing-off-session` | — |
| 作業完了ごとの引き継ぎ更新 | `$incremental-handoff` | `handoff/local.md` / `handoff/deploy/production.md` |
| dirty worktree 整理 | `$cleaning-dirty-worktrees` | `git status --short` |

### Audit Worker Skills (ln-*)

Orchestrator `$ln-620-codebase-auditor` coordinates 9 parallel workers:

| Skill | Focus |
| ----- | ----- |
| `ln-621-security-auditor` | セキュリティ脆弱性 |
| `ln-622-build-auditor` | ビルドエラー・警告 |
| `ln-623-code-principles-auditor` | DRY/KISS/YAGNI |
| `ln-624-code-quality-auditor` | 複雑度・マジックナンバー |
| `ln-625-dependencies-auditor` | 依存関係分析 |
| `ln-626-dead-code-auditor` | デッドコード検出 |
| `ln-627-observability-auditor` | ログ・メトリクス |
| `ln-628-concurrency-auditor` | 並行処理・レースコンディション |
| `ln-629-lifecycle-auditor` | ライフサイクル管理 |
| `ln-640-pattern-evolution-auditor` | アーキテクチャパターン |
| `ln-642-layer-boundary-auditor` | レイヤー境界検証 |

### Utility Skills

| Skill | Purpose |
| ----- | ------- |
| `handing-off-session` | セッション終了時にprofile handoffを生成 |
| `incremental-handoff` | 作業完了ごとにprofile handoffを更新 |
| `invoice-organizer` | 請求書整理・リネーム |
| `skill-builder` | 新スキル作成 |
| `searching-skills-marketplace` | スキルマーケットプレイス検索 |
| `using-finance-team` | 財務分析エージェント |

## Cross-Agent Compatibility

This project supports multiple AI coding agents:
- **Claude Code**: `.claude/` (skills + settings) + `CLAUDE.md`
- **Codex**: `AGENTS.md` (this file) + `.agents/skills/` (symlink to `.claude/skills/`)
- **Cursor**: `.cursor/rules/`
- **Gemini CLI**: `GEMINI.md` + `.gemini/commands/`
- **Antigravity (Gemini)**: `.agent/skills/` (symlink to `.claude/skills/`)

Skills are shared via symlink:
- `.agents/skills/ → .claude/skills/` (Codex/Claude)
- `.agent/skills/ → .claude/skills/` (Antigravity)
When modifying skills, changes propagate across all connected agents automatically.
