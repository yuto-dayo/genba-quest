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
