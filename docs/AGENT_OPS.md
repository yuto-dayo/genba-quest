# Agent Ops Protocol (Claude / Codex / Gemini Common)

このドキュメントは、Claude Code / Codex / Gemini の**共通セッション運用**の唯一の正本です。
`AGENTS.md` / `CLAUDE.md` / `GEMINI.md` には要約のみを置き、詳細は本書に集約します。

## 1. Purpose

- セッション再開を最短化する（迷わず次の1コマンドを実行できる）
- profile handoff 更新漏れを防ぐ（root `HANDOFF.md` は index）
- 品質ゲート結果を機械的に追跡できる状態にする

## 2. Session Lifecycle (Required)

1. One-time setup:
   - `scripts/session/install-git-hooks.sh`
2. Session start (mandatory):
   - Local work (standard): `scripts/session/session-start.sh --agent codex --profile local`
   - Production/deploy work (standard): `scripts/session/session-start.sh --agent codex --profile production`
   - Legacy agent form (backward compatible only, not preferred for new sessions): `scripts/session/session-start.sh --agent codex|claude|gemini`
   - Custom domain split (parallel local work): `scripts/session/session-start.sh --agent codex --domain frontend/today`
   - Custom feature split (parallel local backend work): `scripts/session/session-start.sh --agent claude --domain server/proposals`
   - `--profile` and `--domain` are mutually exclusive.
   - `--profile local` writes operational logs to `handoff/local.md`.
   - `--profile production` writes operational logs to `handoff/deploy/production.md`.
   - Root `HANDOFF.md` is an index/resume map only. Do not use it for detailed session logs when a profile handoff exists.
   - `--domain` 指定時は `handoff/<domain>.md` を対象にする（例: `frontend/today` -> `handoff/frontend/today.md`）
   - すでに `.session/active_session` がある場合は開始を拒否（重複ログ防止）
   - 強制再開が必要な場合のみ: `--force-restart`（既存 active_session は stale として退避）
   - 既定動作で対象 handoff はセッション開始時に再生成（旧版は `.session/handoff_archive/` に退避）
   - 退避ファイルは自動ローテーション（既定: 最大30件 / 14日より古いもの削除）
   - しきい値は環境変数で変更可: `HANDOFF_ARCHIVE_KEEP_COUNT`, `HANDOFF_ARCHIVE_KEEP_DAYS`
   - 既存の対象 handoff を保持したい場合のみ: `--keep-handoff`
   - **v2: session-start は監査イベント (`Session Events (audit log)`) のみを記録し、Completed/L1/L2/L3 を汚さない**
   - **v2: working tree が dirty な場合、`Changed Files` に dirty 行が injection され、Resume セクションに `> [carryover]` 警告が追加される**
   - オプションで `--baseline` を付けると `server` / `frontend` の typecheck をセッション開始時に実行し、結果を `Quality Gate` テーブルに記録（遅いが正確なベースライン）
3. Design reference before implementation (mandatory):
   - `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`
4. During work (per completed chunk):
   - `scripts/session/session-update.sh --done "<done>" --next "<next>" --validation "<command => result>"`
   - 可能な限り `--file "path - semantic description"` を付与する（変更ファイルの意図を明記）
   - Profile sessionでは対象ログに追記する。Localは `handoff/local.md`、production/deployは `handoff/deploy/production.md`。
5. Session end (mandatory):
   - `scripts/session/session-end.sh`
   - 対象 handoff が未完成（例: `NEXT_CMD` が `session-start.sh` のまま、`[semantic description required]` 残存）の場合は終了を拒否
   - 例外時のみ `scripts/session/session-end.sh --allow-incomplete-handoff`
   - **v2: session-end も監査イベントのみを記録**。Quality Gate 結果は `--quality-gate "key=result|notes"` でテーブル行を更新する（fake な Completed エントリを書かない）

Guardrail:

- `.githooks/pre-commit` blocks commit when non-handoff files are staged but:
  - handoff markdown (`HANDOFF.md` or `handoff/**/*.md`) is not staged, or
  - `.session/active_session` is missing.
- `append-handoff-update.sh` の自動ファイル収集はデフォルト無効（必要時のみ `--from-git-status` フラグまたは後方互換の `APPEND_HANDOFF_AUTO_FILES=1` を明示）
- `append-handoff-update.sh` は `--context/--landmine` 未指定時でも L2欠落を防ぐために自動補完する
- L3圧縮の既定値:
  - `HANDOFF_COMPACTION_THRESHOLD=20`
  - `HANDOFF_COMPACTION_KEEP_RECENT=12`
- Session Events 監査ログの保持件数: `HANDOFF_SESSION_EVENTS_KEEP_RECENT=30`（既定）

## 3. AI-Optimized Handoff (Low-Context Resume)

Profile運用では、ルート `HANDOFF.md` は index/resume map として残し、実作業ログは profile handoff に集約します。

- Local standard log: `handoff/local.md`
- Production/deploy standard log: `handoff/deploy/production.md`
- Domain-specific local logs: `handoff/<domain>.md`

対象 handoff はセッション開始時に最小テンプレートで再生成され、以下の4層メモリを維持します。

- **L0**: `Quick Resume`（即実行の `NEXT_CMD`）
- **L1**: `Session Summary (Compacted)`（3-7行の現在要約、Entry-ID参照）
- **L2**: `Project Continuity (Compacted)`（Decisions/Landmines/Open Threads）
- **L3**: `Incremental Updates`（生ログ + 閾値超過時コンパクション）

```md
## 0. Quick Resume (AI)

- NEXT_CMD: `cd server && npm test -- --runInBand`
- SUCCESS_CRITERIA: `ProposalService tests pass and no type errors`
- HOTSET:
  - `/absolute/path/server/src/services/ProposalService.ts`
  - `/absolute/path/server/src/services/PolicyEngine.ts`
- DO_NOT_READ:
  - `docs/DESIGN_PHILOSOPHY.md` (full)
- VERIFY_FIRST:
  - `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`
- STATE:
  - Branch: `feat/a1-approve-atomic`
  - Uncommitted: `5 files`
  - DB migrations: `applied up to 012 / pending: 013, 014`
  - Tests: `88/88 pass, 6 skip`
  - Lint: `0 errors, 0 warnings`

## L1. Session Summary (Compacted)
- [focus] NEXT_CMD: `cd server && npm test -- --runInBand`. Source: realtime
- [H0042] Completed: approve()にatomic RPC優先パスを追加
- [H0042] Remaining: P0: SQL関数をSupabaseにデプロイ

## L2. Project Continuity (Compacted)
### Decisions
- [H0041] RPC-first+fallbackパターンを採用
### Landmines
- [H0040] 013_execute_proposal_atomic.sql は未デプロイ
### Open Threads
- [H0042] P0: SQL関数をSupabaseにデプロイ
```

Rules:

- `NEXT_CMD` は必ず**実際の最初の1コマンド**にする（`session-start.sh` ではなく実質アクション）。
- `STATE` は必ず記載する（Branch / Uncommitted / DB migrations / Tests / Lint）。
- `HOTSET` は最大 7 ファイル。
- `DO_NOT_READ` は巨大ファイルのみ。
- `VERIFY_FIRST` は 1-2 コマンドに絞る。

Profile-specific record items:

- `local` (`handoff/local.md`): Branch, uncommitted count, local DB/migration state, local API/frontend server status, test/lint/typecheck results, `.env`/secret requirements by name only, active domain locks, next local command.
- `production` (`handoff/deploy/production.md`): deploy target, deployed branch/commit, Supabase project/ref and migration state, release steps already run, smoke check results, changed production config names only, rollback command/plan, incident or blocker status.

## 4. Handoff Minimum Requirements

セッション終了時は対象 profile handoff（通常 `handoff/local.md` または `handoff/deploy/production.md`）に最低限以下を反映すること。ルート `HANDOFF.md` には詳細ログを書かず、index/resume map と対象ファイルへの導線だけを置く。

1. Completed
2. Remaining (P0/P1 優先度つき)
3. Changed Files
4. Quality Gate
5. Risks / Blockers

Trigger:

- ユーザーが終了を示唆（done / thanks / bye など）
- またはコンテキスト逼迫時

## 5. Quality Gate (Default)

```bash
cd server && npx tsc --noEmit
cd frontend && npx tsc --noEmit
cd frontend && npx eslint src/
```

必要に応じて `cd server && npm test` を追加し、PASS/FAIL を明記します。

## 5.1 v2 Handoff Update Modes

`append-handoff-update.sh` には2つのモードがある。**事務的イベントとリアル作業を分離**する目的。

| Mode | 用途 | 影響範囲 |
| ---- | ---- | -------- |
| **work-entry mode** (default) | 実作業の完了を記録 | L1/L2/L3 + Completed/Remaining/Quality Gate を更新 |
| **session-event mode** (`--session-event "<label>"`) | start/end など監査イベント | `## Session Events (audit log)` のみ。L1/L2/L3 は無傷 |

ルール:

- `--session-event` は `session-start.sh` / `session-end.sh` が内部で呼ぶ。**手動で `--done "Session started ..."` のような偽の完了エントリを書かないこと。**
- 実作業の完了は `session-update.sh` (= `--done` work-entry mode) で記録する。
- Quality Gate の結果は `--quality-gate "key=result|notes"` で対応行を更新する（複数指定可）。両モードで使える。
- `--from-git-status` は `git status --porcelain` から変更ファイルを自動収集して `--file` に追加する（明示的な `--file "path - 何をなぜ"` が望ましいが、補助として有用）。

## 6. Update Policy

- セッション運用を変更するときは、まず本ファイルを更新する。
- `AGENTS.md` / `CLAUDE.md` には詳細を重複記述しない。
- `scripts/session/README.md` は本書への導線を維持する。

## 7. Domain Split Policy

- 既定は profile split（`local` / `production`）。並行開発が発生したら custom domain として `frontend/<page>` や `server/<feature>` に分割する。
- 分割の目安: 2セッション以上継続 / 複数担当が触る / 変更ファイルが広範囲。
- 1セッションは1つの handoff を主担当にする。クロス影響は他 handoff に1行メモだけ残す。
- 推奨例:
  - Frontend page: `frontend/today`, `frontend/communications`
  - Server feature: `server/proposals`, `server/webhooks`
  - Integration: `integration/gmail`
  - Production deploy: `deploy/production`
