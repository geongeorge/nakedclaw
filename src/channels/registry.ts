import { existsSync } from "fs";
import { extname } from "path";

export type SendFileOptions = {
  recipient: string;
  filePath: string;
  caption?: string;
};

export type ChannelSender = {
  sendFile(opts: SendFileOptions): Promise<void>;
};

const registry = new Map<string, ChannelSender>();

export function registerChannelSender(channel: string, sender: ChannelSender): void {
  registry.set(channel, sender);
}

export function getChannelSender(channel: string): ChannelSender | undefined {
  return registry.get(channel);
}

export function getRegisteredChannels(): string[] {
  return Array.from(registry.keys());
}

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm"]);
const AUDIO_EXTS = new Set([".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"]);

export function detectMediaType(filePath: string): "image" | "video" | "audio" | "document" {
  const ext = extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return "document";
}
