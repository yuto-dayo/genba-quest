# Session Workflow (Claude Code / Codex 共通)

> Canonical protocol: `docs/AGENT_OPS.md`
>
> このREADMEは実行コマンド中心の簡易版。運用ルール本体は `docs/AGENT_OPS.md` を参照。

## 目的

セッション開始・途中更新・終了時の `HANDOFF.md` 更新を手動依存から外し、忘れを防ぐ。

## 初回セットアップ（1回のみ）

```bash
scripts/session/install-git-hooks.sh
```

これで `core.hooksPath=.githooks` が設定され、pre-commit ガードが有効化される。

## 毎セッションの運用

### 1) 開始

```bash
scripts/session/session-start.sh --agent codex
# または
scripts/session/session-start.sh --agent claude
# 既存 HANDOFF.md を保持したい場合のみ
scripts/session/session-start.sh --agent codex --keep-handoff
# active_session が残っている場合に強制再開したい時のみ
scripts/session/session-start.sh --agent codex --force-restart
```

実行内容:
- `.session/active_session` が残っている場合は開始を拒否（重複ログ防止）
- 必要時のみ `--force-restart` で stale として退避して再開
- 既定で `HANDOFF.md` を再生成（旧版は `.session/handoff_archive/` に退避）
- 退避ファイルは自動ローテーション（既定: 最大30件 / 14日より古いもの削除）
- 必要に応じて環境変数で調整:
  - `HANDOFF_ARCHIVE_KEEP_COUNT`（保持件数）
  - `HANDOFF_ARCHIVE_KEEP_DAYS`（保持日数）
  - `HANDOFF_ARCHIVE_DIR`（退避先ディレクトリ）
- `--keep-handoff` 指定時のみ既存 `HANDOFF.md` を維持
- 作業前に `docs/DESIGN_PHILOSOPHY.md` を参照（`sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`）
- `HANDOFF.md` に `## 0. Quick Resume (AI)` がある場合は `NEXT_CMD` を優先して表示
- `.session/active_session` を生成
- `HANDOFF.md` の Incremental Updates に開始ログを追記

### 2) 作業単位ごとの更新

```bash
scripts/session/session-update.sh \
  --done "applyStateChange を実装" \
  --next "P0: Proposal 50件投入" \
  --validation "cd server && npx tsc --noEmit => PASS" \
  --file "server/src/services/ProposalService.ts - applyStateChange 実装"
```

### 3) 終了

```bash
scripts/session/session-end.sh
```

実行内容:
- quality gate 実行（server/frontend typecheck + frontend lint）
- 結果を `HANDOFF.md` に追記
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
- `HANDOFF.md` が staged されていること
- `.session/active_session` が存在すること

一時的にバイパスする場合:

```bash
SKIP_HANDOFF_GUARD=1 SKIP_HANDOFF_REASON="hotfix" git commit -m "..."
```

理由なしバイパスは拒否される。
