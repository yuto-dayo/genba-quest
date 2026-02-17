# Agent Ops Protocol (Claude / Codex Common)

このドキュメントは、Claude Code と Codex の**共通セッション運用**の唯一の正本です。
`AGENTS.md` / `CLAUDE.md` には要約のみを置き、詳細は本書に集約します。

## 1. Purpose

- セッション再開を最短化する（迷わず次の1コマンドを実行できる）
- `HANDOFF.md` 更新漏れを防ぐ
- 品質ゲート結果を機械的に追跡できる状態にする

## 2. Session Lifecycle (Required)

1. One-time setup:
   - `scripts/session/install-git-hooks.sh`
2. Session start (mandatory):
   - Codex: `scripts/session/session-start.sh --agent codex`
   - Claude: `scripts/session/session-start.sh --agent claude`
   - すでに `.session/active_session` がある場合は開始を拒否（重複ログ防止）
   - 強制再開が必要な場合のみ: `--force-restart`（既存 active_session は stale として退避）
   - 既定動作で `HANDOFF.md` はセッション開始時に再生成（旧版は `.session/handoff_archive/` に退避）
   - 退避ファイルは自動ローテーション（既定: 最大30件 / 14日より古いもの削除）
   - しきい値は環境変数で変更可: `HANDOFF_ARCHIVE_KEEP_COUNT`, `HANDOFF_ARCHIVE_KEEP_DAYS`
   - 既存 `HANDOFF.md` を保持したい場合のみ: `--keep-handoff`
3. Design reference before implementation (mandatory):
   - `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`
4. During work (per completed chunk):
   - `scripts/session/session-update.sh --done "<done>" --next "<next>" --validation "<command => result>"`
   - 可能な限り `--file "path - semantic description"` を付与する（変更ファイルの意図を明記）
5. Session end (mandatory):
   - `scripts/session/session-end.sh`
   - `HANDOFF.md` が未完成（例: `NEXT_CMD` が `session-start.sh` のまま、`[semantic description required]` 残存）の場合は終了を拒否
   - 例外時のみ `scripts/session/session-end.sh --allow-incomplete-handoff`

Guardrail:

- `.githooks/pre-commit` blocks commit when non-handoff files are staged but:
  - `HANDOFF.md` is not staged, or
  - `.session/active_session` is missing.
- `append-handoff-update.sh` の自動ファイル収集はデフォルト無効（必要時のみ `APPEND_HANDOFF_AUTO_FILES=1` を明示）

## 3. AI-Optimized Handoff (Low-Context Resume)

`HANDOFF.md` はセッション開始時に最小テンプレートで再生成され、以下の `Quick Resume` を先頭に置きます。
長文説明より、次の行動に必要な情報を最短で提示します。

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
```

Rules:

- `NEXT_CMD` は必ず**実際の最初の1コマンド**にする（`session-start.sh` ではなく実質アクション）。
- `STATE` は必ず記載する（Branch / Uncommitted / DB migrations / Tests / Lint）。
- `HOTSET` は最大 7 ファイル。
- `DO_NOT_READ` は巨大ファイルのみ。
- `VERIFY_FIRST` は 1-2 コマンドに絞る。

## 4. Handoff Minimum Requirements

セッション終了時は `HANDOFF.md` に最低限以下を反映すること。

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

## 6. Update Policy

- セッション運用を変更するときは、まず本ファイルを更新する。
- `AGENTS.md` / `CLAUDE.md` には詳細を重複記述しない。
- `scripts/session/README.md` は本書への導線を維持する。
