export type EventId = string;

export interface EventEnvelope<TType extends string = string, TPayload = unknown> {
  id: EventId;
  ts: string;
  type: TType;
  version: number;
  payload: TPayload;
}

export interface WorkPayloadV1 {
  summary: string;
  next_cmd: string | null;
  tags?: string[];
}

export interface SessionPayloadV1 {
  phase: "start" | "end";
  agent?: string;
  note?: string;
}

export type WorkEventV1 = EventEnvelope<"work", WorkPayloadV1> & { version: 1 };
export type SessionEventV1 = EventEnvelope<"session", SessionPayloadV1> & { version: 1 };

export type KnownEvent = WorkEventV1 | SessionEventV1;

export type AnyEvent = KnownEvent | EventEnvelope<string, unknown>;

export interface ResumeResult {
  next_cmd: string | null;
  source_event_id: EventId | null;
  reason: string;
}

export interface CurrentCache {
  schema_version: 1;
  built_at: string;
  built_from_bytes: number;
  built_from_event_id: EventId | null;
  resume: ResumeResult;
}
