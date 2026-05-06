---
name: handing-off-session
description: Use this skill when context is running low, approaching token limits, ending a work session, or need to hand off work to another agent (Claude Code / Codex) or team member. Updates the active profile handoff with quality gate results, locked files, and instructions for seamless cross-agent continuation; root HANDOFF.md stays an index.
---

# Session Handoff (Cross-Agent)

セッション終了時に対象profile handoffを生成/更新するスキル。
共通ルール（L0-L3モデル、セマンティック記述、ドメイン運用、品質ゲート、Cross-Agent Rules）は [`_shared/handoff-conventions.md`](../_shared/handoff-conventions.md) を参照。

標準の対象:

- Local work: `handoff/local.md`
- Production/deploy work: `handoff/deploy/production.md`
- Root `HANDOFF.md`: index/resume map only. 詳細ログはprofile handoffに書く。

## When to Use

- コンテキストウィンドウが圧迫されてきた時
- 作業セッションを終了する前
- 別のエージェントに作業を引き継ぐ時（Claude Code <-> Codex）
- 複雑なタスクの途中で中断する時

## Instructions

### Step 1: 品質ゲート実行（必須）

`_shared/handoff-conventions.md` の品質ゲートコマンドを実行し、結果を記録する。

### Step 2: State of the World 収集（必須）

```bash
git branch --show-current            # 現在のブランチ
git status --short | wc -l           # 未コミットファイル数
ls server/sql/*.sql | tail -1        # 最新のSQL migration
```

### Step 3: 現状把握

1. **Ticket/Goal** - 何のチケットの作業か
2. **完了タスク** - 具体的なファイル名・関数名で
3. **未完了タスク** - P0/P1で優先順位付け + 依存関係を `(blocked by: X)` で明記
4. **変更ファイル一覧** - `git diff --name-only` + セマンティックな説明
5. **編集中（ロック）ファイル** - 他エージェントが触るべきでないファイル
6. **Working Context** - 次のエージェントが知るべきパターン・判断
7. **Landmines** - 壊れて見えるが意図的、または触ると壊れるもの

### Step 4: Profile handoff 生成

テンプレート `./handoff-template.md` を使い、作業種別に応じた対象ファイルを作成/更新する。

- Local: `handoff/local.md`
- Production/deploy: `handoff/deploy/production.md`
- Root `HANDOFF.md`: 対象handoffへの導線だけを持つ index/resume map として維持する

**構成**: L0-L3 Layered Memory + 番号付きセクション（1-12）。詳細は `_shared/handoff-conventions.md` 参照。

Quick Resume ルール:

- `NEXT_CMD` は実質的な次アクション（`session-start.sh` ではない）
- `STATE` は必ず記載（Branch / Uncommitted / DB migrations / Tests / Lint）
- `HOTSET` は最大7ファイル
- `VERIFY_FIRST` は 1-2 コマンド

Profile-specific record items:

- `local`: Branch、未コミット数、local DB/migration状態、local API/frontend server状態、typecheck/lint/test結果、必要なenv名、ロック中ファイル、次のlocalコマンド
- `production`: deploy対象、deploy済みbranch/commit、Supabase project/refとmigration状態、実行済みrelease手順、smoke check結果、変更したproduction設定名、rollback手順、incident/blocker状態

### Step 5: ドメイン別 / ブランチ運用

ドメイン別運用は `_shared/handoff-conventions.md` を参照。

エージェント別ブランチを推奨:

- `feat/<ticket>-claude` / `feat/<ticket>-codex`
- 同じブランチで同時編集はしない

## Best Practices

### DO

- 具体的なファイル名・関数名を記載
- 品質ゲート結果を正直に記録（FAILでもそのまま書く）
- テスト件数を記録（`88/88 pass, 6 skip` 形式）
- ロックファイルの理由を明記
- Working Contextに今の作業で使っているパターンを書く
- Landminesに「意図的な異常状態」を書く
- profileに応じた対象handoffを使う（localは `handoff/local.md`、productionは `handoff/deploy/production.md`）

### DON'T

- 品質ゲートをスキップ
- 曖昧な表現（「いろいろやった」「updated」など）
- ロックファイルなしで途中のファイルを放置
- NEXT_CMDに `session-start.sh` を書く
- profile運用の詳細ログをroot `HANDOFF.md` に書く
