/**
 * Beta MVP release gate for the Money-led Proposal approval flow.
 *
 * This intentionally does not repair remote migration history. If the linked
 * migration list shows 20260504084000 pending before later applied versions,
 * run an explicit `supabase migration repair` only after human review.
 */

import "dotenv/config";
import { existsSync, readdirSync } from "fs";
import { spawnSync } from "child_process";
import { join } from "path";

type CheckStatus = "PASS" | "FAIL" | "WARN";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const REQUIRED_MIGRATIONS = [
  "20260504084000_seed_accounting_master_data.sql",
  "20260504085000_add_reward_snapshot_tables.sql",
  "20260504090000_add_site_complete_with_close_attempts.sql",
];

const STRICT_FALLBACK_MODES = new Set(["disabled", "deny", "off"]);

function pass(name: string, detail: string): CheckResult {
  return { name, status: "PASS", detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "FAIL", detail };
}

function warn(name: string, detail: string): CheckResult {
  return { name, status: "WARN", detail };
}

function repoRoot(): string {
  return join(__dirname, "../../..");
}

function checkStrictMode(): CheckResult {
  const mode = (process.env.PROPOSAL_RPC_FALLBACK_MODE || "").toLowerCase();
  if (STRICT_FALLBACK_MODES.has(mode)) {
    return pass("proposal_rpc_strict_mode", `PROPOSAL_RPC_FALLBACK_MODE=${mode}`);
  }
  return fail(
    "proposal_rpc_strict_mode",
    `set PROPOSAL_RPC_FALLBACK_MODE=disabled before beta MVP verification (current: ${mode || "unset"})`,
  );
}

function checkLocalMigrationOrder(): CheckResult {
  const migrationsDir = join(repoRoot(), "supabase/migrations");
  if (!existsSync(migrationsDir)) {
    return fail("local_migration_order", "supabase/migrations directory is missing");
  }

  const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();
  const missing = REQUIRED_MIGRATIONS.filter((file) => !files.includes(file));
  if (missing.length > 0) {
    return fail("local_migration_order", `missing migration(s): ${missing.join(", ")}`);
  }

  const indexes = REQUIRED_MIGRATIONS.map((file) => files.indexOf(file));
  const ordered = indexes.every((index, i) => i === 0 || indexes[i - 1] < index);
  if (!ordered) {
    return fail(
      "local_migration_order",
      `expected order: ${REQUIRED_MIGRATIONS.join(" -> ")}`,
    );
  }

  return pass("local_migration_order", REQUIRED_MIGRATIONS.join(" -> "));
}

function runSupabaseCommand(name: string, args: string[]): CheckResult {
  const result = spawnSync("supabase", args, {
    cwd: repoRoot(),
    env: process.env,
    encoding: "utf8",
  });

  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  if (result.status === 0) {
    return pass(name, output.split("\n").slice(-3).join(" | ") || "command passed");
  }

  return fail(
    name,
    output || `command failed with status ${result.status ?? "unknown"}`,
  );
}

function checkLinkedDbGates(): CheckResult[] {
  if (!process.env.SUPABASE_DB_PASSWORD) {
    return [
      fail(
        "linked_db_credentials",
        "SUPABASE_DB_PASSWORD is required for beta MVP linked migration/lint gates",
      ),
    ];
  }

  return [
    pass("linked_db_credentials", "SUPABASE_DB_PASSWORD is set"),
    runSupabaseCommand("linked_migration_list", ["migration", "list"]),
    runSupabaseCommand("linked_schema_lint", [
      "db",
      "lint",
      "--linked",
      "--schema",
      "public,private",
      "--fail-on",
      "error",
    ]),
  ];
}

function checkSupabaseLinkState(): CheckResult {
  const projectRefPath = join(repoRoot(), "supabase/.temp/project-ref");
  if (!existsSync(projectRefPath)) {
    return warn(
      "supabase_link_state",
      "supabase/.temp/project-ref is missing; run `supabase link --project-ref <ref>` before linked gates",
    );
  }
  return pass("supabase_link_state", "linked project state is present");
}

function main() {
  const results: CheckResult[] = [
    checkStrictMode(),
    checkLocalMigrationOrder(),
    checkSupabaseLinkState(),
    ...checkLinkedDbGates(),
  ];

  console.log("=== GENBA QUEST beta MVP gate ===");
  for (const result of results) {
    console.log(`[${result.status}] ${result.name}: ${result.detail}`);
  }

  const failures = results.filter((result) => result.status === "FAIL");
  if (failures.length > 0) {
    console.error(`\nBeta MVP gate failed (${failures.length} check(s)).`);
    process.exit(1);
  }

  console.log("\nBeta MVP gate passed.");
}

main();
