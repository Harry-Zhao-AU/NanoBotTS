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

import { AzureOpenAIProvider } from "../providers/azure-openai.js";
import { ToolRegistry } from "../tools/base.js";
import { Message, ToolCall, AssistantMessage, ToolResultMessage } from "../types.js";
import { estimateTotalTokens, truncateToTokenBudget } from "../utils/tokens.js";

/** Callback for streaming chunks to the caller */
export type StreamCallback = (chunk: string) => void;

export class AgentRunner {
  private provider: AzureOpenAIProvider;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;
  /** Max tokens for the full context window (prompt + response) */
  private contextBudget: number;
  /** Max tokens for a single tool result before truncation */
  private toolResultBudget: number;

  constructor(
    provider: AzureOpenAIProvider,
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
        messages.push(assistantMsg as unknown as Message);

        // Execute each tool and add results to history
        for (const toolCall of response.toolCalls) {
          let result = await this.executeTool(toolCall);
          result = this.applyToolResultBudget(result);

          const toolResultMsg: ToolResultMessage = {
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          };
          messages.push(toolResultMsg as unknown as Message);
        }

        // Continue the loop — send tool results back to the LLM
        continue;
      }

      // Case 2: LLM gave a final text response (no tool calls)
      // Stream it if a callback was provided
      if (onStream && response.content) {
        // For the final response, re-call with streaming
        const streamedContent = await this.streamFinalResponse(messages, onStream);
        return streamedContent;
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
   * Trim old conversation messages when approaching the context window limit.
   * Always keeps the system message and the most recent messages.
   */
  private snipHistory(messages: Message[]): void {
    const totalTokens = estimateTotalTokens(messages);
    // Leave room for the response (reserve ~4000 tokens)
    const limit = this.contextBudget - 4000;
    if (totalTokens <= limit) return;

    // Find the system message (always index 0) — keep it
    const systemMsg = messages[0]?.role === "system" ? messages.shift()! : null;

    // Drop oldest non-system messages until under budget
    while (messages.length > 2 && estimateTotalTokens(messages) > limit * 0.8) {
      messages.shift();
    }

    // Re-insert system message at the front
    if (systemMsg) {
      messages.unshift(systemMsg);
    }
  }

  /** Truncate a tool result if it exceeds the per-result token budget. */
  private applyToolResultBudget(result: string): string {
    return truncateToTokenBudget(result, this.toolResultBudget);
  }

  /** Stream the final response after all tool calls are resolved. */
  private async streamFinalResponse(
    messages: Message[],
    onStream: StreamCallback,
  ): Promise<string> {
    let fullContent = "";
    for await (const chunk of this.provider.chatStream(messages)) {
      onStream(chunk);
      fullContent += chunk;
    }
    return fullContent;
  }
}
