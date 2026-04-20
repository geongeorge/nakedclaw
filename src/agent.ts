import { getApiKeyForProvider } from "./auth/credentials.ts";
import { loadChannels, loadPersistentMemory, loadSystemPrompt } from "./brain/loader.ts";
import { loadSkillsPrompt } from "./skills/loader.ts";
import { loadConfig } from "./config.ts";
import { rebuildMemoryIndex } from "./memory/store.ts";
import { getMessages } from "./session.ts";
import type { Attachment } from "./channels/types.ts";

import { chatCompletion as openrouterChat, fetchFreeModels, selectBestModel } from "./providers/openrouter.ts";
import { chatCompletion as ollamaChat, isRunning as ollamaRunning, listModels as ollamaList, selectBest as ollamaSelectBest } from "./providers/ollama.ts";

export type AgentResponse = {
  text: string;
  toolCalls?: Array<{ name: string; input: unknown; output: string }>;
};

// ============================================================================
// MODEL CONFIGURATION & FALLBACK
// ============================================================================

export async function getWorkingModelConfig(
  configModelName?: string,
  ollamaHost: string = "http://localhost:11434"
): Promise<{
  provider: "openrouter" | "ollama";
  modelName: string;
}> {
  const openrouterApiKey = (await getApiKeyForProvider("openrouter")) || process.env.OPENROUTER_API_KEY || "";

  if (openrouterApiKey) {
    const freeModels = await fetchFreeModels(openrouterApiKey);
    const selected = selectBestModel(freeModels, configModelName);
    if (selected) {
      return { provider: "openrouter", modelName: selected.id };
    }
  }

  if (!(await ollamaRunning(ollamaHost))) {
    throw new Error("No working models: OpenRouter unavailable AND Ollama not running");
  }

  const available = await ollamaList(ollamaHost);
  const selected = ollamaSelectBest(available, configModelName);

  if (!selected) {
    throw new Error("Ollama running but no models found.");
  }

  return { provider: "ollama", modelName: selected };
}

// ============================================================================
// MAIN AGENT EXECUTION
// ============================================================================

export async function runAgent(
  sessionKey: string,
  userMessage: string,
  attachments?: Attachment[],
  reply?: (text: string) => Promise<void>,
  toolContextOverride?: { channel: string; sender: string }
): Promise<AgentResponse> {
  
  const config = loadConfig();
  const ollamaHost = config.ollama?.host || process.env.OLLAMA_HOST || "http://localhost:11434";
  const preferredModel = config.model?.name;

  // === STRATEGY 1: Try OpenRouter Free Models ===
  const openrouterKey = (await getApiKeyForProvider("openrouter")) || process.env.OPENROUTER_API_KEY || "";
  
  if (openrouterKey) {
    console.debug("[agent] Trying OpenRouter free models...");
    const freeModels = await fetchFreeModels(openrouterKey);
    const selected = selectBestModel(freeModels, preferredModel);
    
    if (selected) {
      console.debug(`[agent] ✅ OpenRouter: ${selected.id}`);
      // Convert history to simple {role, content} format
      const history = getMessages(sessionKey);
      const messages = [
        { role: "system", content: await buildSystemPrompt(config.workspace) },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: "user", content: userMessage }
      ];
      
      const result = await openrouterChat(openrouterKey, selected.id, messages, { maxTokens: 4096 });
      if (result.error) {
        console.warn(`[agent] OpenRouter failed: ${result.error}, falling back to Ollama`);
      } else {
        return { text: result.content };
      }
    }
  }

  // === STRATEGY 2: Fallback to Ollama (NO API KEY NEEDED) ===
  console.debug("[agent] 🦙 Falling back to Ollama...");
  
  if (!(await ollamaRunning(ollamaHost))) {
    throw new Error("No working models: OpenRouter unavailable AND Ollama not running");
  }
  
  const available = await ollamaList(ollamaHost);
  const selected = ollamaSelectBest(available, preferredModel);
  
  if (!selected) {
    throw new Error("Ollama running but no models found. Run: ollama pull gemma2:2b");
  }
  
  console.debug(`[agent] ✅ Ollama: ${selected}`);
  
  const history = getMessages(sessionKey);
  const messages = [
    { role: "system", content: await buildSystemPrompt(config.workspace) },
    ...history.map(h => ({ role: h.role, content: h.content })),
    { role: "user", content: userMessage }
  ];
  
  const result = await ollamaChat(selected, messages, ollamaHost, { maxTokens: 4096 });
  if (result.error) {
    throw new Error(`Ollama failed: ${result.error}`);
  }
  
  return { text: result.content };
}

// ============================================================================
// HELPERS
// ============================================================================

async function buildSystemPrompt(workspace: string): Promise<string> {
  const [system, channels, memory, skills] = await Promise.all([
    loadSystemPrompt(workspace),
    loadChannels(),
    loadPersistentMemory(),
    loadSkillsPrompt(),
  ]);
  const parts = [system];
  if (channels) parts.push(channels);
  if (skills) parts.push(skills);
  if (memory) parts.push(`## Permanent Memory\n\n${memory}`);
  parts.push(`## Temporary Memory Index\n\nRecent conversation summaries:\n\n${rebuildMemoryIndex()}`);
  return parts.join("\n\n");
}
