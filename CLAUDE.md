# NakedClaw

A self-improving AI agent reachable via Telegram, WhatsApp, Slack, and terminal. Runs as a background daemon with a CLI chat interface.

## Project Structure

```
nakedclaw/
├── src/
│   ├── cli.ts                # CLI entry point — dispatches subcommands
│   ├── index.ts              # Daemon entry point — channels, scheduler, socket server
│   ├── config.ts             # Loads nakedclaw.json5
│   ├── router.ts             # Message in → command check → agent → reply
│   ├── agent.ts              # Anthropic API caller (OAuth + API key)
│   ├── session.ts            # JSONL transcript storage per sender
│   ├── auth/
│   │   ├── credentials.ts    # ~/.nakedclaw/credentials.json + token refresh
│   │   └── oauth.ts          # Anthropic OAuth PKCE flow
│   ├── cli/
│   │   ├── chat.ts           # Terminal chat REPL (connects to daemon)
│   │   ├── daemon-ctl.ts     # start/stop/restart/status/logs
│   │   └── setup.ts          # Interactive setup wizard
│   ├── daemon/
│   │   ├── server.ts         # Unix socket server for CLI clients
│   │   └── protocol.ts       # NDJSON message types
│   ├── channels/
│   │   ├── types.ts          # ChannelAdapter, IncomingMessage, ReplyFn
│   │   ├── telegram.ts       # Grammy
│   │   ├── whatsapp.ts       # Baileys
│   │   └── slack.ts          # Bolt
│   ├── memory/
│   │   └── store.ts          # MD-based chat storage + search + memory.md index
│   ├── scheduler/
│   │   ├── scheduler.ts      # Programmatic job scheduling (remind me at X)
│   │   └── heartbeat.ts      # Recurring cron heartbeat
│   └── tui/
│       └── viewer.ts         # Legacy session viewer
├── nakedclaw.json5           # Config (workspace dir)
├── memory/                   # Chat markdown files + memory.md index
├── sessions/                 # JSONL transcripts
└── package.json
```

## CLI Usage

```
nakedclaw              # Chat with agent (connects to daemon)
nakedclaw setup        # Configure credentials (OAuth or API key)
nakedclaw start        # Start daemon in background
nakedclaw stop         # Stop daemon
nakedclaw restart      # Restart daemon
nakedclaw status       # Show daemon status
nakedclaw logs         # Show daemon logs
```

## Architecture

- **Daemon** (`src/index.ts`): Runs in background, manages channels, scheduler, heartbeat. Listens on `~/.nakedclaw/daemon.sock` (Unix socket, NDJSON protocol).
- **CLI** (`src/cli.ts`): Dispatches to subcommands. `nakedclaw` (no args) = chat.
- **Chat** (`src/cli/chat.ts`): REPL that connects to daemon socket. Each terminal gets session `terminal:<pid>`.
- **Auth**: Anthropic OAuth PKCE or plain API key. Stored in `~/.nakedclaw/credentials.json`. Env var `ANTHROPIC_API_KEY` always takes priority.

## State Directories

- `~/.nakedclaw/` — credentials, PID file, socket, logs
- `./memory/` — chat markdown files
- `./sessions/` — JSONL transcripts

## Runtime

- Use Bun, not Node.js
- `bun link` to install `nakedclaw` globally
- Config watcher: daemon reloads heartbeat/scheduler on `nakedclaw.json5` change; channel changes require restart
