import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { refreshOpenAICodexToken } from "@mariozechner/pi-ai";

export type OAuthCredentials = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  clientId: string;
  tokenUrl: string;
};

export type OpenAICodexCredentials = {
  access: string;
  refresh: string;
  expires: number; // epoch ms
  accountId: string;
};

/** A single provider's credential (the map key IS the provider) */
export type ProviderCredential =
  | { method: "api_key"; apiKey: string }
  | { method: "oauth"; oauth: OAuthCredentials }
  | { method: "oauth"; openaiCodex: OpenAICodexCredentials };

/** Map of provider → credential */
export type CredentialsStore = Record<string, ProviderCredential>;

/** @deprecated Use ProviderCredential instead */
export type Credentials =
  | { method: "api_key"; provider?: "anthropic"; apiKey: string }
  | { method: "api_key"; provider: "openai"; apiKey: string }
  | { method: "oauth"; provider?: "anthropic"; oauth: OAuthCredentials }
  | { method: "oauth"; provider: "openai-codex"; openaiCodex: OpenAICodexCredentials };

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

/** Detect old single-credential format (has `method` at top level) */
function isOldFormat(data: unknown): data is Credentials {
  return typeof data === "object" && data !== null && "method" in data;
}

/** Migrate old single-credential to the new multi-provider map */
function migrateOldCredentials(old: Credentials): CredentialsStore {
  const provider =
    "provider" in old && old.provider ? old.provider : "anthropic";

  // Strip the provider field — the key IS the provider now
  if ("apiKey" in old) {
    return { [provider]: { method: "api_key", apiKey: old.apiKey } };
  }
  if ("oauth" in old) {
    return { [provider]: { method: "oauth", oauth: old.oauth } };
  }
  if ("openaiCodex" in old) {
    return { [provider]: { method: "oauth", openaiCodex: old.openaiCodex } };
  }
  return {};
}

/** Load all provider credentials. Auto-migrates old single-credential format. */
export function loadAllCredentials(): CredentialsStore {
  if (!existsSync(CREDS_PATH)) return {};
  try {
    const raw = readFileSync(CREDS_PATH, "utf-8");
    const data = JSON.parse(raw);

    if (isOldFormat(data)) {
      const migrated = migrateOldCredentials(data);
      // Persist the migrated format
      ensureStateDir();
      writeFileSync(CREDS_PATH, JSON.stringify(migrated, null, 2), "utf-8");
      return migrated;
    }

    return data as CredentialsStore;
  } catch {
    return {};
  }
}

/** Save/update a single provider's credential */
export function saveProviderCredential(
  provider: string,
  cred: ProviderCredential
): void {
  ensureStateDir();
  const store = loadAllCredentials();
  store[provider] = cred;
  writeFileSync(CREDS_PATH, JSON.stringify(store, null, 2), "utf-8");
}

/** Remove a provider's credential */
export function removeProviderCredential(provider: string): void {
  const store = loadAllCredentials();
  delete store[provider];
  ensureStateDir();
  writeFileSync(CREDS_PATH, JSON.stringify(store, null, 2), "utf-8");
}

/** Refresh an Anthropic OAuth token if expired. Returns the (possibly refreshed) access token. */
async function refreshAnthropicIfNeeded(
  provider: string,
  oauth: OAuthCredentials
): Promise<string> {
  if (Date.now() < oauth.expiresAt - 5 * 60_000) {
    return oauth.accessToken;
  }

  console.log("[auth] Refreshing Anthropic OAuth token...");

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

  saveProviderCredential(provider, { method: "oauth", oauth: updated });
  return updated.accessToken;
}

/** Refresh an OpenAI Codex token if expired. Returns the (possibly refreshed) access token. */
async function refreshOpenAICodexIfNeeded(
  provider: string,
  codex: OpenAICodexCredentials
): Promise<string> {
  if (Date.now() < codex.expires - 5 * 60_000) {
    return codex.access;
  }

  console.log("[auth] Refreshing OpenAI Codex token...");

  const refreshed = await refreshOpenAICodexToken(codex.refresh);

  const updated: OpenAICodexCredentials = {
    access: refreshed.access,
    refresh: refreshed.refresh,
    expires: refreshed.expires,
    accountId: codex.accountId,
  };

  saveProviderCredential(provider, { method: "oauth", openaiCodex: updated });
  return updated.access;
}

/**
 * Get an API key for the given provider.
 * Checks env vars first, then stored credentials.
 * Automatically refreshes expired OAuth / Codex tokens.
 */
export async function getApiKeyForProvider(provider: string): Promise<string> {
  // Env vars take priority
  if (provider === "anthropic" || provider === "openai") {
    const envVar = provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
    const envKey = process.env[envVar];
    if (envKey) return envKey;
  }
  if (provider === "openai-codex") {
    const envKey = process.env.OPENAI_API_KEY;
    if (envKey) return envKey;
  }

  const store = loadAllCredentials();
  const cred = store[provider];

  if (!cred) {
    throw new Error(
      `No credentials for ${provider}. Run: nakedclaw setup`
    );
  }

  if (cred.method === "api_key") {
    return cred.apiKey;
  }

  // OAuth — Anthropic
  if ("oauth" in cred) {
    return refreshAnthropicIfNeeded(provider, cred.oauth);
  }

  // OAuth — OpenAI Codex
  if ("openaiCodex" in cred) {
    return refreshOpenAICodexIfNeeded(provider, cred.openaiCodex);
  }

  throw new Error("Invalid credential state. Run: nakedclaw setup");
}

/**
 * @deprecated Use getApiKeyForProvider() instead.
 * Get auth headers for the Anthropic API (backward compat).
 */
export async function getAuthHeaders(): Promise<Record<string, string>> {
  const key = await getApiKeyForProvider("anthropic");
  if (key.startsWith("sk-ant-oat")) {
    return {
      Authorization: `Bearer ${key}`,
      "anthropic-version": "2023-06-01",
    };
  }
  return {
    "x-api-key": key,
    "anthropic-version": "2023-06-01",
  };
}
