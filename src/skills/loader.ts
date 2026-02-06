import { loadCachedCatalog, syncCatalog } from "./catalog.ts";
import { checkEligibility, getSkillStatuses } from "./eligibility.ts";
import type { SkillEntry, SkillStatus } from "./types.ts";

/**
 * Load skills and build the prompt section for system prompt injection.
 * Shows ALL skills — ready ones with instructions, unavailable ones with what's needed.
 * Auto-syncs from GitHub if catalog is empty.
 */
export async function loadSkillsPrompt(): Promise<string> {
  let entries = loadCachedCatalog();

  // Auto-sync on first use if catalog is empty
  if (entries.length === 0) {
    try {
      entries = await syncCatalog();
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`[skills] Auto-sync failed: ${errMsg}`);
      return "";
    }
  }

  if (entries.length === 0) return "";

  const statuses = entries.map((e) => ({ entry: e, status: checkEligibility(e) }));
  return formatFullSkillsPrompt(statuses);
}

/**
 * Format ALL skills into the prompt — ready and not-ready.
 */
function formatFullSkillsPrompt(
  skills: { entry: SkillEntry; status: SkillStatus }[]
): string {
  const ready = skills.filter((s) => s.status.eligible);
  const notReady = skills.filter((s) => !s.status.eligible);

  let out = "## Skills Catalog\n\n";
  out += `${ready.length} ready, ${notReady.length} available to install.\n\n`;

  // Ready skills
  if (ready.length > 0) {
    const readyXml = ready
      .map(
        (s) =>
          `  <skill status="ready">\n    <name>${s.entry.name}</name>\n    <description>${s.entry.description}</description>\n    <location>${s.entry.filePath}</location>\n  </skill>`
      )
      .join("\n");

    out += `<ready_skills>\n${readyXml}\n</ready_skills>\n\n`;
  }

  // Not-ready skills — show what's missing and how to install
  if (notReady.length > 0) {
    const notReadyXml = notReady
      .map((s) => {
        const missing: string[] = [];
        if (s.status.missing.bins.length) missing.push(`bins: ${s.status.missing.bins.join(", ")}`);
        if (s.status.missing.env.length) missing.push(`env: ${s.status.missing.env.join(", ")}`);
        const installOpts = s.status.install?.map((i) => i.label).join(" | ") || "manual";
        return `  <skill status="not-installed">\n    <name>${s.entry.name}</name>\n    <description>${s.entry.description}</description>\n    <missing>${missing.join("; ")}</missing>\n    <install_options>${installOpts}</install_options>\n    <install_command>/skills install ${s.entry.name}</install_command>\n  </skill>`;
      })
      .join("\n");

    out += `<available_skills>\n${notReadyXml}\n</available_skills>\n\n`;
  }

  out += `When a user request matches a ready skill, read its SKILL.md for detailed instructions.
If a request matches a not-installed skill, offer to install it with /skills install <name> — you can run this command yourself to install the dependency, then use the skill immediately.`;

  return out;
}

/**
 * Get all skill statuses (for /skills command and CLI).
 * Auto-syncs if catalog is empty.
 */
export async function getAllSkillStatuses(): Promise<SkillStatus[]> {
  let cached = loadCachedCatalog();
  if (cached.length === 0) {
    try {
      cached = await syncCatalog();
    } catch {
      return [];
    }
  }
  return getSkillStatuses(cached);
}
