---
name: directing-handoff-workstreams
description: Use this skill when users ask for a manager-style view of distributed handoffs, such as "各作業の進捗を教えて", "今どれを進めるべきか", or requests to prioritize frontend/server/page/feature workstreams and recommend the next action.
version: 1.2
tags: [handoff, prioritization, work-allocation, direction, agent-ops]
---

# Directing Handoff Workstreams

分割された handoff（`HANDOFF.md` / `handoff/*.md`）を横断し、
「今どこが進んでいるか」と「誰が何を次に進めるべきか」をディレクター視点で提示する。
さらに、エージェント実行時の誤作動を防ぐために、指示契約とリスクゲートを必須化する。

生産性の目的は次の3点:

1. 迷い時間を減らす（次の1手を即決）
2. ブロッカー待ちの停滞を減らす（Unblock専任を置く）
3. 同時進行の過多を防ぐ（WIP制限）

## When To Use

- 「それぞれの作業状況を教えて」
- 「次に何を進めるのがおすすめ？」
- 「担当をどう割り振るべき？」
- ページ/機能ごとに handoff を分割運用していて全体像を見失いそうな時

## Director Operating Principles

- `Unblock First`: 依存解除で複数streamが動くなら最優先。
- `Single-Thread Clarity`: 「今やらないこと」も明示して集中を守る。
- `WIP Limit`: 1人あたり同時実行は原則1stream（全体でも実行中は最大3本）。
- `Aging Discipline`: 更新が古い actionable P0 を放置しない。
- `Command First`: 提案は必ず実行コマンドまで落とす。

## Agent Execution Principles

- `Instruction Hierarchy`: 上位指示（system/developer）とプロジェクト規約を優先し、衝突時は下位指示を採用しない。
- `Directive Contract`: 実行前に Goal/Scope/Constraints/Non-goals/DoD を明文化する。
- `Least-Privilege Action`: 読み取り優先。書き込みは最小変更。破壊的操作は承認なしで実行しない。
- `Evidence-First`: 提案だけで終わらせず、検証コマンドと結果をセットで返す。
- `Fail-Loud`: 再試行上限を超えたら黙って進めず、ブロッカーとして報告する。

## Directive Contract (Required)

着手前に次を埋める。空欄のまま実行しない。

```yaml
goal: "このターンで達成する成果"
scope:
  - "変更対象ファイル/領域"
constraints:
  - "守るべき規約・禁止事項"
non_goals:
  - "今回はやらないこと"
output_contract:
  - "返答に必須のセクション"
definition_of_done:
  - "完了判定の具体条件"
risk_tier: "safe-read | bounded-write | destructive"
approval_gate: "required | not_required"
retry_budget: 2
escalation_triggers:
  - "ポリシー衝突"
  - "検証失敗の連続"
```

## Risk Gate Matrix

| Tier | Allowed | Not Allowed | Approval |
| ---- | ------- | ----------- | -------- |
| `safe-read` | 読み取り、分析、計画、非破壊検証 | ファイル変更、削除 | 不要 |
| `bounded-write` | workspace内の限定的編集、検証実行 | 破壊的コマンド、外部破壊操作 | 原則不要（規約順守時） |
| `destructive` | ユーザーが明示許可した破壊的操作のみ | 無許可の削除/リセット/本番破壊 | 必須 |

判定ルール:

- `rm`, `git reset`, `git checkout --`, productionデータ変更を含む場合は `destructive`。
- 変更範囲が handoff/skill ドキュメント内のみなら通常 `bounded-write`。
- 判定に迷う場合は高いTierを採用する。

## Steps

### 1) Snapshot を収集（毎回最新化）

```bash
node .claude/skills/directing-handoff-workstreams/scripts/summarize-handoffs.mjs --cwd /Users/yutoyoshino/Documents/genba-quest
```

必要なら JSON でも取得する:

```bash
node .claude/skills/directing-handoff-workstreams/scripts/summarize-handoffs.mjs --cwd /Users/yutoyoshino/Documents/genba-quest --json
```

### 2) Directive Contract を確定

- このターンの `risk_tier` / `approval_gate` / `retry_budget` を先に確定する。
- `destructive` なら実行前に必ず承認フローへ分岐する。
- Contractが曖昧なら先に明確化し、実装指示を開始しない。

### 3) stream を4レーンに分類

- `blocked`: ブロッカー解消が必要
- `active`: actionable P0 があり即着手可能
- `needs-detail`: P0 が抽象的で実行粒度不足
- `needs-next-step`: NEXT_CMD/P0 が欠落

### 4) 優先度をスコア化（Director Score）

各streamを 0-3 点で採点し、次式で優先順位を決定:

`score = 3*Impact + 2*Urgency + 2*UnblockLeverage + Readiness - 2*RiskPenalty`

- `Impact`: ユーザー価値/売上/運用安定に効く度合い
- `Urgency`: 最終更新の古さ・期限の近さ
- `UnblockLeverage`: この作業で他streamが再開する度合い
- `Readiness`: 着手条件が揃っている度合い
- `RiskPenalty`: 未検証変更や高リスク依存の強さ

同点時の優先ルール:

1. `UnblockLeverage` が高い方
2. `lastUpdate` が古い方
3. `P0` がより具体的な方

### 5) 仕事を割り振る

人数別の基本形:

- `1人`: 最高スコア1本に集中。全て blocked なら「解除作業」から開始。
- `2人`: 1人は `Execution`、もう1人は `Unblock` を担当。
- `3人以上`: 1人を `Unblock/調整` 専任、残りを上位 `active` streamへ配分。

割り振り禁止ルール:

- 同一ブロッカー待ちのstreamを同時に複数割り当てない
- `needs-detail` のまま実装担当へ渡さない（先にP0具体化）
- 1人に2本以上の `Now` を渡さない

### 6) 回答をディレクター形式で出す

回答は必ず次の順序:

1. `Workstream Status`: streamごとの state / P0 / NEXT_CMD
2. `Primary Recommendation`: 今すぐ進める1本（理由1文）
3. `Assignment Plan`: 誰が何を担当するか（Owner A/B/C）
4. `Blocked/Risky`: ブロッカーと解消順
5. `First Commands`: すぐ実行する1-3コマンド
6. `Directive Contract`: 今回確定した contract 抜粋

### 7) 着手後の更新運用まで指示

推奨stream開始後は、1作業単位ごとに `session-update` を案内する:

```bash
scripts/session/session-update.sh --done "<完了>" --next "<次のP0>" --validation "<command => result>" --file "<path - semantic description>"
```

### 8) 推奨アクションをコマンド化

推奨 stream が `frontend/today` の場合:

```bash
scripts/session/session-start.sh --agent codex --domain frontend/today
```

推奨 stream が `server/proposals` の場合:

```bash
scripts/session/session-start.sh --agent codex --domain server/proposals
```

## Failure Protocol

- `Retry Budget`: 同一失敗原因への再試行は最大2回。
- `Immediate Stop`: ポリシー衝突、権限不足、破壊操作の未承認は即停止。
- `Escalate`: 以下のいずれかでエスカレーション:
  - 検証失敗が2回連続
  - 必要入力が不足し、推定でも安全に進められない
  - 関連streamに連鎖ブロックを起こす可能性が高い
- `Fallback`: 自動実行不能時は「安全な次の1手（read-only）」を必ず提示する。

## Output Contract

- 曖昧な提案は禁止。必ず `次の1手` を 1 行コマンドで示す。
- `Primary Recommendation` は必ず1本に絞る（Nowは1つ）。
- `Assignment Plan` には `Owner` と `完了条件` を書く。
- `Directive Contract` から `risk_tier` と `approval_gate` を必ず表示する。
- 推奨理由は1文で明示する（例: 「未ブロックかつ最も古い actionable P0 のため」）。
- actionable P0 がない場合は「各 handoff の P0 具体化」を最優先提案にする。
- `blocked` stream がある場合、最低1つは解除アクションを含める。

## Evaluation Contract

毎回、次の指標を確認する:

- `Command Executable Rate`: 提示コマンドのうち、追加解釈なしで実行可能な割合（目標 `>= 95%`）
- `First-Pass Acceptance`: ユーザー再指示なしで採用された推奨の割合（目標 `>= 70%`）
- `Blocked-to-Unblocked Lead Time`: blocked解消までの時間（短縮傾向を維持）
- `Handoff Accuracy`: handoff記載の P0/NEXT_CMD と実際の次アクションの一致率（目標 `>= 90%`）

## Director Playbook

### ケースA: blocked が多い

- 実装を増やさず `Unblock` レーンに集中
- 解除できたstreamのみ `Execution` へ昇格

### ケースB: active が多すぎる

- スコア上位から最大3本だけ `Now/Next/Later` に圧縮
- 残りは明示的に `Hold` と宣言

### ケースC: P0 が抽象的

- まず P0 を「1コマンドで開始できる粒度」に分解
- 分解完了までは実装担当に渡さない

## Notes

- `summarize-handoffs.mjs` は `HANDOFF.md` と `handoff/**/*.md` を自動探索する。
- ルート `HANDOFF.md` が domain index のみの場合は、自動的に分析対象から外す。
- 分析結果はリアルタイムではないため、回答直前に毎回再実行する。
- 可能なら `--json` 出力を併用し、`riskLevel/approvalRequired/directorScore` を判断根拠に使う。
