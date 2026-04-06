/**
 * MCPToolWrapper — adapts an MCP server tool to the NanoBotTS Tool interface.
 *
 * One wrapper instance per discovered MCP tool. Tool names are namespaced
 * with the server name to avoid collisions (e.g., "resume_graph_search_employees").
 */

import type { Tool, ToolParameters } from "../tools/base.js";
import type { MCPClient, MCPToolInfo } from "./client.js";

/**
 * Normalize an MCP JSON Schema for OpenAI function-calling compatibility.
 *
 * - Ensures top-level `type: "object"` is present
 * - Strips `$schema` and `$ref`
 * - Simplifies `oneOf`/`anyOf` by picking the first non-null variant
 */
export function normalizeSchema(
  schema: Record<string, unknown>,
): ToolParameters {
  const out: Record<string, unknown> = { ...schema };

  // Ensure top-level type
  if (!out.type) {
    out.type = "object";
  }

  // Remove unsupported keys
  delete out.$schema;
  delete out.$ref;

  // Normalize properties that use oneOf/anyOf
  if (out.properties && typeof out.properties === "object") {
    const props = out.properties as Record<string, Record<string, unknown>>;
    for (const [key, prop] of Object.entries(props)) {
      props[key] = normalizeProperty(prop);
    }
  }

  return out;
}

function normalizeProperty(
  prop: Record<string, unknown>,
): Record<string, unknown> {
  const variants =
    (prop.oneOf as Record<string, unknown>[]) ??
    (prop.anyOf as Record<string, unknown>[]);

  if (variants && Array.isArray(variants)) {
    // Pick the first non-null variant
    const picked =
      variants.find((v) => v.type !== "null") ?? variants[0] ?? {};
    const result: Record<string, unknown> = {
      ...picked,
    };
    if (prop.description) result.description = prop.description;
    return result;
  }

  return prop;
}

export class MCPToolWrapper implements Tool {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolParameters;
  readonly readOnly = false;
  readonly concurrencySafe = true;

  /** Original tool name on the MCP server (without namespace prefix) */
  private originalName: string;

  constructor(
    serverName: string,
    tool: MCPToolInfo,
    private client: MCPClient,
  ) {
    this.originalName = tool.name;
    this.name = `${serverName}_${tool.name}`;
    this.description = tool.description || `MCP tool from ${serverName}`;
    this.parameters = normalizeSchema(tool.inputSchema);
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    try {
      return await this.client.callTool(this.originalName, args);
    } catch (error: unknown) {
      return `Error calling MCP tool "${this.name}": ${(error as Error).message}`;
    }
  }
}
