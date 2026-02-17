# GENBA QUEST - Project Guidelines

## Context Efficiency Rules

セッションごとのコンテキスト消費を最小化するため、以下のルールに従う。

### Reading Order（必ず守る）

1. **まずスキルの凝縮版を参照** - 詳細ドキュメントを直接読まない
2. **必要な部分だけ読む** - ファイル全体を読まず、offset/limitで該当セクションのみ
3. **重複読み込み禁止** - 同一セッション内で同じドキュメントを2回読まない

### Context Map（タスク → 参照先）

| タスク | 最初に読むスキル | 詳細が必要な場合のみ |
|--------|-----------------|---------------------|
| 設計判断・レビュー | `genba-quest-dao-principles`(75行) | `docs/DESIGN_PHILOSOPHY.md` |
| 技術選定・依存関係 | `genba-quest-tech-stack`(67行) | `server/package.json`, `frontend/package.json` |
| UI実装 | `genba-quest-design-system`(180行) | `docs/UI_ARCHITECTURE.md` |
| コーディング規約 | `genba-quest-principles`(98行) | - |
| Proposal型追加 | `proposal-type-generator`(188行) | `docs/PROPOSAL_SYSTEM.md` |
| 進捗確認 | `phase-progress-checker`(178行) | `docs/EVOLUTION_ROADMAP.md` |
| DAO実装チェック | `dao-impl-checker`(130行) | `docs/DESIGN_PHILOSOPHY.md` 764行以降 |
| 設計書の実装 | `design-executor`(204行) | `design-system/*.md` |
| セキュリティ監査 | `ln-621-security-auditor` | - |
| コード品質監査 | `ln-620-codebase-auditor` | - |
| Sherpa/AI設計 | - | `docs/SHERPA_ARCHITECTURE.md` |
| 会計/Ledger | `accounting-sherpa`(267行) | `docs/LEDGER_SYSTEM.md` |
| セッション引き継ぎ | `handing-off-session` | - |
| 作業完了ごとの引き継ぎ更新 | `incremental-handoff` | `HANDOFF.md` |

### Do NOT Read（セッション開始時に読まないファイル）

以下は必要になるまで読まない：
- `design-system/UNIFIED_SEMI_DAO.md` (3,008行)
- `design-system/SEMI_DAO_DESIGN.md` (1,270行)
- `docs/DESIGN_PHILOSOPHY.md` 全文 (1,007行) → `genba-quest-dao-principles`で十分

## Architecture Overview（3行で理解）

1. **Proposal中心** - 全状態変更はProposal経由（`draft→pending→approved→executed`）
2. **Event志向Ledger** - 追記のみ、逆仕訳で修正、借方=貸方
3. **AIはPolicyに従属** - AI自己承認禁止、全操作ログ付き

## Tech Stack Summary

- **Frontend**: React 19 + Vite + TypeScript + CSS Modules + Zustand + Framer Motion
- **Backend**: Node.js + Express 5 + TypeScript
- **Database**: Supabase (PostgreSQL + RLS)
- **AI**: Anthropic Claude (Sherpa) + Google Gemini (OCR) + googleapis (Gmail)

## File Structure

```
frontend/src/
  pages/       → Page components (Dashboard, Accounting, Perks, Sherpa, Sites)
  components/  → Reusable components
  lib/api.ts   → API client
  styles/      → Global CSS

server/src/
  routes/      → Express route handlers
  services/    → Business logic
  middleware/  → Auth middleware
  lib/         → Supabase client

server/sql/    → Migration files (000-012)
docs/          → Architecture documents
design-system/ → Design specs
```

## Implementation Phase

現在: **Phase A-0**（MVP基盤 - Proposalログ記録）
次: Phase A-1（承認フロー）→ B（Sherpa統合）→ C（UI刷新）→ D（高度機能）

## Session Rules（必ず守る）

共通運用の正本: `docs/AGENT_OPS.md`

- Claude / Codex 共通で `docs/AGENT_OPS.md` の手順を使うこと。
- 実装前に `docs/DESIGN_PHILOSOPHY.md` を必ず参照すること（最低: `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`）。
- セッション終了時は `HANDOFF.md` を必ず自動更新する。
- 継続して使用するコマンド:
  - `scripts/session/session-start.sh --agent claude|codex`
  - `scripts/session/session-update.sh --done ... --next ... --validation ...`
  - `scripts/session/session-end.sh`
- pre-commit ガード（`.githooks/pre-commit`）は常時有効にする。

## Key Rules

1. **AI自己承認禁止** - `created_by.type === 'ai'` のProposalをAIが承認してはならない
2. **トランザクション境界** - 承認 + Event発行 + 状態更新 = 1つのDBトランザクション
3. **冪等性** - Proposal実行は必ず冪等
4. **Ledgerバランス** - 借方合計 = 貸方合計（必須）
5. **ActorRef types** - `'human' | 'ai' | 'integration' | 'system'`

## Skill Creation

When creating new skills in `.claude/skills/`:

1. **Always check the Claude Code Skill Marketplace first** before creating a new skill
   - Visit: https://claudecode.dev/skills/
   - Search for existing skills that might serve as a reference or starting point
2. If creating a new skill after marketplace review:
   - Follow the structure of existing skills in `.claude/skills/`
   - Include clear `name` and `description` in the frontmatter
   - Document when to use the skill and how it works

## Cross-Agent Compatibility

このプロジェクトは複数のAIエージェントで作業可能：
- **Claude Code**: `.claude/` (skills + settings)
- **Codex**: `AGENTS.md` (project instructions)
- **Cursor**: `.cursor/rules/`
- **Gemini**: `.gemini/handoff/`

変更時は他エージェントの設定ファイルとの整合性を意識する。
