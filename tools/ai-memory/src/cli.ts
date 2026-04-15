#!/usr/bin/env node
import { resume } from "./resume";

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    printHelp();
    process.exit(cmd ? 0 : 1);
  }

  switch (cmd) {
    case "resume": {
      const bypassCache = rest.includes("--no-cache");
      const result = await resume({ bypassCache });
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      return;
    }
    default:
      process.stderr.write(`ai-memory: unknown command '${cmd}'\n`);
      printHelp();
      process.exit(1);
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      "ai-memory <command> [options]",
      "",
      "commands:",
      "  resume            print the single next action as JSON",
      "",
      "options:",
      "  --no-cache        bypass current.json; recompute from events.jsonl",
      "",
      "see ../../MEMORY_PROTOCOL.md for the full spec.",
      "",
    ].join("\n")
  );
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(`ai-memory: ${msg}\n`);
  process.exit(1);
});
