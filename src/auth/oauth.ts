import { createHash, randomBytes } from "crypto";

export type OAuthConfig = {
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
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

/**
 * Build the authorization URL and PKCE values.
 */
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

/**
 * Parse pasted input which can be:
 * - A raw authorization code
 * - A "code#state" token (OpenClaw-style callback page format)
 * - A full callback URL with ?code=...&state=... query params
 */
export function parseAuthInput(input: string): { code: string; state?: string } {
  const trimmed = input.trim();

  // Full callback URL: https://...?code=XXX&state=YYY
  if (trimmed.startsWith("http")) {
    try {
      const url = new URL(trimmed);
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (code) return { code, state: state ?? undefined };
    } catch {}
  }

  // code#state format
  if (trimmed.includes("#")) {
    const [code, state] = trimmed.split("#", 2);
    if (code && state) return { code, state };
  }

  // Raw code
  return { code: trimmed };
}

/**
 * Exchange an authorization code for tokens.
 */
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
 * Run the full OAuth flow:
 * 1. Build auth URL with PKCE
 * 2. Open browser
 * 3. Prompt user to paste the authorization code
 * 4. Exchange code for tokens
 */
export async function startOAuthFlow(
  config: OAuthConfig = ANTHROPIC_OAUTH
): Promise<OAuthTokens> {
  const { url, codeVerifier } = buildAuthorizationUrl(config);

  console.log("\nOpening browser for Anthropic authorization...\n");
  console.log(`If the browser doesn't open, visit:\n${url}\n`);

  // Open browser (macOS)
  try {
    Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
  } catch {
    // Non-fatal — user can copy the URL
  }

  // Prompt user to paste the code#state token or authorization code
  process.stdout.write(
    "Paste the code (or code#state token) here: "
  );
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
