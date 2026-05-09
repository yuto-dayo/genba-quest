# GENBA QUEST - Gemini Agent Instructions

## Read Order

1. Read `AGENTS.md` for project rules and architecture.
2. Follow `docs/AGENT_OPS.md` for session workflow.
3. Before implementation, run `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`.

## Session Rules (MUST follow)

Same lifecycle as Claude / Codex — use the v2 handoff scripts with `--agent gemini`:

```bash
# session start (regenerates HANDOFF.md template, records audit event)
scripts/session/session-start.sh --agent gemini

# optional: capture a real baseline at start (slower)
scripts/session/session-start.sh --agent gemini --baseline

# domain split (recommended for parallel work)
scripts/session/session-start.sh --agent gemini --domain frontend/today

# during work — record each completed chunk
scripts/session/session-update.sh \
  --done "<what you finished>" \
  --next "<next P0>" \
  --validation "<command => result>" \
  --file "path - semantic description"

# session end (runs quality gates, records audit event)
scripts/session/session-end.sh
```

Or use the slash-command shortcuts (see `.gemini/commands/`):

- `/session-start` — wraps `session-start.sh --agent gemini`
- `/session-update <done> :: <next> :: <validation>` — wraps `session-update.sh`
- `/session-end` — wraps `session-end.sh`

**v2 invariants** (do not violate):

- session-start / session-end are recorded in `## Session Events (audit log)` only. They MUST NOT pollute Completed / L1 / L2 / L3.
- Quality Gate results go to the Quality Gate table via `--quality-gate "key=result|notes"`, not via fake `--done` entries.
- If the working tree is dirty at session start, `session-start.sh` injects a `> [carryover]` warning into the Resume section. Read it and verify NEXT_CMD before executing.

## Shared Skills

- Canonical source: `.claude/skills/*/SKILL.md`
- Antigravity-compatible path: `.agent/skills` (symlink to `.claude/skills`)
- Gemini helper commands:
  - `/list-skills`
  - `/use-skill <skill-name> :: <task>`
  - `/session-start`, `/session-update`, `/session-end`

## Guardrails

- Keep Proposal-centric architecture intact.
- Never bypass policy checks on the server.
- Never allow AI self-approval (`ai` creator + `ai` approver).
- Honor MVP outcomes (請求漏れゼロ + 黒字可視化) when prioritizing scope — see `docs/DESIGN_PHILOSOPHY.md` 思想 section.
- Follow UX原則: Input-zero / Decision-human, Direct + Sherpa split, Calm Cockpit 5 principles. AI removes typing and verification load, never decision authority. Details in `AGENTS.md` UX Principles section + `design-system/genba-quest/MASTER.md`.
- Pre-commit guard (`.githooks/pre-commit`) must stay enabled.
