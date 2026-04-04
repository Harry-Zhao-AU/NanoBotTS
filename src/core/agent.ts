/**
 * AgentRunner — The core agent loop.
 *
 * This is what turns a chatbot into an agent. Instead of just sending
 * messages to the LLM and printing the response, the agent loop handles
 * a multi-step cycle:
 *
 *   1. Send messages + available tools to the LLM
 *   2. If the LLM responds with tool_calls → execute each tool
 *   3. Feed tool results back to the LLM
 *   4. Repeat until the LLM gives a final text response (or max iterations)
 *
 * This is the same pattern used by nanobot's AgentRunner, OpenAI's
 * Agents SDK, and virtually every LLM agent framework.
 *
 * Key concepts:
 * - Tool calling: the LLM doesn't execute tools — it returns a JSON
 *   description of which tool to call and with what arguments. WE
 *   execute the tool and send the result back.
 * - The loop: the LLM may need multiple tool calls to answer a question.
 *   e.g., "What time is it in Tokyo and New York?" → two tool calls.
 * - Max iterations: safety limit to prevent infinite loops.
 * - The conversation history grows during the loop: user message →
 *   assistant (tool_calls) → tool results → assistant (tool_calls) →
 *   tool results → assistant (final text).
 */

import { LLMProvider } from "../providers/base.js";
import { ToolRegistry } from "../tools/base.js";
import { Message, ToolCall, AssistantMessage, ToolResultMessage } from "../types.js";
import { estimateMessageTokens, estimateTotalTokens, truncateToTokenBudget } from "../utils/tokens.js";

/** Callback for streaming chunks to the caller */
export type StreamCallback = (chunk: string) => void;

export class AgentRunner {
  private provider: LLMProvider;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  /** Max tokens for the full context window (prompt + response) */
  private contextBudget: number;
  /** Max tokens for a single tool result before truncation */
  private toolResultBudget: number;

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
  }

  /**
   * Run the agent loop.
   *
   * Takes the conversation history, runs the LLM with tools, executes
   * any tool calls, and repeats until we get a final text response.
   *
   * @param messages - The conversation history (will be mutated with new messages)
   * @param onStream - Optional callback for streaming the final text response
   * @returns The final assistant text response
   */
  async run(messages: Message[], onStream?: StreamCallback): Promise<string> {
    const tools = this.toolRegistry.getOpenAITools();

    for (let i = 0; i < this.maxIterations; i++) {
      // Trim history if approaching context window limit
      this.snipHistory(messages);

      // Call the LLM with the current messages and available tools
      const response = await this.provider.chatWithTools(messages, tools);

      // Case 1: LLM wants to call tools
      if (response.toolCalls.length > 0) {
        // Add the assistant's tool-calling message to history.
        // We must include the tool_calls so the API knows which
        // tool results correspond to which requests.
        const assistantMsg: AssistantMessage = {
          role: "assistant",
          content: response.content,
          tool_calls: response.toolCalls,
        };
        messages.push(assistantMsg as Message);

        // Execute tools — run concurrency-safe tools in parallel
        const { concurrent, sequential } = this.partitionToolCalls(response.toolCalls);

        // Run concurrency-safe tools in parallel
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

        // Run non-concurrent tools sequentially
        for (const toolCall of sequential) {
          let result = await this.executeTool(toolCall);
          result = this.applyToolResultBudget(result);
          messages.push({ role: "tool", content: result, tool_call_id: toolCall.id } as Message);
        }

        // Continue the loop — send tool results back to the LLM
        continue;
      }

      // Case 2: LLM gave a final text response (no tool calls)
      if (onStream && response.content) {
        // Feed the already-received content to the stream callback
        // instead of making a second LLM call
        onStream(response.content);
      }

      return response.content ?? "";
    }

    return "I've reached the maximum number of steps. Please try rephrasing your question.";
  }

  /**
   * Direct LLM call without tools — used for internal tasks like
   * memory consolidation where we don't want tool calling.
   */
  async chatDirect(messages: Message[]): Promise<string> {
    return this.provider.chat(messages);
  }

  /** Execute a single tool call and return the result string. */
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

  /**
   * Partition tool calls into concurrent (safe to parallelize) and sequential groups.
   */
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

  /**
   * Trim old conversation messages when approaching the context window limit.
   * Always keeps the system message and the most recent messages.
   */
  private snipHistory(messages: Message[]): void {
    let currentTokens = estimateTotalTokens(messages);
    const limit = this.contextBudget - 4000;
    if (currentTokens <= limit) return;

    const systemMsg = messages[0]?.role === "system" ? messages.shift()! : null;
    const target = limit * 0.8;

    // Subtract incrementally instead of re-scanning the whole array
    while (messages.length > 2 && currentTokens > target) {
      const removed = messages.shift()!;
      currentTokens -= estimateMessageTokens(removed);
    }

    if (systemMsg) {
      messages.unshift(systemMsg);
    }
  }

  /** Truncate a tool result if it exceeds the per-result token budget. */
  private applyToolResultBudget(result: string): string {
    return truncateToTokenBudget(result, this.toolResultBudget);
  }

}
