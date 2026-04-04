/**
 * NanoBotTS — Entry Point
 *
 * Phase 3: Multi-provider support via ProviderRegistry.
 *
 * Usage:
 *   npm start                         — CLI mode (default)
 *   npm start -- --channel telegram   — Telegram mode
 *   npm start -- --channel all        — Both CLI and Telegram
 *
 * Provider selection (via .env):
 *   PROVIDER_NAME=azure-openai   (default, uses AZURE_OPENAI_* vars)
 *   PROVIDER_NAME=openai         (uses OPENAI_API_KEY, OPENAI_MODEL)
 *   PROVIDER_NAME=ollama         (local, uses OPENAI_BASE_URL)
 */

import { loadConfig } from "./config.js";
import { createDefaultRegistry } from "./providers/registry.js";
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

  // Provider — created via registry from config
  const providerRegistry = createDefaultRegistry();
  const provider = await providerRegistry.create(config.provider, {
    temperature: config.agent.temperature,
    maxTokens: config.agent.maxTokens,
  });
  console.log(`Provider: ${config.provider.name} (${config.provider.model})`);

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

  // Bus — the backbone connecting channels <-> agent
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
  agentLoop.start();
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
