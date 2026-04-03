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

/** Callback for streaming chunks to the caller */
export type StreamCallback = (chunk: string) => void;

export class AgentRunner {
  private provider: AzureOpenAIProvider;
  private toolRegistry: ToolRegistry;
  private maxIterations: number;

  constructor(
    provider: AzureOpenAIProvider,
    toolRegistry: ToolRegistry,
    maxIterations: number = 10,
  ) {
    this.provider = provider;
    this.toolRegistry = toolRegistry;
    this.maxIterations = maxIterations;
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
          const result = await this.executeTool(toolCall);

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
    const tool = this.toolRegistry.get(toolCall.function.name);

    if (!tool) {
      return `Error: Unknown tool "${toolCall.function.name}"`;
    }

    try {
      // Parse the arguments JSON string into an object
      const args = JSON.parse(toolCall.function.arguments);
      process.stdout.write(`  [Tool: ${toolCall.function.name}]\n`);
      return await tool.execute(args);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error executing tool "${toolCall.function.name}": ${message}`;
    }
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
