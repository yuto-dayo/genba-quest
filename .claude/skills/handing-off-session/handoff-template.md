# Session Handoff - {{DATE}}

## 0. Quick Resume (AI)

- NEXT_CMD: `{{NEXT_CMD}}`
- SUCCESS_CRITERIA: `{{SUCCESS_CRITERIA}}`
- HOTSET:
  - `{{HOT_FILE_1}}`
  - `{{HOT_FILE_2}}`
- DO_NOT_READ:
  - `{{AVOID_FILE}}`
- VERIFY_FIRST:
  - `{{VERIFY_CMD_1}}`
- STATE:
  - Branch: `{{BRANCH}}`
  - Uncommitted: `{{UNCOMMITTED_COUNT}} files`
  - DB migrations: `applied up to {{LAST_APPLIED_SQL}} / pending: {{PENDING_SQL_LIST}}`
  - Tests: `{{TEST_PASS}}/{{TEST_TOTAL}} pass, {{TEST_SKIP}} skip`
  - Lint: `{{LINT_ERROR}} errors, {{LINT_WARN}} warnings`

---

## L1. Session Summary (Compacted)

<!-- HANDOFF_L1_START -->
- [pending] No completed chunk recorded yet. Source: N/A
- [pending] Use scripts/session/session-update.sh after each meaningful chunk. Source: N/A
- [pending] NEXT_CMD in Quick Resume is the current executable action. Source: N/A
<!-- HANDOFF_L1_END -->

## L2. Project Continuity (Compacted)

### Decisions
<!-- HANDOFF_L2_DECISIONS_START -->
- [pending] No decision context recorded yet. Source: N/A
<!-- HANDOFF_L2_DECISIONS_END -->

### Landmines
<!-- HANDOFF_L2_LANDMINES_START -->
- [none] No landmines recorded. Source: N/A
<!-- HANDOFF_L2_LANDMINES_END -->

### Open Threads
<!-- HANDOFF_L2_THREADS_START -->
- [pending] No unresolved thread recorded yet. Source: N/A
<!-- HANDOFF_L2_THREADS_END -->

### Compaction State
<!-- HANDOFF_L2_STATE_START -->
- threshold: `20`
- keep_recent: `12`
- last_compacted_at: `never`
- archived_entries: `0`
<!-- HANDOFF_L2_STATE_END -->

---

## 1. Resume（次の1手）

```text
Agent: {{NEXT_AGENT}}  (Claude Code / Codex / 未定)
Branch: {{BRANCH}}
Phase: {{CURRENT_PHASE}}
```

1. このファイル全体を読む
2. {{NEXT_ACTION}}

---

## 2. Goal（このチケットの目的）

**Ticket**: {{TICKET_ID}}
{{GOAL_SUMMARY}}

---

## 3. Completed

- [x] {{COMPLETED_ITEM}}

---

## 4. Remaining（優先順位順）

- [ ] **P0**: {{REMAINING_P0}}
- [ ] **P1**: {{REMAINING_P1}} `(blocked by: なし)`
- [ ] {{REMAINING_ITEM}}

---

## 5. Changed Files

| File | What Changed (semantic) |
| ---- | ----------------------- |
| `{{FILE}}` | {{WHY_AND_WHAT}} |

> **ルール**: "updated" は禁止。「何が・なぜ」変わったかを書く（例: `approve()にatomic RPC優先パスを追加`）

---

## 6. Locked Files（編集中 - 他エージェント触らない）

> 以下のファイルは作業途中。次のセッションの担当エージェントのみ編集すること。

- `{{LOCKED_FILE}}` - {{REASON}}

---

## 7. Quality Gate

```bash
# 品質ゲート実行結果（handoff前に必ず実行）
cd server && npx tsc --noEmit        # TypeCheck
cd frontend && npx tsc --noEmit      # TypeCheck
cd frontend && npx eslint src/       # Lint
cd server && npm test                # Test
```

| Check | Result | Detail |
| ----- | ------ | ------ |
| server typecheck | {{PASS_FAIL}} | {{NOTES}} |
| frontend typecheck | {{PASS_FAIL}} | {{NOTES}} |
| lint | {{PASS_FAIL}} | {{ERROR_COUNT}} errors, {{WARN_COUNT}} warnings |
| test | {{PASS_FAIL}} | {{PASS_COUNT}}/{{TOTAL_COUNT}} pass, {{SKIP_COUNT}} skip |

---

## 8. Working Context

> 次のエージェントが「なぜこうなっているか」を即理解するための前提知識。

| Pattern / Decision | 1-line Explanation |
| ------------------ | ------------------ |
| {{PATTERN}} | {{WHY}} |

---

## 9. Key Decisions

| Decision | Rationale |
| -------- | --------- |
| {{DECISION}} | {{REASON}} |

---

## 10. Landmines / Gotchas

> 「壊れてるように見えるが意図的」「触ると壊れる」等の注意事項。

- {{GOTCHA}}

---

## 11. Risks / Blockers

{{RISKS_OR_NONE}}

---

## 12. References

- `{{FILE}}` - {{DESCRIPTION}}

---

## 13. Incremental Updates
