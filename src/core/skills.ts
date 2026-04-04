/**
 * SkillsLoader — Progressive skill loading from SKILL.md files.
 *
 * Skills are markdown files with YAML frontmatter that define specialized
 * capabilities the agent can use. Two sources, in priority order:
 *   1. Workspace skills (./skills/) — user-defined, override built-in
 *   2. Built-in skills (src/skills/) — shipped with NanoBotTS
 *
 * Loading strategy:
 *   - "always" skills: full content injected into every system prompt
 *   - Other skills: only name + description listed in a summary section;
 *     the agent can read the full content on demand via read_file
 *
 * SKILL.md frontmatter format:
 *   ---
 *   name: memory
 *   description: Long-term memory management
 *   always: true
 *   ---
 *   (skill content in markdown)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUILTIN_SKILLS_DIR = path.resolve(__dirname, "../skills");
const WORKSPACE_SKILLS_DIR = path.resolve("skills");

/** Parsed skill metadata + content */
export interface Skill {
  name: string;
  description: string;
  always: boolean;
  /** Full markdown content (after frontmatter) */
  content: string;
  /** File path — so the agent can read_file on demand */
  filePath: string;
  /** Whether this came from workspace (true) or built-in (false) */
  isWorkspace: boolean;
}

/** Parse YAML-like frontmatter from a SKILL.md file */
function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { meta: {}, content: raw };
  }

  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      meta[key] = value;
    }
  }

  return { meta, content: match[2].trim() };
}

/** Scan a directory for SKILL.md files */
function scanSkillsDir(dir: string, isWorkspace: boolean): Skill[] {
  if (!fs.existsSync(dir)) return [];

  const skills: Skill[] = [];

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    // Each skill is either a SKILL.md file or a directory containing SKILL.md
    let skillPath: string;

    if (entry.isFile() && entry.name.endsWith(".skill.md")) {
      skillPath = path.join(dir, entry.name);
    } else if (entry.isDirectory()) {
      const candidate = path.join(dir, entry.name, "SKILL.md");
      if (fs.existsSync(candidate)) {
        skillPath = candidate;
      } else {
        continue;
      }
    } else {
      continue;
    }

    try {
      const raw = fs.readFileSync(skillPath, "utf-8");
      const { meta, content } = parseFrontmatter(raw);

      skills.push({
        name: meta.name || path.basename(entry.name, ".skill.md"),
        description: meta.description || "",
        always: meta.always === "true",
        content,
        filePath: skillPath,
        isWorkspace,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}

export class SkillsLoader {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    this.reload();
  }

  /** Scan both workspace and built-in skill directories. Workspace overrides built-in. */
  reload(): void {
    this.skills.clear();

    // Load built-in skills first
    for (const skill of scanSkillsDir(BUILTIN_SKILLS_DIR, false)) {
      this.skills.set(skill.name, skill);
    }

    // Workspace skills override built-in by name
    for (const skill of scanSkillsDir(WORKSPACE_SKILLS_DIR, true)) {
      this.skills.set(skill.name, skill);
    }
  }

  /** Get all loaded skills. */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /** Get only always-on skills (injected into every prompt). */
  getAlwaysOn(): Skill[] {
    return this.getAll().filter((s) => s.always);
  }

  /** Get skills that are NOT always-on (listed in summary only). */
  getOnDemand(): Skill[] {
    return this.getAll().filter((s) => !s.always);
  }

  /** Get a skill by name. */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * Build the prompt section for always-on skills.
   * Returns the full content of each always-on skill, concatenated.
   */
  buildAlwaysOnSection(): string {
    const always = this.getAlwaysOn();
    if (always.length === 0) return "";

    return always
      .map((s) => `## Skill: ${s.name}\n${s.content}`)
      .join("\n\n");
  }

  /**
   * Build the prompt section for on-demand skills.
   * Returns a summary list — the agent can read_file for full content.
   */
  buildSummarySection(): string {
    const onDemand = this.getOnDemand();
    if (onDemand.length === 0) return "";

    const lines = onDemand.map(
      (s) => `- **${s.name}**: ${s.description} (read: ${s.filePath})`,
    );

    return `## Available skills (use read_file to load full instructions):\n${lines.join("\n")}`;
  }
}
