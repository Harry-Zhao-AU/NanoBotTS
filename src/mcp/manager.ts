/**
 * MCPManager — manages multiple MCP server connections.
 *
 * Connects to all configured servers at startup, discovers their tools,
 * and wraps them as NanoBotTS Tool instances. Handles graceful shutdown.
 */

import type { MCPServerConfig } from "../types.js";
import { MCPClient } from "./client.js";
import { MCPToolWrapper } from "./tool-wrapper.js";

export class MCPManager {
  private clients = new Map<string, MCPClient>();

  /**
   * Connect to all configured MCP servers.
   * Failures are logged and skipped — the bot continues with available servers.
   */
  async connectAll(
    servers: Record<string, MCPServerConfig> | undefined,
  ): Promise<void> {
    if (!servers) return;

    for (const [name, config] of Object.entries(servers)) {
      // Skip disabled servers
      if (config.enabled === false) continue;

      const client = new MCPClient(name, config);
      try {
        await client.connect();
        this.clients.set(name, client);
        const toolNames = client.getTools().map((t) => t.name);
        console.log(
          `  MCP "${name}": connected (${toolNames.length} tools: ${toolNames.join(", ")})`,
        );
      } catch (error: unknown) {
        console.warn(
          `  MCP "${name}": unavailable — ${(error as Error).message}`,
        );
      }
    }
  }

  /**
   * Return wrapped Tool instances for all discovered MCP tools.
   */
  getWrappedTools(): MCPToolWrapper[] {
    const tools: MCPToolWrapper[] = [];
    for (const [name, client] of this.clients) {
      for (const mcpTool of client.getTools()) {
        tools.push(new MCPToolWrapper(name, mcpTool, client));
      }
    }
    return tools;
  }

  /**
   * Disconnect all MCP servers.
   */
  async disconnectAll(): Promise<void> {
    for (const [, client] of this.clients) {
      await client.disconnect();
    }
    this.clients.clear();
  }

  getServerNames(): string[] {
    return Array.from(this.clients.keys());
  }
}
