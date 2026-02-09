import { resolve } from "node:path";
import { loadConfig } from "../config.ts";

function brainPath(filename: string): string {
  const config = loadConfig();
  return resolve(config.brain.dir, filename);
}

async function readBrainFile(filename: string): Promise<string> {
  const path = brainPath(filename);
  const file = Bun.file(path);
  if (!(await file.exists())) return "";
  return file.text();
}

export async function loadSystemPrompt(workspace: string): Promise<string> {
  const raw = await readBrainFile("system.md");
  return raw.replace(/\{\{workspace\}\}/g, resolve(workspace));
}

export async function loadPersistentMemory(): Promise<string> {
  // Preferred durable-memory file name. Fallback keeps legacy installs working.
  const permanent = await readBrainFile("permanent-memory.md");
  if (permanent) return permanent;
  return readBrainFile("memory.md");
}

export async function loadHeartbeatPrompt(): Promise<string> {
  return readBrainFile("heartbeat.md");
}

export async function loadChannels(): Promise<string> {
  return readBrainFile("channels.md");
}
