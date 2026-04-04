/**
 * ContextBuilder — Assembles the system prompt from templates + memory.
 *
 * The system prompt is now composed from markdown template files:
 *   1. SOUL.md — core persona and identity
 *   2. AGENTS.md — agent behavior guidelines
 *   3. TOOLS.md — tool usage guidelines
 *   4. USER.md — user context instructions
 *   5. Long-term memory (dynamic, from memory.md)
 *   6. Current time (dynamic)
 *   7. Available tool names (dynamic)
 *
 * A custom persona string (from config) overrides SOUL.md if provided.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ToolRegistry } from "../tools/base.js";
import { Memory } from "./memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.resolve(__dirname, "../templates");

/** Read a template file, returning empty string if not found. */
function readTemplate(name: string): string {
  const filePath = path.join(TEMPLATES_DIR, name);
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

export class ContextBuilder {
  private customPersona: string | null;
  private toolRegistry: ToolRegistry;
  private memory: Memory;

  constructor(persona: string | null, toolRegistry: ToolRegistry, memory: Memory) {
    // If the persona is the old default, treat it as null (use templates instead)
    const isDefault = persona?.startsWith("You are NanoBot, a helpful personal assistant");
    this.customPersona = isDefault ? null : persona;
    this.toolRegistry = toolRegistry;
    this.memory = memory;
  }

  setPersona(persona: string): void {
    this.customPersona = persona;
  }

  getPersona(): string {
    return this.customPersona ?? readTemplate("SOUL.md");
  }

  /** Build the full system prompt from templates + dynamic context. */
  build(): string {
    const parts: string[] = [];

    // 1. Identity (custom persona overrides SOUL.md)
    if (this.customPersona) {
      parts.push(this.customPersona);
    } else {
      parts.push(readTemplate("SOUL.md"));
    }

    // 2. Agent behavior
    const agents = readTemplate("AGENTS.md");
    if (agents) parts.push(agents);

    // 3. Tool usage guidelines
    const tools = readTemplate("TOOLS.md");
    if (tools) parts.push(tools);

    // 4. User context instructions
    const user = readTemplate("USER.md");
    if (user) parts.push(user);

    // 5. Long-term memory (dynamic)
    const memoryContent = this.memory.readLongTermMemory();
    if (memoryContent) {
      parts.push("## What you remember about the user:");
      parts.push(memoryContent);
    }

    // 6. Current time
    const now = new Date();
    parts.push(`\nCurrent date and time: ${now.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })}`);

    // 7. Available tools
    const toolNames = this.toolRegistry.getToolNames();
    if (toolNames.length > 0) {
      parts.push(`\nAvailable tools: ${toolNames.join(", ")}`);
    }

    return parts.join("\n\n");
  }
}
