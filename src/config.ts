import JSON5 from "json5";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

export type ChannelConfig = {
  enabled: boolean;
  allowFrom: string[];
};

export type Config = {
  model: {
    provider: string;
    name: string;
  };
  workspace: string;
  channels: {
    telegram: ChannelConfig;
    whatsapp: ChannelConfig;
    slack: ChannelConfig;
  };
  sessions: {
    dir: string;
    maxTurns: number;
  };
  memory: {
    dir: string;
    indexFile: string;
  };
  heartbeat: {
    enabled: boolean;
    cronExpr: string;
    prompt: string;
  };
};

const CONFIG_PATH = resolve(
  import.meta.dir,
  "..",
  "nakedclaw.json5"
);

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found: ${CONFIG_PATH}`);
  }

  const raw = readFileSync(CONFIG_PATH, "utf-8");
  _config = JSON5.parse(raw) as Config;
  return _config;
}

export function reloadConfig(): Config {
  _config = null;
  return loadConfig();
}
