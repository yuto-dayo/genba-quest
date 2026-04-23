---
name: directing-handoff-workstreams
description: Use this skill when users ask for a manager-style view of distributed handoffs, such as "各作業の進捗を教えて", "今どれを進めるべきか", or requests to prioritize frontend/server/page/feature workstreams and recommend the next action.
version: 1.2
tags: [handoff, prioritization, work-allocation, direction, agent-ops]
---

# Directing Handoff Workstreams

分割された handoff（`HANDOFF.md` / `handoff/*.md`）を横断し、
「今どこが進んでいるか」と「誰が何を次に進めるべきか」をディレクター視点で提示する。

生産性の目的: (1) 迷い時間を減らす (2) ブロッカー待ちの停滞を減らす (3) 同時進行の過多を防ぐ

## When To Use

- 「それぞれの作業状況を教えて」「次に何を進めるのがおすすめ？」
- ページ/機能ごとに handoff を分割運用していて全体像を見失いそうな時

## Director Operating Principles

- `Unblock First`: 依存解除で複数streamが動くなら最優先
- `Single-Thread Clarity`: 「今やらないこと」も明示して集中を守る
- `WIP Limit`: 1人あたり同時実行は原則1stream（全体で最大3本）
- `Aging Discipline`: 更新が古い actionable P0 を放置しない
- `Command First`: 提案は必ず実行コマンドまで落とす

エージェント行動規範・Directive Contract・Risk Gate → [AGENT_EXECUTION.md](AGENT_EXECUTION.md)

## Steps

### 1) Snapshot を収集

```bash
node .claude/skills/directing-handoff-workstreams/scripts/summarize-handoffs.mjs --cwd /Users/yutoyoshino/Documents/genba-quest
```

JSON出力: `--json` を追加。

### 2) stream を4レーンに分類

- `blocked`: ブロッカー解消が必要
- `active`: actionable P0 があり即着手可能
- `needs-detail`: P0 が抽象的で実行粒度不足
- `needs-next-step`: NEXT_CMD/P0 が欠落

### 3) 優先度をスコア化（Director Score）

`score = 3*Impact + 2*Urgency + 2*UnblockLeverage + Readiness - 2*RiskPenalty`

同点時: UnblockLeverage高 > lastUpdate古 > P0具体的

### 4) 仕事を割り振る

- `1人`: 最高スコア1本に集中
- `2人`: 1人は `Execution`、もう1人は `Unblock`
- `3人以上`: 1人を `Unblock/調整` 専任、残りを上位streamへ

禁止: 同一ブロッカー待ちstreamの複数割当 / `needs-detail` のまま実装渡し / 1人にNow2本

### 5) 回答をディレクター形式で出す

1. `Workstream Status`: streamごとの state / P0 / NEXT_CMD
2. `Primary Recommendation`: 今すぐ進める1本（理由1文）
3. `Assignment Plan`: 誰が何を担当（Owner + 完了条件）
4. `Blocked/Risky`: ブロッカーと解消順
5. `First Commands`: すぐ実行する1-3コマンド

### 6) 着手後の更新運用を案内

```bash
scripts/session/session-update.sh --done "<完了>" --next "<次のP0>" --validation "<command => result>"
```

## Director Playbook

| ケース | 対応 |
| ------ | ---- |
| blocked が多い | Unblockレーンに集中、解除後にExecution昇格 |
| active が多すぎる | 上位3本を Now/Next/Later に圧縮、残りはHold |
| P0 が抽象的 | 1コマンド粒度に分解してから実装渡し |

## Output Contract

- 曖昧な提案禁止。必ず`次の1手`を1行コマンドで示す
- `Primary Recommendation` は1本に絞る
- actionable P0 がなければ「P0具体化」を最優先提案にする
- `blocked` stream があれば最低1つ解除アクションを含める

## Notes

- `summarize-handoffs.mjs` は `HANDOFF.md` と `handoff/**/*.md` を自動探索
- 分析結果はリアルタイムではないため、回答直前に毎回再実行する
