# MEMORY_PROTOCOL.md

AI-first external memory layer for coding workflow handoff.

This document is the **human-readable specification**. The source of truth for
state is [.ai-memory/events.jsonl](.ai-memory/events.jsonl).

## Status

- **v0** — minimum viable foundation
- Implemented query intents: `resume`
- Planned query intents: `status`, `risks`, `open_threads`, `decisions`

## Principles

1. **AI readability over human readability.** Humans inspect state by asking an AI; they do not read raw event files.
2. **Append-only history.** Events are never rewritten or deleted. Historical mistakes are corrected by appending new events, not by editing past ones.
3. **Source of truth vs. caches.** `events.jsonl` is the only source of truth. Every other file under `.ai-memory/` is a regeneratable cache.
4. **Lazy rebuild.** Caches are rebuilt on read when they are stale. No dual-write, no eager sync.
5. **Traceability.** Every cache entry records the source event id it was built from.
6. **Schema evolution via versioning.** Event payloads are versioned per `type`. Readers branch on `(type, version)`. Historical events stay valid forever.
7. **Query-first API.** The public surface is a small set of query intents, not a generic event reader.

## Non-goals (for v0)

- pretty Markdown handoff documents as source of truth
- marker-based rewriting of prose handoffs
- sustaining the legacy L0/L1/L2/L3 layered summaries
- hand-maintained AGENTS.md / CLAUDE.md / GEMINI.md entry files (deferred)

## Storage layout

```
.ai-memory/
  events.jsonl         # source of truth (append-only)
  current.json         # derived cache: resume result + staleness metadata
  schema.json          # machine-readable event schema
```

Planned (not yet implemented):

```
.ai-memory/indexes/
  open_threads.json
  risks.json
  decisions.json
```

## Event envelope

All events share this shape:

```json
{
  "id":      "H000123",
  "ts":      "2026-04-15T10:00:00Z",
  "type":    "work",
  "version": 1,
  "payload": { }
}
```

### `id`

Format: `H` + zero-padded integer (minimum 6 digits). Strictly monotonic. Never reused, never reassigned.

### `version`

Scoped to `type`. `work` v1 and `work` v2 may coexist in the same log; readers must branch on `(type, version)`.

Rules:

- never mutate a previously published `(type, version)` schema
- to change a payload shape, publish `version: N+1`
- readers must ignore unknown `(type, version)` pairs gracefully, not throw

## Event types (v0)

### `work` v1

```json
{
  "type": "work",
  "version": 1,
  "payload": {
    "summary": "implemented schema validator",
    "next_cmd": "wire validator into CLI",
    "tags": ["protocol", "validator"]
  }
}
```

`next_cmd` is the **single** next action. It is always one string or `null`. Multi-step plans belong elsewhere (future intents may cover them).

### `session` v1

```json
{
  "type": "session",
  "version": 1,
  "payload": {
    "phase": "start",
    "agent": "claude",
    "note": "resumed after lunch"
  }
}
```

`phase` is `"start"` or `"end"`. `agent` and `note` are optional.

## Caches

### `current.json`

Holds the latest `resume` result plus staleness metadata.

```json
{
  "schema_version": 1,
  "built_at": "2026-04-15T10:05:00Z",
  "built_from_bytes": 4823,
  "built_from_event_id": "H000123",
  "resume": {
    "next_cmd": "implement schema validator",
    "source_event_id": "H000123",
    "reason": "latest work event defines next_cmd"
  }
}
```

**Staleness rule:** cache is valid iff `built_from_bytes` equals the current byte size of `events.jsonl`. Because the log is append-only, byte size is a correct and cheap staleness signal.

**Recovery:** delete `current.json`. The next query rebuilds it from events.

## Query intents

### `resume`

Returns the single next action.

```json
{
  "next_cmd":        "implement schema validator",
  "source_event_id": "H000123",
  "reason":          "latest work event defines next_cmd"
}
```

Algorithm: scan events in reverse; return the first `work` event with a non-null `next_cmd`. If none exists, return nulls with an explanatory `reason`.

### Planned (not yet implemented)

- `status` — summary of recent work, open questions, unresolved risks
- `risks` — known landmines still active
- `open_threads` — work started but not closed
- `decisions` — settled decisions and their justification

Each will follow the same contract: structured JSON, every answer field traceable to one or more source event ids.

## Implementation

TypeScript package at [tools/ai-memory/](tools/ai-memory/).

CLI:

```
ai-memory resume [--no-cache]
```

Programmatic:

```ts
import { resume } from "@genba-quest/ai-memory";
const result = await resume();
```

## Relationship to existing HANDOFF.md

Temporarily coexists. `HANDOFF.md` remains the human-facing handoff document until the AI-first protocol covers enough query intents to replace it. No data migration is required; new events go into `.ai-memory/events.jsonl`.
