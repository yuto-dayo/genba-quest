---
name: compacting-handoff-memory
description: L0-L3メモリ階層によるHANDOFF圧縮。実処理はincremental-handoffのappend-handoff-update.shが自動実行する。
---

# Compacting Handoff Memory

このスキルの機能は [`incremental-handoff`](../incremental-handoff/SKILL.md) に統合済み。

- メモリモデル（L0-L3）→ [`_shared/handoff-conventions.md`](../_shared/handoff-conventions.md)
- 圧縮の自動実行 → `append-handoff-update.sh` が閾値超過時に自動処理
- 設定（`HANDOFF_COMPACTION_THRESHOLD` 等）→ `incremental-handoff` SKILL.md
- 処理フロー詳細 → [`incremental-handoff/LOGIC.md`](../incremental-handoff/LOGIC.md)
