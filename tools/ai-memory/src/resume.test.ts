import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { resume, computeResume } from "./resume";
import { appendEvent, resolvePaths } from "./store";
import type { SessionEventV1, WorkEventV1 } from "./types";

const REPO_SCHEMA_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  ".ai-memory",
  "schema.json"
);

async function makeTmpRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-memory-test-"));
  await fs.mkdir(path.join(dir, ".ai-memory"), { recursive: true });
  await fs.copyFile(
    REPO_SCHEMA_PATH,
    path.join(dir, ".ai-memory", "schema.json")
  );
  return dir;
}

test("computeResume returns latest work event's next_cmd", () => {
  const events: (WorkEventV1 | SessionEventV1)[] = [
    {
      id: "H000001",
      ts: "2026-04-15T09:00:00Z",
      type: "work",
      version: 1,
      payload: { summary: "wrote spec", next_cmd: "implement reader" },
    },
    {
      id: "H000002",
      ts: "2026-04-15T09:10:00Z",
      type: "session",
      version: 1,
      payload: { phase: "end", agent: "claude" },
    },
    {
      id: "H000003",
      ts: "2026-04-15T10:00:00Z",
      type: "work",
      version: 1,
      payload: {
        summary: "wrote reader",
        next_cmd: "implement schema validator",
      },
    },
  ];
  const result = computeResume(events);
  assert.equal(result.next_cmd, "implement schema validator");
  assert.equal(result.source_event_id, "H000003");
  assert.equal(result.reason, "latest work event defines next_cmd");
});

test("computeResume returns nulls when no work event carries next_cmd", () => {
  const events: (WorkEventV1 | SessionEventV1)[] = [
    {
      id: "H000001",
      ts: "2026-04-15T09:00:00Z",
      type: "session",
      version: 1,
      payload: { phase: "start", agent: "claude" },
    },
    {
      id: "H000002",
      ts: "2026-04-15T09:10:00Z",
      type: "work",
      version: 1,
      payload: { summary: "investigated", next_cmd: null },
    },
  ];
  const result = computeResume(events);
  assert.equal(result.next_cmd, null);
  assert.equal(result.source_event_id, null);
  assert.match(result.reason, /no work event/);
});

test("computeResume skips non-work and later null next_cmd to find usable work", () => {
  const events: (WorkEventV1 | SessionEventV1)[] = [
    {
      id: "H000001",
      ts: "2026-04-15T08:00:00Z",
      type: "work",
      version: 1,
      payload: { summary: "did a thing", next_cmd: "do the other thing" },
    },
    {
      id: "H000002",
      ts: "2026-04-15T09:00:00Z",
      type: "work",
      version: 1,
      payload: { summary: "unclear where to go", next_cmd: null },
    },
    {
      id: "H000003",
      ts: "2026-04-15T09:30:00Z",
      type: "session",
      version: 1,
      payload: { phase: "end" },
    },
  ];
  const result = computeResume(events);
  assert.equal(result.next_cmd, "do the other thing");
  assert.equal(result.source_event_id, "H000001");
});

test("resume reads events.jsonl and writes traceable cache", async () => {
  const root = await makeTmpRoot();
  const { eventsPath, currentPath } = resolvePaths(root);

  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "init", next_cmd: "implement schema validator" },
  });

  const r1 = await resume({ root });
  assert.equal(r1.next_cmd, "implement schema validator");
  assert.equal(r1.source_event_id, "H000001");

  const cache = JSON.parse(await fs.readFile(currentPath, "utf8"));
  assert.equal(cache.schema_version, 1);
  assert.equal(cache.built_from_event_id, "H000001");
  assert.equal(cache.resume.source_event_id, "H000001");
  assert.ok(cache.built_from_bytes > 0, "cache must record byte size");
});

test("resume lazy-rebuilds when events.jsonl grows", async () => {
  const root = await makeTmpRoot();
  const { eventsPath } = resolvePaths(root);

  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "init", next_cmd: "first-thing" },
  });
  const r1 = await resume({ root });
  assert.equal(r1.next_cmd, "first-thing");

  await appendEvent(eventsPath, {
    id: "H000002",
    ts: "2026-04-15T10:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "next", next_cmd: "second-thing" },
  });
  const r2 = await resume({ root });
  assert.equal(r2.next_cmd, "second-thing");
  assert.equal(r2.source_event_id, "H000002");
});

test("resume uses cache when events.jsonl is unchanged", async () => {
  const root = await makeTmpRoot();
  const { eventsPath, currentPath } = resolvePaths(root);

  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "init", next_cmd: "cached-thing" },
  });

  await resume({ root });
  const cacheBefore = await fs.readFile(currentPath, "utf8");

  const r2 = await resume({ root });
  const cacheAfter = await fs.readFile(currentPath, "utf8");

  assert.equal(r2.next_cmd, "cached-thing");
  assert.equal(
    cacheBefore,
    cacheAfter,
    "cache file must not be rewritten when log is unchanged"
  );
});

test("resume with bypassCache ignores and does not write cache", async () => {
  const root = await makeTmpRoot();
  const { eventsPath, currentPath } = resolvePaths(root);

  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "init", next_cmd: "uncached" },
  });

  const r = await resume({ root, bypassCache: true });
  assert.equal(r.next_cmd, "uncached");

  await assert.rejects(
    fs.readFile(currentPath, "utf8"),
    /ENOENT/,
    "bypassCache must not create the cache file"
  );
});
