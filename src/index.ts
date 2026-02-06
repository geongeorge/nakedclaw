import { writeFileSync, unlinkSync, watch } from "fs";
import { resolve, join } from "path";
import { loadConfig, reloadConfig } from "./config.ts";
import type { ChannelAdapter } from "./channels/types.ts";
import { createTelegramAdapter } from "./channels/telegram.ts";
import { createWhatsAppAdapter } from "./channels/whatsapp.ts";
import { createSlackAdapter } from "./channels/slack.ts";
import { handleMessage } from "./router.ts";
import { ensureMemoryDirs, rebuildMemoryIndex } from "./memory/store.ts";
import {
  initScheduler,
  setJobCallback,
  stopScheduler,
} from "./scheduler/scheduler.ts";
import { startHeartbeat, stopHeartbeat } from "./scheduler/heartbeat.ts";
import { runAgent } from "./agent.ts";
import { sessionKeyFromMessage } from "./session.ts";
import { startDaemonServer, setActiveChannels } from "./daemon/server.ts";
import { getStateDir, ensureStateDir } from "./auth/credentials.ts";
import { PID_FILENAME } from "./daemon/protocol.ts";

/**
 * NakedClaw — daemon entry point.
 *
 * Boots enabled channels, wires them to the message router,
 * starts the heartbeat, scheduler, and Unix socket server, then waits.
 */

async function main() {
  console.log("NakedClaw starting...\n");

  ensureStateDir();
  const config = loadConfig();
  ensureMemoryDirs();
  rebuildMemoryIndex();

  // --- PID file ---
  const pidPath = join(getStateDir(), PID_FILENAME);
  writeFileSync(pidPath, String(process.pid), "utf-8");

  // --- Daemon socket server ---
  const daemonServer = startDaemonServer();

  // --- Scheduler ---
  initScheduler();

  setJobCallback(async (job) => {
    const key = sessionKeyFromMessage(job.channel, job.sender);
    try {
      const result = await runAgent(key, `[Scheduled Reminder] ${job.message}`);
      console.log(
        `[scheduler] Job "${job.name}" result: ${result.text.slice(0, 100)}`
      );
    } catch (err) {
      console.error(`[scheduler] Job error: ${err}`);
    }
  });

  // --- Heartbeat ---
  const heartbeatCallback = async (prompt: string) => {
    try {
      const result = await runAgent("heartbeat:system", prompt);
      console.log(`[heartbeat] Agent: ${result.text.slice(0, 200)}`);
    } catch (err) {
      console.error(`[heartbeat] Error: ${err}`);
    }
  };
  startHeartbeat(heartbeatCallback);

  // --- Channels ---
  // Each channel starts independently — one failing won't crash the others
  const activeAdapters: ChannelAdapter[] = [];

  async function startChannel(
    name: string,
    create: () => ChannelAdapter
  ): Promise<void> {
    try {
      const adapter = create();
      adapter.onMessage(handleMessage);
      await adapter.start();
      activeAdapters.push(adapter);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[${name}] Failed to start: ${errMsg}`);
    }
  }

  if (config.channels.telegram.enabled) {
    await startChannel("telegram", () =>
      createTelegramAdapter(config.channels.telegram)
    );
  }

  if (config.channels.whatsapp.enabled) {
    await startChannel("whatsapp", () =>
      createWhatsAppAdapter(config.channels.whatsapp)
    );
  }

  if (config.channels.slack.enabled) {
    await startChannel("slack", () =>
      createSlackAdapter(config.channels.slack)
    );
  }

  setActiveChannels(activeAdapters.map((a) => a.name));

  if (activeAdapters.length === 0) {
    console.log(
      "No channels enabled. Edit nakedclaw.json5 and set a channel to enabled: true"
    );
    console.log("Then set the required env vars (TELEGRAM_BOT_TOKEN, etc.)");
    console.log("\nRunning in headless mode (heartbeat + scheduler only)...\n");
  } else {
    console.log(
      `\nChannels active: ${activeAdapters.map((a) => a.name).join(", ")}`
    );
  }

  // --- Config watcher ---
  const configPath = resolve(import.meta.dir, "..", "nakedclaw.json5");
  let reloadTimer: ReturnType<typeof setTimeout> | null = null;

  watch(configPath, (event) => {
    if (event !== "change") return;
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      console.log("[config] Change detected, reloading...");
      try {
        reloadConfig();
        stopHeartbeat();
        startHeartbeat(heartbeatCallback);
        console.log(
          "[config] Reloaded. Heartbeat/scheduler updated. Channel changes require daemon restart."
        );
      } catch (err) {
        console.error(`[config] Reload error: ${err}`);
      }
    }, 300);
  });

  console.log("NakedClaw is running. Press Ctrl+C to stop.\n");

  // --- Graceful shutdown ---
  const shutdown = async () => {
    console.log("\nShutting down...");
    daemonServer.stop();
    stopHeartbeat();
    stopScheduler();
    for (const adapter of activeAdapters) {
      await adapter.stop();
    }
    try {
      unlinkSync(pidPath);
    } catch {}
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
