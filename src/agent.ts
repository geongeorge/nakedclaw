import { resolve } from "path";
import { completeSimple, getModel, type Message } from "@mariozechner/pi-ai";
import { loadConfig } from "./config.ts";
import { getMessages, type SessionMessage } from "./session.ts";
import { rebuildMemoryIndex } from "./memory/store.ts";
import { loadCredentials } from "./auth/credentials.ts";

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
  const systemPrompt = buildSystemPrompt(config.workspace, memoryContext);
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

function buildSystemPrompt(workspace: string, memoryContext: string): string {
  const ws = resolve(workspace);
  return `You are NakedClaw, a self-improving AI agent. Your workspace is your own source code at: ${ws}

You are a coding agent that can be reached via Telegram, WhatsApp, and Slack. When users ask you to add features, fix bugs, or improve yourself — you edit your own source files.

## Memory
Here is your current memory index with recent conversation summaries:

${memoryContext}

## Commands
Users can send these special commands:
- /reset — clear the current session
- /status — show system status
- /memory — show memory index
- /search <query> — search all chat history
- /schedule <time> <message> — schedule a reminder
- /heartbeat — show heartbeat status

## Guidelines
- Be concise in responses (messaging channels have length limits)
- When editing code, explain what you changed
- After code changes, remind the user to restart for changes to take effect
- Use your memory to maintain context across conversations`;
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
