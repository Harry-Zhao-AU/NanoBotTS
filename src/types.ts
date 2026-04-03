/**
 * Core type definitions for NanoBotTS.
 *
 * These types mirror the OpenAI chat completion message format,
 * which is the standard interface for LLM conversations.
 */

/** The role of a message in a conversation */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A single message in a conversation */
export interface Message {
  role: MessageRole;
  content: string;
}

/**
 * A tool call requested by the LLM.
 *
 * This matches the exact shape the OpenAI API returns AND expects back.
 * When the LLM requests a tool call, we store it as-is in the assistant
 * message. The API requires this exact format when we send the message
 * history back — including `type: "function"` and the nested `function` object.
 */
export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string — we parse it when executing
  };
}

/** A tool result to feed back to the LLM */
export interface ToolResultMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
}

/**
 * An assistant message that may contain tool calls.
 * When the LLM wants to use a tool, it returns tool_calls instead of
 * (or alongside) text content. We need to preserve the full shape
 * so we can feed it back in the next request.
 */
export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

/** The structured response from the LLM provider */
export interface LLMResponse {
  content: string | null;
  toolCalls: ToolCall[];
  finishReason: string;
}

/** Azure OpenAI connection configuration */
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deploymentName: string;
  apiVersion: string;
}

/** Channel configuration */
export interface ChannelsConfig {
  cli: { enabled: boolean };
  telegram: { enabled: boolean; token: string };
}

/** Full application configuration */
export interface AppConfig {
  /** The system prompt / persona for the bot */
  persona: string;
  /** Azure OpenAI provider settings */
  provider: AzureOpenAIConfig;
  /** Agent behavior settings */
  agent: {
    maxIterations: number;
    temperature: number;
    maxTokens: number;
  };
  /** Channel settings */
  channels: ChannelsConfig;
}
