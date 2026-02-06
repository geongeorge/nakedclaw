import { loadCachedCatalog, loadSkillByName, syncCatalog } from "../skills/catalog.ts";
import { checkEligibility, getSkillStatuses } from "../skills/eligibility.ts";
import { installSkillByName } from "../skills/installer.ts";

/**
 * CLI handler for: nakedclaw skills [list|sync|install <name>|info <name>]
 */
export async function handleSkillsCli(args: string[]): Promise<void> {
  const [action, ...rest] = args;

  switch (action) {
    case "sync": {
      try {
        const entries = await syncCatalog();
        console.log(`Synced ${entries.length} skills from openclaw catalog.`);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`Sync failed: ${errMsg}`);
        process.exit(1);
      }
      break;
    }

    case "install": {
      const name = rest[0];
      if (!name) {
        console.error("Usage: nakedclaw skills install <name> [spec-id]");
        process.exit(1);
      }
      const specId = rest[1];
      const result = await installSkillByName(name, specId);
      if (result.ok) {
        console.log(result.message);
      } else {
        console.error(result.message);
        process.exit(1);
      }
      break;
    }

    case "info": {
      const name = rest[0];
      if (!name) {
        console.error("Usage: nakedclaw skills info <name>");
        process.exit(1);
      }
      const entry = loadSkillByName(name);
      if (!entry) {
        console.error(`Skill "${name}" not found. Run "nakedclaw skills sync" first.`);
        process.exit(1);
      }
      const status = checkEligibility(entry);
      console.log(`${status.emoji || ""} ${status.name}`);
      console.log(`  ${status.description}`);
      console.log(`  Eligible: ${status.eligible ? "yes" : "no"}`);
      if (status.missing.bins.length) {
        console.log(`  Missing bins: ${status.missing.bins.join(", ")}`);
      }
      if (status.missing.env.length) {
        console.log(`  Missing env: ${status.missing.env.join(", ")}`);
      }
      if (status.install?.length) {
        console.log(`  Install options:`);
        for (const inst of status.install) {
          console.log(`    - ${inst.label} (${inst.kind})`);
        }
      }
      break;
    }

    default: {
      const cached = loadCachedCatalog();
      if (cached.length === 0) {
        console.log("No skills cached. Run: nakedclaw skills sync");
        return;
      }
      const statuses = getSkillStatuses(cached);
      const eligible = statuses.filter((s) => s.eligible).length;

      console.log(`Skills (${eligible}/${statuses.length} ready)\n`);
      for (const s of statuses) {
        const icon = s.eligible ? "\u2713" : "\u2717";
        console.log(`${icon} ${s.emoji || " "} ${s.name} \u2014 ${s.description}`);
        if (!s.eligible && s.missing.bins.length) {
          console.log(`  missing: ${s.missing.bins.join(", ")}`);
        }
        if (!s.eligible && s.missing.env.length) {
          console.log(`  missing env: ${s.missing.env.join(", ")}`);
        }
      }
      break;
    }
  }
}
