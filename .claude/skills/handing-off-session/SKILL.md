---
name: handing-off-session
description: Use this skill when context is running low, approaching token limits, ending a work session, or need to hand off work to another agent (Claude Code / Codex) or team member. Creates a HANDOFF.md file with quality gate results, locked files, and instructions for seamless cross-agent continuation.
---

# Session Handoff (Cross-Agent)

エージェント間（Claude Code / Codex）またはセッション間で作業を引き継ぐためのスキル。

## When to Use

- コンテキストウィンドウが圧迫されてきた時
- 作業セッションを終了する前
- **別のエージェントに作業を引き継ぐ時**（Claude Code ↔ Codex）
- 複雑なタスクの途中で中断する時

## Instructions

### Step 1: 品質ゲート実行（必須）

handoff前に以下を実行し、結果を記録する：

```bash
cd server && npx tsc --noEmit        # server typecheck
cd frontend && npx tsc --noEmit      # frontend typecheck
cd frontend && npx eslint src/       # lint
cd server && npm test                # test (件数も記録)
```

### Step 2: State of the World 収集（必須）

品質ゲートに加え、以下の情報を収集する：

```bash
git branch --show-current            # 現在のブランチ
git status --short | wc -l           # 未コミットファイル数
ls server/sql/*.sql | tail -1        # 最新のSQL migration
```

### Step 3: 現状把握

1. **Ticket/Goal** - 何のチケットの作業か
2. **完了タスク** - 具体的なファイル名・関数名で
3. **未完了タスク** - P0/P1で優先順位付け + 依存関係を `(blocked by: X)` で明記
4. **変更ファイル一覧** - `git diff --name-only` で取得 + **セマンティックな説明**
5. **編集中（ロック）ファイル** - 作業途中で他エージェントが触るべきでないファイル
6. **Working Context** - 次のエージェントが前提として知るべきパターン・判断
7. **Landmines** - 壊れて見えるが意図的、または触ると壊れるもの

### Step 4: HANDOFF.md 生成

テンプレート `./handoff-template.md` を使い、プロジェクトルートに `HANDOFF.md` を作成。

**AI向け Quick Resume + Layered Memory 構成（必須）：**

L0. **Quick Resume (AI)** - 実行可能な `NEXT_CMD` と成功条件
L1. **Session Summary (Compacted)** - 3-7行のセッション要約（`Entry-ID` 参照つき）
L2. **Project Continuity (Compacted)** - Decisions / Landmines / Open Threads（`Entry-ID` 参照つき）
L3. **Incremental Updates** - 生ログ（`Entry-ID` つき）。閾値超過時は自動コンパクション

番号付きセクション（1-12）も維持:

1. **Resume** - 次のエージェント名、ブランチ名、Phase、最初の1手
2. **Goal** - チケットID・目的
3. **Completed** - 完了タスク
4. **Remaining** - P0/P1で優先順位 + `(blocked by: ...)` で依存関係
5. **Changed Files** - 変更ファイルと**セマンティックな説明**（"updated" 禁止）
6. **Locked Files** - 編集中ファイル（他エージェント触らない）
7. **Quality Gate** - typecheck/lint/test結果テーブル（件数付き）
8. **Working Context** - 次のエージェントが前提として知るべきパターン・判断
9. **Key Decisions** - 重要な決定事項とその理由
10. **Landmines / Gotchas** - 壊れて見えるが意図的、触ると壊れるもの
11. **Risks / Blockers** - リスクやブロッカー
12. **References** - 参照すべきファイル

Quick Resume ルール:

- `NEXT_CMD` は「次セッションの**実際の**最初の1コマンド」を記載（`session-start.sh` ではなく実質的なアクション）
- `STATE` は必ず記載（Branch / Uncommitted / DB migrations / Tests / Lint）
- `HOTSET` は最大7ファイル
- `VERIFY_FIRST` は 1-2 コマンドに絞る

Progressive Loading ルール（コンテキスト節約）:

- 次のエージェントは **L0（Quick Resume）だけを最初に読む**（`offset: 1, limit: 15`）
- L1/L2 はタスクの文脈が不明な場合のみ追加で読む
- L3（Incremental Updates）は原則読まない（L1/L2にコンパクション済み）
- HANDOFF.md 全文を一括で読むのは**禁止**

Layered Memory ルール:

- `Incremental Updates` の各エントリに `Entry-ID` を必ず付与する
- L1/L2 は `append-handoff-update.sh` が更新する（手動編集より自動更新を優先）
- L3 は `HANDOFF_COMPACTION_THRESHOLD`（既定20）超で圧縮し、古いログを `.session/handoff_archive/` に退避

### Step 5: Changed Files のセマンティック記述ルール

Changed Files には以下のルールを適用する：

- **"updated" / "modified" / "changed" は禁止** — 情報量ゼロ
- **「何が・なぜ」を書く** — 例: `approve()にatomic RPC優先パスを追加`
- **新規作成は明記** — 例: `新規作成: approve+executeの原子実行SQL関数`
- **削除は理由付き** — 例: `削除: 旧Dashboardコンポーネント（Todayページに統合）`

### Step 6: ドメイン別Handoff運用

ドメイン別にhandoffを分割して運用できる：

```bash
# サーバー作業セッション
scripts/session/session-start.sh --agent claude --domain server
# → handoff/server.md が生成・更新される

# フロント作業セッション
scripts/session/session-start.sh --agent codex --domain frontend
# → handoff/frontend.md が生成・更新される

# フルスタック作業（従来通り）
scripts/session/session-start.sh --agent claude
# → HANDOFF.md が単体で使われる
```

`--domain` 指定時、ルート `HANDOFF.md` はドメイン一覧のindex（~15行）になる。

### Step 7: ブランチ運用

エージェント別ブランチを推奨：

- `feat/<ticket>-claude` — Claude Code 担当
- `feat/<ticket>-codex` — Codex 担当
- 同じブランチで同時編集はしない

## Cross-Agent Rules

1. **同時に同じファイルを触らない** — Locked Filesで明示
2. **受け渡しごとに品質ゲート必須** — PASS/FAILを記録
3. **片方は実装、もう片方はレビュー寄り** — 衝突を最小化
4. **最終統合は人間が判断してマージ**

## Best Practices

### DO

- 具体的なファイル名・関数名を記載
- 品質ゲート結果を正直に記録（FAILでもそのまま書く）
- テスト件数を記録（`88/88 pass, 6 skip` 形式）
- ロックファイルの理由を明記
- Working Contextに今の作業で使っているパターンを書く
- Landminesに「意図的な異常状態」を書く

### DON'T

- 品質ゲートをスキップ
- 曖昧な表現（「いろいろやった」「updated」など）
- ロックファイルなしで途中のファイルを放置
- NEXT_CMDに `session-start.sh` を書く（実質の次アクションを書く）
