import { Type, type Static } from "@sinclair/typebox";
import type { Tool, TextContent } from "@mariozechner/pi-ai";
import { saveProviderCredential } from "./auth/credentials.ts";
import { loadConfig } from "./config.ts";
import { resolve } from "path";
import { readFileSync, existsSync } from "fs";

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
  provider: Type.String({ description: "Provider name, e.g. 'openai', 'whisper', 'anthropic'" }),
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
    "Use when the user provides an API key they want stored.",
  parameters: SaveCredentialParams,
};

export const allTools: Tool[] = [shellTool, readFileTool, saveCredentialTool];

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

function executeSaveCredential(args: Static<typeof SaveCredentialParams>): ToolResult {
  try {
    saveProviderCredential(args.provider, { method: "api_key", apiKey: args.apiKey });
    return { content: text(`Saved API key for provider "${args.provider}".`), isError: false };
  } catch (err: any) {
    return { content: text(`Error saving credential: ${err.message}`), isError: true };
  }
}

export async function executeTool(
  name: string,
  args: Record<string, any>
): Promise<ToolResult> {
  console.log(`[agent] Tool call: ${name}(${JSON.stringify(args)})`);

  switch (name) {
    case "shell":
      return executeShell(args as Static<typeof ShellParams>);
    case "read_file":
      return executeReadFile(args as Static<typeof ReadFileParams>);
    case "save_credential":
      return executeSaveCredential(args as Static<typeof SaveCredentialParams>);
    default:
      return { content: text(`Unknown tool: ${name}`), isError: true };
  }
}
