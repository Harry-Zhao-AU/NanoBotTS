/**
 * SubagentManager — Spawn background AgentRunner instances.
 *
 * Background tasks run independently with a limited tool set:
 *   - No `message` tool (can't send to channels directly)
 *   - No `spawn` tool (prevents recursion)
 *   - No `cron` tool (prevents scheduled spawning)
 *
 * When a subagent finishes, its result is published to the outbound
 * MessageBus so the user sees the output.
 */

import { LLMProvider } from "../providers/base.js";
import { ToolRegistry, Tool } from "../tools/base.js";
import { AgentRunner } from "./agent.js";
import { MessageBus } from "../bus/queue.js";
import { Message } from "../types.js";

/** Active background task */
interface SubagentTask {
  id: string;
  name: string;
  channel: string;
  chatId: string;
  startedAt: string;
  promise: Promise<string>;
}

/** Tools that subagents are NOT allowed to use */
const BLOCKED_TOOLS = new Set(["message", "spawn", "cron"]);

export class SubagentManager {
  private provider: LLMProvider;
  private parentRegistry: ToolRegistry | null = null;
  private bus: MessageBus;
  private activeTasks: Map<string, SubagentTask> = new Map();
  private maxIterations: number;

  constructor(
    provider: LLMProvider,
    bus: MessageBus,
    maxIterations: number = 50,
  ) {
    this.provider = provider;
    this.bus = bus;
    this.maxIterations = maxIterations;
  }

  /** Set the parent tool registry (called after tools are registered). */
  setRegistry(registry: ToolRegistry): void {
    this.parentRegistry = registry;
  }

  /**
   * Spawn a background task.
   * Returns the task ID immediately — the task runs asynchronously.
   */
  spawn(
    name: string,
    task: string,
    channel: string,
    chatId: string,
  ): string {
    const id = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    if (!this.parentRegistry) {
      throw new Error("SubagentManager: registry not set. Call setRegistry() first.");
    }

    // Create a limited tool registry for the subagent
    const limitedRegistry = new ToolRegistry();
    for (const toolName of this.parentRegistry.getToolNames()) {
      if (!BLOCKED_TOOLS.has(toolName)) {
        const tool = this.parentRegistry.get(toolName);
        if (tool) limitedRegistry.register(tool);
      }
    }

    const agent = new AgentRunner(
      this.provider,
      limitedRegistry,
      this.maxIterations,
    );

    const messages: Message[] = [
      {
        role: "system",
        content:
          "You are a background worker. Complete the given task and return the result. " +
          "Be concise. You cannot send messages to the user directly — your output " +
          "will be delivered when you finish.",
      },
      { role: "user", content: task },
    ];

    const promise = agent.run(messages).then(
      (result) => {
        this.onComplete(id, name, channel, chatId, result);
        return result;
      },
      (error) => {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        this.onComplete(id, name, channel, chatId, `Error: ${errMsg}`);
        return `Error: ${errMsg}`;
      },
    );

    const subagentTask: SubagentTask = {
      id,
      name,
      channel,
      chatId,
      startedAt: new Date().toISOString(),
      promise,
    };

    this.activeTasks.set(id, subagentTask);
    console.log(`  [Subagent] Spawned "${name}" (${id})`);

    return id;
  }

  /** Called when a background task completes. */
  private onComplete(
    id: string,
    name: string,
    channel: string,
    chatId: string,
    result: string,
  ): void {
    this.activeTasks.delete(id);
    console.log(`  [Subagent] Completed "${name}" (${id})`);

    this.bus.publishOutbound({
      channel,
      chatId,
      content: `[Background task "${name}" completed]\n\n${result}`,
      isDelta: false,
      isFinal: true,
    });
  }

  /** List active background tasks. */
  listActive(): SubagentTask[] {
    return Array.from(this.activeTasks.values());
  }

  /** Get count of active tasks. */
  get activeCount(): number {
    return this.activeTasks.size;
  }
}
