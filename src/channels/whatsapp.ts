import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";
import { mkdirSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import qrcode from "qrcode-terminal";
import type { Attachment, ChannelAdapter, IncomingMessage, ReplyFn } from "./types.ts";
import type { ChannelConfig } from "../config.ts";
import { registerChannelSender, detectMediaType } from "./registry.ts";

const MEDIA_DIR = resolve(import.meta.dir, "../../media/whatsapp");

const MEDIA_TYPES = [
  "audioMessage",
  "imageMessage",
  "videoMessage",
  "documentMessage",
  "stickerMessage",
] as const;

type MediaType = (typeof MEDIA_TYPES)[number];

function mediaTypeToAttachment(type: MediaType): Attachment["type"] {
  switch (type) {
    case "audioMessage": return "audio";
    case "imageMessage": return "image";
    case "videoMessage": return "video";
    case "documentMessage": return "document";
    case "stickerMessage": return "sticker";
  }
}

function extensionForType(type: MediaType, mimetype?: string | null): string {
  if (mimetype) {
    const ext = mimetype.split("/").pop()?.split(";")[0];
    if (ext && ext !== "octet-stream") return `.${ext.replace("x-", "")}`;
  }
  switch (type) {
    case "audioMessage": return ".ogg";
    case "imageMessage": return ".jpg";
    case "videoMessage": return ".mp4";
    case "documentMessage": return ".bin";
    case "stickerMessage": return ".webp";
  }
}

/**
 * Extract text and media info from a WhatsApp message.
 */
function extractContent(msg: WAMessage): {
  text: string;
  mediaType?: MediaType;
  caption?: string;
  mimetype?: string | null;
  ptt?: boolean;
  fileName?: string | null;
  duration?: number;
} {
  const m = msg.message;
  if (!m) return { text: "" };

  // Plain text
  if (m.conversation) return { text: m.conversation };
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text };

  // Media messages
  for (const type of MEDIA_TYPES) {
    const media = m[type];
    if (media) {
      const isVoice = type === "audioMessage" && (media as any).ptt;
      return {
        text: (media as any).caption || "",
        mediaType: type,
        caption: (media as any).caption || undefined,
        mimetype: (media as any).mimetype,
        ptt: isVoice,
        fileName: type === "documentMessage" ? (media as any).fileName : undefined,
        duration: (media as any).seconds,
      };
    }
  }

  return { text: "" };
}

/**
 * Download media from a message and save to disk.
 */
async function saveMedia(
  msg: WAMessage,
  mediaType: MediaType,
  mimetype?: string | null,
  fileName?: string | null
): Promise<string | null> {
  if (!existsSync(MEDIA_DIR)) mkdirSync(MEDIA_DIR, { recursive: true });

  try {
    const buffer = await downloadMediaMessage(msg, "buffer", {});
    const name = fileName || `${Date.now()}${extensionForType(mediaType, mimetype)}`;
    const filePath = join(MEDIA_DIR, name);
    writeFileSync(filePath, buffer as Buffer);
    console.log(`[whatsapp] Saved media: ${filePath}`);
    return filePath;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp] Media download failed: ${errMsg}`);
    return null;
  }
}

export function createWhatsAppAdapter(
  config: ChannelConfig,
  onConnected?: () => void
): ChannelAdapter {
  let sock: WASocket | null = null;
  let handler: ((msg: IncomingMessage, reply: ReplyFn) => void) | null = null;
  const authDir = resolve(import.meta.dir, "../../.wa-auth");

  return {
    name: "whatsapp",

    async start() {
      console.log("[whatsapp] Starting...");
      const { state, saveCreds } = await useMultiFileAuthState(authDir);

      sock = makeWASocket({
        auth: state,
        browser: ["NakedClaw", "Chrome", "1.0.0"],
      });

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Display QR code when received
        if (qr) {
          console.log("\n[whatsapp] Scan this QR code with WhatsApp:\n");
          qrcode.generate(qr, { small: true });
          console.log();
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output
            ?.statusCode;
          if (statusCode !== DisconnectReason.loggedOut) {
            console.log("[whatsapp] Reconnecting...");
            this.start();
          } else {
            console.log("[whatsapp] Logged out");
          }
        } else if (connection === "open") {
          console.log("[whatsapp] Connected");

          // Register file sender so agent can send images/files back
          const currentSock = sock!;
          registerChannelSender("whatsapp", {
            async sendText({ recipient, text }) {
              await currentSock.sendMessage(recipient, { text });
            },

            async sendFile({ recipient, filePath, caption }) {
              const mediaType = detectMediaType(filePath);
              const buffer = readFileSync(filePath);

              switch (mediaType) {
                case "image":
                  await currentSock.sendMessage(recipient, { image: buffer, caption });
                  break;
                case "video":
                  await currentSock.sendMessage(recipient, { video: buffer, caption });
                  break;
                case "audio":
                  await currentSock.sendMessage(recipient, { audio: buffer, ptt: false });
                  break;
                default:
                  await currentSock.sendMessage(recipient, {
                    document: buffer,
                    mimetype: "application/octet-stream",
                    fileName: basename(filePath),
                    caption,
                  });
                  break;
              }
              console.log(`[whatsapp] Sent ${mediaType} to ${recipient}`);
            },
          });

          onConnected?.();
        }
      });

      sock.ev.on("messages.upsert", async ({ messages }) => {
        if (!handler || !sock) return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;

          const sender = msg.key.remoteJid || "";

          // Check allowlist
          if (
            config.allowFrom.length > 0 &&
            !config.allowFrom.some((a) => sender.includes(a.replace("+", "")))
          ) {
            continue;
          }

          const content = extractContent(msg);

          // Skip if no text and no media
          if (!content.text && !content.mediaType) continue;

          // Send typing indicator immediately
          const currentSock = sock;
          try {
            await currentSock.sendPresenceUpdate("composing", sender);
          } catch {
            // Typing indicator is best-effort
          }

          // Download media if present
          const attachments: Attachment[] = [];
          if (content.mediaType) {
            const filePath = await saveMedia(
              msg,
              content.mediaType,
              content.mimetype,
              content.fileName,
            );
            if (filePath) {
              attachments.push({
                type: content.ptt ? "voice" : mediaTypeToAttachment(content.mediaType),
                filePath,
                mimeType: content.mimetype || undefined,
                fileName: content.fileName || undefined,
                duration: content.duration,
                caption: content.caption,
              });
            }
          }

          // Build text for agent — include attachment context
          let text = content.text;
          if (attachments.length > 0 && !text) {
            text = `[Sent ${attachments[0]!.type}]`;
          }

          const incoming: IncomingMessage = {
            channel: "whatsapp",
            sender,
            senderName: msg.pushName || sender,
            text,
            timestamp: (msg.messageTimestamp as number) * 1000,
            attachments: attachments.length > 0 ? attachments : undefined,
            raw: msg,
          };

          const reply: ReplyFn = async (replyText: string) => {
            // Stop typing indicator
            try {
              await currentSock.sendPresenceUpdate("paused", sender);
            } catch {
              // best-effort
            }
            await currentSock.sendMessage(sender, { text: replyText });
          };

          try {
            await handler(incoming, reply);
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(`[whatsapp] Handler error: ${errMsg}`);
            try {
              await currentSock.sendMessage(sender, { text: `Error: ${errMsg}` });
            } catch {}
          }
        }
      });
    },

    async stop() {
      sock?.end(undefined);
      sock = null;
      console.log("[whatsapp] Stopped");
    },

    onMessage(h) {
      handler = h;
    },
  };
}
