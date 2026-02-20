---
name: compacting-handoff-memory
description: Use this skill when you want AI-era layered handoff operations for long sessions, including L0/L1/L2/L3 memory structure, deterministic compaction of Incremental Updates, source-linked summaries via Entry-ID, and low-context quick resume across Codex/Claude handoffs.
---

# Compacting Handoff Memory

長時間セッション向けに、`HANDOFF.md` を4層メモリで維持するスキル。

## Use This Skill When

- 引き継ぎログが肥大化して再開効率が落ちている
- `HANDOFF.md` を「履歴 + 圧縮要約」の二層ではなく、L0-L3の階層で運用したい
- 次のエージェントが source-linked な要約（Entry-ID参照）で即再開できる状態を作りたい

## Memory Model

- **L0**: `Quick Resume (AI)` の `NEXT_CMD`
- **L1**: `Session Summary (Compacted)`（3-7行）
- **L2**: `Project Continuity (Compacted)`（Decisions / Landmines / Open Threads）
- **L3**: `Incremental Updates`（生ログ + 自動コンパクション）

## Workflow

1. セッション開始時に `scripts/session/session-start.sh --agent codex|claude` を実行
2. 作業単位ごとに `scripts/session/session-update.sh --done ... --next ...` を実行
3. `append-handoff-update.sh` が次を自動実行
   - `Entry-ID` 採番
   - L1/L2 再生成
   - L3 閾値超過時の圧縮 + archive退避
4. セッション終了時に `scripts/session/session-end.sh` を実行

## Configuration

- `HANDOFF_COMPACTION_THRESHOLD` (default `20`)
- `HANDOFF_COMPACTION_KEEP_RECENT` (default `12`)

## Source-of-Truth

- Script: `./../incremental-handoff/scripts/append-handoff-update.sh`
- Template: `./../handing-off-session/handoff-template.md`
- Ops protocol: `/Users/yutoyoshino/Documents/genba-quest/docs/AGENT_OPS.md`
