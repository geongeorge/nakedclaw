import { readFileSync, existsSync } from "fs";
import {
  listSessions,
  searchMemory,
  getChatHistory,
} from "../memory/store.ts";
import { listJobs } from "../scheduler/scheduler.ts";
import { loadConfig } from "../config.ts";

/**
 * TUI Session Viewer — run with `bun run tui`
 *
 * Interactive terminal UI to browse sessions, search memory,
 * and view chat history.
 */

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const RED = "\x1b[31m";

function print(s: string = "") {
  process.stdout.write(s + "\n");
}

function header(title: string) {
  print(`\n${BOLD}${CYAN}═══ ${title} ═══${RESET}\n`);
}

function printSessions() {
  header("Sessions");
  const sessions = listSessions();

  if (sessions.length === 0) {
    print(`${DIM}  No sessions yet.${RESET}`);
    return;
  }

  for (let i = 0; i < sessions.length; i++) {
    const s = sessions[i]!;
    const age = timeSince(s.lastModified);
    print(
      `  ${BOLD}${GREEN}[${i + 1}]${RESET} ${s.key}  ${DIM}${s.lines} lines • ${age} ago • ${formatBytes(s.sizeBytes)}${RESET}`
    );
  }
}

function printSession(key: string) {
  header(`Chat: ${key}`);
  const history = getChatHistory(key.split("-")[0]!, key.split("-").slice(1).join("-"));

  if (!history) {
    print(`${DIM}  No history for ${key}${RESET}`);
    return;
  }

  // Colorize the markdown
  const lines = history.split("\n");
  for (const line of lines) {
    if (line.startsWith("### **You**")) {
      print(`${BOLD}${YELLOW}${line}${RESET}`);
    } else if (line.startsWith("### **Agent**")) {
      print(`${BOLD}${MAGENTA}${line}${RESET}`);
    } else if (line.startsWith("# ")) {
      print(`${BOLD}${CYAN}${line}${RESET}`);
    } else {
      print(line);
    }
  }
}

function printJobs() {
  header("Scheduled Jobs");
  const jobs = listJobs();

  if (jobs.length === 0) {
    print(`${DIM}  No scheduled jobs.${RESET}`);
    return;
  }

  for (const j of jobs) {
    print(
      `  ${BOLD}${GREEN}•${RESET} ${j.name} ${DIM}(${j.cronExpr})${RESET}`
    );
    print(`    ${DIM}Message: ${j.message}${RESET}`);
    if (j.nextRunAt) {
      print(`    ${DIM}Next: ${new Date(j.nextRunAt).toLocaleString()}${RESET}`);
    }
    print(`    ${DIM}ID: ${j.id}${RESET}`);
    print();
  }
}

function doSearch(query: string) {
  header(`Search: "${query}"`);
  const results = searchMemory(query);

  if (results.length === 0) {
    print(`${DIM}  No results.${RESET}`);
    return;
  }

  for (const r of results) {
    print(`  ${BOLD}${GREEN}${r.key}${RESET}`);
    for (const m of r.matches.slice(0, 5)) {
      const highlighted = m.replace(
        new RegExp(query, "gi"),
        (match) => `${RED}${BOLD}${match}${RESET}`
      );
      print(`    ${highlighted.trim()}`);
    }
    print();
  }
}

function printHelp() {
  header("NakedClaw TUI");
  print(`  ${BOLD}Commands:${RESET}`);
  print(`    ${GREEN}sessions${RESET}       List all sessions`);
  print(`    ${GREEN}view <n>${RESET}       View session by number`);
  print(`    ${GREEN}search <q>${RESET}     Search all chat history`);
  print(`    ${GREEN}jobs${RESET}           List scheduled jobs`);
  print(`    ${GREEN}status${RESET}         Show system status`);
  print(`    ${GREEN}help${RESET}           Show this help`);
  print(`    ${GREEN}quit${RESET}           Exit`);
}

function printStatus() {
  header("Status");
  const config = loadConfig();
  const sessions = listSessions();
  const jobs = listJobs();

  print(`  ${BOLD}Model:${RESET}    ${config.model.name}`);
  print(`  ${BOLD}Workspace:${RESET} ${config.workspace}`);
  print(`  ${BOLD}Sessions:${RESET} ${sessions.length}`);
  print(`  ${BOLD}Jobs:${RESET}     ${jobs.length}`);
  print();
  print(`  ${BOLD}Channels:${RESET}`);
  for (const [name, ch] of Object.entries(config.channels)) {
    const status = ch.enabled ? `${GREEN}enabled${RESET}` : `${DIM}disabled${RESET}`;
    print(`    ${name}: ${status}`);
  }
  print();
  print(`  ${BOLD}Heartbeat:${RESET} ${config.heartbeat.enabled ? "on" : "off"} (${config.heartbeat.cronExpr})`);
}

function timeSince(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

// Main REPL loop
async function main() {
  print(`${BOLD}${CYAN}NakedClaw TUI Session Viewer${RESET}`);
  print(`${DIM}Type "help" for commands, "quit" to exit.${RESET}\n`);

  const prompt = `${BOLD}${CYAN}nakedclaw>${RESET} `;

  for await (const line of console) {
    const input = line.trim();
    if (!input) {
      process.stdout.write(prompt);
      continue;
    }

    const [cmd, ...rest] = input.split(/\s+/);
    const arg = rest.join(" ");

    switch (cmd) {
      case "sessions":
      case "ls":
        printSessions();
        break;

      case "view": {
        const sessions = listSessions();
        const idx = parseInt(arg) - 1;
        if (isNaN(idx) || idx < 0 || idx >= sessions.length) {
          print(`${RED}Invalid session number. Use "sessions" to list.${RESET}`);
        } else {
          printSession(sessions[idx]!.key);
        }
        break;
      }

      case "search":
        if (!arg) {
          print(`${RED}Usage: search <query>${RESET}`);
        } else {
          doSearch(arg);
        }
        break;

      case "jobs":
        printJobs();
        break;

      case "status":
        printStatus();
        break;

      case "help":
      case "?":
        printHelp();
        break;

      case "quit":
      case "exit":
      case "q":
        print(`${DIM}Bye.${RESET}`);
        process.exit(0);

      default:
        print(`${RED}Unknown command: ${cmd}. Type "help" for commands.${RESET}`);
    }

    process.stdout.write(prompt);
  }
}

main().catch(console.error);
