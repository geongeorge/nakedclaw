#!/usr/bin/env bun

/**
 * NakedClaw CLI entry point.
 *
 * Usage:
 *   nakedclaw              — chat with the agent (default)
 *   nakedclaw setup        — configure credentials
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

  case "help":
  case "--help":
  case "-h": {
    console.log(`
Usage: nakedclaw [command]

Commands:
  (none)     Chat with the agent (connects to daemon)
  setup      Configure credentials (OAuth or API key)
  start      Start the daemon in background
  stop       Stop the daemon
  restart    Restart the daemon
  status     Show daemon status
  logs       Show daemon logs
  help       Show this help
`);
    break;
  }

  default: {
    console.error(`Unknown command: ${subcommand}`);
    console.error("Run 'nakedclaw help' for usage.");
    process.exit(1);
  }
}
