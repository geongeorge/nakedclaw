// src/providers/ollama.ts
export type OllamaModel = { name: string; modified_at: string; size: number };

export async function isRunning(host = "http://localhost:11434"): Promise<boolean> {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${host}/api/tags`, { signal: controller.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

export async function listModels(host = "http://localhost:11434"): Promise<OllamaModel[]> {
  try {
    const res = await fetch(`${host}/api/tags`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.models?.map((m: any) => ({ name: m.name, modified_at: m.modified_at, size: m.size })) || [];
  } catch {
    return [];
  }
}

export function selectBest(available: OllamaModel[], preferred?: string): string | null {
  if (!available.length) return null;
  if (preferred && available.some(m => m.name === preferred)) return preferred;
  
  // Prefer small instruct models
  const patterns = ["gemma2:2b", "gemma3:4b", "llama3.2:3b", "qwen2.5:3b", "phi3:mini"];
  for (const p of patterns) {
    const match = available.find(m => m.name.toLowerCase().includes(p));
    if (match) return match.name;
  }
  // Fallback to any instruct/chat model
  const instruct = available.find(m => /instruct|chat/i.test(m.name));
  if (instruct) return instruct.name;
  return available[0].name;
}

export async function chatCompletion(
  model: string,
  messages: Array<{ role: string; content: string }>,
  host = "http://localhost:11434",
  options?: { temperature?: number; maxTokens?: number }
): Promise<{ content: string; error?: string }> {
  try {
    const res = await fetch(`${host}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 4096,
      }),
    });
    
    if (!res.ok) {
      const err = await res.text().catch(() => "unknown");
      return { content: "", error: `Ollama ${res.status}: ${err.slice(0, 200)}` };
    }
    
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content || "", error: undefined };
  } catch (e: any) {
    return { content: "", error: `Ollama request failed: ${e?.message || e}` };
  }
}
