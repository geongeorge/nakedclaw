import { completeSimple, getModel, type Message } from "@mariozechner/pi-ai";
import { getApiKeyForProvider } from "./auth/credentials.ts";
import { loadChannels, loadPersistentMemory, loadSystemPrompt } from "./brain/loader.ts";
import { loadSkillsPrompt } from "./skills/loader.ts";
import { loadConfig } from "./config.ts";
import { rebuildMemoryIndex } from "./memory/store.ts";
import { getMessages, type SessionMessage } from "./session.ts";

export type AgentResponse = {
  text: string;
  toolCalls?: Array<{ name: string; input: unknown; output: string }>;
};

export async function runAgent(
  sessionKey: string,
  userMessage: string
): Promise<AgentResponse> {
  const config = loadConfig();
  const provider = config.model.provider || "anthropic";
  const apiKey = await getApiKeyForProvider(provider);

  // Rebuild memory index so agent has fresh context
  const memoryContext = rebuildMemoryIndex();

  // Get conversation history
  const history = getMessages(sessionKey);

  // Resolve the model through pi-ai (needed before building messages for the API string)
  const modelRef = config.model.name as any;
  const model = getModel(provider as any, modelRef);
  if (!model) {
    throw new Error(`Model not found: ${provider}/${modelRef}`);
  }

  // Build messages for the API
  const systemPrompt = await buildSystemPrompt(config.workspace, memoryContext);
  const messages = historyToApiMessages(history, userMessage, model.api, provider);

  // Only pass temperature for non-reasoning models (OpenAI reasoning models reject it)
  const options: Record<string, any> = {
    apiKey,
    maxTokens: 4096,
  };
  if (!model.reasoning) {
    options.temperature = 0.7;
  }

  const res = await completeSimple(
    model,
    {
      systemPrompt,
      messages,
    },
    options
  );

  // Check for API errors surfaced through the response
  if (res.errorMessage) {
    throw new Error(res.errorMessage);
  }

  const text =
    res.content
      .filter((block) => block.type === "text")
      .map((block) => "text" in block ? block.text : "")
      .join("\n") || "(no response)";

  return { text };
}

async function buildSystemPrompt(workspace: string, memoryContext: string): Promise<string> {
  const [system, channels, memory, skills] = await Promise.all([
    loadSystemPrompt(workspace),
    loadChannels(),
    loadPersistentMemory(),
    loadSkillsPrompt(),
  ]);

  const parts = [system];

  if (channels) {
    parts.push(channels);
  }

  if (skills) {
    parts.push(skills);
  }

  if (memory) {
    parts.push(`## Persistent Memory\n\n${memory}`);
  }

  parts.push(`## Chat Index\n\nRecent conversation summaries:\n\n${memoryContext}`);

  return parts.join("\n\n");
}

function historyToApiMessages(
  history: SessionMessage[],
  currentMessage: string,
  api: string,
  provider: string
): Message[] {
  const msgs: Message[] = [];
  const now = Date.now();

  for (const h of history) {
    if (h.role === "user") {
      msgs.push({ role: "user", content: h.content, timestamp: now });
    } else if (h.role === "assistant") {
      msgs.push({
        role: "assistant",
        content: [{ type: "text", text: h.content }],
        api,
        provider,
        model: "",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: now,
      });
    }
  }

  msgs.push({ role: "user", content: currentMessage, timestamp: now });
  return msgs;
}
