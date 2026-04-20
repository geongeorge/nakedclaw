import { existsSync } from "fs";
import { join } from "path";
import { getStateDir } from "../auth/credentials.ts";
import {
  encode,
  decode,
  SOCKET_FILENAME,
  type ServerMessage,
} from "../daemon/protocol.ts";
import { TerminalUI } from "../ui/terminal.ts";

const sockPath = join(getStateDir(), SOCKET_FILENAME);
const sessionId = `terminal:${process.pid}`;

async function main() {
  // Check daemon is running
  if (!existsSync(sockPath)) {
    console.error(`Daemon not running. Start it with: nakedclaw start`);
    process.exit(1);
  }

  const socket = await Bun.connect({
    unix: sockPath,
    socket: {
      data(_socket, raw) {
        const lines = Buffer.from(raw).toString().split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = decode(line) as ServerMessage;
            handleServerMessage(msg);
          } catch {}
        }
      },
      close() {
        process.exit(0);
      },
      error(_socket, err) {
        process.exit(1);
      },
    },
  });

  const ui = new TerminalUI(async (text) => {
    if (text.startsWith("/")) {
      const [cmd, ...rest] = text.split(/\s+/);
      socket.write(encode({ type: "command", sessionId, command: cmd!, args: rest.join(" ") }));
    } else {
      socket.write(encode({ type: "chat", sessionId, text }));
    }
  });

  function handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "chat_response":
        ui.hideThinking();
        ui.addMessage("agent", msg.text);
        break;

      case "command_response":
        ui.hideThinking();
        ui.addMessage("agent", msg.text);
        break;

      case "model_info":
        ui.setModelStatus(
          msg.provider === "openrouter" ? "cloud" : "local",
          msg.modelName,
          msg.provider
        );
        break;

      case "error":
        ui.hideThinking();
        ui.addMessage("agent", `❌ Error: ${msg.message}`);
        break;
    }
  }

  // Initial status request to get model info
  socket.write(encode({ type: "status" }));
  
  await ui.start();
}

main().catch(() => process.exit(1));
