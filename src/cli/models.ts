import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { createInterface } from "readline";
import JSON5 from "json5";
import { loadConfig } from "../config.ts";
import { loadAllCredentials } from "../auth/credentials.ts";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const CONFIG_PATH = resolve(import.meta.dir, "..", "..", "nakedclaw.json5");

/** Curated model lists per provider */
export const MODELS: Record<string, string[]> = {
  anthropic: [
    "claude-opus-4-6",
    "claude-sonnet-4-5",
    "claude-haiku-4-5",
    "claude-opus-4-0",
    "claude-sonnet-4-0",
  ],
  openai: [
    "gpt-5.3-codex",
    "gpt-5.2",
    "gpt-5",
    "gpt-5-mini",
    "gpt-4o",
    "gpt-4o-mini",
    "o4-mini",
    "o3",
  ],
  "openai-codex": [
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.1-codex-max",
  ],
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
};

function warnIfNoCredential(provider: string): void {
  const store = loadAllCredentials();
  if (!store[provider]) {
    const label = PROVIDER_LABELS[provider] || provider;
    console.log(`${YELLOW}No credentials for ${label}. Run: ${CYAN}nakedclaw setup${RESET}`);
  }
}

export function updateConfigModel(provider: string, name: string): void {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  const config = JSON5.parse(raw);
  config.model = { provider, name };

  // Write back as JSON5-ish (use JSON with 2-space indent — JSON is valid JSON5)
  writeFileSync(CONFIG_PATH, JSON5.stringify(config, null, 2) + "\n", "utf-8");
}

function showCurrentModel(): void {
  const config = loadConfig();
  const provider = config.model.provider || "anthropic";
  const label = PROVIDER_LABELS[provider] || provider;
  console.log(`\n${DIM}Current model:${RESET} ${BOLD}${label}/${config.model.name}${RESET}\n`);
}

async function setModel(spec: string): Promise<void> {
  const slash = spec.indexOf("/");
  if (slash === -1) {
    console.error(`Invalid format. Use: ${CYAN}nakedclaw models set <provider>/<model>${RESET}`);
    console.error(`Example: ${CYAN}nakedclaw models set openai/gpt-5${RESET}`);
    process.exit(1);
  }

  const provider = spec.slice(0, slash);
  const name = spec.slice(slash + 1);

  if (!MODELS[provider]) {
    console.error(`Unknown provider: ${provider}`);
    console.error(`Available: ${Object.keys(MODELS).join(", ")}`);
    process.exit(1);
  }

  updateConfigModel(provider, name);
  const label = PROVIDER_LABELS[provider] || provider;
  console.log(`${GREEN}Model set to ${BOLD}${label}/${name}${RESET}`);
  warnIfNoCredential(provider);
}

async function interactivePick(): Promise<void> {
  const config = loadConfig();
  const currentProvider = config.model.provider || "anthropic";
  const currentModel = config.model.name;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (msg: string): Promise<string> =>
    new Promise((resolve) => rl.question(msg, (a) => resolve(a.trim())));

  showCurrentModel();

  // Step 1: Pick provider
  const providers = Object.keys(MODELS);
  console.log("Select a provider:\n");
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const label = PROVIDER_LABELS[p] || p;
    const marker = p === currentProvider ? ` ${GREEN}(current)${RESET}` : "";
    console.log(`  ${BOLD}[${i + 1}]${RESET} ${label}${marker}`);
  }
  console.log();

  const providerChoice = await prompt("Provider (number): ");
  const providerIdx = parseInt(providerChoice, 10) - 1;
  if (isNaN(providerIdx) || providerIdx < 0 || providerIdx >= providers.length) {
    console.log("Invalid choice.");
    rl.close();
    return;
  }

  const selectedProvider = providers[providerIdx]!;
  const models = MODELS[selectedProvider]!;

  // Step 2: Pick model
  console.log(`\n${PROVIDER_LABELS[selectedProvider] || selectedProvider} models:\n`);
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const marker = m === currentModel && selectedProvider === currentProvider
      ? ` ${GREEN}(current)${RESET}` : "";
    console.log(`  ${BOLD}[${i + 1}]${RESET} ${m}${marker}`);
  }
  console.log();

  const modelChoice = await prompt("Model (number): ");
  const modelIdx = parseInt(modelChoice, 10) - 1;
  if (isNaN(modelIdx) || modelIdx < 0 || modelIdx >= models.length) {
    console.log("Invalid choice.");
    rl.close();
    return;
  }

  const selectedModel = models[modelIdx]!;

  updateConfigModel(selectedProvider, selectedModel);
  const label = PROVIDER_LABELS[selectedProvider] || selectedProvider;
  console.log(`\n${GREEN}Model set to ${BOLD}${label}/${selectedModel}${RESET}`);
  warnIfNoCredential(selectedProvider);
  console.log(`${DIM}Restart the daemon for changes to take effect: ${CYAN}nakedclaw restart${RESET}`);

  rl.close();
}

export async function handleModelsCli(args: string[]): Promise<void> {
  const [sub, ...rest] = args;

  if (sub === "set") {
    const spec = rest[0];
    if (!spec) {
      console.error(`Usage: ${CYAN}nakedclaw models set <provider>/<model>${RESET}`);
      process.exit(1);
    }
    await setModel(spec);
  } else if (!sub) {
    await interactivePick();
  } else {
    console.error(`Unknown subcommand: ${sub}`);
    console.error(`Usage: ${CYAN}nakedclaw models${RESET} or ${CYAN}nakedclaw models set <provider>/<model>${RESET}`);
    process.exit(1);
  }
}

