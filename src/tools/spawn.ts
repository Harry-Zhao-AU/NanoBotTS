/**
 * Spawn Tool — Launch background tasks via SubagentManager.
 */

import { Tool, ToolParameters } from "./base.js";
import { SubagentManager } from "../core/subagent.js";

export class SpawnTool implements Tool {
  name = "spawn";
  readOnly = false;
  concurrencySafe = true;

  description =
    "Launch a background task that runs independently. " +
    "The task will be completed asynchronously and the result will be " +
    "delivered when it finishes. Use for long-running operations.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "A short name for the task (e.g., 'research', 'analyze')",
      },
      task: {
        type: "string",
        description: "The task description / prompt for the background agent",
      },
      channel: {
        type: "string",
        description: "Channel to deliver results to",
      },
      chat_id: {
        type: "string",
        description: "Chat ID to deliver results to",
      },
    },
    required: ["name", "task", "channel", "chat_id"],
  };

  private subagentManager: SubagentManager;

  constructor(subagentManager: SubagentManager) {
    this.subagentManager = subagentManager;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const name = args.name as string;
    const task = args.task as string;
    const channel = args.channel as string;
    const chatId = args.chat_id as string;

    if (!name || !task) {
      return "Error: name and task are required.";
    }

    const id = this.subagentManager.spawn(name, task, channel, chatId);
    const active = this.subagentManager.activeCount;

    return `Background task "${name}" spawned (${id}). ${active} task(s) running. Results will be delivered when complete.`;
  }
}
