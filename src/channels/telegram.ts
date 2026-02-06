import { Bot, InputFile } from "grammy";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import type { Attachment, ChannelAdapter, IncomingMessage, ReplyFn } from "./types.ts";
import type { ChannelConfig } from "../config.ts";
import { registerChannelSender, detectMediaType } from "./registry.ts";

const MEDIA_DIR = resolve(import.meta.dir, "../../media/telegram");

/** Maps sender string (@username or numeric ID) → numeric chat ID for outbound messages */
const chatIdMap = new Map<string, number>();

export function createTelegramAdapter(config: ChannelConfig): ChannelAdapter {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not set");

  const bot = new Bot(token);
  let handler: ((msg: IncomingMessage, reply: ReplyFn) => void) | null = null;

  /**
   * Download a Telegram file by file_id and save to disk.
   */
  async function downloadFile(
    fileId: string,
    fileName: string
  ): Promise<string | null> {
    if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });

    try {
      const file = await bot.api.getFile(fileId);
      if (!file.file_path) return null;

      const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const buffer = Buffer.from(await res.arrayBuffer());
      const filePath = join(MEDIA_DIR, fileName);
      writeFileSync(filePath, buffer);
      console.log(`[telegram] Saved media: ${filePath}`);
      return filePath;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[telegram] Media download failed: ${errMsg}`);
      return null;
    }
  }

  /**
   * Handle any message type — text, voice, photo, video, document, audio, sticker.
   */
  bot.on("message", async (ctx) => {
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

    // Track sender → chatId for outbound file sends
    chatIdMap.set(sender, ctx.chat.id);

    // Send typing indicator immediately
    try {
      await ctx.replyWithChatAction("typing");
    } catch {
      // best-effort
    }

    const attachments: Attachment[] = [];
    let text = ctx.message?.text || ctx.message?.caption || "";

    // Voice message
    if (ctx.message?.voice) {
      const v = ctx.message.voice;
      const name = `${Date.now()}.ogg`;
      const filePath = await downloadFile(v.file_id, name);
      if (filePath) {
        attachments.push({
          type: "voice",
          filePath,
          mimeType: v.mime_type || "audio/ogg",
          duration: v.duration,
        });
      }
    }

    // Audio message
    if (ctx.message?.audio) {
      const a = ctx.message.audio;
      const ext = a.mime_type?.split("/").pop() || "mp3";
      const name = a.file_name || `${Date.now()}.${ext}`;
      const filePath = await downloadFile(a.file_id, name);
      if (filePath) {
        attachments.push({
          type: "audio",
          filePath,
          mimeType: a.mime_type || undefined,
          fileName: a.file_name || undefined,
          duration: a.duration,
        });
      }
    }

    // Photo — pick the largest resolution
    if (ctx.message?.photo && ctx.message.photo.length > 0) {
      const photo = ctx.message.photo[ctx.message.photo.length - 1]!;
      const name = `${Date.now()}.jpg`;
      const filePath = await downloadFile(photo.file_id, name);
      if (filePath) {
        attachments.push({
          type: "image",
          filePath,
          mimeType: "image/jpeg",
        });
      }
    }

    // Video
    if (ctx.message?.video) {
      const v = ctx.message.video;
      const ext = v.mime_type?.split("/").pop() || "mp4";
      const name = v.file_name || `${Date.now()}.${ext}`;
      const filePath = await downloadFile(v.file_id, name);
      if (filePath) {
        attachments.push({
          type: "video",
          filePath,
          mimeType: v.mime_type || undefined,
          fileName: v.file_name || undefined,
          duration: v.duration,
        });
      }
    }

    // Document
    if (ctx.message?.document) {
      const d = ctx.message.document;
      const name = d.file_name || `${Date.now()}.bin`;
      const filePath = await downloadFile(d.file_id, name);
      if (filePath) {
        attachments.push({
          type: "document",
          filePath,
          mimeType: d.mime_type || undefined,
          fileName: d.file_name || undefined,
        });
      }
    }

    // Sticker
    if (ctx.message?.sticker) {
      const s = ctx.message.sticker;
      const name = `${Date.now()}.webp`;
      const filePath = await downloadFile(s.file_id, name);
      if (filePath) {
        attachments.push({
          type: "sticker",
          filePath,
          mimeType: "image/webp",
        });
      }
    }

    // Video note (round video)
    if (ctx.message?.video_note) {
      const vn = ctx.message.video_note;
      const name = `${Date.now()}.mp4`;
      const filePath = await downloadFile(vn.file_id, name);
      if (filePath) {
        attachments.push({
          type: "video",
          filePath,
          mimeType: "video/mp4",
          duration: vn.duration,
        });
      }
    }

    // Skip if nothing to process
    if (!text && attachments.length === 0) return;

    // Default text for media-only messages
    if (!text && attachments.length > 0) {
      text = `[Sent ${attachments[0]!.type}]`;
    }

    const msg: IncomingMessage = {
      channel: "telegram",
      sender,
      senderName:
        ctx.from?.first_name +
        (ctx.from?.last_name ? ` ${ctx.from.last_name}` : ""),
      text,
      timestamp: ctx.message!.date * 1000,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: ctx,
    };

    const reply: ReplyFn = async (replyText: string) => {
      // Telegram has a 4096 char limit per message
      const chunks = splitMessage(replyText, 4096);
      for (const chunk of chunks) {
        await ctx.reply(chunk);
      }
    };

    try {
      await handler(msg, reply);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[telegram] Handler error: ${errMsg}`);
      try {
        await ctx.reply(`Error: ${errMsg}`);
      } catch {}
    }
  });

  return {
    name: "telegram",

    async start() {
      console.log("[telegram] Starting bot...");

      // Init first to validate token before returning
      await bot.init();
      console.log(`[telegram] Bot initialized: @${bot.botInfo.username}`);

      // Register file sender so agent can send images/files back
      registerChannelSender("telegram", {
        async sendFile({ recipient, filePath, caption }) {
          // Resolve numeric chat ID from sender string
          let chatId: number;
          if (chatIdMap.has(recipient)) {
            chatId = chatIdMap.get(recipient)!;
          } else {
            const parsed = parseInt(recipient, 10);
            if (isNaN(parsed)) throw new Error(`Unknown Telegram recipient: ${recipient}`);
            chatId = parsed;
          }

          const mediaType = detectMediaType(filePath);
          const file = new InputFile(filePath);

          switch (mediaType) {
            case "image":
              await bot.api.sendPhoto(chatId, file, { caption });
              break;
            case "video":
              await bot.api.sendVideo(chatId, file, { caption });
              break;
            case "audio":
              await bot.api.sendAudio(chatId, file, { caption });
              break;
            default:
              await bot.api.sendDocument(chatId, file, { caption });
              break;
          }
          console.log(`[telegram] Sent ${mediaType} to ${recipient}`);
        },
      });

      // Start polling in background (resolves when bot stops)
      bot.start({
        onStart: () => console.log("[telegram] Polling started"),
      }).catch((err) => {
        console.error(`[telegram] Polling error: ${err}`);
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
