/**
 * OpenAI-Compatible LLM Provider.
 *
 * Works with any API that implements the OpenAI chat completions format:
 *   - OpenAI (api.openai.com)
 *   - Groq, Together, Fireworks, DeepSeek
 *   - Local servers: Ollama, LM Studio, vLLM, etc.
 *
 * Set `endpoint` to the base URL and `apiKey` + `model` as needed.
 * For local servers that don't require auth, use apiKey: "not-needed".
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/index";
import { LLMProvider, ProviderConfig, GenerationSettings } from "./base.js";
import { LLMResponse, Message } from "../types.js";

export class OpenAICompatProvider extends LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(config: ProviderConfig, settings: GenerationSettings) {
    super(settings);

    this.client = new OpenAI({
      baseURL: config.endpoint || "https://api.openai.com/v1",
      apiKey: config.apiKey,
    });
    this.model = config.model;
  }

  private toSDKMessages(messages: Message[]): ChatCompletionMessageParam[] {
    return messages as unknown as ChatCompletionMessageParam[];
  }

  async chat(messages: Message[]): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.toSDKMessages(messages),
      temperature: this.settings.temperature,
      max_tokens: this.settings.maxTokens,
    });

    return response.choices[0]?.message?.content ?? "";
  }

  async chatWithTools(messages: Message[], tools: ChatCompletionTool[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: this.toSDKMessages(messages),
      tools: tools.length > 0 ? tools : undefined,
      temperature: this.settings.temperature,
      max_tokens: this.settings.maxTokens,
    });

    const choice = response.choices[0];
    const message = choice?.message;

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
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    };
  }

  async *chatStream(messages: Message[]): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: this.toSDKMessages(messages),
      temperature: this.settings.temperature,
      max_tokens: this.settings.maxTokens,
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
