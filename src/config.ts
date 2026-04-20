import JSON5 from "json5";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

// Add a helper to check if a model supports vision or custom contexts
export const MODEL_METADATA: Record<string, { api: string; context: number }> = {
  "openrouter/elephant-alpha": { api: "openai", context: 32768 },
  "qwen/qwen3-coder:free": { api: "openai", context: 32768 },
  "z-ai/glm-4.5-air:free": { api: "openai", context: 32768 },
  "nvidia/nemotron-3-super-120b-a12b:free": { api: "openai", context: 32768 },
  "google/gemma-3-27b-it:free": { api: "openai", context: 128000 },
};

export function getModelApi(modelName: string): string {
  // If it's in our custom list, return the API type
  if (MODEL_METADATA[modelName]) return MODEL_METADATA[modelName].api;
  
  // Default fallback logic
  if (modelName.includes("gpt") || modelName.includes("llama")) return "openai";
  if (modelName.includes("claude")) return "anthropic";
  if (modelName.includes("gemini")) return "google";
  
  return "openai"; // Safest default for OpenRouter/Ollama
}

export type ChannelConfig = {
  enabled: boolean;
  allowFrom: string[];
};

export type Config = {
  model: {
    provider: string;
    name: string;
  };
  workspace: string;
  channels: {
    telegram: ChannelConfig;
    whatsapp: ChannelConfig;
    slack: ChannelConfig;
  };
  sessions: {
    dir: string;
    maxTurns: number;
    maxToolIterations?: number;
  };
  memory: {
    dir: string;
    indexFile: string;
  };
  brain: {
    dir: string;
  };
  heartbeat: {
    enabled: boolean;
    cronExpr: string;
  };
  skills?: {
    dir: string;
    autoSync: boolean;
  };
};

const CONFIG_PATH = resolve(
  import.meta.dir,
  "..",
  "nakedclaw.json5"
);

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}`);
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  _config = JSON5.parse(raw) as Config;
  return _config;
}

export function reloadConfig(): Config {
  _config = null;
  return loadConfig();
}
