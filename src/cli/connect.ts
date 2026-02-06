import { createInterface } from "readline";
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import JSON5 from "json5";

const BOLD = "\x1b[1m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const CONFIG_PATH = resolve(import.meta.dir, "../..", "nakedclaw.json5");

const rl = createInterface({ input: process.stdin, output: process.stdout });

function prompt(msg: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(msg, (answer) => resolve(answer.trim()));
  });
}

function readConfig(): any {
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON5.parse(raw);
}

function writeConfig(config: any): void {
  // Write as JSON with indentation (JSON is valid JSON5)
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

async function connectWhatsApp() {
  console.log(`\n${BOLD}${CYAN}Connect WhatsApp${RESET}\n`);
  console.log(
    `WhatsApp uses QR code authentication. When you proceed,\n` +
      `a QR code will appear in this terminal.\n`
  );
  console.log(
    `${DIM}Open WhatsApp on your phone > Linked Devices > Link a Device${RESET}\n`
  );

  const ready = await prompt("Ready to scan? (Y/n): ");
  if (ready.toLowerCase() === "n") {
    console.log("Aborted.");
    rl.close();
    return;
  }

  // Enable in config
  const config = readConfig();
  config.channels.whatsapp.enabled = true;
  writeConfig(config);

  console.log(`\n${GREEN}WhatsApp enabled in config.${RESET}`);
  console.log(`\nStarting WhatsApp connection to show QR code...\n`);

  // Run the WhatsApp adapter in foreground to show QR
  const { createWhatsAppAdapter } = await import("../channels/whatsapp.ts");

  const done = new Promise<void>((resolve) => {
    const adapter = createWhatsAppAdapter(config.channels.whatsapp, () => {
      // Auto-exit on successful connection
      console.log(`\n${GREEN}WhatsApp connected and auth saved.${RESET}`);
      console.log(
        `${CYAN}Start the daemon to receive messages:${RESET} nakedclaw start\n`
      );
      adapter.stop().then(() => resolve());
    });

    adapter.onMessage(() => {});

    // Also allow Ctrl+C
    process.on("SIGINT", () => {
      console.log(`\n\n${GREEN}WhatsApp auth saved.${RESET}`);
      console.log(
        `${CYAN}Start the daemon to receive messages:${RESET} nakedclaw start\n`
      );
      adapter.stop().then(() => resolve());
    });

    adapter.start();
  });

  await done;
  rl.close();
  process.exit(0);
}

async function connectTelegram() {
  console.log(`\n${BOLD}${CYAN}Connect Telegram${RESET}\n`);
  console.log(
    `You need a Telegram Bot Token from ${BOLD}@BotFather${RESET}.\n`
  );
  console.log(`${DIM}1. Open Telegram and search for @BotFather`);
  console.log(`2. Send /newbot and follow the prompts`);
  console.log(`3. Copy the bot token${RESET}\n`);

  const token = await prompt("Telegram Bot Token: ");
  if (!token) {
    console.log("No token provided. Aborted.");
    rl.close();
    return;
  }

  // Verify the token with a getMe call
  console.log(`\n${DIM}Verifying token...${RESET}`);
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/getMe`
    );
    const data = (await res.json()) as any;
    if (!data.ok) {
      console.error(`\nInvalid token: ${data.description}`);
      rl.close();
      return;
    }
    console.log(
      `${GREEN}Bot verified:${RESET} @${data.result.username} (${data.result.first_name})\n`
    );
  } catch (err) {
    console.error(`\nFailed to verify token: ${err}`);
    rl.close();
    return;
  }

  // Enable in config
  const config = readConfig();
  config.channels.telegram.enabled = true;
  writeConfig(config);

  // Save token to .env or instruct user
  console.log(`${YELLOW}Set the environment variable before starting the daemon:${RESET}\n`);
  console.log(`  export TELEGRAM_BOT_TOKEN="${token}"\n`);

  const saveEnv = await prompt("Save to .env file? (Y/n): ");
  if (saveEnv.toLowerCase() !== "n") {
    const envPath = resolve(import.meta.dir, "../..", ".env");
    let envContent = "";
    try {
      envContent = readFileSync(envPath, "utf-8");
    } catch {}
    if (envContent.includes("TELEGRAM_BOT_TOKEN=")) {
      // Replace existing
      envContent = envContent.replace(
        /TELEGRAM_BOT_TOKEN=.*/,
        `TELEGRAM_BOT_TOKEN=${token}`
      );
    } else {
      envContent += `\nTELEGRAM_BOT_TOKEN=${token}\n`;
    }
    writeFileSync(envPath, envContent.trimStart(), "utf-8");
    console.log(`\n${GREEN}Token saved to .env${RESET}`);
  }

  console.log(`\n${GREEN}Telegram enabled.${RESET}`);
  console.log(
    `${CYAN}Restart the daemon to start receiving messages:${RESET} nakedclaw restart\n`
  );
  rl.close();
}

async function connectSlack() {
  console.log(`\n${BOLD}${CYAN}Connect Slack${RESET}\n`);
  console.log(`You need a Slack App with Socket Mode enabled.\n`);
  console.log(`${DIM}1. Go to https://api.slack.com/apps and create a new app`);
  console.log(`2. Enable Socket Mode (get an App-Level Token with connections:write)`);
  console.log(`3. Add Bot Token Scopes: chat:write, app_mentions:read, im:history, im:read`);
  console.log(`4. Install to your workspace`);
  console.log(`5. Copy the Bot Token (xoxb-...) and App Token (xapp-...)${RESET}\n`);

  const botToken = await prompt("Slack Bot Token (xoxb-...): ");
  if (!botToken || !botToken.startsWith("xoxb-")) {
    console.log("Invalid or no bot token provided. Aborted.");
    rl.close();
    return;
  }

  const appToken = await prompt("Slack App Token (xapp-...): ");
  if (!appToken || !appToken.startsWith("xapp-")) {
    console.log("Invalid or no app token provided. Aborted.");
    rl.close();
    return;
  }

  // Verify with auth.test
  console.log(`\n${DIM}Verifying tokens...${RESET}`);
  try {
    const res = await fetch("https://slack.com/api/auth.test", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${botToken}`,
        "Content-Type": "application/json",
      },
    });
    const data = (await res.json()) as any;
    if (!data.ok) {
      console.error(`\nInvalid bot token: ${data.error}`);
      rl.close();
      return;
    }
    console.log(
      `${GREEN}Bot verified:${RESET} ${data.user} in ${data.team}\n`
    );
  } catch (err) {
    console.error(`\nFailed to verify token: ${err}`);
    rl.close();
    return;
  }

  // Enable in config
  const config = readConfig();
  config.channels.slack.enabled = true;
  writeConfig(config);

  // Save tokens
  console.log(`${YELLOW}Set these environment variables before starting the daemon:${RESET}\n`);
  console.log(`  export SLACK_BOT_TOKEN="${botToken}"`);
  console.log(`  export SLACK_APP_TOKEN="${appToken}"\n`);

  const saveEnv = await prompt("Save to .env file? (Y/n): ");
  if (saveEnv.toLowerCase() !== "n") {
    const envPath = resolve(import.meta.dir, "../..", ".env");
    let envContent = "";
    try {
      envContent = readFileSync(envPath, "utf-8");
    } catch {}

    for (const [key, val] of [
      ["SLACK_BOT_TOKEN", botToken],
      ["SLACK_APP_TOKEN", appToken],
    ]) {
      if (envContent.includes(`${key}=`)) {
        envContent = envContent.replace(
          new RegExp(`${key}=.*`),
          `${key}=${val}`
        );
      } else {
        envContent += `\n${key}=${val}`;
      }
    }
    writeFileSync(envPath, envContent.trimStart() + "\n", "utf-8");
    console.log(`\n${GREEN}Tokens saved to .env${RESET}`);
  }

  console.log(`\n${GREEN}Slack enabled.${RESET}`);
  console.log(
    `${CYAN}Restart the daemon to start receiving messages:${RESET} nakedclaw restart\n`
  );
  rl.close();
}

// Main
const channel = process.argv[3];

switch (channel) {
  case "whatsapp":
  case "wa":
    await connectWhatsApp();
    break;

  case "telegram":
  case "tg":
    await connectTelegram();
    break;

  case "slack":
    await connectSlack();
    break;

  default:
    console.log(`
${BOLD}Usage:${RESET} nakedclaw connect <channel>

${BOLD}Channels:${RESET}
  whatsapp (wa)    Connect WhatsApp via QR code
  telegram (tg)    Connect Telegram bot
  slack            Connect Slack app
`);
    rl.close();
    break;
}
