/**
 * Tool system — Interface + Registry.
 *
 * A "tool" is a function the LLM can choose to call. For example,
 * "get the current time" or "search the web". The LLM doesn't execute
 * the tool itself — it tells US which tool to call and with what arguments,
 * then we execute it and send the result back.
 *
 * Key concepts:
 * - Tool interface: every tool must have a name, description, parameter
 *   schema (JSON Schema format), and an execute() method.
 * - ToolRegistry: a central catalog of all available tools. The agent
 *   asks the registry for the list of tool schemas (to tell the LLM
 *   what's available) and looks up tools by name (to execute them).
 * - JSON Schema: a standard way to describe the shape of data. The LLM
 *   uses this to know what arguments each tool accepts.
 * - OpenAI tool format: the specific shape the API expects when you
 *   pass tools to chat.completions.create().
 */

/**
 * JSON Schema object describing a tool's parameters.
 *
 * We use Record<string, unknown> because the OpenAI SDK's FunctionParameters
 * type requires an index signature. This is flexible enough to hold any
 * valid JSON Schema while satisfying TypeScript's type checker.
 */
export type ToolParameters = Record<string, unknown>;

/** The interface every tool must implement */
export interface Tool {
  /** Unique name the LLM uses to call this tool (e.g., "get_current_time") */
  name: string;

  /** Human-readable description — the LLM reads this to decide when to use the tool */
  description: string;

  /** JSON Schema describing the arguments this tool accepts */
  parameters: ToolParameters;

  /** Execute the tool with the given arguments and return a string result */
  execute(args: Record<string, unknown>): Promise<string>;
}

/**
 * We use the OpenAI SDK's own ChatCompletionTool type directly.
 * This avoids type mismatches between our types and the SDK's types.
 */
import type { ChatCompletionTool } from "openai/resources/index";

/** Convert a Tool to the OpenAI API's expected format */
export function toOpenAITool(tool: Tool): ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * ToolRegistry — Central catalog of all available tools.
 *
 * Tools register themselves here. The agent uses the registry to:
 * 1. Get all tool schemas → pass to the LLM so it knows what's available.
 * 2. Look up a tool by name → execute it when the LLM requests it.
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /** Register a tool. Throws if a tool with the same name already exists. */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Look up a tool by name. Returns undefined if not found. */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Get all tool schemas in OpenAI API format. */
  getOpenAITools(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map(toOpenAITool);
  }

  /** Get the names of all registered tools. */
  getToolNames(): string[] {
    return Array.from(this.tools.keys());
  }
}
