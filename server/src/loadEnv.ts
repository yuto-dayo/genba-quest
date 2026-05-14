import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const PLACEHOLDER_PATTERN = /^your_.*_here$/i;
const ENV_PATH_CANDIDATES = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "server/.env"),
    path.resolve(__dirname, "../.env"),
    path.resolve(__dirname, "../../.env"),
    path.resolve(__dirname, "../../server/.env"),
];

const resolvedEnvPath = ENV_PATH_CANDIDATES.find((candidate) => fs.existsSync(candidate));
const fallbackEnvPath = path.resolve(__dirname, "../.env");
const dotenvPath = resolvedEnvPath || fallbackEnvPath;

const dotenvResult = dotenv.config({ path: dotenvPath });

if (dotenvResult.error && process.env.NODE_ENV !== "test") {
    console.warn(
        `[ENV] Could not load ${dotenvPath}. Falling back to process environment only.`
    );
}

function isHostedSupabaseUrl(value: string | undefined): boolean {
    if (!value) {
        return false;
    }

    try {
        return new URL(value).hostname.endsWith(".supabase.co");
    } catch {
        return false;
    }
}

if (
    process.env.NODE_ENV !== "test"
    && process.env.NODE_ENV !== "production"
    && process.env.DEV_SKIP_AUTH === "true"
    && isHostedSupabaseUrl(process.env.SUPABASE_URL)
) {
    throw new Error(
        "Unsafe dev auth configuration: DEV_SKIP_AUTH=true cannot be used with hosted Supabase. Use local Supabase (http://127.0.0.1:54321) for development auth."
    );
}

for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string" && PLACEHOLDER_PATTERN.test(value.trim())) {
        console.warn(`[ENV] ${key} is still set to the .env.example placeholder`);
    }
}

if (process.env.NODE_ENV !== "test" && !resolvedEnvPath) {
    console.warn(
        `[ENV] .env file not found in expected locations (${ENV_PATH_CANDIDATES.join(", ")}). Create server/.env from server/.env.example if needed.`
    );
}
