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
      let cached = loadCachedCatalog();
      if (cached.length === 0) {
        console.log("No skills cached. Syncing from openclaw...\n");
        try {
          cached = await syncCatalog();
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error(`Sync failed: ${errMsg}`);
          process.exit(1);
        }
      }
      const statuses = getSkillStatuses(cached);
      const ready = statuses.filter((s) => s.eligible);
      const notReady = statuses.filter((s) => !s.eligible);

      console.log(`Skills (${ready.length} ready, ${notReady.length} available to install)\n`);

      console.log("READY:");
      for (const s of ready) {
        console.log(`  ${s.emoji || "\u2713"} ${s.name} \u2014 ${s.description}`);
      }

      console.log(`\nNOT INSTALLED (${notReady.length}):`);
      for (const s of notReady) {
        console.log(`  ${s.emoji || "\u2717"} ${s.name} \u2014 ${s.description}`);
        const missing: string[] = [];
        if (s.missing.bins.length) missing.push(`bins: ${s.missing.bins.join(", ")}`);
        if (s.missing.env.length) missing.push(`env: ${s.missing.env.join(", ")}`);
        if (missing.length) console.log(`    needs: ${missing.join("; ")}`);
        if (s.install?.length) {
          console.log(`    install: nakedclaw skills install ${s.name}`);
        }
      }
      break;
    }
  }
}
