import {
  ensureStateDir,
  loadAllCredentials,
  saveProviderCredential,
  removeProviderCredential,
  type CredentialsStore,
} from "../auth/credentials.ts";
import { ANTHROPIC_OAUTH } from "../auth/oauth.ts";
import { loginOpenAICodex } from "@mariozechner/pi-ai";
import { createInterface } from "readline";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(msg: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(msg, (answer) => resolve(answer.trim()));
  });
}

const METHOD_LABELS: Record<string, string> = {
  api_key: "API key",
  oauth: "OAuth",
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
};

function showSavedCredentials(store: CredentialsStore): void {
  const providers = Object.keys(store);
  if (providers.length === 0) {
    console.log(`${DIM}No saved credentials.${RESET}\n`);
    return;
  }

  console.log("Saved credentials:\n");
  for (const provider of providers) {
    const cred = store[provider]!;
    const label = PROVIDER_LABELS[provider] || provider;
    let methodLabel = METHOD_LABELS[cred.method] || cred.method;
    if (cred.method === "oauth" && "openaiCodex" in cred) {
      methodLabel = "OAuth (Codex)";
    }
    console.log(`  ${BOLD}${label}${RESET}  ${DIM}— ${methodLabel}${RESET}`);
  }
  console.log();
}

async function addAnthropicSetupToken(): Promise<void> {
  console.log(
    `\n${YELLOW}Run ${BOLD}claude setup-token${RESET}${YELLOW} in another terminal, then paste the token here.${RESET}\n`
  );
  const token = await prompt("Setup token: ");
  if (!token) {
    console.log("No token provided.");
    return;
  }

  try {
    const parsed = JSON.parse(token);
    saveProviderCredential("anthropic", {
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
    console.log(`${GREEN}Anthropic OAuth credentials saved.${RESET}`);
  } catch {
    if (token.startsWith("sk-ant-oat")) {
      saveProviderCredential("anthropic", {
        method: "oauth",
        oauth: {
          accessToken: token,
          refreshToken: "",
          expiresAt: Date.now() + 8 * 60 * 60 * 1000,
          clientId: ANTHROPIC_OAUTH.clientId,
          tokenUrl: ANTHROPIC_OAUTH.tokenUrl,
        },
      });
      console.log(
        `${GREEN}Access token saved.${RESET} ${DIM}(no refresh token — re-run setup when it expires)${RESET}`
      );
    } else {
      console.log("Unrecognized token format.");
    }
  }
}

async function addAnthropicApiKey(): Promise<void> {
  const key = await prompt("\nAnthropic API Key: ");
  if (!key) {
    console.log("No key provided.");
    return;
  }
  saveProviderCredential("anthropic", { method: "api_key", apiKey: key });
  console.log(`${GREEN}Anthropic API key saved.${RESET}`);
}

async function addOpenAIApiKey(): Promise<void> {
  const key = await prompt("\nOpenAI API Key: ");
  if (!key) {
    console.log("No key provided.");
    return;
  }
  saveProviderCredential("openai", { method: "api_key", apiKey: key });
  console.log(`${GREEN}OpenAI API key saved.${RESET}`);
}

async function addOpenAICodex(): Promise<void> {
  console.log(`\n${YELLOW}Logging in with OpenAI Codex (ChatGPT subscription)...${RESET}\n`);

  try {
    const result = await loginOpenAICodex({
      onAuth: ({ url, instructions }) => {
        console.log(instructions || "Open the following URL to authenticate:");
        console.log(`\n  ${CYAN}${url}${RESET}\n`);
        try {
          Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
        } catch {}
      },
      onPrompt: async ({ message }) => {
        return await prompt(message || "Paste the code: ");
      },
    });

    saveProviderCredential("openai-codex", {
      method: "oauth",
      openaiCodex: {
        access: result.access,
        refresh: result.refresh,
        expires: result.expires,
        accountId: (result as any).accountId || "",
      },
    });
    console.log(`${GREEN}OpenAI Codex credentials saved.${RESET}`);
  } catch (err: any) {
    console.error(`${RED}Codex login failed:${RESET} ${err.message}`);
  }
}

async function deleteCredential(store: CredentialsStore): Promise<void> {
  const providers = Object.keys(store);
  if (providers.length === 0) {
    console.log("\nNo credentials to delete.");
    return;
  }

  console.log("\nWhich credential to delete?\n");
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const label = PROVIDER_LABELS[p] || p;
    console.log(`  ${BOLD}[${i + 1}]${RESET} ${label}`);
  }
  console.log();

  const choice = await prompt("Choice (number): ");
  const idx = parseInt(choice, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= providers.length) {
    console.log("Invalid choice.");
    return;
  }

  const provider = providers[idx]!;
  const label = PROVIDER_LABELS[provider] || provider;
  removeProviderCredential(provider);
  console.log(`${GREEN}Removed ${label} credentials.${RESET}`);
}

async function main() {
  console.log(`\n${BOLD}${CYAN}NakedClaw Setup${RESET}\n`);

  ensureStateDir();

  // Main loop — keep showing the menu until user quits
  while (true) {
    const store = loadAllCredentials();
    showSavedCredentials(store);

    console.log(`  ${BOLD}[1]${RESET} Add Anthropic ${GREEN}(setup token)${RESET}`);
    console.log(`  ${BOLD}[2]${RESET} Add Anthropic ${DIM}(API key)${RESET}`);
    console.log(`  ${BOLD}[3]${RESET} Add OpenAI ${DIM}(API key)${RESET}`);
    console.log(`  ${BOLD}[4]${RESET} Add OpenAI Codex ${DIM}(ChatGPT subscription)${RESET}`);
    if (Object.keys(store).length > 0) {
      console.log(`  ${BOLD}[d]${RESET} Delete a credential`);
    }
    console.log(`  ${BOLD}[q]${RESET} Done`);
    console.log();

    const choice = await prompt("Choice: ");

    if (choice === "1") {
      await addAnthropicSetupToken();
    } else if (choice === "2") {
      await addAnthropicApiKey();
    } else if (choice === "3") {
      await addOpenAIApiKey();
    } else if (choice === "4") {
      await addOpenAICodex();
    } else if (choice.toLowerCase() === "d" && Object.keys(store).length > 0) {
      await deleteCredential(store);
    } else if (choice.toLowerCase() === "q") {
      break;
    } else {
      console.log("Invalid choice.\n");
      continue;
    }

    console.log(); // blank line before next iteration
  }

  const final = loadAllCredentials();
  if (Object.keys(final).length > 0) {
    console.log(`
${BOLD}Setup complete!${RESET}

${CYAN}Next steps:${RESET}
  1. Pick a model:      ${CYAN}nakedclaw models${RESET}
  2. Start the daemon:  ${CYAN}nakedclaw start${RESET}
  3. Chat:              ${CYAN}nakedclaw${RESET}
`);
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
});
