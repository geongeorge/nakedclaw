#!/usr/bin/env bun

/**
 * NakedClaw CLI entry point.
 *
 * Usage:
 *   nakedclaw              — chat with the agent (default)
 *   nakedclaw setup        — configure credentials
 *   nakedclaw connect <ch> — connect a channel (whatsapp, telegram, slack)
 *   nakedclaw start        — start daemon in background
 *   nakedclaw stop         — stop daemon
 *   nakedclaw restart      — restart daemon
 *   nakedclaw status       — show daemon status
 *   nakedclaw logs         — show daemon logs
 */

const [subcommand] = process.argv.slice(2);

switch (subcommand || "chat") {
  case "chat": {
    await import("./cli/chat.ts");
    break;
  }

  case "setup": {
    await import("./cli/setup.ts");
    break;
  }

  case "connect": {
    await import("./cli/connect.ts");
    break;
  }

  case "start": {
    const { startDaemon } = await import("./cli/daemon-ctl.ts");
    await startDaemon();
    break;
  }

  case "stop": {
    const { stopDaemon } = await import("./cli/daemon-ctl.ts");
    await stopDaemon();
    break;
  }

  case "restart": {
    const { restartDaemon } = await import("./cli/daemon-ctl.ts");
    await restartDaemon();
    break;
  }

  case "status": {
    const { showStatus } = await import("./cli/daemon-ctl.ts");
    await showStatus();
    break;
  }

  case "logs": {
    const { showLogs } = await import("./cli/daemon-ctl.ts");
    await showLogs();
    break;
  }

  case "skills": {
    const { handleSkillsCli } = await import("./cli/skills.ts");
    await handleSkillsCli(process.argv.slice(3));
    break;
  }

  case "help":
  case "--help":
  case "-h": {
    console.log(`
Usage: nakedclaw [command]

Commands:
  (none)        Chat with the agent (connects to daemon)
  setup         Configure credentials (OAuth or API key)
  connect <ch>  Connect a channel (whatsapp/wa, telegram/tg, slack)
  start         Start the daemon in background
  stop          Stop the daemon
  restart       Restart the daemon
  status        Show daemon status
  logs          Show daemon logs
  skills        List, sync, or install skills
  help          Show this help
`);
    break;
  }

  default: {
    console.error(`Unknown command: ${subcommand}`);
    console.error("Run 'nakedclaw help' for usage.");
    process.exit(1);
  }
}
