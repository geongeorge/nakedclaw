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
  openrouter: "OpenRouter (FREE models only)",
  ollama: "Ollama (Local)",
};

/** Hardcoded FREE OpenRouter models (as requested) */
const FREE_OPENROUTER_MODELS: string[] = [
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",   // Venice: Uncensored (free)
  "google/gemma-3n-e2b-it:free",                                   // Google: Gemma 3n 2B (free)
  "google/gemma-3n-e4b-it:free",                                   // Google: Gemma 3n 4B (free)
  "google/gemma-3-4b-it:free",                                     // Google: Gemma 3 4B (free)
  "google/gemma-3-12b-it:free",                                    // Google: Gemma 3 12B (free)
  "google/gemma-3-27b-it:free",                                    // Google: Gemma 3 27B (free)
  "meta-llama/llama-3.3-70b-instruct:free",                        // Meta: Llama 3.3 70B Instruct (free)
  "meta-llama/llama-3.2-3b-instruct:free",                         // Meta: Llama 3.2 3B Instruct (free)
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "openrouter/elephant-alpha",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "z-ai/glm-4.5-air:free",
  "qwen/qwen3-coder:free",
  "cognitivecomputations/dolphin-mistral-24b-venice-edition:free"                     // Nous: Hermes 3 405B Instruct (free)
];

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
  writeFileSync(CONFIG_PATH, JSON5.stringify(config, null, 2) + "\n", "utf-8");
}

function showCurrentModel(): void {
  const config = loadConfig();
  const provider = config.model.provider || "anthropic";
  const label = PROVIDER_LABELS[provider] || provider;
  console.log(`\n${DIM}Current model:${RESET} ${BOLD}${label}/${config.model.name}${RESET}\n`);
}

// ==================== HELPERS ====================

async function getOllamaModels(): Promise<string[]> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { timeout: 3000 });
    const data = await res.json();
    return data.models?.map((m: any) => m.name) || [];
  } catch {
    return [];
  }
}

async function ensureOllamaRunning(): Promise<void> {
  try {
    await fetch("http://localhost:11434/api/version", { timeout: 2000 });
    return;
  } catch {}

  console.log(`${YELLOW}Ollama not running. Starting it automatically...${RESET}`);
  
  try {
    const proc = Bun.spawn(["ollama", "serve"], {
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });
    proc.unref();
    await new Promise((r) => setTimeout(r, 4000));
  } catch {
    console.log(`${YELLOW}Failed to auto-start Ollama. Make sure Ollama is installed.${RESET}`);
  }
}

// ==================== MAIN FUNCTIONS ====================

async function setModel(spec: string): Promise<void> {
  const slash = spec.indexOf("/");
  if (slash === -1) {
    console.error(`Invalid format. Use: ${CYAN}nakedclaw models set <provider>/<model>${RESET}`);
    process.exit(1);
  }
  const provider = spec.slice(0, slash);
  const name = spec.slice(slash + 1);

  if (!["anthropic", "openai", "openai-codex", "openrouter", "ollama"].includes(provider)) {
    console.error(`Unknown provider: ${provider}`);
    console.error(`Available: anthropic, openai, openai-codex, openrouter, ollama`);
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

  // Step 1: Pick provider (OpenRouter is now first - cloud-first)
  const providers = ["openrouter", "ollama", "anthropic", "openai", "openai-codex"];
  console.log("Select a provider:\n");

  for (let i = 0; i < providers.length; i++) {
    const p = providers[i]!;
    const label = PROVIDER_LABELS[p] || p;
    const marker = p === currentProvider ? ` ${GREEN}(current)${RESET}` : "";
    console.log(` ${BOLD}[${i + 1}]${RESET} ${label}${marker}`);
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

  // Step 2: Load models
  let models: string[] = [];

  if (selectedProvider === "openrouter") {
    console.log("✅ Loading curated FREE OpenRouter models...");
    models = [...FREE_OPENROUTER_MODELS];   // Your exact list
  } else if (selectedProvider === "ollama") {
    console.log("🔍 Detecting local Ollama models...");
    models = await getOllamaModels();

    if (models.length === 0) {
      await ensureOllamaRunning();
      models = await getOllamaModels();
    }

    if (models.length === 0) {
      console.log(`${YELLOW}No Ollama models found. Pull one first: ollama pull llama3.2${RESET}`);
      rl.close();
      return;
    }
  } else {
    models = MODELS[selectedProvider] || [];
  }

  if (models.length === 0) {
    console.log(`${YELLOW}No models available for this provider.${RESET}`);
    rl.close();
    return;
  }

  // Step 3: Pick model
  console.log(`\n${PROVIDER_LABELS[selectedProvider] || selectedProvider} models:\n`);

  for (let i = 0; i < models.length; i++) {
    const m = models[i]!;
    const shortName = m.split("/").pop() || m;   // nicer display
    const marker = (m === currentModel && selectedProvider === currentProvider)
      ? ` ${GREEN}(current)${RESET}` : "";
    console.log(` ${BOLD}[${i + 1}]${RESET} ${shortName}${marker}   ${DIM}${m}${RESET}`);
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
  console.log(`${DIM}Restart the daemon: ${CYAN}nakedclaw restart${RESET}`);

  rl.close();
}

import { fetchFreeModels } from "../providers/openrouter.ts";
import { listModels as listOllamaModels } from "../providers/ollama.ts";
import { getApiKeyForProvider } from "../auth/credentials.ts";

export async function cmdModelsFree() {
  const key = (await getApiKeyForProvider("openrouter").catch(() => "")) || process.env.OPENROUTER_API_KEY;
  if (!key) return console.log(`${YELLOW}❌ Set OPENROUTER_API_KEY first${RESET}`);
  
  console.log(`${CYAN}🔍 Fetching free models from OpenRouter...${RESET}`);
  const models = await fetchFreeModels(key, true);
  console.log(`\n🆓 ${BOLD}${models.length}${RESET} FREE OpenRouter Models:\n`);
  models.slice(0, 15).forEach((m, i) => {
    console.log(` ${BOLD}[${i+1}]${RESET} ${GREEN}${m.id}${RESET}`);
    console.log(`     ${DIM}Context: ${m.context_length.toLocaleString()} | Released: ${m.released || "unknown"}${RESET}`);
  });
  if (models.length > 15) {
    console.log(`\n ${DIM}... and ${models.length - 15} more.${RESET}`);
  }
}

export async function cmdModelsOllama() {
  console.log(`${CYAN}🔍 Listing local Ollama models...${RESET}`);
  const models = await listOllamaModels();
  if (!models.length) return console.log(`${YELLOW}❌ No Ollama models found. Is Ollama running?${RESET}`);
  console.log(`\n🦙 ${BOLD}${models.length}${RESET} Local Ollama Models:\n`);
  models.forEach((m, i) => {
    console.log(` ${BOLD}[${i+1}]${RESET} ${GREEN}${m.name}${RESET} ${DIM}(${(m.size / (1024*1024*1024)).toFixed(2)} GB)${RESET}`);
  });
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
  } else if (sub === "free") {
    await cmdModelsFree();
  } else if (sub === "ollama") {
    await cmdModelsOllama();
  } else if (!sub) {
    await interactivePick();
  } else {
    console.error(`Unknown subcommand: ${sub}`);
    console.error(`Usage: ${CYAN}nakedclaw models${RESET} [set|free|ollama]`);
    process.exit(1);
  }
}