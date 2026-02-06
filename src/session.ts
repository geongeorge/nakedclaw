import { mkdirSync, existsSync, appendFileSync, readFileSync } from "fs";
import { resolve, join } from "path";
import { loadConfig } from "./config.ts";

export type SessionMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  channel?: string;
  sender?: string;
};

/**
 * JSONL session transcripts — one file per sender.
 * Used to feed conversation history to the agent.
 */

function getSessionDir(): string {
  const config = loadConfig();
  const dir = resolve(config.sessions.dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionFilePath(sessionKey: string): string {
  return join(getSessionDir(), `${sessionKey}.jsonl`);
}

export function appendMessage(sessionKey: string, msg: SessionMessage): void {
  const path = sessionFilePath(sessionKey);
  appendFileSync(path, JSON.stringify(msg) + "\n", "utf-8");
}

export function getMessages(sessionKey: string): SessionMessage[] {
  const path = sessionFilePath(sessionKey);
  if (!existsSync(path)) return [];

  const config = loadConfig();
  const lines = readFileSync(path, "utf-8")
    .split("\n")
    .filter((l) => l.trim());

  const messages = lines.map((l) => JSON.parse(l) as SessionMessage);

  // Respect maxTurns — keep the most recent
  if (messages.length > config.sessions.maxTurns * 2) {
    return messages.slice(-config.sessions.maxTurns * 2);
  }
  return messages;
}

export function clearSession(sessionKey: string): void {
  const path = sessionFilePath(sessionKey);
  if (existsSync(path)) {
    const { unlinkSync } = require("fs");
    unlinkSync(path);
  }
}

export function sessionKeyFromMessage(
  channel: string,
  sender: string
): string {
  return `${channel}:${sender.replace(/[^a-zA-Z0-9_@+\-]/g, "_")}`;
}
