import { completeSimple, getModel, type Message } from "@mariozechner/pi-ai";
import { loadCredentials } from "./auth/credentials.ts";
import { loadChannels, loadPersistentMemory, loadSystemPrompt } from "./brain/loader.ts";
import { loadSkillsPrompt } from "./skills/loader.ts";
import { loadConfig } from "./config.ts";
import { rebuildMemoryIndex } from "./memory/store.ts";
import { getMessages, type SessionMessage } from "./session.ts";

export type AgentResponse = {
  text: string;
  toolCalls?: Array<{ name: string; input: unknown; output: string }>;
};

function getApiKey(): string {
  // Env var takes priority
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;

  const creds = loadCredentials();
  if (!creds) throw new Error("No credentials configured. Run: nakedclaw setup");

  if (creds.method === "api_key") return creds.apiKey;
  return creds.oauth.accessToken;
}

export async function runAgent(
  sessionKey: string,
  userMessage: string
): Promise<AgentResponse> {
  const config = loadConfig();
  const apiKey = getApiKey();

  // Rebuild memory index so agent has fresh context
  const memoryContext = rebuildMemoryIndex();

  // Get conversation history
  const history = getMessages(sessionKey);

  // Build messages for the API
  const systemPrompt = await buildSystemPrompt(config.workspace, memoryContext);
  const messages = historyToApiMessages(history, userMessage);

  // Resolve the model through pi-ai
  const modelRef = config.model.name as any; // config may have any valid model string
  const model = getModel("anthropic", modelRef) ?? getModel("anthropic", "claude-sonnet-4-5");
  if (!model) {
    throw new Error(`Model not found: ${modelRef}`);
  }

  const res = await completeSimple(
    model,
    {
      systemPrompt,
      messages,
    },
    {
      apiKey,
      maxTokens: 4096,
      temperature: 0.7,
    }
  );

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
  currentMessage: string
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
        api: "anthropic-messages",
        provider: "anthropic",
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
