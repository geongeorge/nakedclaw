import { existsSync } from "fs";
import { join } from "path";
import { getStateDir } from "../auth/credentials.ts";
import {
  encode,
  decode,
  SOCKET_FILENAME,
  type ServerMessage,
} from "../daemon/protocol.ts";

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

const sockPath = join(getStateDir(), SOCKET_FILENAME);
const sessionId = `terminal:${process.pid}`;

function showPrompt() {
  process.stdout.write(`${BOLD}${GREEN}you>${RESET} `);
}

async function main() {
  // Check daemon is running
  if (!existsSync(sockPath)) {
    console.log(
      `${RED}Daemon is not running.${RESET} Start it with: ${CYAN}nakedclaw start${RESET}`
    );
    process.exit(1);
  }

  console.log(`${BOLD}${CYAN}NakedClaw${RESET}`);
  console.log(
    `${DIM}Session: ${sessionId} | /help for commands | /quit to exit${RESET}\n`
  );

  let buffer = "";
  let waitingForResponse = false;

  const socket = await Bun.connect({
    unix: sockPath,
    socket: {
      data(_socket, raw) {
        buffer += Buffer.from(raw).toString();

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = decode(line) as ServerMessage;
            handleServerMessage(msg);
          } catch {}
        }
      },

      close() {
        console.log(`\n${DIM}Disconnected from daemon.${RESET}`);
        process.exit(0);
      },

      error(_socket, err) {
        console.error(`${RED}Connection error: ${err.message}${RESET}`);
        process.exit(1);
      },
    },
  });

  function handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "chat_response":
        console.log(`\n${BOLD}${MAGENTA}agent>${RESET} ${msg.text}\n`);
        waitingForResponse = false;
        showPrompt();
        break;

      case "command_response":
        console.log(`\n${msg.text}\n`);
        waitingForResponse = false;
        showPrompt();
        break;

      case "status_response":
        console.log(`\n${BOLD}Status${RESET}`);
        console.log(
          `  Channels: ${msg.channels.length > 0 ? msg.channels.join(", ") : "none"}`
        );
        console.log(`  Sessions: ${msg.sessions}`);
        console.log(`  Jobs:     ${msg.jobs}`);
        console.log(`  Uptime:   ${formatUptime(msg.uptime)}\n`);
        waitingForResponse = false;
        showPrompt();
        break;

      case "error":
        console.log(`\n${RED}Error: ${msg.message}${RESET}\n`);
        waitingForResponse = false;
        showPrompt();
        break;

      case "pong":
        console.log(`${DIM}pong${RESET}`);
        waitingForResponse = false;
        showPrompt();
        break;
    }
  }

  // REPL loop
  showPrompt();
  for await (const line of console) {
    const input = line.trim();
    if (!input) {
      showPrompt();
      continue;
    }

    // Local-only commands
    if (input === "/quit" || input === "/exit" || input === "/q") {
      console.log(`${DIM}Bye.${RESET}`);
      socket.end();
      process.exit(0);
    }

    if (input === "/help") {
      printHelp();
      showPrompt();
      continue;
    }

    if (waitingForResponse) {
      console.log(`${DIM}Waiting for response...${RESET}`);
      showPrompt();
      continue;
    }

    if (input.startsWith("/")) {
      // Send as command to daemon
      const [cmd, ...rest] = input.split(/\s+/);
      socket.write(
        encode({
          type: "command",
          sessionId,
          command: cmd!,
          args: rest.join(" "),
        })
      );
    } else {
      // Send as chat message
      socket.write(
        encode({
          type: "chat",
          sessionId,
          text: input,
        })
      );
      console.log(`${DIM}Thinking...${RESET}`);
    }

    waitingForResponse = true;
  }
}

function printHelp() {
  console.log(`
${BOLD}${CYAN}NakedClaw Commands${RESET}

  ${YELLOW}Chat${RESET}
    Just type a message and press Enter.

  ${YELLOW}Slash Commands${RESET} ${DIM}(handled by daemon)${RESET}
    ${GREEN}/reset${RESET}              Clear session
    ${GREEN}/status${RESET}             System status
    ${GREEN}/memory${RESET}             Show memory index
    ${GREEN}/search <query>${RESET}     Search chat history
    ${GREEN}/schedule <t> <msg>${RESET} Schedule a reminder
    ${GREEN}/jobs${RESET}               List scheduled jobs
    ${GREEN}/cancel <id>${RESET}        Cancel a job
    ${GREEN}/heartbeat${RESET}          Heartbeat status

  ${YELLOW}Local Commands${RESET}
    ${GREEN}/help${RESET}               This help
    ${GREEN}/quit${RESET}               Exit chat
`);
}

function formatUptime(ms: number): string {
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

main().catch((err) => {
  console.error(`${RED}Fatal: ${err.message || err}${RESET}`);
  process.exit(1);
});
