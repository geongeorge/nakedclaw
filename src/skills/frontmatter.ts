import JSON5 from "json5";
import type { SkillEntry, SkillMetadata } from "./types.ts";

/**
 * Parse a SKILL.md file. Extracts YAML-like frontmatter between --- delimiters,
 * then parses the `metadata` field as JSON5 (openclaw format).
 */
export function parseSkillFile(
  content: string,
  filePath: string,
  source: "openclaw" | "local" = "openclaw"
): SkillEntry {
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    return {
      name: nameFromPath(filePath),
      description: "",
      body: content,
      filePath,
      source,
    };
  }

  // Find closing ---
  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      endIdx = i;
      break;
    }
  }

  if (endIdx === -1) {
    return {
      name: nameFromPath(filePath),
      description: "",
      body: content,
      filePath,
      source,
    };
  }

  const frontmatterLines = lines.slice(1, endIdx);
  const body = lines.slice(endIdx + 1).join("\n").trim();

  // Parse frontmatter fields
  const fm = parseFrontmatter(frontmatterLines);

  // Extract openclaw metadata from the metadata field
  let metadata: SkillMetadata | undefined;
  if (fm.metadata) {
    try {
      const parsed = JSON5.parse(fm.metadata);
      metadata = parsed?.openclaw as SkillMetadata;
    } catch {
      // If metadata parse fails, skip it
    }
  }

  return {
    name: fm.name || nameFromPath(filePath),
    description: fm.description || "",
    metadata,
    body,
    filePath,
    source,
  };
}

/**
 * Simple frontmatter parser. Handles multiline values (metadata spans multiple lines).
 * Not a full YAML parser — just enough for SKILL.md files.
 */
function parseFrontmatter(lines: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  let currentKey = "";
  let currentValue = "";

  for (const line of lines) {
    // Check if this line starts a new key: value pair (key at column 0, followed by colon)
    const keyMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);

    if (keyMatch) {
      // Save previous key if any
      if (currentKey) {
        result[currentKey] = currentValue.trim();
      }
      currentKey = keyMatch[1] ?? "";
      currentValue = keyMatch[2] ?? "";
    } else if (currentKey) {
      // Continuation line for current key
      currentValue += `\n${line}`;
    }
  }

  // Save last key
  if (currentKey) {
    result[currentKey] = currentValue.trim();
  }

  // Strip surrounding quotes from simple string values
  for (const [key, val] of Object.entries(result)) {
    if (
      val.startsWith('"') && val.endsWith('"') &&
      !val.includes("\n")
    ) {
      result[key] = val.slice(1, -1);
    }
  }

  return result;
}

function nameFromPath(filePath: string): string {
  // Extract skill name from path like "skills/mcporter/SKILL.md"
  const parts = filePath.split("/");
  const skillIdx = parts.lastIndexOf("SKILL.md");
  if (skillIdx > 0) return parts[skillIdx - 1] ?? "unknown";
  return parts[parts.length - 1]?.replace(/\.md$/, "") || "unknown";
}
