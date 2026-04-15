import type { AnyEvent, CurrentCache, ResumeResult, WorkEventV1 } from "./types";
import {
  resolvePaths,
  readAllEvents,
  readCache,
  writeCache,
  getEventsFileSize,
} from "./store";

export interface ResumeOptions {
  root?: string;
  bypassCache?: boolean;
}

export async function resume(opts: ResumeOptions = {}): Promise<ResumeResult> {
  const { eventsPath, currentPath } = resolvePaths(opts.root);
  const currentSize = await getEventsFileSize(eventsPath);

  if (!opts.bypassCache) {
    const cached = await readCache(currentPath);
    if (isFreshCache(cached, currentSize)) {
      return cached!.resume;
    }
  }

  const events = await readAllEvents(eventsPath);
  const result = computeResume(events);

  if (!opts.bypassCache) {
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const cache: CurrentCache = {
      schema_version: 1,
      built_at: new Date().toISOString(),
      built_from_bytes: currentSize,
      built_from_event_id: lastEvent ? lastEvent.id : null,
      resume: result,
    };
    await writeCache(currentPath, cache);
  }

  return result;
}

export function computeResume(events: readonly AnyEvent[]): ResumeResult {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    if (isWorkV1(ev) && ev.payload.next_cmd) {
      return {
        next_cmd: ev.payload.next_cmd,
        source_event_id: ev.id,
        reason: "latest work event defines next_cmd",
      };
    }
  }
  return {
    next_cmd: null,
    source_event_id: null,
    reason: "no work event with a next_cmd found",
  };
}

function isWorkV1(ev: AnyEvent): ev is WorkEventV1 {
  return ev.type === "work" && ev.version === 1;
}

function isFreshCache(
  cache: CurrentCache | null,
  currentSize: number
): cache is CurrentCache {
  return (
    cache !== null &&
    cache.schema_version === 1 &&
    cache.built_from_bytes === currentSize
  );
}
