/**
 * LLMProvider — Abstract base for all LLM backends.
 *
 * Every provider (Azure OpenAI, OpenAI-compat, Anthropic, etc.) implements
 * this interface. The AgentRunner and AgentLoop only depend on LLMProvider,
 * never on a concrete provider class — making providers swappable.
 *
 * Includes retry with exponential backoff for transient API errors.
 */

import type { ChatCompletionTool } from "openai/resources/index";
import { Message, LLMResponse, ToolCall } from "../types.js";

/** Token usage stats returned by providers */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** Settings that control generation behavior */
export interface GenerationSettings {
  temperature: number;
  maxTokens: number;
}

/** Configuration needed to instantiate any provider */
export interface ProviderConfig {
  /** Provider name (e.g., "azure-openai", "openai", "anthropic") */
  name: string;
  /** API endpoint URL */
  endpoint?: string;
  /** API key */
  apiKey: string;
  /** Model or deployment name */
  model: string;
  /** Provider-specific extra config */
  extras?: Record<string, string>;
}

/** Errors that are safe to retry (rate limits, server errors) */
function isTransientError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // Rate limit or server error
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (msg.includes("500") || msg.includes("502") || msg.includes("503")) return true;
    if (msg.includes("timeout") || msg.includes("econnreset")) return true;
  }
  return false;
}

/**
 * Abstract base class for LLM providers.
 * Subclasses implement the core methods; retry logic is shared here.
 */
export abstract class LLMProvider {
  protected settings: GenerationSettings;
  protected maxRetries: number;

  constructor(settings: GenerationSettings, maxRetries: number = 3) {
    this.settings = settings;
    this.maxRetries = maxRetries;
  }

  /** Simple chat completion — returns content string. */
  abstract chat(messages: Message[]): Promise<string>;

  /** Chat with tool definitions — returns structured LLMResponse. */
  abstract chatWithTools(messages: Message[], tools: ChatCompletionTool[]): Promise<LLMResponse>;

  /** Streaming chat — yields content chunks as they arrive. */
  abstract chatStream(messages: Message[]): AsyncGenerator<string>;

  /**
   * Chat with retry — wraps chat() with exponential backoff.
   */
  async chatWithRetry(messages: Message[]): Promise<string> {
    return this.retry(() => this.chat(messages));
  }

  /**
   * ChatWithTools with retry — wraps chatWithTools() with exponential backoff.
   */
  async chatWithToolsRetry(messages: Message[], tools: ChatCompletionTool[]): Promise<LLMResponse> {
    return this.retry(() => this.chatWithTools(messages, tools));
  }

  /** Exponential backoff retry for transient errors. */
  protected async retry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt < this.maxRetries && isTransientError(error)) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
          const jitter = Math.random() * 500;
          console.error(
            `  [Provider retry ${attempt + 1}/${this.maxRetries} in ${Math.round(delay + jitter)}ms]`,
          );
          await new Promise((r) => setTimeout(r, delay + jitter));
          continue;
        }

        throw error;
      }
    }

    throw lastError;
  }
}
