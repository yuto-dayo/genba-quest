/**
 * Generate Gmail OAuth refresh token for local setup.
 *
 * Usage:
 *   npx ts-node src/scripts/generate-gmail-refresh-token.ts
 */

import "dotenv/config";
import { google } from "googleapis";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.metadata",
];

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET が必要です。");
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    "urn:ietf:wg:oauth:2.0:oob",
  );

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });

  console.log("==========================================");
  console.log("Gmail Refresh Token Generator");
  console.log("==========================================\n");
  console.log("1) Open this URL in your browser:");
  console.log(authUrl);
  console.log("\n2) Complete consent and copy the authorization code.\n");

  const rl = readline.createInterface({ input, output });
  try {
    const code = (await rl.question("Paste authorization code: ")).trim();
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
    console.log(`GOOGLE_REFRESH_TOKEN=${refreshToken}`);
  } finally {
    rl.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`❌ Failed to generate refresh token: ${message}`);
  process.exit(1);
});
