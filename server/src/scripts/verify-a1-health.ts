/**
 * A-1 strict health verification helper.
 *
 * Usage:
 *   npm run verify:a1-health -- --stg-url https://stg.example.com --prod-url https://prod.example.com
 *
 * Or with env vars:
 *   A1_HEALTH_STG_URL=https://stg.example.com A1_HEALTH_PROD_URL=https://prod.example.com npm run verify:a1-health
 */

type CheckStatus = "PASS" | "FAIL";

interface CheckResult {
  target: string;
  status: CheckStatus;
  detail: string;
}

const STRICT_MODES = new Set(["disabled", "deny", "off"]);

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }

    result[key] = value;
    i += 1;
  }

  return result;
}

function normalizeHealthUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/health")) {
    return trimmed;
  }
  return `${trimmed}/health`;
}

async function fetchHealth(target: string, endpoint: string): Promise<CheckResult> {
  const healthUrl = normalizeHealthUrl(endpoint);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(healthUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        target,
        status: "FAIL",
        detail: `HTTP ${response.status} from ${healthUrl}`,
      };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return {
        target,
        status: "FAIL",
        detail: `non-JSON response from ${healthUrl}`,
      };
    }

    if (typeof body !== "object" || body === null) {
      return {
        target,
        status: "FAIL",
        detail: `invalid JSON object from ${healthUrl}`,
      };
    }

    const payload = body as Record<string, unknown>;
    const ok = payload.ok === true;
    const strict = payload.proposal_atomic_strict === true;
    const mode = String(payload.proposal_rpc_fallback_mode ?? "").toLowerCase();

    if (!ok) {
      return {
        target,
        status: "FAIL",
        detail: `ok flag is not true at ${healthUrl}`,
      };
    }

    if (!strict) {
      return {
        target,
        status: "FAIL",
        detail: `proposal_atomic_strict is not true at ${healthUrl}`,
      };
    }

    if (!STRICT_MODES.has(mode)) {
      return {
        target,
        status: "FAIL",
        detail: `proposal_rpc_fallback_mode is '${mode || "undefined"}' at ${healthUrl}`,
      };
    }

    return {
      target,
      status: "PASS",
      detail: `strict=${strict}, mode=${mode}, url=${healthUrl}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      target,
      status: "FAIL",
      detail: `request failed for ${healthUrl}: ${message}`,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getTargetUrls() {
  const args = parseArgs(process.argv.slice(2));

  const stgUrl =
    args["stg-url"] ||
    process.env.A1_HEALTH_STG_URL ||
    process.env.STG_SERVER_URL;
  const prodUrl =
    args["prod-url"] ||
    process.env.A1_HEALTH_PROD_URL ||
    process.env.PROD_SERVER_URL;

  return { stgUrl, prodUrl };
}

function printUsageAndExit(): never {
  console.error("A-1 health verification requires target URLs.");
  console.error("Set env vars A1_HEALTH_STG_URL / A1_HEALTH_PROD_URL,");
  console.error("or pass --stg-url <url> --prod-url <url>.");
  process.exit(1);
}

async function main() {
  const { stgUrl, prodUrl } = getTargetUrls();
  const checks: Array<Promise<CheckResult>> = [];

  if (stgUrl) {
    checks.push(fetchHealth("stg", stgUrl));
  }
  if (prodUrl) {
    checks.push(fetchHealth("prod", prodUrl));
  }

  if (checks.length === 0) {
    printUsageAndExit();
  }

  const results = await Promise.all(checks);

  console.log("=== A-1 strict health verification ===");
  for (const result of results) {
    console.log(`[${result.status}] ${result.target} - ${result.detail}`);
  }

  const failures = results.filter((result) => result.status === "FAIL");
  if (failures.length > 0) {
    console.error(`\nA-1 health verification failed (${failures.length} target(s)).`);
    process.exit(1);
  }

  console.log("\nAll checks passed.");
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Unexpected failure:", message);
  process.exit(1);
});
