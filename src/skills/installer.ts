import type { SkillEntry, SkillInstallSpec } from "./types.ts";
import { loadSkillByName } from "./catalog.ts";

type InstallResult = { ok: boolean; message: string };

/**
 * Run an install command and return the result.
 */
async function runInstall(args: string[]): Promise<InstallResult> {
  console.log(`[skills] Running: ${args.join(" ")}`);

  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);

  const exitCode = await proc.exited;

  if (exitCode === 0) {
    return { ok: true, message: stdout.trim() || "Installed successfully." };
  }
  return { ok: false, message: stderr.trim() || stdout.trim() || `Exit code: ${exitCode}` };
}

/**
 * Build the install command for a given spec.
 */
function buildCommand(spec: SkillInstallSpec): string[] | null {
  switch (spec.kind) {
    case "brew": {
      const args = ["brew", "install"];
      if (spec.tap) args.push(`${spec.tap}/${spec.formula}`);
      else if (spec.formula) args.push(spec.formula);
      else return null;
      return args;
    }
    case "node":
      if (!spec.package) return null;
      return ["bun", "install", "-g", spec.package];
    case "go":
      if (!spec.module) return null;
      return ["go", "install", spec.module];
    case "uv":
      if (!spec.package) return null;
      return ["uv", "tool", "install", spec.package];
    case "apt":
      if (!spec.package) return null;
      return ["sudo", "apt-get", "install", "-y", spec.package];
    case "download":
      if (!spec.url) return null;
      return ["curl", "-fsSL", "-O", spec.url];
    default:
      return null;
  }
}

/**
 * Install a skill's dependencies using the specified install spec (or first available).
 */
export async function installSkill(
  entry: SkillEntry,
  specId?: string
): Promise<InstallResult> {
  const specs = entry.metadata?.install;
  if (!specs || specs.length === 0) {
    return { ok: false, message: `No install specs for skill "${entry.name}".` };
  }

  // Pick the requested spec or default to first
  const spec = specId
    ? specs.find((s) => s.id === specId)
    : specs[0];

  if (!spec) {
    return { ok: false, message: `Install spec "${specId}" not found for "${entry.name}".` };
  }

  // Check OS restriction on the spec
  if (spec.os && spec.os.length > 0) {
    const current = process.platform === "darwin" ? "macos" : process.platform;
    if (!spec.os.includes(current)) {
      return { ok: false, message: `Install spec "${spec.label}" not available on ${current}.` };
    }
  }

  const cmd = buildCommand(spec);
  if (!cmd) {
    return { ok: false, message: `Cannot build install command for spec "${spec.label || spec.kind}".` };
  }

  return runInstall(cmd);
}

/**
 * Install a skill by name (looks it up from local cache).
 */
export async function installSkillByName(
  name: string,
  specId?: string
): Promise<InstallResult> {
  const entry = loadSkillByName(name);
  if (!entry) {
    return { ok: false, message: `Skill "${name}" not found. Run "/skills sync" first.` };
  }
  return installSkill(entry, specId);
}
