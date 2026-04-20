// src/providers/openrouter.ts
import { getApiKeyForProvider } from "../auth/credentials.ts";

export type OpenRouterModel = {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  architecture?: { modality?: string[] };
  pricing: { prompt: number; completion: number };
  top_provider?: { max_completion_tokens: number };
  released?: string;
};

type CachedFreeModels = {
  models: OpenRouterModel[];
  fetchedAt: number;
  ttl: number;
};

let _freeModelsCache: CachedFreeModels | null = null;
const FREE_MODELS_TTL = 15 * 60 * 1000; // 15 min cache

function getHeaders(apiKey: string): Record<string, string> {
  return {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://github.com/geongeorge/nakedclaw",
    "X-Title": "NakedClaw",
  };
}

export async function fetchFreeModels(apiKey: string, forceRefresh = false): Promise<OpenRouterModel[]> {
  const now = Date.now();
  
  if (!forceRefresh && _freeModelsCache && (now - _freeModelsCache.fetchedAt) < _freeModelsCache.ttl) {
    return _freeModelsCache.models;
  }

  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { "HTTP-Referer": "https://github.com/geongeorge/nakedclaw", "X-Title": "NakedClaw" }
    });
    
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json();
    
    const free = data.data
      .filter((m: OpenRouterModel) => m.pricing?.prompt === 0 && m.pricing?.completion === 0)
      .sort((a: OpenRouterModel, b: OpenRouterModel) => {
        const dateA = a.released ? new Date(a.released).getTime() : 0;
        const dateB = b.released ? new Date(b.released).getTime() : 0;
        if (dateB !== dateA) return dateB - dateA;
        return b.context_length - a.context_length;
      });
    
    _freeModelsCache = { models: free, fetchedAt: now, ttl: FREE_MODELS_TTL };
    console.debug(`[openrouter] ✅ Found ${free.length} free models`);
    return free;
  } catch (e) {
    console.warn("[openrouter] Failed to fetch free models:", e);
    return [];
  }
}

export function selectBestModel(models: OpenRouterModel[], preferred?: string): OpenRouterModel | null {
  if (!models.length) return null;
  if (preferred) {
    const exact = models.find(m => m.id === preferred);
    if (exact) return exact;
    const matched = models.find(m => m.id.toLowerCase().includes(preferred.toLowerCase()));
    if (matched) return matched;
  }
  // Prefer recent + large context
  const recent = models.filter(m => {
    const released = m.released ? new Date(m.released).getTime() : 0;
    return m.context_length >= 32768 && released > Date.now() - 180*24*60*60*1000;
  });
  if (recent.length) return recent[0];
  return models[0];
}

export async function chatCompletion(
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string | Array<{ type: string; [key: string]: any }> }>,
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; error?: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: getHeaders(apiKey),
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      }),
    });
    
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown error");
      return { content: "", error: `OpenRouter ${res.status}: ${err.slice(0, 200)}` };
    }
    
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    return { content, error: undefined };
  } catch (e: any) {
    return { content: "", error: `OpenRouter request failed: ${e?.message || e}` };
  }
}
