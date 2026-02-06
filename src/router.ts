import type { IncomingMessage, ReplyFn } from "./channels/types.ts";
import { runAgent } from "./agent.ts";
import { appendMessage, sessionKeyFromMessage } from "./session.ts";
import {
  appendChat,
  rebuildMemoryIndex,
  searchMemory,
  listSessions,
} from "./memory/store.ts";
import { clearSession } from "./session.ts";
import {
  addJob,
  listJobs,
  removeJob,
  parseTimeToJob,
} from "./scheduler/scheduler.ts";
import { getHeartbeatStatus } from "./scheduler/heartbeat.ts";

/**
 * Message router: incoming message → command check → agent → reply.
 * Also handles slash commands before they reach the agent.
 */

export async function handleMessage(
  msg: IncomingMessage,
  reply: ReplyFn
): Promise<void> {
  const key = sessionKeyFromMessage(msg.channel, msg.sender);
  const text = msg.text.trim();

  console.log(`[router] ${msg.channel}:${msg.sender} → "${text.slice(0, 80)}"`);

  // Check for slash commands
  if (text.startsWith("/")) {
    const handled = await handleCommand(text, msg, reply, key);
    if (handled) return;
  }

  // Save user message
  appendMessage(key, {
    role: "user",
    content: text,
    timestamp: msg.timestamp,
    channel: msg.channel,
    sender: msg.sender,
  });
  appendChat(msg.channel, msg.sender, "user", text);

  // Run agent
  try {
    const result = await runAgent(key, text);

    // Save agent response
    appendMessage(key, {
      role: "assistant",
      content: result.text,
      timestamp: Date.now(),
    });
    appendChat(msg.channel, msg.sender, "assistant", result.text);

    await reply(result.text);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[router] Agent error: ${errMsg}`);
    await reply(`Error: ${errMsg}`);
  }
}

async function handleCommand(
  text: string,
  msg: IncomingMessage,
  reply: ReplyFn,
  sessionKey: string
): Promise<boolean> {
  const [cmd, ...args] = text.split(/\s+/);
  const arg = args.join(" ");

  switch (cmd) {
    case "/reset": {
      clearSession(sessionKey);
      await reply("Session cleared.");
      return true;
    }

    case "/status": {
      const sessions = listSessions();
      const heartbeat = getHeartbeatStatus();
      const jobs = listJobs();

      let status = `NakedClaw Status\n`;
      status += `Sessions: ${sessions.length}\n`;
      status += `Scheduled jobs: ${jobs.length}\n`;
      status += `Heartbeat: ${heartbeat.enabled ? "on" : "off"}`;
      if (heartbeat.nextRun) status += ` (next: ${heartbeat.nextRun})`;
      await reply(status);
      return true;
    }

    case "/memory": {
      const index = rebuildMemoryIndex();
      // Truncate for messaging
      const truncated =
        index.length > 3000 ? index.slice(0, 3000) + "\n..." : index;
      await reply(truncated);
      return true;
    }

    case "/search": {
      if (!arg) {
        await reply("Usage: /search <query>");
        return true;
      }
      const results = searchMemory(arg);
      if (results.length === 0) {
        await reply(`No results for "${arg}"`);
      } else {
        let out = `Search: "${arg}"\n\n`;
        for (const r of results.slice(0, 5)) {
          out += `${r.key}:\n`;
          for (const m of r.matches.slice(0, 3)) {
            out += `  ${m.trim()}\n`;
          }
          out += "\n";
        }
        await reply(out);
      }
      return true;
    }

    case "/schedule": {
      if (!arg) {
        await reply(
          "Usage: /schedule <time> <message>\nExamples:\n  /schedule at 10 Check email\n  /schedule in 30 minutes Call mom\n  /schedule every day at 9am Morning review"
        );
        return true;
      }

      // Try to split time from message: find where the reminder text starts
      const parsed = tryParseSchedule(arg, msg.channel, msg.sender);
      if (!parsed) {
        await reply(
          "Couldn't parse time. Try:\n  at 10, at 3pm, in 30 minutes, every day at 9am"
        );
        return true;
      }

      const job = addJob(parsed.job);
      await reply(
        `Scheduled: "${parsed.job.name}" → "${parsed.reminderText}"\nID: ${job.id}\nNext: ${job.nextRunAt ? new Date(job.nextRunAt).toISOString() : "soon"}`
      );
      return true;
    }

    case "/jobs": {
      const jobs = listJobs();
      if (jobs.length === 0) {
        await reply("No scheduled jobs.");
      } else {
        let out = "Scheduled Jobs:\n\n";
        for (const j of jobs) {
          out += `• ${j.name} (${j.cronExpr})`;
          if (j.nextRunAt) out += ` → next: ${new Date(j.nextRunAt).toLocaleString()}`;
          out += `\n  Message: ${j.message}\n  ID: ${j.id}\n\n`;
        }
        await reply(out);
      }
      return true;
    }

    case "/cancel": {
      if (!arg) {
        await reply("Usage: /cancel <job-id>");
        return true;
      }
      const removed = removeJob(arg);
      await reply(removed ? "Job cancelled." : "Job not found.");
      return true;
    }

    case "/heartbeat": {
      const hb = getHeartbeatStatus();
      await reply(
        `Heartbeat: ${hb.enabled ? "enabled" : "disabled"}\n` +
          `Running: ${hb.running}\n` +
          `Cron: ${hb.cronExpr}\n` +
          `Next: ${hb.nextRun || "n/a"}`
      );
      return true;
    }

    default:
      return false; // Unknown command — let agent handle it
  }
}

function tryParseSchedule(
  input: string,
  channel: string,
  sender: string
): { job: Omit<import("./scheduler/scheduler.ts").ScheduledJob, "id" | "createdAt">; reminderText: string } | null {
  // Try progressively shorter prefixes as the time part
  const words = input.split(/\s+/);

  for (let i = Math.min(words.length, 6); i >= 1; i--) {
    const timePart = words.slice(0, i).join(" ");
    const messagePart = words.slice(i).join(" ") || "Reminder";

    const parsed = parseTimeToJob(timePart, channel, sender);
    if (parsed) {
      parsed.message = messagePart;
      parsed.name = messagePart.slice(0, 50);
      return { job: parsed, reminderText: messagePart };
    }
  }

  return null;
}
