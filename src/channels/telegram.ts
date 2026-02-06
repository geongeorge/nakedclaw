import { Bot } from "grammy";
import type { ChannelAdapter, IncomingMessage, ReplyFn } from "./types.ts";
import type { ChannelConfig } from "../config.ts";

export function createTelegramAdapter(config: ChannelConfig): ChannelAdapter {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const bot = new Bot(token);
  let handler: ((msg: IncomingMessage, reply: ReplyFn) => void) | null = null;

  bot.on("message:text", async (ctx) => {
    if (!handler) return;

    const sender = ctx.from?.username
      ? `@${ctx.from.username}`
      : String(ctx.from?.id);

    // Check allowlist (empty = allow all)
    if (
      config.allowFrom.length > 0 &&
      !config.allowFrom.includes(sender)
    ) {
      return;
    }

    const msg: IncomingMessage = {
      channel: "telegram",
      sender,
      senderName:
        ctx.from?.first_name +
        (ctx.from?.last_name ? ` ${ctx.from.last_name}` : ""),
      text: ctx.message.text,
      timestamp: ctx.message.date * 1000,
      raw: ctx,
    };

    const reply: ReplyFn = async (text: string) => {
      // Telegram has a 4096 char limit per message
      const chunks = splitMessage(text, 4096);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    };

    handler(msg, reply);
  });

  return {
    name: "telegram",

    async start() {
      console.log("[telegram] Starting bot...");
      bot.start({
        onStart: () => console.log("[telegram] Bot is running"),
      });
    },

    async stop() {
      await bot.stop();
      console.log("[telegram] Bot stopped");
    },

    onMessage(h) {
      handler = h;
    },
  };
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}
