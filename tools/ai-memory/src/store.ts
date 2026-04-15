import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { AnyEvent, CurrentCache, EventId } from "./types";
import {
  createValidator,
  loadSchema,
  type EventValidator,
} from "./validate";

export interface StorePaths {
  root: string;
  eventsPath: string;
  currentPath: string;
  schemaPath: string;
}

export function resolvePaths(root: string = process.cwd()): StorePaths {
  return {
    root,
    eventsPath: path.join(root, ".ai-memory", "events.jsonl"),
    currentPath: path.join(root, ".ai-memory", "current.json"),
    schemaPath: path.join(root, ".ai-memory", "schema.json"),
  };
}

export interface ReadEventsOptions {
  validator?: EventValidator;
}

export async function readAllEvents(
  eventsPath: string,
  opts: ReadEventsOptions = {}
): Promise<AnyEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(eventsPath, "utf8");
  } catch (err: unknown) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const validator =
    opts.validator ??
    createValidator(
      await loadSchema(path.join(path.dirname(eventsPath), "schema.json"))
    );
  const out: AnyEvent[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (err) {
      throw new Error(
        `invalid JSON at ${eventsPath}:${i + 1}: ${(err as Error).message}`
      );
    }
    validator(parsed, { file: eventsPath, line: i + 1 });
    out.push(parsed as AnyEvent);
  }
  return out;
}

export async function getEventsFileSize(eventsPath: string): Promise<number> {
  try {
    const stat = await fs.stat(eventsPath);
    return stat.size;
  } catch (err: unknown) {
    if (isEnoent(err)) return 0;
    throw err;
  }
}

export async function readCache(currentPath: string): Promise<CurrentCache | null> {
  try {
    const raw = await fs.readFile(currentPath, "utf8");
    return JSON.parse(raw) as CurrentCache;
  } catch (err: unknown) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function writeCache(
  currentPath: string,
  cache: CurrentCache
): Promise<void> {
  await fs.mkdir(path.dirname(currentPath), { recursive: true });
  const tmp = `${currentPath}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 2) + "\n", "utf8");
  await fs.rename(tmp, currentPath);
}

export function nextEventId(lastId: EventId | null): EventId {
  if (!lastId) return "H000001";
  const m = /^H(\d+)$/.exec(lastId);
  if (!m) throw new Error(`malformed event id: ${lastId}`);
  const n = parseInt(m[1], 10) + 1;
  const width = Math.max(6, m[1].length);
  return "H" + n.toString().padStart(width, "0");
}

export async function appendEvent(
  eventsPath: string,
  event: AnyEvent
): Promise<void> {
  await fs.mkdir(path.dirname(eventsPath), { recursive: true });
  await fs.appendFile(eventsPath, JSON.stringify(event) + "\n", "utf8");
}

function isEnoent(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as NodeJS.ErrnoException).code === "ENOENT"
  );
}
