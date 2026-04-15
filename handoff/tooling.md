# Tooling Handoff

## Scope

- session lifecycle scripts
- handoff update tooling
- Gemini session commands
- AI memory protocol bootstrap

## Current

- `docs/AGENT_OPS.md` is the canonical protocol for Codex / Claude / Gemini.
- `scripts/session/session-start.sh` and `scripts/session/session-end.sh` now write audit events instead of fake completed work.
- `tools/ai-memory/` contains the first query-first memory CLI (`resume`).

## Next

- keep frontend chunking separate from tooling commits
- avoid committing runtime cache under `tools/ai-memory/.ai-memory/`
