# GENBA QUEST - Gemini Agent Instructions

## Read Order

1. Read `AGENTS.md` for project rules and architecture.
2. Follow `docs/AGENT_OPS.md` for session workflow.
3. Before implementation, run `sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md`.

## Shared Skills

- Canonical source: `.claude/skills/*/SKILL.md`
- Antigravity-compatible path: `.agent/skills` (symlink to `.claude/skills`)
- Gemini helper commands:
  - `/list-skills`
  - `/use-skill <skill-name> :: <task>`

## Guardrails

- Keep Proposal-centric architecture intact.
- Never bypass policy checks on the server.
- Never allow AI self-approval (`ai` creator + `ai` approver).
