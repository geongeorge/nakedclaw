import { createHash, randomBytes } from "crypto";

export type OAuthConfig = {
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
};

// --- ADDED: OpenRouter Configuration ---
export const OPENROUTER_CONFIG = {
  baseUrl: "https://openrouter.ai/api/v1",
  siteUrl: "http://localhost:3000", // Required by OpenRouter for rankings
  siteName: "NakedClaw",
};

export const ANTHROPIC_OAUTH: OAuthConfig = {
  clientId: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  authUrl: "https://claude.ai/oauth/authorize",
  tokenUrl: "https://console.anthropic.com/v1/oauth/token",
  redirectUri: "https://console.anthropic.com/oauth/code/callback",
  scopes: ["user:inference", "user:profile"],
};

export type OAuthTokens = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
};

// --- ADDED: Ollama Detection Utility ---
/**
 * Detects local Ollama instance and returns available models.
 */
export async function detectLocalOllama(): Promise<string[]> {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    if (!response.ok) return [];
    const data = (await response.json()) as { models: { name: string }[] };
    return data.models.map((m) => m.name);
  } catch (e) {
    return []; // Ollama not running
  }
}

function base64url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

function generateCodeChallenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier).digest();
  return base64url(hash);
}

export function buildAuthorizationUrl(config: OAuthConfig = ANTHROPIC_OAUTH): {
  url: string;
  codeVerifier: string;
  state: string;
} {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);
  const state = base64url(randomBytes(16));

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
  });

  return {
    url: `${config.authUrl}?${params.toString()}`,
    codeVerifier,
    state,
  };
}

export function parseAuthInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim();

  if (trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (code) return { code, state: state ?? undefined };
    } catch {}
  }

  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#", 2);
    if (code && state) return { code, state };
  }

  return { code: trimmed };
}

export async function exchangeCodeForTokens(
  code: string,
  codeVerifier: string,
  state?: string,
  config: OAuthConfig = ANTHROPIC_OAUTH
): Promise<OAuthTokens> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  };
  if (state) body.state = state;

  const response = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OAuth token exchange failed (${response.status}): ${err}`);
  }

  const data = (await response.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
  };
}

/**
 * Enhanced OAuth flow with OpenRouter support and Ollama fallback detection.
 */
export async function startOAuthFlow(
  config: OAuthConfig = ANTHROPIC_OAUTH
): Promise<OAuthTokens | { localModel: string } | { openRouterKey: string }> {
  
  // --- ADDED: Check for Local Fallbacks First ---
  const localModels = await detectLocalOllama();
  if (localModels.length > 0) {
    console.log("\n[Detected Local Ollama Models]");
    localModels.forEach((m, i) => console.log(`  [L${i}] ${m}`));
    console.log("  [O] Use OpenRouter instead");
    console.log("  [C] Continue with Anthropic OAuth");
    
    process.stdout.write("\nSelect a local model index, 'O' for OpenRouter, or 'C' for Anthropic: ");
    for await (const line of console) {
      const choice = line.trim().toUpperCase();
      if (choice === 'C') break; 
      if (choice === 'O') {
        process.stdout.write("Enter your OpenRouter API Key: ");
        for await (const key of console) return { openRouterKey: key.trim() };
      }
      const idx = parseInt(choice.replace('L', ''));
      if (!isNaN(idx) && localModels[idx]) {
        return { localModel: localModels[idx] };
      }
      break;
    }
  }

  const { url, codeVerifier } = buildAuthorizationUrl(config);

  console.log("\nOpening browser for Anthropic authorization...\n");
  console.log(`If the browser doesn't open, visit:\n${url}\n`);

  try {
    Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {}

  process.stdout.write("Paste the code (or code#state token) here: ");
  let raw = "";
  for await (const line of console) {
    raw = line.trim();
    break;
  }

  if (!raw) {
    throw new Error("No authorization code provided");
  }

  const parsed = parseAuthInput(raw);
  console.log("\nExchanging code for tokens...");
  return exchangeCodeForTokens(parsed.code, codeVerifier, parsed.state, config);
}