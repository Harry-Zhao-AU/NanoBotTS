/**
 * NanoBotTS — Entry Point
 *
 * Phase 6: Persistent memory and session storage.
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
import { CLIChannel } from "./channels/cli.js";
import { TelegramChannel } from "./channels/telegram.js";
import type { Channel } from "./channels/base.js";

function parseChannelArg(): string {
  const idx = process.argv.indexOf("--channel");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1].toLowerCase();
  }
  return "cli";
}

async function main() {
  const config = loadConfig();

  const provider = new AzureOpenAIProvider(
    config.provider,
    config.agent.temperature,
    config.agent.maxTokens,
  );

  const toolRegistry = new ToolRegistry();
  toolRegistry.register(new TimeTool());
  toolRegistry.register(new WebSearchTool());

  console.log(`Tools: ${toolRegistry.getToolNames().join(", ")}`);

  // Create memory system
  const memory = new Memory();

  // Context builder now includes memory
  const context = new ContextBuilder(config.persona, toolRegistry, memory);

  const agent = new AgentRunner(provider, toolRegistry, config.agent.maxIterations);

  // Start channels
  const channelArg = parseChannelArg();
  const channels: Channel[] = [];

  if (channelArg === "cli" || channelArg === "all") {
    channels.push(new CLIChannel(agent, context, memory, config));
  }

  if (channelArg === "telegram" || channelArg === "all") {
    if (!config.channels.telegram.token) {
      console.error("Telegram bot token not configured.");
      console.error("Add TELEGRAM_BOT_TOKEN to your .env file.");
      process.exit(1);
    }
    channels.push(new TelegramChannel(config.channels.telegram.token, agent, context, memory));
  }

  if (channels.length === 0) {
    console.error(`Unknown channel: "${channelArg}". Use: cli, telegram, or all`);
    process.exit(1);
  }

  await Promise.all(
    channels.map((ch) =>
      ch.start().catch((err) => {
        const name = ch.constructor.name;
        console.error(`\n${name} failed to start: ${err.message}`);
        console.error("Other channels will continue running.\n");
      }),
    ),
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
