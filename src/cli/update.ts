import { resolve } from "path";
import { unlinkSync } from "fs";

const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

const REPO = "geongeorge/nakedclaw";

interface GitHubRelease {
  tag_name: string;
  assets: { name: string; browser_download_url: string }[];
}

function getCurrentVersion(): string {
  // Embedded at compile time from package.json
  const pkg = require("../../package.json");
  return pkg.version;
}

function getPlatformAsset(): string {
  const os = process.platform === "darwin" ? "darwin" : "linux";
  const arch = process.arch === "arm64" ? "arm64" : "x64";
  return `nakedclaw-${os}-${arch}`;
}

function parseVersion(tag: string): string {
  return tag.replace(/^v/, "");
}

export async function selfUpdate(): Promise<void> {
  const current = getCurrentVersion();
  console.log(`${DIM}Current version: ${current}${RESET}`);
  console.log(`${DIM}Checking for updates...${RESET}`);

  // Fetch latest release
  let release: GitHubRelease;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/releases/latest`,
      { headers: { Accept: "application/vnd.github.v3+json" } }
    );
    if (!res.ok) {
      throw new Error(`GitHub API returned ${res.status}`);
    }
    release = (await res.json()) as GitHubRelease;
  } catch (err: any) {
    console.error(`${RED}Failed to check for updates:${RESET} ${err.message}`);
    process.exit(1);
  }

  const latest = parseVersion(release.tag_name);
  if (latest === current) {
    console.log(`${GREEN}Already on the latest version (${current}).${RESET}`);
    return;
  }

  console.log(`${BOLD}New version available: ${latest}${RESET}`);

  // Find the right binary asset
  const assetName = getPlatformAsset();
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    console.error(
      `${RED}No binary found for your platform (${assetName}).${RESET}`
    );
    console.error(
      `Available assets: ${release.assets.map((a) => a.name).join(", ")}`
    );
    process.exit(1);
  }

  // Download the binary
  console.log(`Downloading ${assetName}...`);
  let binary: ArrayBuffer;
  try {
    const res = await fetch(asset.browser_download_url);
    if (!res.ok) {
      throw new Error(`Download failed: ${res.status}`);
    }
    binary = await res.arrayBuffer();
  } catch (err: any) {
    console.error(`${RED}Download failed:${RESET} ${err.message}`);
    process.exit(1);
  }

  // Write to temp file, then replace the current binary
  const execPath = process.execPath;
  const tmpPath = `${execPath}.update-tmp`;

  try {
    await Bun.write(tmpPath, binary);

    // Make executable
    const chmod = Bun.spawnSync(["chmod", "+x", tmpPath]);
    if (chmod.exitCode !== 0) {
      throw new Error("Failed to chmod +x");
    }

    // Atomic replace: rename over the existing binary
    const mv = Bun.spawnSync(["mv", tmpPath, execPath]);
    if (mv.exitCode !== 0) {
      throw new Error("Failed to replace binary — you may need sudo");
    }

    console.log(
      `${GREEN}Updated to ${latest}!${RESET} Restart the daemon with: ${BOLD}nakedclaw restart${RESET}`
    );
  } catch (err: any) {
    // Clean up temp file on failure
    try {
      unlinkSync(tmpPath);
    } catch {}
    console.error(`${RED}Update failed:${RESET} ${err.message}`);
    process.exit(1);
  }
}
