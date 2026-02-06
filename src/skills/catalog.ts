import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "../config.ts";
import { parseSkillFile } from "./frontmatter.ts";
import type { SkillEntry } from "./types.ts";

const GITHUB_API_BASE = "https://api.github.com/repos/openclaw/openclaw/contents/skills";
const GITHUB_RAW_BASE = "https://raw.githubusercontent.com/openclaw/openclaw/main/skills";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

function skillsDir(): string {
  const config = loadConfig();
  return resolve(config.skills?.dir || "./skills");
}

function catalogPath(): string {
  return join(skillsDir(), "catalog.json");
}

/**
 * Load cached catalog from disk.
 */
export function loadCachedCatalog(): SkillEntry[] {
  const path = catalogPath();
  if (!existsSync(path)) return [];

  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as SkillEntry[];
  } catch {
    return [];
  }
}

/**
 * Check if the cached catalog is still fresh.
 */
function isCacheFresh(): boolean {
  const path = catalogPath();
  if (!existsSync(path)) return false;

  try {
    const file = Bun.file(path);
    return Date.now() - file.lastModified < CACHE_TTL_MS;
  } catch {
    return false;
  }
}

/**
 * Fetch the skill directory listing from GitHub API.
 * Returns an array of skill directory names.
 */
async function fetchSkillNames(): Promise<string[]> {
  const res = await fetch(GITHUB_API_BASE, {
    headers: { Accept: "application/vnd.github.v3+json" },
  });

  if (!res.ok) {
    throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
  }

  const items = (await res.json()) as Array<{ name: string; type: string }>;
  return items
    .filter((item) => item.type === "dir")
    .map((item) => item.name);
}

/**
 * Fetch a single SKILL.md from GitHub raw content.
 */
async function fetchSkillMd(skillName: string): Promise<string | null> {
  const url = `${GITHUB_RAW_BASE}/${skillName}/SKILL.md`;
  const res = await fetch(url);

  if (!res.ok) return null;
  return res.text();
}

/**
 * Fetch the full catalog from GitHub, download SKILL.md files, and cache locally.
 */
export async function syncCatalog(): Promise<SkillEntry[]> {
  const dir = skillsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  console.log("[skills] Fetching catalog from GitHub...");
  const names = await fetchSkillNames();
  console.log(`[skills] Found ${names.length} skills`);

  const entries: SkillEntry[] = [];

  // Fetch SKILL.md files in batches of 10 to avoid rate limiting
  const batchSize = 10;
  for (let i = 0; i < names.length; i += batchSize) {
    const batch = names.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (name) => {
        const content = await fetchSkillMd(name);
        if (!content) return null;

        // Save to local cache
        const skillDir = join(dir, name);
        if (!existsSync(skillDir)) mkdirSync(skillDir, { recursive: true });
        const filePath = join(skillDir, "SKILL.md");
        writeFileSync(filePath, content, "utf-8");

        return parseSkillFile(content, `skills/${name}/SKILL.md`, "openclaw");
      })
    );

    for (const entry of results) {
      if (entry) entries.push(entry);
    }
  }

  // Write catalog index
  writeFileSync(catalogPath(), JSON.stringify(entries, null, 2), "utf-8");
  console.log(`[skills] Cached ${entries.length} skills`);

  return entries;
}

/**
 * Load skills — uses cache if fresh, otherwise syncs from GitHub.
 */
export async function fetchCatalog(): Promise<SkillEntry[]> {
  if (isCacheFresh()) {
    return loadCachedCatalog();
  }
  return syncCatalog();
}

/**
 * Load a single skill from the local cache by name.
 */
export function loadSkillByName(name: string): SkillEntry | null {
  const filePath = join(skillsDir(), name, "SKILL.md");
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, "utf-8");
  return parseSkillFile(content, `skills/${name}/SKILL.md`, "openclaw");
}
