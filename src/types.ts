/**
 * Core type definitions for NanoBotTS.
 *
 * These types mirror the OpenAI chat completion message format,
 * which is the standard interface for LLM conversations.
 */

/** The role of a message in a conversation */
export type MessageRole = "system" | "user" | "assistant" | "tool";

/** A basic message in a conversation */
export interface BaseMessage {
  role: MessageRole;
  content: string;
}

/**
 * Union type for all message types that can appear in conversation history.
 * Includes basic messages, assistant messages with tool_calls, and tool results.
 */
export type Message = BaseMessage | AssistantMessage | ToolResultMessage;

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
  /** Token usage stats (if reported by the provider) */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Azure OpenAI connection configuration (kept for backwards compat with old config.json) */
export interface AzureOpenAIConfig {
  endpoint: string;
  apiKey: string;
  deploymentName: string;
  apiVersion: string;
}

/** Generic provider configuration */
export interface ProviderConfigType {
  /** Provider name: "azure-openai", "openai", "groq", "ollama", etc. */
  name: string;
  /** API endpoint URL (optional — providers have defaults) */
  endpoint?: string;
  /** API key (loaded from .env) */
  apiKey: string;
  /** Model or deployment name */
  model: string;
  /** Provider-specific extra settings (e.g., apiVersion for Azure) */
  extras?: Record<string, string>;
}

/** Channel configuration */
export interface ChannelsConfig {
  cli: { enabled: boolean };
  telegram: { enabled: boolean; token: string };
}

/** Configuration for a single MCP server */
export interface MCPServerConfig {
  /** Transport type */
  transport: "stdio" | "sse" | "streamable-http";
  /** For stdio: command to run */
  command?: string;
  /** For stdio: command arguments */
  args?: string[];
  /** For stdio: environment variables to pass */
  env?: Record<string, string>;
  /** For stdio: working directory */
  cwd?: string;
  /** For sse/streamable-http: server URL */
  url?: string;
  /** Only register these tools (omit = all) */
  enabledTools?: string[];
  /** Timeout per tool call in ms (default: 30000) */
  toolTimeout?: number;
  /** Whether to connect on startup (default: true) */
  enabled?: boolean;
}

/** Full application configuration */
export interface AppConfig {
  /** The system prompt / persona for the bot */
  persona: string;
  /** LLM provider settings */
  provider: ProviderConfigType;
  /** Agent behavior settings */
  agent: {
    maxIterations: number;
    temperature: number;
    maxTokens: number;
  };
  /** Channel settings */
  channels: ChannelsConfig;
  /** MCP server connections */
  mcpServers?: Record<string, MCPServerConfig>;
}
