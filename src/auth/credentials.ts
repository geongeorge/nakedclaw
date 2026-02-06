import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export type OAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  clientId: string;
  tokenUrl: string;
};

export type Credentials =
  | { method: "api_key"; apiKey: string }
  | { method: "oauth"; oauth: OAuthCredentials };

const STATE_DIR = join(homedir(), ".nakedclaw");
const CREDS_PATH = join(STATE_DIR, "credentials.json");

export function getStateDir(): string {
  return STATE_DIR;
}

export function ensureStateDir(): void {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
  const logsDir = join(STATE_DIR, "logs");
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }
}

export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    const raw = readFileSync(CREDS_PATH, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureStateDir();
  writeFileSync(CREDS_PATH, JSON.stringify(creds, null, 2), "utf-8");
}

/** Refresh an OAuth token if expired. Returns the (possibly refreshed) access token. */
async function refreshIfNeeded(oauth: OAuthCredentials): Promise<string> {
  // 5 minute buffer before expiry
  if (Date.now() < oauth.expiresAt - 5 * 60_000) {
    return oauth.accessToken;
  }

  console.log("[auth] Refreshing OAuth token...");

  const response = await fetch(oauth.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: oauth.clientId,
      refresh_token: oauth.refreshToken,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OAuth token refresh failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  const updated: OAuthCredentials = {
    ...oauth,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || oauth.refreshToken,
    expiresAt: Date.now() + data.expires_in * 1000,
  };

  // Persist refreshed tokens
  saveCredentials({ method: "oauth", oauth: updated });

  return updated.accessToken;
}

/**
 * Get auth headers for the Anthropic API.
 * Supports both API key and OAuth token.
 * Automatically refreshes expired OAuth tokens.
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  // Env var takes priority
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) {
    return {
      "x-api-key": envKey,
      "anthropic-version": "2023-06-01",
    };
  }

  const creds = loadCredentials();
  if (!creds) {
    throw new Error("No credentials configured. Run: nakedclaw setup");
  }

  if (creds.method === "api_key") {
    return {
      "x-api-key": creds.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }

  // OAuth
  const token = await refreshIfNeeded(creds.oauth);
  return {
    Authorization: `Bearer ${token}`,
    "anthropic-version": "2023-06-01",
  };
}
