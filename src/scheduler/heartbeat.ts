import { Cron } from "croner";
import { loadHeartbeatPrompt } from "../brain/loader.ts";
import { loadConfig } from "../config.ts";

/**
 * Heartbeat — a recurring cron that triggers the agent to do something.
 * Default: every hour, "Check for pending tasks, review memory, and report status."
 *
 * The heartbeat fires the agent with the configured prompt.
 * The agent can then check its memory, run pending tasks, etc.
 */

type HeartbeatCallback = (prompt: string) => void | Promise<void>;

let cronJob: Cron | null = null;
let isRunning = false;

export function startHeartbeat(onBeat: HeartbeatCallback): void {
  const config = loadConfig();
  if (!config.heartbeat.enabled) {
    console.log("[heartbeat] Disabled in config");
    return;
  }

  if (cronJob) {
    cronJob.stop();
  }

  cronJob = new Cron(config.heartbeat.cronExpr, async () => {
    if (isRunning) {
      console.log("[heartbeat] Skipping — previous beat still running");
      return;
    }

    isRunning = true;
    console.log(`[heartbeat] Beat at ${new Date().toISOString()}`);

    try {
      const prompt = await loadHeartbeatPrompt();
      await onBeat(prompt);
    } finally {
      isRunning = false;
    }
  });

  const next = cronJob.nextRun();
  console.log(
    `[heartbeat] Started (${config.heartbeat.cronExpr}), next: ${next?.toISOString()}`
  );
}

export function stopHeartbeat(): void {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log("[heartbeat] Stopped");
  }
}

export function getHeartbeatStatus(): {
  enabled: boolean;
  running: boolean;
  nextRun: string | null;
  cronExpr: string;
} {
  const config = loadConfig();
  return {
    enabled: config.heartbeat.enabled,
    running: !!cronJob,
    nextRun: cronJob?.nextRun()?.toISOString() || null,
    cronExpr: config.heartbeat.cronExpr,
  };
}
