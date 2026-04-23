# GENBA QUEST Docs Map

`docs/` の人間向け入口です。
既存の skill / script / `AGENTS.md` が `docs/*.md` を直接参照しているため、当面は主要ドキュメントの既存パスを正本アンカーとして維持します。

## 目的

- 初見で「どこから読めばいいか」を明確にする
- 設計書 / 実行計画 / runbook / ADR / 作業メモを分類して見つけやすくする
- 将来の再編時も skill や script を壊さない移行順序を共有する

## 先に読むもの

### 1. 全体像を掴みたい

1. `docs/GENBA_QUEST_SYSTEM_SPEC.md`
2. `docs/DESIGN_PHILOSOPHY.md`
3. 必要な領域の個別設計書

### 2. 今どこまで実装されているか知りたい

1. `docs/EXECUTION_PLAN.md`
2. `docs/EVOLUTION_ROADMAP.md`
3. 関連する `docs/tasks/` または `docs/adr/`

### 3. セッション運用を知りたい

1. `docs/AGENT_OPS.md`
2. `HANDOFF.md`

### 4. 実装前に参照する設計

1. `docs/DESIGN_PHILOSOPHY.md`
2. `docs/PROPOSAL_SYSTEM.md`
3. `docs/LEDGER_SYSTEM.md`
4. `docs/POLICY_SYSTEM.md`
5. 必要に応じて `docs/SHERPA_ARCHITECTURE.md` / `docs/UI_ARCHITECTURE.md`

## 正本マップ

| Subject | Canonical doc | Notes |
| --- | --- | --- |
| Agent session operations | `docs/AGENT_OPS.md` | Codex / Claude / Gemini 共通運用 |
| Human-readable system overview | `docs/GENBA_QUEST_SYSTEM_SPEC.md` | まず読む 1 枚 |
| Core architecture philosophy | `docs/DESIGN_PHILOSOPHY.md` | ideal target と current note を含む |
| Proposal model | `docs/PROPOSAL_SYSTEM.md` | Proposal lifecycle と type 設計 |
| Ledger model | `docs/LEDGER_SYSTEM.md` | 会計・仕訳の正規設計 |
| Policy model | `docs/POLICY_SYSTEM.md` | 承認ルールと policy 原則 |
| Sherpa design | `docs/SHERPA_ARCHITECTURE.md` | AI actor / orchestrator 設計 |
| UI design | `docs/UI_ARCHITECTURE.md` | 画面構成と UX 方針 |
| Reward design | `docs/REWARD_SYSTEM.md` | 報酬分配ルール |
| PATH V3.1 program rules | `docs/architecture/path-v31.md` | post-cutover PATH mainline の正本 |
| Current execution status | `docs/EXECUTION_PLAN.md` | 実装状況と直近タスクの正本 |
| Mid/long-term roadmap | `docs/EVOLUTION_ROADMAP.md` | 中長期構想。進捗の正本ではない |

## ディレクトリの見方

### Root `docs/`

既存の主要設計書と、互換性維持が必要なアンカー文書を置く場所です。
今は skill / script / `AGENTS.md` から直接参照される文書が多いため、安易に移動しません。

- Overview / entry
  - `GENBA_QUEST_SYSTEM_SPEC.md`
  - `README.md`
- Core architecture
  - `DESIGN_PHILOSOPHY.md`
  - `PROPOSAL_SYSTEM.md`
  - `LEDGER_SYSTEM.md`
  - `POLICY_SYSTEM.md`
  - `SHERPA_ARCHITECTURE.md`
  - `UI_ARCHITECTURE.md`
  - `REWARD_SYSTEM.md`
- Planning / execution
  - `EXECUTION_PLAN.md`
  - `EVOLUTION_ROADMAP.md`
- Post-cutover PATH mainline
  - `architecture/path-v31.md`
- Operations / runbook anchors
  - `AGENT_OPS.md`
  - `DB_MIGRATION_RUNBOOK_A1.md`
  - `GMAIL_WEBHOOK_PENDING_QUEUE_MANUAL_E2E.md`
  - `SHERPA_TODAY_MANUAL_E2E.md`
- Feature-specific design anchors
  - `CALENDAR_COCKPIT_ARCHITECTURE.md`
  - `PHASE_C_ASSIGNMENT_SIMULATOR_ARCHITECTURE.md`

### `docs/adr/`

設計判断の固定点。
`DESIGN_PHILOSOPHY.md` と current production model の差分がある場合は、まず ADR を確認します。
一覧は `docs/adr/README.md` を参照します。

### `docs/architecture/`

特定テーマの深掘り設計。
root のコア設計書では収まらない、個別領域の canonical flow や migration plan を置きます。
一覧は `docs/architecture/README.md` を参照します。

### `docs/policies/`

機械可読ポリシーや bundle の置き場です。

### `docs/runbooks/`

定型運用の実務手順です。
今後、新しい runbook は原則ここに追加します。
一覧は `docs/runbooks/README.md` を参照します。

### `docs/tasks/`

日付付きの実装仕様、調査結果、証跡、提案の置き場です。
恒久設計に昇格した内容は root / `architecture/` / `adr/` へ昇格させます。
一覧は `docs/tasks/README.md` を参照します。

## 今の分かりづらさ

- root 直下に設計書、運用手順、手動 E2E、提案書が混在している
- 正本の説明が各ドキュメント本文に散っている
- `docs/architecture/` など新しい分類がある一方で、旧来の root 配置も多く混在している

この README は、まずその混在を読む側に見える形にするための入口です。

## 今後の安全な再編ルール

1. 既存参照を `rg "docs/"` で棚卸ししてから動かす
2. skill / script / `AGENTS.md` が直接参照する文書は、参照更新完了まで移動しない
3. 新規文書はできるだけ `adr/`, `architecture/`, `runbooks/`, `tasks/` に追加する
4. 既存文書を移動する場合は、旧パスに移転案内のみの薄い互換ファイルを残す
5. `.docx` は可能なら Markdown 化してから整理する

## 追加先ガイド

| If you are adding... | Put it here |
| --- | --- |
| Core cross-domain design | root `docs/` |
| Irreversible architecture decision | `docs/adr/` |
| Detailed feature architecture | `docs/architecture/` |
| Operational procedure | `docs/runbooks/` |
| Policy bundle or rule artifact | `docs/policies/` |
| Dated investigation / spec / evidence | `docs/tasks/` |
