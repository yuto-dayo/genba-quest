import Ajv, { type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import { promises as fs } from "node:fs";

export interface ValidateContext {
  file: string;
  line: number;
}

export type EventValidator = (parsed: unknown, ctx: ValidateContext) => void;

export async function loadSchema(schemaPath: string): Promise<object> {
  const raw = await fs.readFile(schemaPath, "utf8");
  return JSON.parse(raw) as object;
}

export function createValidator(schema: object): EventValidator {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  return (parsed, ctx) => {
    if (validate(parsed)) return;
    const errs = formatErrors(validate.errors);
    const id = extractId(parsed);
    const idPart = id ? ` (id=${id})` : "";
    throw new Error(
      `invalid event at ${ctx.file}:${ctx.line}${idPart}: ${errs}`
    );
  };
}

function extractId(x: unknown): string | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  return typeof o.id === "string" ? o.id : null;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  if (!errors || errors.length === 0) return "unknown validation error";
  return errors
    .map((e) => {
      const where = e.instancePath || "/";
      return `${where} ${e.message ?? "invalid"}`;
    })
    .join("; ");
}
