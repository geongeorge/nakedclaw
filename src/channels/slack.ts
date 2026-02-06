import { App } from "@slack/bolt";
import type { ChannelAdapter, IncomingMessage, ReplyFn } from "./types.ts";
import type { ChannelConfig } from "../config.ts";

export function createSlackAdapter(config: ChannelConfig): ChannelAdapter {
  const botToken = process.env.SLACK_BOT_TOKEN;
  const appToken = process.env.SLACK_APP_TOKEN;
  if (!botToken) throw new Error("SLACK_BOT_TOKEN not set");
  if (!appToken) throw new Error("SLACK_APP_TOKEN not set");

  const app = new App({
    token: botToken,
    appToken,
    socketMode: true,
  });

  let handler: ((msg: IncomingMessage, reply: ReplyFn) => void) | null = null;

  // Listen for direct messages and mentions
  app.message(async ({ message, say }) => {
    if (!handler) return;
    if (message.subtype) return; // skip edits, joins, etc.
    if (!("text" in message) || !message.text) return;

    const sender = message.user || "";

    // Check allowlist
    if (config.allowFrom.length > 0 && !config.allowFrom.includes(sender)) {
      return;
    }

    const incoming: IncomingMessage = {
      channel: "slack",
      sender,
      senderName: sender, // Slack user IDs — could resolve via API
      text: message.text,
      timestamp: parseFloat(message.ts || "0") * 1000,
      raw: message,
    };

    const reply: ReplyFn = async (text: string) => {
      await say({ text, thread_ts: message.ts });
    };

    handler(incoming, reply);
  });

  return {
    name: "slack",

    async start() {
      console.log("[slack] Starting app...");
      await app.start();
      console.log("[slack] App is running (socket mode)");
    },

    async stop() {
      await app.stop();
      console.log("[slack] App stopped");
    },

    onMessage(h) {
      handler = h;
    },
  };
}
