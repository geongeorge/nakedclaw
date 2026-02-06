#!/usr/bin/env bun

/**
 * Interactive TUI for browsing NakedClaw sessions.
 *
 * Features:
 *   - Live session list with arrow-key navigation
 *   - Enter to view messages, Esc/q to go back
 *   - Auto-refreshes when session files change on disk
 *   - j/k vim keys, PgUp/PgDown, Home/End
 */

import {
  readdirSync,
  readFileSync,
  existsSync,
  statSync,
  unlinkSync,
  watch,
} from "node:fs";
import { resolve, join } from "node:path";
import { loadConfig } from "../config.ts";
import type { SessionMessage } from "../session.ts";

// ── ANSI helpers ──────────────────────────────────────────────

const write = (s: string) => process.stdout.write(s);

const CLEAR = "\x1b[2J\x1b[H";
const HIDE_CUR = "\x1b[?25l";
const SHOW_CUR = "\x1b[?25h";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const GRAY = "\x1b[90m";
const BG_SEL = "\x1b[48;5;236m";
const CLEAR_LINE = "\x1b[2K";

const CHANNEL_ICON: Record<string, string> = {
  telegram: "✈",
  whatsapp: "☏",
  slack: "#",
  terminal: "›",
};
const CHANNEL_COLOR: Record<string, string> = {
  telegram: BLUE,
  whatsapp: GREEN,
  slack: MAGENTA,
  terminal: CYAN,
};

// ── Types ─────────────────────────────────────────────────────

type SessionInfo = {
  key: string;
  channel: string;
  sender: string;
  messageCount: number;
  lastActive: Date;
  sizeBytes: number;
  preview: string;
};

type Screen = "list" | "detail";

// ── State ─────────────────────────────────────────────────────

let screen: Screen = "list";
let sel = 0;
let listScroll = 0;
let detailScroll = 0;
let sessions: SessionInfo[] = [];
let detailLines: string[] = [];
let detailKey = "";
let rows = process.stdout.rows || 24;
let cols = process.stdout.columns || 80;

// ── Session I/O ───────────────────────────────────────────────

function sessionDir(): string {
  return resolve(loadConfig().sessions.dir);
}

function loadSessions(): SessionInfo[] {
  const dir = sessionDir();
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const filePath = join(dir, f);
      const key = f.replace(".jsonl", "");
      const colon = key.indexOf(":");
      const channel = colon >= 0 ? key.slice(0, colon) : "unknown";
      const sender = colon >= 0 ? key.slice(colon + 1) : key;

      const raw = readFileSync(filePath, "utf-8");
      const lines = raw.split("\n").filter((l) => l.trim());
      const stat = statSync(filePath);

      // Preview: last user message
      let preview = "";
      for (let i = lines.length - 1; i >= 0; i--) {
        try {
          const m = JSON.parse(lines[i]!) as SessionMessage;
          if (m.role === "user") {
            preview = m.content.replace(/\n/g, " ").slice(0, 80);
            break;
          }
        } catch {}
      }
      if (!preview && lines.length > 0) {
        try {
          const m = JSON.parse(lines[lines.length - 1]!) as SessionMessage;
          preview = m.content.replace(/\n/g, " ").slice(0, 80);
        } catch {}
      }

      return {
        key,
        channel,
        sender,
        messageCount: lines.length,
        lastActive: stat.mtime,
        sizeBytes: stat.size,
        preview,
      };
    })
    .sort((a, b) => b.lastActive.getTime() - a.lastActive.getTime());
}

function loadMessages(key: string): SessionMessage[] {
  const fp = join(sessionDir(), `${key}.jsonl`);
  if (!existsSync(fp)) return [];
  return readFileSync(fp, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as SessionMessage;
      } catch {
        return null;
      }
    })
    .filter((m): m is SessionMessage => m !== null);
}

// ── Formatters ────────────────────────────────────────────────

function ago(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function fmtSize(b: number): string {
  if (b < 1024) return `${b}B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)}K`;
  return `${(b / 1048576).toFixed(1)}M`;
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function trunc(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

// ── Renderers ─────────────────────────────────────────────────

function renderList() {
  write(CLEAR + HIDE_CUR);

  // Header
  write(
    ` ${BOLD}${CYAN}NakedClaw Sessions${RESET}  ${GRAY}${sessions.length} session${sessions.length !== 1 ? "s" : ""}  (live)${RESET}\n`
  );
  write(`${GRAY}${"─".repeat(Math.min(cols, 90))}${RESET}\n`);

  if (sessions.length === 0) {
    write(`\n  ${GRAY}No sessions yet. Start chatting to create one.${RESET}\n`);
    write(`\n${GRAY}  q quit${RESET}\n`);
    return;
  }

  const listH = rows - 5;
  if (sel < listScroll) listScroll = sel;
  if (sel >= listScroll + listH) listScroll = sel - listH + 1;

  const visible = sessions.slice(listScroll, listScroll + listH);

  for (let i = 0; i < visible.length; i++) {
    const s = visible[i]!;
    const idx = listScroll + i;
    const isSel = idx === sel;

    const icon = CHANNEL_ICON[s.channel] || "•";
    const cc = CHANNEL_COLOR[s.channel] || "";
    const bg = isSel ? BG_SEL : "";
    const ptr = isSel ? `${CYAN}▸${RESET}` : " ";

    const tag = `${cc}${icon} ${s.channel.padEnd(9)}${RESET}`;
    const name = `${BOLD}${trunc(s.sender, 22).padEnd(22)}${RESET}`;
    const cnt = `${GRAY}${String(s.messageCount).padStart(3)} msg${RESET}`;
    const time = `${GRAY}${ago(s.lastActive).padStart(4)}${RESET}`;

    const usedCols = 1 + 2 + 10 + 22 + 8 + 5 + 3;
    const previewMax = Math.max(10, cols - usedCols);
    const pv = s.preview
      ? `${GRAY}${trunc(s.preview, previewMax)}${RESET}`
      : "";

    write(`${bg} ${ptr} ${tag}${name} ${cnt} ${time}  ${pv}${RESET}\n`);
  }

  // Scroll bar hint
  if (sessions.length > listH) {
    const pct = Math.round(
      (listScroll / Math.max(1, sessions.length - listH)) * 100
    );
    write(`\n${GRAY}  ↕ ${pct}%${RESET}\n`);
  } else {
    write("\n");
  }

  write(
    `${GRAY}  ↑↓/j/k navigate  Enter view  d delete  r refresh  q quit${RESET}\n`
  );
}

function buildDetailLines(messages: SessionMessage[]): string[] {
  const out: string[] = [];
  let lastDate = "";

  for (const msg of messages) {
    const date = fmtDate(msg.timestamp);
    if (date !== lastDate) {
      out.push("");
      out.push(`  ${GRAY}── ${date} ──${RESET}`);
      lastDate = date;
    }

    const time = fmtTime(msg.timestamp);
    const isUser = msg.role === "user";
    const rc = isUser ? YELLOW : GREEN;
    const label = isUser ? "You" : "Agent";
    const ch =
      msg.channel && msg.sender
        ? `${GRAY} via ${msg.channel}${RESET}`
        : "";

    out.push(`  ${rc}${BOLD}${label}${RESET} ${GRAY}${time}${ch}${RESET}`);

    for (const line of msg.content.split("\n")) {
      if (line.length <= cols - 6) {
        out.push(`    ${line}`);
      } else {
        let rem = line;
        while (rem.length > 0) {
          out.push(`    ${rem.slice(0, cols - 6)}`);
          rem = rem.slice(cols - 6);
        }
      }
    }
    out.push("");
  }

  return out;
}

function renderDetail() {
  write(CLEAR + HIDE_CUR);

  const s = sessions[sel];
  if (!s) return;

  const icon = CHANNEL_ICON[s.channel] || "•";
  const cc = CHANNEL_COLOR[s.channel] || "";
  write(
    ` ${BOLD}${cc}${icon} ${s.channel}${RESET}  ${BOLD}${s.sender}${RESET}  ${GRAY}${detailLines.length} lines  ${s.messageCount} messages${RESET}\n`
  );
  write(`${GRAY}${"─".repeat(Math.min(cols, 90))}${RESET}\n`);

  if (detailLines.length === 0) {
    write(`\n  ${GRAY}Empty session.${RESET}\n`);
    write(`\n${GRAY}  q/Esc back${RESET}\n`);
    return;
  }

  const viewH = rows - 5;
  const maxScroll = Math.max(0, detailLines.length - viewH);
  if (detailScroll > maxScroll) detailScroll = maxScroll;

  const visible = detailLines.slice(detailScroll, detailScroll + viewH);
  for (const line of visible) {
    write(line + "\n");
  }

  // Pad if fewer lines than viewport
  const pad = viewH - visible.length;
  for (let i = 0; i < pad; i++) write("\n");

  if (detailLines.length > viewH) {
    const pct =
      maxScroll > 0 ? Math.round((detailScroll / maxScroll) * 100) : 100;
    write(
      `${GRAY}  ↕ ${pct}%  line ${detailScroll + 1}–${Math.min(detailScroll + viewH, detailLines.length)} of ${detailLines.length}${RESET}\n`
    );
  } else {
    write("\n");
  }

  write(
    `${GRAY}  ↑↓/j/k scroll  PgUp/PgDn page  g/G top/bottom  q/Esc back${RESET}\n`
  );
}

function render() {
  if (screen === "list") renderList();
  else renderDetail();
}

// ── Actions ───────────────────────────────────────────────────

function refresh() {
  sessions = loadSessions();
  if (sel >= sessions.length) sel = Math.max(0, sessions.length - 1);

  // If viewing a detail, refresh it too
  if (screen === "detail" && detailKey) {
    const msgs = loadMessages(detailKey);
    detailLines = buildDetailLines(msgs);
  }

  render();
}

function openDetail() {
  if (sessions.length === 0) return;
  const s = sessions[sel];
  if (!s) return;

  detailKey = s.key;
  const msgs = loadMessages(s.key);
  detailLines = buildDetailLines(msgs);
  // Start scrolled to bottom so you see the latest messages
  const viewH = rows - 5;
  detailScroll = Math.max(0, detailLines.length - viewH);
  screen = "detail";
  render();
}

function deleteSession() {
  if (sessions.length === 0) return;
  const s = sessions[sel];
  if (!s) return;

  const fp = join(sessionDir(), `${s.key}.jsonl`);
  if (existsSync(fp)) unlinkSync(fp);

  sessions = loadSessions();
  if (sel >= sessions.length) sel = Math.max(0, sessions.length - 1);
  render();
}

// ── Input handling ────────────────────────────────────────────

function handleKey(buf: Buffer) {
  const s = buf.toString();

  // Ctrl+C always exits
  if (s === "\x03") {
    cleanup();
    process.exit(0);
  }

  if (screen === "list") listKey(s);
  else detailKey_(s);
}

function listKey(s: string) {
  switch (s) {
    case "\x1b[A": // Up
    case "k":
      if (sel > 0) { sel--; render(); }
      break;
    case "\x1b[B": // Down
    case "j":
      if (sel < sessions.length - 1) { sel++; render(); }
      break;
    case "\r": // Enter
    case "\n":
      openDetail();
      break;
    case "d":
      deleteSession();
      break;
    case "r":
      refresh();
      break;
    case "q":
      cleanup();
      process.exit(0);
  }
}

function detailKey_(s: string) {
  const pageH = rows - 6;
  const maxScroll = Math.max(0, detailLines.length - (rows - 5));

  switch (s) {
    case "\x1b[A": // Up
    case "k":
      if (detailScroll > 0) { detailScroll--; render(); }
      break;
    case "\x1b[B": // Down
    case "j":
      if (detailScroll < maxScroll) { detailScroll++; render(); }
      break;
    case "\x1b[5~": // PgUp
      detailScroll = Math.max(0, detailScroll - pageH);
      render();
      break;
    case "\x1b[6~": // PgDn
      detailScroll = Math.min(maxScroll, detailScroll + pageH);
      render();
      break;
    case "g": // Top
      detailScroll = 0;
      render();
      break;
    case "G": // Bottom
      detailScroll = maxScroll;
      render();
      break;
    case "q":
    case "\x1b": // Esc (single byte)
      screen = "list";
      render();
      break;
  }
}

// ── Lifecycle ─────────────────────────────────────────────────

function cleanup() {
  write(SHOW_CUR + CLEAR);
  if (watcher) watcher.close();
  process.stdin.setRawMode(false);
}

// Watch sessions dir for live updates
let watcher: ReturnType<typeof watch> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function startWatcher() {
  const dir = sessionDir();
  if (!existsSync(dir)) return;

  try {
    watcher = watch(dir, () => {
      // Debounce — files change rapidly during a conversation
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refresh(), 300);
    });
  } catch {
    // watch not supported on this FS — degrade gracefully
  }
}

// ── Main ──────────────────────────────────────────────────────

if (!process.stdin.isTTY) {
  console.error("nakedclaw sessions requires an interactive terminal.");
  process.exit(1);
}

process.stdout.on("resize", () => {
  rows = process.stdout.rows || 24;
  cols = process.stdout.columns || 80;
  render();
});

sessions = loadSessions();
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.on("data", handleKey);

process.on("SIGINT", () => {
  cleanup();
  process.exit(0);
});

startWatcher();
render();
