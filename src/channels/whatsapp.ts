import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  type WASocket,
} from "@whiskeysockets/baileys";
import { resolve } from "path";
import qrcode from "qrcode-terminal";
import type { ChannelAdapter, IncomingMessage, ReplyFn } from "./types.ts";
import type { ChannelConfig } from "../config.ts";

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
          onConnected?.();
        }
      });

      sock.ev.on("messages.upsert", async ({ messages }) => {
        if (!handler || !sock) return;

        for (const msg of messages) {
          if (!msg.message || msg.key.fromMe) continue;

          const text =
            msg.message.conversation ||
            msg.message.extendedTextMessage?.text;
          if (!text) continue;

          const sender = msg.key.remoteJid || "";

          // Check allowlist
          if (
            config.allowFrom.length > 0 &&
            !config.allowFrom.some((a) => sender.includes(a.replace("+", "")))
          ) {
            continue;
          }

          const incoming: IncomingMessage = {
            channel: "whatsapp",
            sender,
            senderName: msg.pushName || sender,
            text,
            timestamp: (msg.messageTimestamp as number) * 1000,
            raw: msg,
          };

          const currentSock = sock;
          const reply: ReplyFn = async (replyText: string) => {
            await currentSock.sendMessage(sender, { text: replyText });
          };

          handler(incoming, reply);
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
