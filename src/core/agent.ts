/**
 * AgentRunner — The core agent loop with hook support.
 *
 * Runs a multi-step LLM + tool-calling loop. Hooks allow external code
 * to observe and influence the loop at each lifecycle point.
 */

import { LLMProvider } from "../providers/base.js";
import { ToolRegistry } from "../tools/base.js";
import { Message, ToolCall, AssistantMessage, ToolResultMessage } from "../types.js";
import { estimateMessageTokens, estimateTotalTokens, truncateToTokenBudget } from "../utils/tokens.js";
import { AgentHook, CompositeHook } from "./hook.js";

/** Callback for streaming chunks to the caller */
export type StreamCallback = (chunk: string) => void;

export class AgentRunner {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  private contextBudget: number;
  private toolResultBudget: number;
  private hook: CompositeHook;

  constructor(
    provider: LLMProvider,
    toolRegistry: ToolRegistry,
    maxIterations: number = 200,
    contextBudget: number = 120000,
    toolResultBudget: number = 8000,
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.maxIterations = maxIterations;
    this.contextBudget = contextBudget;
    this.toolResultBudget = toolResultBudget;
    this.hook = new CompositeHook();
  }

  /** Add a lifecycle hook. */
  addHook(hook: AgentHook): void {
    this.hook.add(hook);
  }

  /**
   * Run the agent loop.
   *
   * @param messages - The conversation history (will be mutated)
   * @param onStream - Optional callback for streaming the final text response
   * @returns The final assistant text response
   */
  async run(messages: Message[], onStream?: StreamCallback): Promise<string> {
    const tools = this.toolRegistry.getOpenAITools();

    for (let i = 0; i < this.maxIterations; i++) {
      this.snipHistory(messages);

      // Hook: beforeIteration — return false to abort
      const proceed = await this.hook.beforeIteration(i, messages);
      if (proceed === false) break;

      const response = await this.provider.chatWithTools(messages, tools);

      // Case 1: LLM wants to call tools
      if (response.toolCalls.length > 0) {
        const assistantMsg: AssistantMessage = {
          role: "assistant",
          content: response.content,
          tool_calls: response.toolCalls,
        };
        messages.push(assistantMsg as Message);

        // Hook: beforeExecuteTools
        await this.hook.beforeExecuteTools(response.toolCalls);

        // Execute tools — concurrency-safe ones in parallel
        const { concurrent, sequential } = this.partitionToolCalls(response.toolCalls);

        if (concurrent.length > 0) {
          const results = await Promise.all(
            concurrent.map(async (tc) => ({
              id: tc.id,
              result: this.applyToolResultBudget(await this.executeTool(tc)),
            })),
          );
          for (const { id, result } of results) {
            messages.push({ role: "tool", content: result, tool_call_id: id } as Message);
          }
        }

        for (const toolCall of sequential) {
          let result = await this.executeTool(toolCall);
          result = this.applyToolResultBudget(result);
          messages.push({ role: "tool", content: result, tool_call_id: toolCall.id } as Message);
        }

        // Hook: afterIteration (after tools complete)
        await this.hook.afterIteration(i, response);

        continue;
      }

      // Case 2: Final text response
      // Hook: afterIteration
      await this.hook.afterIteration(i, response);
      let content = response.content ?? "";

      // Hook: finalizeContent — allows transforming the output
      const finalized = await this.hook.finalizeContent(content);
      if (finalized !== undefined) content = finalized;

      if (onStream && content) {
        this.hook.onStream(content);
        onStream(content);
        this.hook.onStreamEnd();
      }

      return content;
    }

    return "I've reached the maximum number of steps. Please try rephrasing your question.";
  }

  /** Direct LLM call without tools (for memory consolidation, etc.). */
  async chatDirect(messages: Message[]): Promise<string> {
    return this.provider.chat(messages);
  }

  private async executeTool(toolCall: ToolCall): Promise<string> {
    try {
      process.stdout.write(`  [Tool: ${toolCall.function.name}]\n`);
      return await this.toolRegistry.execute(
        toolCall.function.name,
        toolCall.function.arguments,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error executing tool "${toolCall.function.name}": ${message}`;
    }
  }

  private partitionToolCalls(toolCalls: ToolCall[]): { concurrent: ToolCall[]; sequential: ToolCall[] } {
    const concurrent: ToolCall[] = [];
    const sequential: ToolCall[] = [];

    for (const tc of toolCalls) {
      const tool = this.toolRegistry.get(tc.function.name);
      if (tool?.concurrencySafe) {
        concurrent.push(tc);
      } else {
        sequential.push(tc);
      }
    }

    return { concurrent, sequential };
  }

  private snipHistory(messages: Message[]): void {
    let currentTokens = estimateTotalTokens(messages);
    const limit = this.contextBudget - 4000;
    if (currentTokens <= limit) return;

    const systemMsg = messages[0]?.role === "system" ? messages.shift()! : null;
    const target = limit * 0.8;

    while (messages.length > 2 && currentTokens > target) {
      const removed = messages.shift()!;
      currentTokens -= estimateMessageTokens(removed);
    }

    if (systemMsg) {
      messages.unshift(systemMsg);
    }
  }

  private applyToolResultBudget(result: string): string {
    return truncateToTokenBudget(result, this.toolResultBudget);
  }
}
