/**
 * Generate Google Drive OAuth refresh token for local setup.
 *
 * Usage:
 *   npx ts-node src/scripts/generate-drive-refresh-token.ts
 */

import "dotenv/config";
import { google } from "googleapis";
import { createServer, Server } from "http";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SCOPES = [
  "https://www.googleapis.com/auth/drive",
];

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveRedirectUri(): string {
  const explicit = normalizeString(process.env.GOOGLE_OAUTH_REDIRECT_URI);
  if (explicit) {
    return explicit;
  }

  const host = normalizeString(process.env.GOOGLE_OAUTH_REDIRECT_HOST) || "127.0.0.1";
  const portRaw = normalizeString(process.env.GOOGLE_OAUTH_REDIRECT_PORT) || "53682";
  const port = Number.parseInt(portRaw, 10);
  const safePort = Number.isFinite(port) && port > 0 ? port : 53682;
  return `http://${host}:${safePort}/oauth2callback`;
}

function parseCodeFromInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const url = new URL(trimmed);
      return normalizeString(url.searchParams.get("code"));
    } catch {
      return null;
    }
  }

  return trimmed;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function startAuthCodeListener(redirectUri: string): Promise<{ waitForCode: Promise<string>; close: () => Promise<void> } | null> {
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:") {
    return null;
  }

  if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
    return null;
  }

  const port = Number.parseInt(parsed.port, 10);
  if (!Number.isFinite(port) || port <= 0) {
    return null;
  }

  const pathname = parsed.pathname || "/";
  let captured = false;
  let serverRef: Server | null = null;
  let resolveCode: ((code: string) => void) | null = null;
  let rejectCode: ((error: unknown) => void) | null = null;
  const waitForCode = new Promise<string>((resolve, reject) => {
    resolveCode = resolve;
    rejectCode = reject;
  });

  const server = createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", `http://${req.headers.host || `${parsed.hostname}:${port}`}`);
    if (requestUrl.pathname !== pathname) {
      res.statusCode = 404;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Not Found");
      return;
    }

    const code = normalizeString(requestUrl.searchParams.get("code"));
    if (!code) {
      const error = normalizeString(requestUrl.searchParams.get("error")) || "code was not returned";
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end(`Authorization failed: ${error}`);
      rejectCode?.(new Error(`Authorization failed: ${error}`));
      return;
    }

    captured = true;
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end("<h1>Authorization received</h1><p>Return to terminal and continue setup.</p>");
    resolveCode?.(code);
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (error: unknown) => {
      reject(error);
    };
    server.once("error", onListenError);
    server.listen(port, parsed.hostname, () => {
      server.off("error", onListenError);
      resolve();
    });
  });

  server.on("error", (error) => {
    rejectCode?.(error);
  });
  serverRef = server;

  return {
    waitForCode,
    close: async () => {
      if (serverRef) {
        await closeServer(serverRef);
        serverRef = null;
      }
      if (captured) {
        console.log("Authorization callback captured from browser redirect.");
      }
    },
  };
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が必要です。");
    process.exit(1);
  }

  const redirectUri = resolveRedirectUri();
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri,
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("==========================================");
  console.log("Google Drive Refresh Token Generator");
  console.log("==========================================\n");
  console.log("1) Open this URL in your browser:");
  console.log(authUrl);
  console.log("\n2) Complete consent.");
  console.log(`3) Redirect URI: ${redirectUri}`);
  console.log("   If auto capture fails, paste the full redirected URL or authorization code.\n");

  const rl = readline.createInterface({ input, output });
  let listener: { waitForCode: Promise<string>; close: () => Promise<void> } | null = null;
  let listenerCodePromise: Promise<string | null> | null = null;
  try {
    try {
      listener = await startAuthCodeListener(redirectUri);
      if (listener) {
        listenerCodePromise = listener.waitForCode.catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[WARN] callback listener failed: ${message}`);
          return null;
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[WARN] callback listener unavailable: ${message}`);
    }

    const userInput = (await rl.question("Paste authorization code / redirect URL (Enter to wait for callback): ")).trim();
    let code = parseCodeFromInput(userInput);
    if (!code && listenerCodePromise) {
      console.log("Waiting for browser redirect callback...");
      code = await listenerCodePromise;
    }

    if (!code) {
      console.error("Authorization code is empty.");
      process.exit(1);
    }

    const { tokens } = await oauth2Client.getToken(code);
    const refreshToken = tokens.refresh_token;

    if (!refreshToken) {
      console.error("Refresh token was not returned. Use prompt=consent with a fresh consent flow.");
      process.exit(1);
    }

    console.log("\n✅ Refresh token generated.");
    console.log("Add this to server/.env:");
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${refreshToken}`);
    console.log("\nOptional: verify immediately with a lightweight Drive API call after setting GOOGLE_DRIVE_ROOT_FOLDER_ID.");
  } finally {
    if (listener) {
      await listener.close();
    }
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Failed to generate refresh token: ${message}`);
  process.exit(1);
});
