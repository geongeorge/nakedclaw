import {
  ensureStateDir,
  loadAllCredentials,
  saveProviderCredential,
  removeProviderCredential,
  type CredentialsStore,
} from "../auth/credentials.ts";
import { loginOpenAICodex } from "@mariozechner/pi-ai";
import { createInterface } from "readline";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const DIM = "\x1b[2m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
// Add these to the top of src/agent.ts
const OPENROUTER_FREE_MODELS = [
  "qwen/qwen3-coder:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "google/gemma-3-27b-it:free",
  "openrouter/elephant-alpha"
];

async function getVettedModel(): Promise<{ provider: string, name: string }> {
  console.log(`${YELLOW}🔍 Vetting cloud models...${RESET}`);
  
  const apiKey = (await getApiKeyForProvider("openrouter")) || "";
  
  // 1. Try Cloud Models in order of preference
  for (const modelName of OPENROUTER_FREE_MODELS) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1500); // 1.5s "ping" test

      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: modelName,
          messages: [{ role: "user", content: "." }], // Micro-prompt
          max_tokens: 1
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);

      if (response.ok) {
        console.log(`✅ ${modelName} is healthy.`);
        return { provider: "openrouter", name: modelName };
      }
    } catch (e) {
      console.log(`⚠️  ${modelName} timed out or failed. trying next...`);
    }
  }

  // 2. Final Fallback: Local Ollama
  console.log(`${YELLOW}🏠 All cloud models failed. Using local Ollama.${RESET}`);
  return { provider: "ollama", name: "gemma2:9b" }; // Or your preferred local model
}

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(msg: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(msg, (answer) => resolve(answer.trim()));
  });
}

const METHOD_LABELS: Record<string, string> = {
  api_key: "API key",
  oauth: "OAuth",
  local: "Local Inference", // Added label for Ollama
};

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  "openai-codex": "OpenAI Codex",
  openrouter: "OpenRouter (Cloud)",
  ollama: "Ollama (Local)",
  whisper: "Whisper",
};

/** Checks if Ollama is accessible on the default port */
async function checkOllama(): Promise<boolean> {
  try {
    const res = await fetch("http://localhost:11434/api/version");
    return res.ok;
  } catch {
    return false;
  }
}

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
    console.log(` ${BOLD}${label}${RESET} ${DIM}— ${methodLabel}${RESET}`);
  }
  console.log();
}

// ... (Keep addAnthropic, addOpenAI, addOpenAICodex, addWhisper functions as they are)

async function addOpenRouterApiKey(): Promise<void> {
  console.log(`\n${CYAN}Get your free API key at: https://openrouter.ai/keys${RESET}\n`);
  const key = await prompt("OpenRouter API Key: ");
  if (!key) {
    console.log("No key provided.");
    return;
  }
  saveProviderCredential("openrouter", { method: "api_key", apiKey: key });
  console.log(`${GREEN}OpenRouter API key saved.${RESET}`);
}

/** New handler for Ollama to prevent "No Credentials" errors */
async function setupOllamaLocal(): Promise<void> {
  console.log(`\n${CYAN}Configuring local Ollama...${RESET}`);
  const isRunning = await checkOllama();
  
  if (!isRunning) {
    console.log(`${YELLOW}Warning: Ollama doesn't seem to be running on localhost:11434.${RESET}`);
    console.log(`${DIM}Make sure to start 'ollama serve' later.${RESET}\n`);
  }

  // We save a dummy key so NakedClaw's credential check passes
  saveProviderCredential("ollama", { method: "api_key", apiKey: "local" });
  console.log(`${GREEN}Ollama (Local) enabled in configuration.${RESET}`);
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
    console.log(` ${BOLD}[${i + 1}]${RESET} ${label}`);
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

  while (true) {
    const store = loadAllCredentials();
    showSavedCredentials(store);

    console.log(` ${BOLD}[1]${RESET} Add Anthropic ${GREEN}(setup token)${RESET}`);
    console.log(` ${BOLD}[2]${RESET} Add Anthropic ${DIM}(API key)${RESET}`);
    console.log(` ${BOLD}[3]${RESET} Add OpenAI ${DIM}(API key)${RESET}`);
    console.log(` ${BOLD}[4]${RESET} Add OpenAI Codex ${DIM}(ChatGPT subscription)${RESET}`);
    console.log(` ${BOLD}[5]${RESET} Add Whisper API key ${DIM}(OpenAI)${RESET}`);
    console.log(` ${BOLD}[6]${RESET} Add OpenRouter API Key ${DIM}(Cloud - Recommended)${RESET}`);
    console.log(` ${BOLD}[7]${RESET} Enable Ollama ${DIM}(Local Inference)${RESET}`);

    if (Object.keys(store).length > 0) {
      console.log(` ${BOLD}[d]${RESET} Delete a credential`);
    }
    console.log(` ${BOLD}[q]${RESET} Done`);
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
    } else if (choice === "5") {
      await addWhisperApiKey();
    } else if (choice === "6") {
      await addOpenRouterApiKey();
    } else if (choice === "7") {
      await setupOllamaLocal();
    } else if (choice.toLowerCase() === "d" && Object.keys(store).length > 0) {
      await deleteCredential(store);
    } else if (choice.toLowerCase() === "q") {
      break;
    } else {
      console.log("Invalid choice.\n");
      continue;
    }
    console.log(); 
  }

  // ... (Final steps message remains same)
  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
});