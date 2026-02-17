---
name: incremental-handoff
description: 作業完了ごとにHANDOFF.mdを小刻みに更新し、Claude Code/Codex間の引き継ぎを常に最新化する。タスク完了・リファクタ完了・検証完了のたびに進捗を追記する時に使う。
---

# Incremental Handoff

作業セッションの最後だけでなく、**作業完了単位でHANDOFF.mdを更新**するためのスキル。

## 使うタイミング

- 1つの作業単位が完了した直後
- lint/typecheck/test の結果が変わった直後
- 次のエージェントに「今すぐ渡せる状態」にしたい時

## 目的

`HANDOFF.md` を「最終まとめ」ではなく「常時最新の運用ログ」にする。

## 手順

### 1) 完了単位を定義

完了単位は以下のいずれか:

- 1機能の実装完了
- 1セットのリファクタ完了
- 1回の検証結果確定（typecheck/lint/test）

### 2) 自動追記スクリプトを実行（推奨）

`scripts/append-handoff-update.sh` を使う。

```bash
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --done "approve()にatomic RPC優先パスを追加" \
  --next "P0: SQL関数をSupabaseにデプロイ" \
  --validation "cd server && npm test => 88/88 pass, 6 skip" \
  --file "server/src/services/ProposalService.ts - approve()にatomic RPC優先パスを追加" \
  --context "RPC-first+fallbackパターン: DB関数があれば原子実行、なければ従来パス" \
  --landmine "013_execute_proposal_atomic.sql は未デプロイ。コード上はfallbackで動作中"
```

#### オプション一覧

| Flag | 必須 | 説明 |
| ---- | ---- | ---- |
| `--done` | Yes | 完了した作業（セマンティックに） |
| `--next` | Yes | 次のP0アクション |
| `--validation` | No | 検証結果（未指定時は `SKIP`） |
| `--file` | No | `path - semantic description` 形式（未指定時は自動収集しない。必要なら `APPEND_HANDOFF_AUTO_FILES=1` で有効化） |
| `--context` | No | Working Context（パターン・前提知識） |
| `--landmine` | No | Landmines / Gotchas |
| `--note` | No | その他メモ |

### 3) HANDOFF.md を最小更新

毎回、最低でも次を更新:

1. `Completed` に完了項目を1行追加
2. `Remaining` から対応済み項目を削除 or 文言更新
3. `Changed Files` に対象ファイルを追加
4. `Quality Gate` を再実行した場合は結果を更新

### 4) 追記フォーマットを統一

`update-template.md` の1エントリ形式を使う。

### 5) Changed Files のセマンティック記述ルール（必須）

Changed Files には以下のルールを適用する：

- **"updated" / "modified" / "changed" は禁止** — 情報量ゼロ
- **「何が・なぜ」を書く** — 例: `approve()にatomic RPC優先パスを追加`
- **新規作成は明記** — 例: `新規作成: approve+executeの原子実行SQL関数`
- **削除は理由付き** — 例: `削除: 旧Dashboardコンポーネント（Todayページに統合）`

`--file` 未指定時、スクリプトは `No file list provided` を記録する。
必要な場合のみ `APPEND_HANDOFF_AUTO_FILES=1` を指定して `git diff --name-only` から収集する。

### 6) 破壊的変更を避ける

- 他人が書いた履歴を消さない
- 既存セクション構造（0-13）は維持する
- 不明な点は `Risks / Blockers` に明記する

## ルール

- 「やったこと」だけでなく「未完了の次アクション」も同時更新する
- 検証コマンドを実行していないなら `SKIP` を明記する
- 引き継ぎ相手がすぐ動ける具体度（ファイル名、テスト件数、エラー件数）で書く
- Working Context を書く（なぜそのパターンを選んだか、前提は何か）
- Landmines があれば必ず書く（意図的な異常状態、触ると壊れるもの）

## 併用

- セッション終了時の最終整形: `handing-off-session`
- 進捗判定: `phase-progress-checker`
