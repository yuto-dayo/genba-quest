---
name: incremental-handoff
description: 作業完了ごとにHANDOFF.mdを小刻みに更新し、Claude Code/Codex/Gemini間の引き継ぎを常に最新化する。タスク完了・リファクタ完了・検証完了のたびに進捗を追記する時に使う。
---

# Incremental Handoff

作業セッションの最後だけでなく、**作業完了単位でHANDOFF.mdを更新**するためのスキル。

## 使うタイミング

- 1つの作業単位が完了した直後
- lint/typecheck/test の結果が変わった直後
- 次のエージェントに「今すぐ渡せる状態」にしたい時

**使ってはいけないタイミング**: セッションの開始/終了それ自体は「作業」ではない。
セッション開始/終了は `--session-event` モード（後述）または `scripts/session/session-{start,end}.sh` から自動記録するので、`--done "Session started ..."` のような偽の完了エントリを書かないこと。

## 目的

`HANDOFF.md` を「最終まとめ」ではなく「常時最新の運用ログ」にする。
加えて、L0/L1/L2/L3 のメモリ階層を自動同期する。

## 2つのモード

| Mode | 用途 | 影響範囲 |
| ---- | ---- | -------- |
| **Work-entry mode** (default) | 実作業の完了を記録 | L1/L2/L3 + Completed/Remaining/Quality Gate を更新 |
| **Session-event mode** (`--session-event`) | start/end など事務的イベントを監査ログに記録 | `## Session Events (audit log)` のみ更新（L1/L2/L3 を汚さない） |

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

| Flag | モード | 説明 |
| ---- | ------ | ---- |
| `--done` | work | 完了した作業（セマンティックに） |
| `--next` | work | 次のP0アクション |
| `--validation` | work | 検証結果（未指定時は `SKIP`） |
| `--file` | work | `path - semantic description` 形式（複数指定可） |
| `--locked-file` | work | `path - reason` 形式で編集中ファイルを記録（複数指定可） |
| `--from-git-status` | work | `git status --porcelain` から変更ファイルを自動収集して `--file` に追加（後方互換: `APPEND_HANDOFF_AUTO_FILES=1` でも有効） |
| `--context` | work | Working Context（パターン・前提知識） |
| `--landmine` | work | Landmines / Gotchas |
| `--note` | work | その他メモ |
| `--session-event <label>` | event | start/end などの監査イベントを `## Session Events` に1行追記。L1/L2/L3 や Completed/Remaining は触らない |
| `--quality-gate <key=result\|notes>` | both | `## 7. Quality Gate` テーブルの `key` 行を `result` + `notes` で更新（複数指定可、両モードで使える） |

補足:
- `--context` 未指定時は `--done` から `Auto-captured decision` を自動生成
- `--landmine` 未指定時は `validation` を見て自動補完（FAILがあれば追跡用Landmine、なければ `No new landmines...`）

#### Session-event mode の例

```bash
# セッション開始（session-start.sh が内部で呼ぶ）
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --session-event "started by claude"

# セッション終了 + 品質ゲート結果記録（session-end.sh が内部で呼ぶ）
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --session-event "ended by claude" \
  --quality-gate "server typecheck=PASS|run by session-end" \
  --quality-gate "frontend typecheck=FAIL|3 errors in Today.tsx" \
  --quality-gate "lint=PASS|frontend eslint src/" \
  --quality-gate "test=SKIP|test suite not standardized"
```

これは `## Session Events (audit log)` ブロックに timestamp 付き1行を追記し、Quality Gate テーブルの該当行を更新するだけ。Completed/Remaining/L1/L2/L3 は完全に無傷。

`HANDOFF_SESSION_EVENTS_KEEP_RECENT` (default: 30) で audit log の保持件数を制御。

#### Layered Memory 挙動（自動）

- 各追記エントリに `Entry-ID`（例: `H0007`）を付与
- L1 (`Session Summary`) を最新履歴から3-7行で再生成
- L2 (`Project Continuity`) を `Decisions/Landmines/Open Threads` で再生成
- L3 (`Incremental Updates`) が閾値超過で自動コンパクション

#### Compaction 設定（環境変数）

| Env | 既定値 | 説明 |
| --- | --- | --- |
| `HANDOFF_COMPACTION_THRESHOLD` | `20` | L3圧縮を開始するエントリ件数 |
| `HANDOFF_COMPACTION_KEEP_RECENT` | `12` | HANDOFFに残す最新エントリ件数（古い分はarchive退避） |

#### Concurrency Lock 設定（環境変数）

同一 handoff ファイルへの並行書き込みを直列化するため、mkdir ベースのロックを自動取得する。ロックは per-file（`handoff/server.md` と `handoff/frontend.md` は独立ロック）なので、ドメインをまたぐ並行作業はブロックされない。

| Env | 既定値 | 説明 |
| --- | --- | --- |
| `HANDOFF_LOCK_TIMEOUT` | `30` | ロック取得待ちの最大秒数。超過すると exit 2 |
| `HANDOFF_LOCK_STALE_SECONDS` | `120` | ロック保持時間がこれを超えると crash 残骸と判断し自動破棄 |
| `HANDOFF_LOCK_DISABLE` | `0` | `1` でロックを無効化（デバッグ用・通常は不要） |

ロック残骸が残った場合は `rm -rf <handoff>.lock.d` で手動削除する。

#### テストスイート

スクリプト変更時は必ず以下を実行してリグレッションを確認する。外部依存なし（plain bash）:

```bash
.claude/skills/incremental-handoff/tests/run.sh
```

カバー範囲: 基本追記、Entry-ID 連番、`--session-event` の L1/L2/L3 非汚染、ロックの並行直列化 / stale自動破棄 / タイムアウト / `HANDOFF_LOCK_DISABLE=1` バイパス。単独実行は `run.sh <test_name>`。

### 3) HANDOFF.md を最小更新

毎回、最低でも次を更新:

1. `Completed` に完了項目を1行追加
2. `Remaining` から対応済み項目を削除 or 文言更新
3. `Changed Files` に対象ファイルを追加
4. `Locked Files` / `Risks` がある場合は同時に更新
5. `Quality Gate` を再実行した場合は結果を更新

### 4) 追記フォーマットを統一

`update-template.md` の1エントリ形式を使う。

### 5) Changed Files のセマンティック記述ルール（必須）

Changed Files には以下のルールを適用する：

- **"updated" / "modified" / "changed" は禁止** — 情報量ゼロ
- **「何が・なぜ」を書く** — 例: `approve()にatomic RPC優先パスを追加`
- **新規作成は明記** — 例: `新規作成: approve+executeの原子実行SQL関数`
- **削除は理由付き** — 例: `削除: 旧Dashboardコンポーネント（Todayページに統合）`

`--file` 未指定時、スクリプトは `No file list provided` を記録する。
必要な場合のみ `--from-git-status` フラグ（または後方互換の `APPEND_HANDOFF_AUTO_FILES=1`）を指定して `git status --porcelain` から収集する。
ただし自動収集はファイルパスしか取れないため、できるだけ明示的に `--file "path - 何をなぜ"` を書くこと。

### 6) 破壊的変更を避ける

- 他人が書いた履歴を消さない
- 既存番号付きセクション（0-12）と L1/L2 の自動ブロックは維持する
- 不明な点は `Risks / Blockers` に明記する

## ルール

- 「やったこと」だけでなく「未完了の次アクション」も同時更新する
- 検証コマンドを実行していないなら `SKIP` を明記する
- 引き継ぎ相手がすぐ動ける具体度（ファイル名、テスト件数、エラー件数）で書く
- Working Context を書く（なぜそのパターンを選んだか、前提は何か）
- Landmines があれば必ず書く（意図的な異常状態、触ると壊れるもの）

## ドメイン別運用

`--domain` でセッション開始した場合、`--handoff` で対象ドメインファイルを指定する：

```bash
# サーバー作業のインクリメンタル更新
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff handoff/server.md \
  --done "approve()にatomic RPC優先パスを追加" \
  --next "P0: SQL関数をSupabaseにデプロイ"

# フロントページ単位（例: frontend/today）
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff handoff/frontend/today.md \
  --done "Todayページの承認キュー表示を調整" \
  --next "P0: Todayのモバイル崩れを修正"

# 他ドメインへのクロス更新（サーバー作業中にフロント側にも影響がある場合）
.claude/skills/incremental-handoff/scripts/append-handoff-update.sh \
  --handoff handoff/frontend.md \
  --done "ProposalStatus型をpendingに統一" \
  --next "P0: ProposalDetailModalの表示確認"
```

`--domain` 未指定時は従来通り `HANDOFF.md` が対象（後方互換）。

推奨命名:

- Frontend page: `frontend/<page>`（例: `frontend/today`, `frontend/communications`）
- Server feature: `server/<feature>`（例: `server/proposals`, `server/webhooks`）
- Integration: `integration/<provider>`（例: `integration/gmail`）

## 併用

- セッション終了時の最終整形: `handing-off-session`
- 進捗判定: `phase-progress-checker`
