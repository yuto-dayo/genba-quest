---
name: incremental-handoff
description: 作業完了ごとにHANDOFF.mdを小刻みに更新し、Claude Code/Codex/Gemini間の引き継ぎを常に最新化する。タスク完了・リファクタ完了・検証完了のたびに進捗を追記する時に使う。
---

# Incremental Handoff

作業完了単位でHANDOFF.mdを更新するスキル。共通ルールは [`_shared/handoff-conventions.md`](../_shared/handoff-conventions.md) を参照。

## 使うタイミング

- 1つの作業単位（機能実装/リファクタ/検証）が完了した直後
- lint/typecheck/test の結果が変わった直後

**使わない**: セッション開始/終了それ自体。それは `--session-event` モードで記録する。

## コマンドリファレンス

### Work-entry mode（既定）

```bash
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --done "approve()にatomic RPC優先パスを追加" \
  --next "P0: SQL関数をSupabaseにデプロイ" \
  --validation "cd server && npm test => 88/88 pass, 6 skip" \
  --file "server/src/services/ProposalService.ts - approve()にatomic RPC優先パスを追加" \
  --context "RPC-first+fallbackパターン" \
  --landmine "013_execute_proposal_atomic.sql は未デプロイ"
```

### Session-event mode

```bash
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --session-event "claude ended session" \
  --quality-gate "server typecheck=PASS|run by session-end" \
  --quality-gate "frontend typecheck=FAIL|3 errors in Today.tsx"
```

L0/L1/L2/L3には一切触らず、`## Session Events (audit log)` に1行追記するだけ。

### ドメイン指定

```bash
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff handoff/server.md \
  --done "..." --next "..."
```

### 全オプション

| Flag | Mode | 説明 |
| ---- | ---- | ---- |
| `--done` | work | 完了した作業（セマンティックに） |
| `--next` | work | 次のP0アクション |
| `--validation` | work | 検証結果（未指定時は `SKIP`） |
| `--file` | work | `path - semantic description`（複数可） |
| `--locked-file` | work | `path - reason`（複数可） |
| `--from-git-status` | work | git statusから変更ファイル自動収集 |
| `--context` | work | Working Context（未指定時は自動生成） |
| `--landmine` | work | Landmines（未指定時はvalidationから自動補完） |
| `--note` | work | その他メモ |
| `--handoff <path>` | both | 対象ファイル（既定: `HANDOFF.md`） |
| `--session-event <label>` | event | 監査ログに1行追記。L1/L2/L3不変 |
| `--quality-gate <k=r\|n>` | both | Quality Gateテーブル行を更新（複数可） |

## 自動処理

- Entry-ID採番（H0001, H0002, ...）
- L1/L2の自動再生成（Entry-ID参照つき）
- L3閾値超過時の自動コンパクション→archive退避
- per-fileロックによる並行書き込み直列化

## 設定（環境変数）

| Env | 既定 | 説明 |
| --- | ---- | ---- |
| `HANDOFF_COMPACTION_THRESHOLD` | `20` | L3圧縮開始件数 |
| `HANDOFF_COMPACTION_KEEP_RECENT` | `12` | L3に残す件数 |
| `HANDOFF_SESSION_EVENTS_KEEP_RECENT` | `30` | 監査ログ保持件数 |
| `HANDOFF_LOCK_TIMEOUT` | `30` | ロック待ち秒数上限 |
| `HANDOFF_LOCK_STALE_SECONDS` | `120` | stale判定保持時間 |

## 詳細・変更時

- 処理フロー・不変条件・失敗モード → [LOGIC.md](LOGIC.md)
- テスト → `tests/run.sh`（7 tests, plain bash）
- エントリ形式 → [update-template.md](update-template.md)

## 併用

- セッション終了時の最終整形: `handing-off-session`
- 進捗判定: `phase-progress-checker`
