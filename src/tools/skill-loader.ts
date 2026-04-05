/**
 * Skill Loader Tool — Load a skill's full instructions on demand.
 */

import { Tool, ToolParameters } from "./base.js";
import { SkillsLoader } from "../core/skills.js";

export class SkillLoaderTool implements Tool {
  name = "load_skill";
  readOnly = true;
  concurrencySafe = true;

  description =
    "Load the full instructions for an available skill by name. " +
    "Use this when you see a skill listed in your available skills summary " +
    "and need its detailed instructions to complete a task.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The skill name to load (e.g., 'github', 'weather')",
      },
    },
    required: ["name"],
  };

  private skills: SkillsLoader;

  constructor(skills: SkillsLoader) {
    this.skills = skills;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = args.name as string;
    if (!name) return "Error: No skill name provided.";

    const skill = this.skills.get(name);
    if (!skill) {
      const available = this.skills.getAll().map((s) => s.name).join(", ");
      return `Error: Skill "${name}" not found. Available: ${available}`;
    }

    return `# Skill: ${skill.name}\n\n${skill.content}`;
  }
}
