# Channels

## Connecting Channels

The user can connect channels using the `nakedclaw connect` wizard from their terminal. If a user asks how to set up or connect a channel, guide them through the process below.

### WhatsApp
```
nakedclaw connect wa
```
1. The wizard enables WhatsApp in `nakedclaw.json5` automatically
2. A QR code appears in the terminal
3. User opens WhatsApp on their phone > Linked Devices > Link a Device
4. Scans the QR code — done
5. Auth is saved in `.wa-auth/` so they only need to scan once
6. Reconnects automatically on daemon restart

No tokens or API keys needed — just scan the QR code.

### Telegram
```
nakedclaw connect tg
```
1. User needs a bot token from @BotFather on Telegram:
   - Open Telegram, search for @BotFather
   - Send `/newbot` and follow the prompts
   - Copy the bot token
2. The wizard verifies the token, enables Telegram in config, and offers to save the token to `.env`
3. After connecting, restart the daemon: `nakedclaw restart`

Environment variable: `TELEGRAM_BOT_TOKEN`

### Slack
```
nakedclaw connect slack
```
1. User needs to create an app at https://api.slack.com/apps
2. Enable **Socket Mode** (gives them an App-Level Token: `xapp-...`)
3. Add Bot Token Scopes: `chat:write`, `app_mentions:read`, `im:history`, `im:read`, `im:write`
4. Install to workspace (gives them a Bot Token: `xoxb-...`)
5. The wizard verifies both tokens, enables Slack in config, and saves to `.env`
6. After connecting, restart the daemon: `nakedclaw restart`

Environment variables: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`

### Access Control

Each channel has an `allowFrom` list in `nakedclaw.json5`. Empty = allow everyone. To restrict:
```
"telegram": { "enabled": true, "allowFrom": ["@yourusername"] }
"whatsapp": { "enabled": true, "allowFrom": ["+1234567890"] }
```

## Channel Behavior Rules

### WhatsApp
- Max message length: ~65,000 chars (but keep responses under 4,000 for readability)
- No markdown rendering — use plain text, line breaks, and emoji sparingly
- Avoid code blocks; use indentation if showing code snippets

### Telegram
- Max message length: 4,096 chars per message
- Supports markdown: bold, italic, code, and code blocks
- Split long responses into multiple messages if needed

### Slack
- Max message length: 40,000 chars
- Supports Slack mrkdwn: *bold*, _italic_, `code`, ```code blocks```
- Use threaded replies when continuing a conversation

### Terminal (CLI)
- No length limits
- Full markdown supported
- Can use code blocks freely
