import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { appendEvent, readAllEvents, resolvePaths } from "./store";
import { createValidator, loadSchema } from "./validate";

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

test("createValidator accepts a well-formed work event", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  validate(
    {
      id: "H000001",
      ts: "2026-04-15T09:00:00Z",
      type: "work",
      version: 1,
      payload: { summary: "ok", next_cmd: "next" },
    },
    { file: "events.jsonl", line: 1 }
  );
});

test("createValidator accepts a well-formed session event", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  validate(
    {
      id: "H000001",
      ts: "2026-04-15T09:00:00Z",
      type: "session",
      version: 1,
      payload: { phase: "start", agent: "claude" },
    },
    { file: "events.jsonl", line: 1 }
  );
});

test("createValidator rejects missing required envelope fields", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  assert.throws(
    () =>
      validate(
        {
          id: "H000001",
          ts: "2026-04-15T09:00:00Z",
          type: "work",
          version: 1,
        },
        { file: "events.jsonl", line: 4 }
      ),
    /invalid event at events\.jsonl:4.*payload/
  );
});

test("createValidator rejects bad id pattern and names the id in the error", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  assert.throws(
    () =>
      validate(
        {
          id: "BAD",
          ts: "2026-04-15T09:00:00Z",
          type: "work",
          version: 1,
          payload: { summary: "x", next_cmd: null },
        },
        { file: "events.jsonl", line: 7 }
      ),
    /id=BAD.*pattern/
  );
});

test("createValidator rejects malformed timestamp", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  assert.throws(
    () =>
      validate(
        {
          id: "H000001",
          ts: "not-a-date",
          type: "session",
          version: 1,
          payload: { phase: "start" },
        },
        { file: "events.jsonl", line: 2 }
      ),
    /date-time/
  );
});

test("createValidator rejects work payload missing required fields", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  assert.throws(
    () =>
      validate(
        {
          id: "H000002",
          ts: "2026-04-15T09:00:00Z",
          type: "work",
          version: 1,
          payload: { next_cmd: null },
        },
        { file: "events.jsonl", line: 3 }
      ),
    /summary/
  );
});

test("createValidator rejects unknown top-level fields", async () => {
  const validate = createValidator(await loadSchema(REPO_SCHEMA_PATH));
  assert.throws(
    () =>
      validate(
        {
          id: "H000001",
          ts: "2026-04-15T09:00:00Z",
          type: "work",
          version: 1,
          payload: { summary: "x", next_cmd: null },
          rogue: true,
        },
        { file: "events.jsonl", line: 5 }
      ),
    /additional|rogue/i
  );
});

test("readAllEvents fails fast with line number and event id on invalid event", async () => {
  const root = await makeTmpRoot();
  const { eventsPath } = resolvePaths(root);
  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "ok", next_cmd: "keep going" },
  });
  await fs.appendFile(
    eventsPath,
    JSON.stringify({
      id: "bad",
      ts: "2026-04-15T09:10:00Z",
      type: "work",
      version: 1,
      payload: { summary: "x", next_cmd: null },
    }) + "\n"
  );
  await assert.rejects(
    readAllEvents(eventsPath),
    /invalid event at .*events\.jsonl:2.*id=bad/
  );
});

test("readAllEvents surfaces JSON parse errors with line number", async () => {
  const root = await makeTmpRoot();
  const { eventsPath } = resolvePaths(root);
  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "ok", next_cmd: "go" },
  });
  await fs.appendFile(eventsPath, "{not json}\n");
  await assert.rejects(readAllEvents(eventsPath), /invalid JSON at .*:2/);
});

test("readAllEvents succeeds when all events pass validation", async () => {
  const root = await makeTmpRoot();
  const { eventsPath } = resolvePaths(root);
  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "session",
    version: 1,
    payload: { phase: "start", agent: "claude" },
  });
  await appendEvent(eventsPath, {
    id: "H000002",
    ts: "2026-04-15T09:05:00Z",
    type: "work",
    version: 1,
    payload: { summary: "wrote stuff", next_cmd: "write more" },
  });
  const events = await readAllEvents(eventsPath);
  assert.equal(events.length, 2);
});

test("readAllEvents uses an injected validator when provided", async () => {
  const root = await makeTmpRoot();
  const { eventsPath } = resolvePaths(root);
  await appendEvent(eventsPath, {
    id: "H000001",
    ts: "2026-04-15T09:00:00Z",
    type: "work",
    version: 1,
    payload: { summary: "ok", next_cmd: "go" },
  });
  let calls = 0;
  const events = await readAllEvents(eventsPath, {
    validator: () => {
      calls++;
    },
  });
  assert.equal(events.length, 1);
  assert.equal(calls, 1);
});
