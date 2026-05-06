# Session Workflow (Claude Code / Codex 共通)

> Canonical protocol: `docs/AGENT_OPS.md`
>
> このREADMEは実行コマンド中心の簡易版。運用ルール本体は `docs/AGENT_OPS.md` を参照。

## 目的

セッション開始・途中更新・終了時の profile handoff 更新を手動依存から外し、忘れを防ぐ。root `HANDOFF.md` は index として扱う。

## 初回セットアップ（1回のみ）

```bash
scripts/session/install-git-hooks.sh
```

これで `core.hooksPath=.githooks` が設定され、pre-commit ガードが有効化される。

## 毎セッションの運用

### 1) 開始

```bash
scripts/session/session-start.sh --agent codex --profile local
# production/deploy作業の場合
scripts/session/session-start.sh --agent codex --profile production
# 後方互換のみ（新規セッションでは非推奨）
scripts/session/session-start.sh --agent codex
# ページ/機能ごとに分割する場合（local profile内）
scripts/session/session-start.sh --agent codex --domain frontend/today
scripts/session/session-start.sh --agent claude --domain server/proposals
# 既存の対象handoffを保持したい場合のみ
scripts/session/session-start.sh --agent codex --profile local --keep-handoff
# active_session が残っている場合に強制再開したい時のみ
scripts/session/session-start.sh --agent codex --profile local --force-restart
```

実行内容:
- `.session/active_session` が残っている場合は開始を拒否（重複ログ防止）
- 必要時のみ `--force-restart` で stale として退避して再開
- `--profile local` は `handoff/local.md`、`--profile production` は `handoff/deploy/production.md` を対象にする
- `--profile` と `--domain` は同時指定できない
- root `HANDOFF.md` は index/resume map。profile運用の詳細ログは書かない
- 既定で対象handoffを再生成（旧版は `.session/handoff_archive/` に退避）
- 対象handoffに L0/L1/L2/L3 メモリ構造を初期化
- 退避ファイルは自動ローテーション（既定: 最大30件 / 14日より古いもの削除）
- 必要に応じて環境変数で調整:
  - `HANDOFF_ARCHIVE_KEEP_COUNT`（保持件数）
  - `HANDOFF_ARCHIVE_KEEP_DAYS`（保持日数）
  - `HANDOFF_ARCHIVE_DIR`（退避先ディレクトリ）
- `--keep-handoff` 指定時のみ既存の対象handoffを維持
- `--domain` 指定時は `handoff/<domain>.md` を対象にする（例: `frontend/today` -> `handoff/frontend/today.md`）
- 作業前に `docs/DESIGN_PHILOSOPHY.md` を参照（`sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`）
- 対象 handoff に `## 0. Quick Resume (AI)` がある場合は `NEXT_CMD` を優先して表示
- `.session/active_session` を生成
- 対象 handoff の Incremental Updates に開始ログを追記

Profile別に記録する項目:
- `local`: Branch、未コミット数、local DB/migration状態、local API/frontend server状態、typecheck/lint/test結果、必要なenv名、ロック中ファイル、次のlocalコマンド
- `production`: deploy対象、deploy済みbranch/commit、Supabase project/refとmigration状態、実行済みrelease手順、smoke check結果、変更したproduction設定名、rollback手順、incident/blocker状態

### 2) 作業単位ごとの更新

```bash
scripts/session/session-update.sh \
  --done "applyStateChange を実装" \
  --next "P0: Proposal 50件投入" \
  --validation "cd server && npx tsc --noEmit => PASS" \
  --file "server/src/services/ProposalService.ts - applyStateChange 実装"
```

補足:
- 追記時に `Entry-ID` が自動採番される
- L1/L2 は L3 から自動再生成される
- L3 が大きくなりすぎた場合は自動コンパクションされる（既定: 20件超）
- compaction設定: `HANDOFF_COMPACTION_THRESHOLD`, `HANDOFF_COMPACTION_KEEP_RECENT`
- profile sessionでは `handoff/local.md` または `handoff/deploy/production.md` に追記する

### 3) 終了

```bash
scripts/session/session-end.sh
```

実行内容:
- quality gate 実行（server/frontend typecheck + frontend lint）
- 結果を対象handoffに追記
- `.session/active_session` をアーカイブ

## ガード回帰チェック（任意）

handoff運用ガードの回帰確認をまとめて実行:

```bash
scripts/session/verify-handoff-guard.sh
```

検証内容:
- `session-start/session-update/session-end/append-handoff-update` の構文チェック
- `append-handoff-update` の要約同期（`NEXT_CMD` / `Completed` / `Remaining(P0)`）
- `session-end` の未完成handoff検知
- `session-end --allow-incomplete-handoff` の例外通過
- 履歴ログ内プレースホルダを `session-end` 検証対象から除外できていること

## pre-commit ガード

非handoffファイルの変更をcommitする場合、以下を強制:
- handoff markdown（通常は `handoff/local.md` または `handoff/deploy/production.md`、必要に応じて root `HANDOFF.md` index）が staged されていること
- `.session/active_session` が存在すること

一時的にバイパスする場合:

```bash
SKIP_HANDOFF_GUARD=1 SKIP_HANDOFF_REASON="hotfix" git commit -m "..."
```

理由なしバイパスは拒否される。
