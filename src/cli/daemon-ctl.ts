import { existsSync, readFileSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import { getStateDir, ensureStateDir } from "../auth/credentials.ts";
import {
  PID_FILENAME,
  SOCKET_FILENAME,
  LOG_DIR,
  LOG_FILENAME,
  encode,
  decode,
  type ServerMessage,
} from "../daemon/protocol.ts";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function getPaths() {
  const stateDir = getStateDir();
  return {
    pid: join(stateDir, PID_FILENAME),
    sock: join(stateDir, SOCKET_FILENAME),
    logsDir: join(stateDir, LOG_DIR),
    logFile: join(stateDir, LOG_DIR, LOG_FILENAME),
  };
}

function isDaemonRunning(): { running: boolean; pid?: number } {
  const { pid: pidPath } = getPaths();
  if (!existsSync(pidPath)) return { running: false };

  const pid = parseInt(readFileSync(pidPath, "utf-8").trim());
  if (isNaN(pid)) return { running: false };

  try {
    process.kill(pid, 0); // signal 0 = check if alive
    return { running: true, pid };
  } catch {
    return { running: false };
  }
}

export async function startDaemon(): Promise<void> {
  ensureStateDir();
  const paths = getPaths();

  const status = isDaemonRunning();
  if (status.running) {
    console.log(
      `${GREEN}Daemon already running${RESET} (PID ${status.pid})`
    );
    return;
  }

  mkdirSync(paths.logsDir, { recursive: true });

  // Resolve the daemon entry point relative to this file
  const daemonEntry = resolve(import.meta.dir, "../index.ts");

  // Spawn detached daemon via nohup so it survives parent exit
  const proc = Bun.spawn(
    ["sh", "-c", `nohup bun run "${daemonEntry}" >> "${paths.logFile}" 2>&1 &`],
    { stdio: ["ignore", "ignore", "ignore"] }
  );

  // Wait for the daemon to write its PID file
  await proc.exited;
  let started = false;
  for (let i = 0; i < 20; i++) {
    await Bun.sleep(250);
    if (isDaemonRunning().running) {
      started = true;
      break;
    }
  }

  if (started) {
    const { pid } = isDaemonRunning();
    console.log(`${GREEN}Daemon started${RESET} (PID ${pid})`);
    console.log(`${DIM}Logs: ${paths.logFile}${RESET}`);
  } else {
    console.log(`${RED}Daemon failed to start.${RESET} Check logs:`);
    console.log(`  ${paths.logFile}`);
  }
}

export async function stopDaemon(): Promise<void> {
  const status = isDaemonRunning();
  if (!status.running) {
    console.log(`${DIM}Daemon is not running.${RESET}`);
    return;
  }

  process.kill(status.pid!, "SIGTERM");
  console.log(`Sent SIGTERM to daemon (PID ${status.pid})...`);

  for (let i = 0; i < 20; i++) {
    await Bun.sleep(250);
    if (!isDaemonRunning().running) {
      console.log(`${GREEN}Daemon stopped.${RESET}`);
      return;
    }
  }

  console.log("Daemon did not stop in time. Force killing...");
  try {
    process.kill(status.pid!, "SIGKILL");
  } catch {}
  console.log(`${GREEN}Daemon killed.${RESET}`);
}

export async function restartDaemon(): Promise<void> {
  const status = isDaemonRunning();
  if (status.running) {
    await stopDaemon();
  }
  await startDaemon();
}

export async function showStatus(): Promise<void> {
  const status = isDaemonRunning();
  if (!status.running) {
    console.log(`${BOLD}NakedClaw${RESET} — ${RED}not running${RESET}`);
    console.log(`\nStart with: ${CYAN}nakedclaw start${RESET}`);
    return;
  }

  console.log(
    `${BOLD}NakedClaw${RESET} — ${GREEN}running${RESET} (PID ${status.pid})`
  );

  // Try to get detailed status from the daemon socket
  const { sock } = getPaths();
  if (!existsSync(sock)) {
    console.log(`${DIM}Socket not found — daemon may still be starting${RESET}`);
    return;
  }

  try {
    const statusData = await queryDaemonStatus(sock);
    if (statusData) {
      console.log(
        `  Channels: ${statusData.channels.length > 0 ? statusData.channels.join(", ") : "none"}`
      );
      console.log(`  Sessions: ${statusData.sessions}`);
      console.log(`  Jobs:     ${statusData.jobs}`);
      console.log(`  Uptime:   ${formatUptime(statusData.uptime)}`);
    }
  } catch {
    console.log(`${DIM}Could not query daemon for details.${RESET}`);
  }
}

async function queryDaemonStatus(
  sockPath: string
): Promise<Extract<ServerMessage, { type: "status_response" }> | null> {
  let resolvePromise!: (val: Extract<ServerMessage, { type: "status_response" }> | null) => void;
  const promise = new Promise<Extract<ServerMessage, { type: "status_response" }> | null>(
    (resolve) => { resolvePromise = resolve; }
  );

  let buffer = "";
  let settled = false;
  const timeout = setTimeout(() => {
    if (!settled) { settled = true; resolvePromise(null); }
  }, 3000);

  try {
    await Bun.connect({
      unix: sockPath,
      socket: {
        open(socket) {
          socket.write(encode({ type: "status" }));
        },
        data(_socket, raw) {
          buffer += Buffer.from(raw).toString();
          const lines = buffer.split("\n");
          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const msg = decode(line) as ServerMessage;
              if (msg.type === "status_response" && !settled) {
                settled = true;
                clearTimeout(timeout);
                _socket.end();
                resolvePromise(msg);
                return;
              }
            } catch {}
          }
        },
        close() {
          if (!settled) { settled = true; clearTimeout(timeout); resolvePromise(null); }
        },
        error() {
          if (!settled) { settled = true; clearTimeout(timeout); resolvePromise(null); }
        },
      },
    });
  } catch {
    if (!settled) { settled = true; clearTimeout(timeout); resolvePromise(null); }
  }

  return promise;
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

export async function showLogs(): Promise<void> {
  const { logFile } = getPaths();
  if (!existsSync(logFile)) {
    console.log(`${DIM}No log file found.${RESET}`);
    return;
  }
  const content = readFileSync(logFile, "utf-8");
  const lines = content.split("\n");
  // Show last 50 lines
  const tail = lines.slice(-50).join("\n");
  console.log(tail);
}
