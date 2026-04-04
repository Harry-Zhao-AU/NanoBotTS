/**
 * NanoBotTS — Entry Point
 *
 * Phase 2: MessageBus architecture.
 *
 * Components are wired together:
 *   MessageBus ← channels publish inbound, AgentLoop publishes outbound
 *   AgentLoop  ← consumes inbound, runs agent, publishes outbound
 *   ChannelManager ← consumes outbound, routes to correct channel
 *
 * Usage:
 *   npm start                         — CLI mode (default)
 *   npm start -- --channel telegram   — Telegram mode
 *   npm start -- --channel all        — Both CLI and Telegram
 */

import { loadConfig } from "./config.js";
import { AzureOpenAIProvider } from "./providers/azure-openai.js";
import { ToolRegistry } from "./tools/base.js";
import { TimeTool } from "./tools/time.js";
import { WebSearchTool } from "./tools/web-search.js";
import { AgentRunner } from "./core/agent.js";
import { ContextBuilder } from "./core/context.js";
import { Memory } from "./core/memory.js";
import { SessionManager } from "./session/manager.js";
import { MessageBus } from "./bus/queue.js";
import { AgentLoop } from "./core/loop.js";
import { ChannelManager } from "./channels/manager.js";
import { CLIChannel } from "./channels/cli.js";
import { TelegramChannel } from "./channels/telegram.js";

function parseChannelArg(): string {
  const idx = process.argv.indexOf("--channel");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].toLowerCase();
  }
  return "cli";
}

async function main() {
  const config = loadConfig();

  // Provider
  const provider = new AzureOpenAIProvider(
    config.provider,
    config.agent.temperature,
    config.agent.maxTokens,
  );

  // Tools
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new TimeTool());
  toolRegistry.register(new WebSearchTool());
  console.log(`Tools: ${toolRegistry.getToolNames().join(", ")}`);

  // Core systems
  const memory = new Memory();
  const sessionManager = new SessionManager();
  const context = new ContextBuilder(config.persona, toolRegistry, memory);
  const agent = new AgentRunner(provider, toolRegistry, config.agent.maxIterations);

  // Bus — the backbone connecting channels ↔ agent
  const bus = new MessageBus();

  // AgentLoop — central orchestrator
  const agentLoop = new AgentLoop(bus, agent, context, memory, sessionManager);

  // ChannelManager — routes outbound messages to channels
  const channelManager = new ChannelManager(bus);

  // Register channels
  const channelArg = parseChannelArg();

  if (channelArg === "cli" || channelArg === "all") {
    channelManager.register(
      new CLIChannel(bus, context, memory, sessionManager, config),
    );
  }

  if (channelArg === "telegram" || channelArg === "all") {
    if (!config.channels.telegram.token) {
      console.error("Telegram bot token not configured.");
      console.error("Add TELEGRAM_BOT_TOKEN to your .env file.");
      process.exit(1);
    }
    channelManager.register(
      new TelegramChannel(
        config.channels.telegram.token,
        bus,
        context,
        memory,
        sessionManager,
      ),
    );
  }

  // Start everything
  // AgentLoop runs in background (non-blocking infinite loop)
  agentLoop.start();

  // ChannelManager starts channels + outbound dispatch loop
  await channelManager.startAll();

  // Graceful shutdown
  const shutdown = async () => {
    agentLoop.stop();
    await channelManager.stopAll();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
