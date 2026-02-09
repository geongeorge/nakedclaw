import { Type, type Static } from "@sinclair/typebox";
import type { Tool, TextContent } from "@mariozechner/pi-ai";
import { saveProviderCredential } from "./auth/credentials.ts";
import { loadConfig } from "./config.ts";
import { searchMemory, getChatHistory, listSessions } from "./memory/store.ts";
import { resolve, dirname } from "path";
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from "fs";
import { getChannelSender, detectMediaType, getRegisteredChannels } from "./channels/registry.ts";

export type ToolContext = {
  channel: string;
  sender: string;
};

// ── Tool definitions ──────────────────────────────────────────────

const ShellParams = Type.Object({
  command: Type.String({ description: "Shell command to execute" }),
  timeout: Type.Optional(
    Type.Number({ description: "Timeout in seconds (default 30, max 120)", minimum: 1, maximum: 120 })
  ),
});

const ReadFileParams = Type.Object({
  path: Type.String({ description: "File path (absolute or workspace-relative)" }),
  maxLines: Type.Optional(
    Type.Number({ description: "Maximum lines to return (default 500)", minimum: 1, maximum: 2000 })
  ),
});

const SaveCredentialParams = Type.Object({
  provider: Type.String({ description: "Provider name, e.g. 'whisper', 'anthropic', 'deepgram'" }),
  apiKey: Type.String({ description: "The API key to save" }),
});

export const shellTool: Tool<typeof ShellParams> = {
  name: "shell",
  description:
    "Execute a shell command. Use for curl, git, ls, package managers, and any CLI operation. " +
    "stdout+stderr are captured. Timeout defaults to 30s (max 120s). Output truncated at 50k chars.",
  parameters: ShellParams,
};

export const readFileTool: Tool<typeof ReadFileParams> = {
  name: "read_file",
  description:
    "Read a file from disk. Path can be absolute or relative to the workspace directory. " +
    "Returns up to 500 lines by default (max 2000).",
  parameters: ReadFileParams,
};

export const saveCredentialTool: Tool<typeof SaveCredentialParams> = {
  name: "save_credential",
  description:
    "Save an API key to ~/.nakedclaw/credentials.json for a given provider. " +
    "Use when the user provides an API key they want stored. " +
    "IMPORTANT: For OpenAI keys (for Whisper/transcription), always use provider 'whisper' — " +
    "never use 'openai' (that's reserved for the chat model's OAuth credentials). " +
    "Keys take effect immediately — no daemon restart needed.",
  parameters: SaveCredentialParams,
};

const SearchMemoryParams = Type.Object({
  query: Type.String({ description: "Search query — matched case-insensitively against all chat history" }),
  maxResults: Type.Optional(
    Type.Number({ description: "Max sessions to return (default 5)", minimum: 1, maximum: 20 })
  ),
});

export const searchMemoryTool: Tool<typeof SearchMemoryParams> = {
  name: "search_memory",
  description:
    "Search across all past conversations (chat history) for a keyword or phrase. " +
    "Returns matching lines grouped by session. Use this to recall what a user said, " +
    "find past decisions, look up shared information, or answer 'did we talk about X?' questions. " +
    "For full context around a match, follow up with read_file on the chat file path.",
  parameters: SearchMemoryParams,
};

const RememberParams = Type.Object({
  note: Type.String({
    description:
      "A concise durable fact to store in persistent memory (e.g. user preference, identity detail, stable project rule)"
  }),
});

export const rememberTool: Tool<typeof RememberParams> = {
  name: "remember",
  description:
    "Save a durable fact to persistent memory at brain/permanent-memory.md. " +
    "Use this for user preferences, stable personal details, project constraints, and long-term decisions. " +
    "Do not use for one-off transient details.",
  parameters: RememberParams,
};

const SendFileParams = Type.Object({
  filePath: Type.String({ description: "Absolute path to the file to send (e.g. an image the user asked you to create/edit)" }),
  caption: Type.Optional(
    Type.String({ description: "Optional caption to accompany the file" })
  ),
});

export const sendFileTool: Tool<typeof SendFileParams> = {
  name: "send_file",
  description:
    "Send a file (image, video, audio, document) back to the user through the current channel (WhatsApp, Telegram). " +
    "Use this after creating, downloading, or processing a file that the user wants sent back. " +
    "The file is sent to the same user in the same channel as the current conversation. " +
    "Supports images (.jpg, .png, .gif, .webp), videos (.mp4, .mov), audio (.mp3, .ogg), and documents (any).",
  parameters: SendFileParams,
};

export const allTools: Tool[] = [shellTool, readFileTool, saveCredentialTool, searchMemoryTool, rememberTool, sendFileTool];

// ── Tool execution ────────────────────────────────────────────────

type ToolResult = { content: TextContent[]; isError: boolean };

const MAX_OUTPUT = 50_000;

function text(s: string): TextContent[] {
  return [{ type: "text", text: s }];
}

async function executeShell(args: Static<typeof ShellParams>): Promise<ToolResult> {
  const timeout = Math.min(args.timeout ?? 30, 120) * 1000;

  try {
    const proc = Bun.spawn(["sh", "-c", args.command], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env },
    });

    const timer = setTimeout(() => proc.kill(), timeout);
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    clearTimeout(timer);

    const exitCode = await proc.exited;
    let output = stdout + (stderr ? `\n${stderr}` : "");
    if (output.length > MAX_OUTPUT) {
      output = output.slice(0, MAX_OUTPUT) + "\n... (truncated)";
    }

    if (exitCode !== 0) {
      return { content: text(`Exit code ${exitCode}\n${output}`.trim()), isError: true };
    }
    return { content: text(output || "(no output)"), isError: false };
  } catch (err: any) {
    return { content: text(`Error: ${err.message}`), isError: true };
  }
}

function executeReadFile(args: Static<typeof ReadFileParams>): ToolResult {
  const maxLines = Math.min(args.maxLines ?? 500, 2000);

  let filePath = args.path;
  if (!filePath.startsWith("/")) {
    const config = loadConfig();
    filePath = resolve(config.workspace, filePath);
  }

  if (!existsSync(filePath)) {
    return { content: text(`File not found: ${filePath}`), isError: true };
  }

  try {
    const raw = readFileSync(filePath, "utf-8");
    const lines = raw.split("\n");
    const truncated = lines.length > maxLines;
    const output = lines.slice(0, maxLines).join("\n");
    const suffix = truncated ? `\n... (${lines.length - maxLines} more lines)` : "";
    return { content: text(output + suffix), isError: false };
  } catch (err: any) {
    return { content: text(`Error reading file: ${err.message}`), isError: true };
  }
}

function getPersistentMemoryPath(): string {
  const config = loadConfig();
  return resolve(config.brain.dir, "permanent-memory.md");
}

function executeRemember(args: Static<typeof RememberParams>): ToolResult {
  const note = args.note.trim().replace(/\s+/g, " ");
  if (!note) {
    return { content: text("Nothing to remember: note is empty."), isError: true };
  }

  const path = getPersistentMemoryPath();
  const dir = dirname(path);

  try {
    mkdirSync(dir, { recursive: true });

    if (!existsSync(path)) {
      const header =
        "# Persistent Memory\n\n" +
        "<!-- Auto-updated by NakedClaw. You can also edit this file manually. -->\n\n" +
        "## Learned Facts\n\n";
      writeFileSync(path, header, "utf-8");
    }

    const existing = readFileSync(path, "utf-8");
    const normalizedExisting = existing.toLowerCase();
    const normalizedNote = note.toLowerCase();
    if (normalizedExisting.includes(normalizedNote)) {
      return {
        content: text(`Already remembered (duplicate skipped): "${note}"`),
        isError: false,
      };
    }

    const entry = `- [${new Date().toISOString()}] ${note}\n`;
    const spacer = existing.endsWith("\n") ? "" : "\n";
    appendFileSync(path, spacer + entry, "utf-8");

    return {
      content: text(`Remembered: "${note}" (${path})`),
      isError: false,
    };
  } catch (err: any) {
    return { content: text(`Error saving memory: ${err.message}`), isError: true };
  }
}

function executeSaveCredential(args: Static<typeof SaveCredentialParams>): ToolResult {
  try {
    // Never overwrite "openai" — that's the chat model's OAuth credential.
    // Remap OpenAI API keys to "whisper" (used for transcription).
    let provider = args.provider;
    if (provider === "openai" && args.apiKey.startsWith("sk-")) {
      provider = "whisper";
      console.log('[agent] Remapped provider "openai" → "whisper" to protect chat credentials');
    }

    saveProviderCredential(provider, { method: "api_key", apiKey: args.apiKey });
    return { content: text(`Saved API key for provider "${provider}". Takes effect immediately.`), isError: false };
  } catch (err: any) {
    return { content: text(`Error saving credential: ${err.message}`), isError: true };
  }
}

function executeSearchMemory(args: Static<typeof SearchMemoryParams>): ToolResult {
  const maxResults = args.maxResults ?? 5;

  const results = searchMemory(args.query);
  if (results.length === 0) {
    return { content: text(`No results for "${args.query}".`), isError: false };
  }

  const sessions = listSessions();
  const fileMap = new Map(sessions.map((s) => [s.key, s.file]));

  let output = `Found matches in ${results.length} session(s) for "${args.query}":\n\n`;
  for (const r of results.slice(0, maxResults)) {
    const filePath = fileMap.get(r.key) || `memory/chats/${r.key}.md`;
    output += `── ${r.key} (${filePath})\n`;
    for (const m of r.matches.slice(0, 5)) {
      output += `  ${m.trim()}\n`;
    }
    if (r.matches.length > 5) {
      output += `  ... (${r.matches.length - 5} more matches)\n`;
    }
    output += "\n";
  }

  if (output.length > MAX_OUTPUT) {
    output = output.slice(0, MAX_OUTPUT) + "\n... (truncated)";
  }

  return { content: text(output), isError: false };
}

async function executeSendFile(args: Static<typeof SendFileParams>, context?: ToolContext): Promise<ToolResult> {
  if (!context) {
    return { content: text("send_file requires a session context (channel + sender). Cannot send files from headless sessions."), isError: true };
  }

  const { channel, sender } = context;

  if (channel === "terminal") {
    return { content: text(`File is at: ${args.filePath} (terminal sessions don't support file attachments)`), isError: false };
  }

  const channelSender = getChannelSender(channel);
  if (!channelSender) {
    const registered = getRegisteredChannels();
    return {
      content: text(`No file sender registered for channel "${channel}". Registered channels: ${registered.join(", ") || "none"}`),
      isError: true,
    };
  }

  if (!existsSync(args.filePath)) {
    return { content: text(`File not found: ${args.filePath}`), isError: true };
  }

  try {
    await channelSender.sendFile({
      recipient: sender,
      filePath: args.filePath,
      caption: args.caption,
    });
    const mediaType = detectMediaType(args.filePath);
    return { content: text(`Sent ${mediaType} to ${sender} on ${channel}.`), isError: false };
  } catch (err: any) {
    return { content: text(`Error sending file: ${err.message}`), isError: true };
  }
}

export async function executeTool(
  name: string,
  args: Record<string, any>,
  context?: ToolContext
): Promise<ToolResult> {
  console.log(`[agent] Tool call: ${name}(${JSON.stringify(args)})`);

  switch (name) {
    case "shell":
      return executeShell(args as Static<typeof ShellParams>);
    case "read_file":
      return executeReadFile(args as Static<typeof ReadFileParams>);
    case "save_credential":
      return executeSaveCredential(args as Static<typeof SaveCredentialParams>);
    case "search_memory":
      return executeSearchMemory(args as Static<typeof SearchMemoryParams>);
    case "remember":
      return executeRemember(args as Static<typeof RememberParams>);
    case "send_file":
      return executeSendFile(args as Static<typeof SendFileParams>, context);
    default:
      return { content: text(`Unknown tool: ${name}`), isError: true };
  }
}
