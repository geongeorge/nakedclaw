import { completeSimple, getModel, type Message } from "@mariozechner/pi-ai";
import { getApiKeyForProvider } from "./auth/credentials.ts";
import { loadChannels, loadPersistentMemory, loadSystemPrompt } from "./brain/loader.ts";
import { loadSkillsPrompt } from "./skills/loader.ts";
import { loadConfig } from "./config.ts";
import { rebuildMemoryIndex } from "./memory/store.ts";
import { getMessages, type SessionMessage } from "./session.ts";
import type { Attachment } from "./channels/types.ts";
import { readImageAsBase64 } from "./media.ts";

export type AgentResponse = {
  text: string;
  toolCalls?: Array<{ name: string; input: unknown; output: string }>;
};

export async function runAgent(
  sessionKey: string,
  userMessage: string,
  attachments?: Attachment[]
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
  const supportsVision = model.input.includes("image");
  const messages = historyToApiMessages(history, userMessage, model.api, provider, supportsVision, attachments);

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

function buildUserContent(
  text: string,
  sessionAttachments: SessionMessage["attachments"] | undefined,
  supportsVision: boolean
): string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> {
  if (!supportsVision || !sessionAttachments || sessionAttachments.length === 0) {
    return text;
  }

  const imageAttachments = sessionAttachments.filter((a) => a.type === "image");
  if (imageAttachments.length === 0) return text;

  const content: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
  if (text) {
    content.push({ type: "text", text });
  }

  for (const att of imageAttachments) {
    const img = readImageAsBase64(att.filePath);
    if (img) {
      content.push({ type: "image", data: img.data, mimeType: img.mimeType });
    }
  }

  return content.length === 1 && content[0]!.type === "text" ? text : content;
}

function historyToApiMessages(
  history: SessionMessage[],
  currentMessage: string,
  api: string,
  provider: string,
  supportsVision: boolean,
  currentAttachments?: Attachment[]
): Message[] {
  const msgs: Message[] = [];
  const now = Date.now();

  for (const h of history) {
    if (h.role === "user") {
      const content = buildUserContent(h.content, h.attachments, supportsVision);
      msgs.push({ role: "user", content, timestamp: now });
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

  // Current message — convert channel attachments to session format for buildUserContent
  const sessionAtts = currentAttachments?.map((a) => ({
    type: a.type,
    filePath: a.filePath,
    mimeType: a.mimeType,
  }));
  const content = buildUserContent(currentMessage, sessionAtts, supportsVision);
  msgs.push({ role: "user", content, timestamp: now });
  return msgs;
}
