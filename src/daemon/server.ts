import { existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { Socket } from "bun";
import { getStateDir } from "../auth/credentials.ts";
import {
  encode,
  decode,
  SOCKET_FILENAME,
  type ClientMessage,
  type ServerMessage,
} from "./protocol.ts";
import { handleMessage } from "../router.ts";
import { listSessions } from "../memory/store.ts";
import { listJobs } from "../scheduler/scheduler.ts";
import type { IncomingMessage, ReplyFn } from "../channels/types.ts";

type ClientSocket = Socket<{ buffer: string }>;

const clients = new Map<ClientSocket, string>(); // socket → sessionId
let startTime = Date.now();
let activeChannelNames: string[] = [];

export function setActiveChannels(names: string[]): void {
  activeChannelNames = names;
}

export function sendToTerminalSession(sessionId: string, text: string): boolean {
  let sent = false;
  for (const [socket, sid] of clients.entries()) {
    if (sid !== sessionId) continue;
    socket.write(
      encode({
        type: "chat_response",
        sessionId,
        text,
        done: true,
      })
    );
    sent = true;
  }
  return sent;
}

export function startDaemonServer(): { stop: () => void } {
  const socketPath = join(getStateDir(), SOCKET_FILENAME);
  startTime = Date.now();

  // Remove stale socket file
  if (existsSync(socketPath)) {
    unlinkSync(socketPath);
  }

  const server = Bun.listen<{ buffer: string }>({
    unix: socketPath,
    socket: {
      open(socket) {
        socket.data = { buffer: "" };
      },

      data(socket, raw) {
        socket.data.buffer += Buffer.from(raw).toString();

        // Process complete NDJSON lines
        const lines = socket.data.buffer.split("\n");
        socket.data.buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = decode(line) as ClientMessage;
            handleClientMessage(socket, msg);
          } catch (err) {
            const errMsg =
              err instanceof Error ? err.message : String(err);
            socket.write(
              encode({ type: "error", message: `Parse error: ${errMsg}` })
            );
          }
        }
      },

      close(socket) {
        clients.delete(socket);
      },

      error(socket, err) {
        console.error(`[daemon] Socket error: ${err.message}`);
        clients.delete(socket);
      },
    },
  });

  console.log(`[daemon] Listening on ${socketPath}`);

  return {
    stop() {
      server.stop();
      if (existsSync(socketPath)) {
        unlinkSync(socketPath);
      }
    },
  };
}

async function handleClientMessage(
  socket: ClientSocket,
  msg: ClientMessage
): Promise<void> {
  switch (msg.type) {
    case "ping": {
      socket.write(encode({ type: "pong" }));
      break;
    }

    case "status": {
      const sessions = listSessions();
      const jobs = listJobs();
      const response: ServerMessage = {
        type: "status_response",
        running: true,
        channels: activeChannelNames,
        uptime: Date.now() - startTime,
        sessions: sessions.length,
        jobs: jobs.length,
      };
      socket.write(encode(response));
      break;
    }

    case "chat": {
      clients.set(socket, msg.sessionId);

      const incoming: IncomingMessage = {
        channel: "terminal",
        sender: msg.sessionId,
        senderName: msg.sessionId,
        text: msg.text,
        timestamp: Date.now(),
      };

      const reply: ReplyFn = async (text: string) => {
        socket.write(
          encode({
            type: "chat_response",
            sessionId: msg.sessionId,
            text,
            done: true,
          })
        );
      };

      try {
        await handleMessage(incoming, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        socket.write(encode({ type: "error", message: errMsg }));
      }
      break;
    }

    case "command": {
      clients.set(socket, msg.sessionId);

      // Route commands through the router as if they were messages
      const commandText = msg.args
        ? `${msg.command} ${msg.args}`
        : msg.command;

      const incoming: IncomingMessage = {
        channel: "terminal",
        sender: msg.sessionId,
        senderName: msg.sessionId,
        text: commandText,
        timestamp: Date.now(),
      };

      const reply: ReplyFn = async (text: string) => {
        socket.write(encode({ type: "command_response", text }));
      };

      try {
        await handleMessage(incoming, reply);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        socket.write(encode({ type: "error", message: errMsg }));
      }
      break;
    }
  }
}
