import {
  ensureStateDir,
  saveCredentials,
  loadCredentials,
} from "../auth/credentials.ts";
import { ANTHROPIC_OAUTH } from "../auth/oauth.ts";
import { createInterface } from "readline";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(msg: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(msg, (answer) => resolve(answer.trim()));
  });
}

async function main() {
  console.log(`\n${BOLD}${CYAN}NakedClaw Setup${RESET}\n`);

  ensureStateDir();

  // Check existing credentials
  const existing = loadCredentials();
  if (existing) {
    console.log(
      `${DIM}Existing credentials found (${existing.method}).${RESET}`
    );
    const overwrite = await prompt("Overwrite? (y/N): ");
    if (overwrite.toLowerCase() !== "y") {
      console.log("Keeping existing credentials.");
      rl.close();
      return;
    }
  }

  // Auth method selection
  console.log("How would you like to authenticate with Anthropic?\n");
  console.log(
    `  ${BOLD}[1]${RESET} Setup token ${GREEN}(recommended)${RESET} — paste from ${CYAN}claude setup-token${RESET}`
  );
  console.log(`  ${BOLD}[2]${RESET} API Key — paste your key`);
  console.log();

  const choice = await prompt("Choice (1/2): ");

  if (choice === "1") {
    console.log(
      `\n${YELLOW}Run ${BOLD}claude setup-token${RESET}${YELLOW} in another terminal, then paste the token here.${RESET}\n`
    );
    const token = await prompt("Setup token: ");
    if (!token) {
      console.log("No token provided. Aborting.");
      rl.close();
      return;
    }

    // The setup-token is a JSON blob containing accessToken, refreshToken, expiresAt
    // It could also just be a raw OAuth access token (sk-ant-oat01-...)
    try {
      const parsed = JSON.parse(token);
      // Full credentials object from claude setup-token
      saveCredentials({
        method: "oauth",
        oauth: {
          accessToken: parsed.accessToken || parsed.access_token,
          refreshToken: parsed.refreshToken || parsed.refresh_token,
          expiresAt:
            parsed.expiresAt ||
            (parsed.expires_in
              ? Date.now() + parsed.expires_in * 1000
              : Date.now() + 8 * 60 * 60 * 1000),
          clientId: ANTHROPIC_OAUTH.clientId,
          tokenUrl: ANTHROPIC_OAUTH.tokenUrl,
        },
      });
      console.log(`\n${GREEN}OAuth credentials saved from setup-token.${RESET}`);
    } catch {
      // Not JSON — treat as raw access token
      if (token.startsWith("sk-ant-oat")) {
        saveCredentials({
          method: "oauth",
          oauth: {
            accessToken: token,
            refreshToken: "",
            expiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 hours default
            clientId: ANTHROPIC_OAUTH.clientId,
            tokenUrl: ANTHROPIC_OAUTH.tokenUrl,
          },
        });
        console.log(
          `\n${GREEN}Access token saved.${RESET} ${DIM}(no refresh token — re-run setup when it expires)${RESET}`
        );
      } else {
        console.log("Unrecognized token format. Aborting.");
        rl.close();
        return;
      }
    }
  } else {
    const key = await prompt("Anthropic API Key: ");
    if (!key) {
      console.log("No key provided. Aborting.");
      rl.close();
      return;
    }
    saveCredentials({ method: "api_key", apiKey: key });
    console.log(`\n${GREEN}API key saved.${RESET}`);
  }

  console.log(`
${BOLD}Setup complete!${RESET}

${CYAN}Next steps:${RESET}
  1. Edit ${BOLD}nakedclaw.json5${RESET} to enable channels (telegram, whatsapp, slack)
  2. Set channel env vars (TELEGRAM_BOT_TOKEN, etc.)
  3. Start the daemon:  ${CYAN}nakedclaw start${RESET}
  4. Chat:              ${CYAN}nakedclaw${RESET}
`);

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
});
