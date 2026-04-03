/**
 * Azure OpenAI LLM Provider.
 *
 * Wraps the OpenAI SDK's AzureOpenAI client to provide a simple
 * interface for chat completions. This is the layer that talks to GPT-4o.
 *
 * Key concepts:
 * - AzureOpenAI: a client class from the `openai` npm package that
 *   knows how to authenticate with Azure's OpenAI endpoints.
 * - chat.completions.create(): sends a list of messages to the model
 *   and returns the model's response.
 * - Messages have roles: "system" (instructions), "user" (human input),
 *   "assistant" (model output).
 */

import { AzureOpenAI } from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/index";
import { AzureOpenAIConfig, LLMResponse, Message } from "../types.js";

export class AzureOpenAIProvider {
  private client: AzureOpenAI;
  private deploymentName: string;
  private temperature: number;
  private maxTokens: number;

  constructor(config: AzureOpenAIConfig, temperature = 0.7, maxTokens = 2000) {
    this.client = new AzureOpenAI({
      endpoint: config.endpoint,
      apiKey: config.apiKey,
      apiVersion: config.apiVersion,
      deployment: config.deploymentName,
    });
    this.deploymentName = config.deploymentName;
    this.temperature = temperature;
    this.maxTokens = maxTokens;
  }

  /**
   * Convert our Message[] to the format the OpenAI SDK expects.
   *
   * Messages can be simple (role + content) or complex (assistant with
   * tool_calls, or tool results with tool_call_id). We pass them through
   * as-is since they already match the OpenAI format when they come
   * from the agent loop.
   */
  private toSDKMessages(messages: Message[]): ChatCompletionMessageParam[] {
    return messages as unknown as ChatCompletionMessageParam[];
  }

  /**
   * Send messages to GPT-4o and get a complete response.
   * Use this when you need the full reply at once (e.g., for tool calling later).
   */
  async chat(messages: Message[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.deploymentName,
      messages: this.toSDKMessages(messages),
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  /**
   * Send messages to GPT-4o with tools, returning a structured response.
   *
   * This is the method the AgentRunner uses. It returns the full response
   * including any tool calls the LLM wants to make.
   *
   * Key concepts:
   * - When you pass `tools` to the API, the LLM can choose to call one
   *   or more tools instead of (or in addition to) giving a text response.
   * - `tool_calls` in the response contain: the tool name, a unique ID,
   *   and the arguments as a JSON string.
   * - `finish_reason: "tool_calls"` means the LLM wants us to execute
   *   tools and send the results back. `"stop"` means it's done.
   */
  async chatWithTools(messages: Message[], tools: ChatCompletionTool[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.deploymentName,
      messages: this.toSDKMessages(messages),
      tools: tools.length > 0 ? tools : undefined,
      temperature: this.temperature,
      max_tokens: this.maxTokens,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    // Extract tool calls — keep the full API shape so it round-trips correctly
    const toolCalls = (message?.tool_calls ?? [])
      .filter((tc): tc is Extract<typeof tc, { type: "function" }> => tc.type === "function")
      .map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      }));

    return {
      content: message?.content ?? null,
      toolCalls,
      finishReason: choice?.finish_reason ?? "stop",
    };
  }

  /**
   * Send messages to GPT-4o and stream the response token-by-token.
   *
   * This is an async generator — it yields small string chunks as the
   * model produces them, instead of waiting for the full response.
   *
   * Key concepts:
   * - `stream: true` tells the API to send partial results incrementally.
   * - The API returns "chunks" — each chunk has a `delta` with a small
   *   piece of the response (often just one word or a few characters).
   * - `async function*` makes this a generator: the caller uses
   *   `for await (const chunk of provider.chatStream(messages))` to
   *   consume chunks one at a time.
   * - This gives a "typewriter" effect in the terminal — much better UX
   *   than waiting several seconds for the full response.
   */
  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.deploymentName,
      messages: this.toSDKMessages(messages),
      temperature: this.temperature,
      max_tokens: this.maxTokens,
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        yield content;
      }
    }
  }
}
