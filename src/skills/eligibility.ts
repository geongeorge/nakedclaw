import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import type { SkillEntry, SkillStatus } from "./types.ts";

/**
 * Check if a binary is available on PATH.
 */
export function hasBinary(bin: string): boolean {
  const pathDirs = (process.env.PATH || "").split(":");
  for (const dir of pathDirs) {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      // Not found in this dir
    }
  }
  return false;
}

/**
 * Check if an environment variable is set (non-empty).
 */
function hasEnv(name: string): boolean {
  const val = process.env[name];
  return val !== undefined && val !== "";
}

/**
 * Check if the current OS matches the skill's requirements.
 */
function matchesOs(osList?: string[]): boolean {
  if (!osList || osList.length === 0) return true;
  const current = process.platform === "darwin" ? "macos" : process.platform;
  return osList.includes(current);
}

/**
 * Check eligibility for a single skill entry.
 */
export function checkEligibility(entry: SkillEntry): SkillStatus {
  const meta = entry.metadata;
  const missingBins: string[] = [];
  const missingEnv: string[] = [];

  // If always: true, it's always eligible
  if (meta?.always) {
    return {
      name: entry.name,
      description: entry.description,
      emoji: meta.emoji,
      eligible: true,
      installed: true,
      missing: { bins: [], env: [] },
      install: meta.install?.map((s) => ({
        label: s.label || s.kind,
        id: s.id || s.kind,
        kind: s.kind,
      })),
    };
  }

  // Check OS
  if (!matchesOs(meta?.os)) {
    return {
      name: entry.name,
      description: entry.description,
      emoji: meta?.emoji,
      eligible: false,
      installed: false,
      missing: { bins: [], env: [] },
    };
  }

  // Check required bins (all must be present)
  if (meta?.requires?.bins) {
    for (const bin of meta.requires.bins) {
      if (!hasBinary(bin)) missingBins.push(bin);
    }
  }

  // Check anyBins (at least one must be present)
  if (meta?.requires?.anyBins) {
    const hasAny = meta.requires.anyBins.some((bin) => hasBinary(bin));
    if (!hasAny) {
      missingBins.push(...meta.requires.anyBins);
    }
  }

  // Check env vars
  if (meta?.requires?.env) {
    for (const env of meta.requires.env) {
      if (!hasEnv(env)) missingEnv.push(env);
    }
  }

  const eligible = missingBins.length === 0 && missingEnv.length === 0;

  return {
    name: entry.name,
    description: entry.description,
    emoji: meta?.emoji,
    eligible,
    installed: true, // SKILL.md exists locally if we have the entry
    missing: { bins: missingBins, env: missingEnv },
    install: meta?.install?.map((s) => ({
      label: s.label || s.kind,
      id: s.id || s.kind,
      kind: s.kind,
    })),
  };
}

/**
 * Filter entries to eligible-only.
 */
export function getEligibleSkills(entries: SkillEntry[]): SkillEntry[] {
  return entries.filter((entry) => checkEligibility(entry).eligible);
}

/**
 * Get statuses for all entries.
 */
export function getSkillStatuses(entries: SkillEntry[]): SkillStatus[] {
  return entries.map(checkEligibility);
}
