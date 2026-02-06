/**
 * NDJSON protocol for daemon ↔ CLI communication over Unix socket.
 * Each message is a single JSON line terminated by \n.
 */

// --- Client → Daemon ---

export type ClientMessage =
  | { type: "chat"; sessionId: string; text: string }
  | { type: "command"; sessionId: string; command: string; args: string }
  | { type: "status" }
  | { type: "ping" };

// --- Daemon → Client ---

export type ServerMessage =
  | {
      type: "chat_response";
      sessionId: string;
      text: string;
      done: boolean;
    }
  | {
      type: "status_response";
      running: boolean;
      channels: string[];
      uptime: number;
      sessions: number;
      jobs: number;
    }
  | { type: "command_response"; text: string }
  | { type: "error"; message: string }
  | { type: "pong" };

// --- Encoding ---

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg) + "\n";
}

export function decode(line: string): ClientMessage | ServerMessage {
  return JSON.parse(line.trim());
}

// --- Paths ---

export const SOCKET_FILENAME = "daemon.sock";
export const PID_FILENAME = "daemon.pid";
export const LOG_DIR = "logs";
export const LOG_FILENAME = "daemon.log";
