---
name: directing-handoff-workstreams
description: Use this skill when users ask for a manager-style view of distributed handoffs, such as "各作業の進捗を教えて", "今どれを進めるべきか", or requests to prioritize frontend/server/page/feature workstreams and recommend the next action.
---

# Directing Handoff Workstreams

分割された handoff（`HANDOFF.md` / `handoff/*.md`）を横断し、
「今どこが進んでいるか」と「次に何を進めるべきか」をディレクター視点で提示する。

## When To Use

- 「それぞれの作業状況を教えて」
- 「次に何を進めるのがおすすめ？」
- ページ/機能ごとに handoff を分割運用していて全体像を見失いそうな時

## Steps

### 1) Snapshot を収集

```bash
node .claude/skills/directing-handoff-workstreams/scripts/summarize-handoffs.mjs --cwd /Users/yutoyoshino/Documents/genba-quest
```

必要なら JSON でも取得する:

```bash
node .claude/skills/directing-handoff-workstreams/scripts/summarize-handoffs.mjs --cwd /Users/yutoyoshino/Documents/genba-quest --json
```

### 2) 進行状況を短く整理

回答は次の順序で出す:

1. `Workstream Status`: streamごとの state / P0 / NEXT_CMD
2. `Primary Recommendation`: 今すぐ進める1本（理由つき）
3. `Blocked/Risky`: ブロッカーと解消優先度

### 3) 推奨アクションをコマンド化

推奨 stream が `frontend/today` の場合:

```bash
scripts/session/session-start.sh --agent codex --domain frontend/today
```

推奨 stream が `server/proposals` の場合:

```bash
scripts/session/session-start.sh --agent codex --domain server/proposals
```

## Output Contract

- 曖昧な提案は禁止。必ず `次の1手` を 1 行コマンドで示す。
- 推奨理由は1文で明示する（例: 「未ブロックかつ最も古い actionable P0 のため」）。
- actionable P0 がない場合は「各 handoff の P0 具体化」を最優先提案にする。

## Notes

- `summarize-handoffs.mjs` は `HANDOFF.md` と `handoff/**/*.md` を自動探索する。
- ルート `HANDOFF.md` が domain index のみの場合は、自動的に分析対象から外す。
- 分析結果はリアルタイムではないため、回答直前に毎回再実行する。
