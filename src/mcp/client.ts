/**
 * MCP Client — wraps @modelcontextprotocol/sdk for a single MCP server connection.
 *
 * Handles transport creation (stdio, SSE, streamable-http), tool discovery,
 * and tool invocation with timeout support.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { MCPServerConfig } from "../types.js";

/** Tool info as discovered from an MCP server */
export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export class MCPClient {
  private client: Client;
  private transport:
    | StdioClientTransport
    | SSEClientTransport
    | StreamableHTTPClientTransport
    | null = null;
  private tools: MCPToolInfo[] = [];
  private connected = false;

  constructor(
    readonly serverName: string,
    private config: MCPServerConfig,
  ) {
    this.client = new Client({
      name: "nanobotts",
      version: "1.0.0",
    });
  }

  async connect(): Promise<void> {
    this.transport = this.createTransport();
    await this.client.connect(this.transport);
    this.connected = true;

    // Discover tools
    const result = await this.client.listTools();
    let tools: MCPToolInfo[] = (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {
        type: "object",
        properties: {},
      },
    }));

    // Apply enabledTools filter
    if (this.config.enabledTools && this.config.enabledTools.length > 0) {
      const allowed = new Set(this.config.enabledTools);
      tools = tools.filter((t) => allowed.has(t.name));
    }

    this.tools = tools;
  }

  async disconnect(): Promise<void> {
    if (this.connected) {
      try {
        await this.client.close();
      } catch {
        // Ignore close errors during shutdown
      }
      this.connected = false;
    }
  }

  getTools(): MCPToolInfo[] {
    return this.tools;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  async callTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const timeout = this.config.toolTimeout ?? 30_000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const result = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: controller.signal },
      );
      return this.extractContent(result);
    } catch (error: unknown) {
      if ((error as Error).name === "AbortError") {
        return `MCP tool "${toolName}" timed out after ${timeout}ms`;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private createTransport() {
    switch (this.config.transport) {
      case "stdio": {
        if (!this.config.command) {
          throw new Error(
            `MCP server "${this.serverName}": stdio transport requires "command"`,
          );
        }
        return new StdioClientTransport({
          command: this.config.command,
          args: this.config.args,
          env: this.config.env
            ? { ...process.env, ...this.config.env } as Record<string, string>
            : undefined,
          cwd: this.config.cwd,
        });
      }

      case "sse": {
        if (!this.config.url) {
          throw new Error(
            `MCP server "${this.serverName}": sse transport requires "url"`,
          );
        }
        return new SSEClientTransport(new URL(this.config.url));
      }

      case "streamable-http": {
        if (!this.config.url) {
          throw new Error(
            `MCP server "${this.serverName}": streamable-http transport requires "url"`,
          );
        }
        return new StreamableHTTPClientTransport(new URL(this.config.url));
      }

      default:
        throw new Error(
          `MCP server "${this.serverName}": unknown transport "${this.config.transport}"`,
        );
    }
  }

  private extractContent(result: Awaited<ReturnType<Client["callTool"]>>): string {
    const parts = (result.content as Array<{ type: string; text?: string }>) ?? [];
    return (
      parts
        .filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n") || "(no content)"
    );
  }
}
