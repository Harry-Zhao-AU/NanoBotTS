/**
 * AgentHook — Lifecycle callbacks for the agent loop.
 *
 * Hooks let external code observe and influence the agent loop without
 * modifying AgentRunner itself. Use cases:
 *   - Streaming deltas to the UI (onStream)
 *   - Logging tool calls (beforeExecuteTools)
 *   - Modifying the final response (finalizeContent)
 *   - Progress indicators (beforeIteration, afterIteration)
 *
 * CompositeHook fans out to multiple hooks with error isolation —
 * one hook failing doesn't break the others.
 */

import { Message, ToolCall, LLMResponse } from "../types.js";

/** Lifecycle callbacks for the agent loop. All methods are optional. */
export interface AgentHook {
  /** Called before each LLM call. Return false to abort the loop. */
  beforeIteration?(iteration: number, messages: Message[]): Promise<void | false>;

  /** Called for each streaming chunk from the LLM. */
  onStream?(chunk: string): void;

  /** Called when streaming for the current response ends. */
  onStreamEnd?(): void;

  /** Called before tools are executed. Receives the tool calls the LLM requested. */
  beforeExecuteTools?(toolCalls: ToolCall[]): Promise<void>;

  /** Called after each LLM response (whether it had tool calls or not). */
  afterIteration?(iteration: number, response: LLMResponse): Promise<void>;

  /**
   * Called with the final text content before it's returned.
   * Return a modified string to transform the output, or undefined to keep it as-is.
   */
  finalizeContent?(content: string): Promise<string | undefined>;
}

/**
 * CompositeHook — Fans out to multiple hooks with error isolation.
 * If one hook throws, the others still run and a warning is logged.
 */
export class CompositeHook implements Required<AgentHook> {
  private hooks: AgentHook[];

  constructor(hooks: AgentHook[] = []) {
    this.hooks = hooks;
  }

  /** Add a hook at runtime. */
  add(hook: AgentHook): void {
    this.hooks.push(hook);
  }

  async beforeIteration(iteration: number, messages: Message[]): Promise<void | false> {
    for (const hook of this.hooks) {
      try {
        const result = await hook.beforeIteration?.(iteration, messages);
        if (result === false) return false;
      } catch (err) {
        this.logError("beforeIteration", err);
      }
    }
  }

  onStream(chunk: string): void {
    for (const hook of this.hooks) {
      try {
        hook.onStream?.(chunk);
      } catch (err) {
        this.logError("onStream", err);
      }
    }
  }

  onStreamEnd(): void {
    for (const hook of this.hooks) {
      try {
        hook.onStreamEnd?.();
      } catch (err) {
        this.logError("onStreamEnd", err);
      }
    }
  }

  async beforeExecuteTools(toolCalls: ToolCall[]): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook.beforeExecuteTools?.(toolCalls);
      } catch (err) {
        this.logError("beforeExecuteTools", err);
      }
    }
  }

  async afterIteration(iteration: number, response: LLMResponse): Promise<void> {
    for (const hook of this.hooks) {
      try {
        await hook.afterIteration?.(iteration, response);
      } catch (err) {
        this.logError("afterIteration", err);
      }
    }
  }

  async finalizeContent(content: string): Promise<string | undefined> {
    let result: string | undefined = content;
    for (const hook of this.hooks) {
      try {
        const modified: string | undefined = await hook.finalizeContent?.(result ?? content);
        if (modified !== undefined) result = modified;
      } catch (err) {
        this.logError("finalizeContent", err);
      }
    }
    return result;
  }

  private logError(method: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`  [Hook error in ${method}: ${msg}]`);
  }
}
