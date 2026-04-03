/**
 * ContextBuilder — Assembles the system prompt.
 *
 * Phase 6 upgrade: now includes long-term memory in the system prompt,
 * so the LLM always knows remembered facts about the user.
 *
 * The system prompt is built from:
 * 1. Persona (who the bot is)
 * 2. Long-term memory (what the bot remembers about the user)
 * 3. Current time
 * 4. Available tools
 */

import { ToolRegistry } from "../tools/base.js";
import { Memory } from "./memory.js";

export class ContextBuilder {
  private persona: string;
  private toolRegistry: ToolRegistry;
  private memory: Memory;

  constructor(persona: string, toolRegistry: ToolRegistry, memory: Memory) {
    this.persona = persona;
    this.toolRegistry = toolRegistry;
    this.memory = memory;
  }

  setPersona(persona: string): void {
    this.persona = persona;
  }

  getPersona(): string {
    return this.persona;
  }

  /** Build the full system prompt with memory and runtime context */
  build(): string {
    const parts: string[] = [];

    // 1. Core persona
    parts.push(this.persona);

    // 2. Long-term memory (if any)
    const memoryContent = this.memory.readLongTermMemory();
    if (memoryContent) {
      parts.push("\n## What you remember about the user:");
      parts.push(memoryContent);
      parts.push("Use this memory to personalize your responses. If the user corrects any of these facts, acknowledge the correction.");
    }

    // 3. Current time
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

    // 4. Available tools
    const toolNames = this.toolRegistry.getToolNames();
    if (toolNames.length > 0) {
      parts.push(`\nYou have access to these tools: ${toolNames.join(", ")}.`);
      parts.push("Use tools when the user's question would benefit from real-time data or external information.");
    }

    return parts.join("\n");
  }
}
