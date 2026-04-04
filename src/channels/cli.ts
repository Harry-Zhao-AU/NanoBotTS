/**
 * CLI Channel — Interactive terminal interface.
 *
 * Phase 2 rewrite: now a thin I/O adapter. The CLI channel:
 *   1. Reads user input via readline
 *   2. Publishes to the MessageBus inbound queue
 *   3. Receives outbound messages (deltas + final) and writes to stdout
 *
 * All agent logic, session management, and memory consolidation now
 * live in AgentLoop — the channel just handles terminal I/O.
 *
 * Slash commands that affect local config (/persona, /model, /config)
 * are still handled here since they're channel-specific UI.
 */

import readline from "node:readline";
import { MessageBus } from "../bus/queue.js";
import { ContextBuilder } from "../core/context.js";
import { Memory } from "../core/memory.js";
import { SessionManager } from "../session/manager.js";
import { AppConfig } from "../types.js";
import { saveConfig } from "../config.js";
import type { Channel } from "./base.js";
import type { OutboundMessage } from "../bus/queue.js";

const CLI_SESSION_ID = "cli";
const CLI_CHAT_ID = "cli";

export class CLIChannel implements Channel {
  readonly name = "cli";

  private bus: MessageBus;
  private context: ContextBuilder;
  private memory: Memory;
  private sessionManager: SessionManager;
  private config: AppConfig;
  private rl: readline.Interface;

  constructor(
    bus: MessageBus,
    context: ContextBuilder,
    memory: Memory,
    sessionManager: SessionManager,
    config: AppConfig,
  ) {
    this.bus = bus;
    this.context = context;
    this.memory = memory;
    this.sessionManager = sessionManager;
    this.config = config;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  async start(): Promise<void> {
    console.log("NanoBot v0.9 — Multi-Provider");
    console.log('Type a message, or /help for commands. "exit" to quit.\n');

    // Ensure session exists (SessionManager loads from disk automatically)
    this.sessionManager.getOrCreate(CLI_SESSION_ID, this.context.build());

    const memContent = this.memory.readLongTermMemory();
    if (memContent) {
      console.log("Memory loaded. I remember things about you from past conversations.\n");
    }

    this.rl.on("close", () => {
      this.sessionManager.save(CLI_SESSION_ID);
      console.log("\nSession saved. Goodbye!");
      process.exit(0);
    });

    this.promptLoop();
  }

  async stop(): Promise<void> {
    this.sessionManager.save(CLI_SESSION_ID);
    this.rl.close();
  }

  private receivedDelta: boolean = false;

  /** Called by ChannelManager when a final response arrives. */
  async send(msg: OutboundMessage): Promise<void> {
    if (!this.receivedDelta) {
      // No streaming happened — print the full response
      process.stdout.write(msg.content);
    }
    process.stdout.write("\n\n");
    this.receivedDelta = false;
  }

  /** Called by ChannelManager for each streaming chunk. */
  async sendDelta(msg: OutboundMessage): Promise<void> {
    this.receivedDelta = true;
    process.stdout.write(msg.content);
  }

  private promptLoop(): void {
    this.rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit") {
        this.sessionManager.save(CLI_SESSION_ID);
        console.log("Session saved. Goodbye!");
        this.rl.close();
        return;
      }

      if (!trimmed) {
        this.promptLoop();
        return;
      }

      if (trimmed.startsWith("/")) {
        await this.handleCommand(trimmed);
        this.promptLoop();
        return;
      }

      // Publish to the bus — AgentLoop will handle the rest
      process.stdout.write("\nBot: ");
      this.bus.publishInbound({
        channel: this.name,
        sessionKey: CLI_SESSION_ID,
        chatId: CLI_CHAT_ID,
        senderName: "User",
        content: trimmed,
      });

      // Wait for the final response before showing next prompt
      await this.waitForResponse(CLI_CHAT_ID);

      this.promptLoop();
    });
  }

  /**
   * Wait for the final outbound message for this chat.
   * Deltas are handled by sendDelta() called from ChannelManager;
   * we just need to know when the final message arrives.
   */
  private waitForResponse(chatId: string): Promise<void> {
    return new Promise((resolve) => {
      this._pendingResolve = resolve;
    });
  }

  /** Resolve stored by waitForResponse, called when send() fires. */
  _pendingResolve: (() => void) | null = null;

  /** Called by ChannelManager to signal response complete. */
  notifyResponseComplete(): void {
    if (this._pendingResolve) {
      const resolve = this._pendingResolve;
      this._pendingResolve = null;
      resolve();
    }
  }

  // ── Slash Commands (channel-local UI) ────────────────────────

  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(/\s+/);
    const command = parts[0].toLowerCase();
    const args = parts.slice(1).join(" ");

    switch (command) {
      case "help":
        this.showHelp();
        break;
      case "clear":
        this.clearSession();
        break;
      case "persona":
        this.setPersona(args);
        break;
      case "config":
        this.showConfig();
        break;
      case "model":
        this.setModel(args);
        break;
      case "memory":
        this.showMemory();
        break;
      case "forget":
        this.forgetMemory();
        break;
      case "sessions":
        this.listSessions();
        break;
      case "save":
        this.sessionManager.save(CLI_SESSION_ID);
        console.log("\nSession saved.\n");
        break;
      default:
        console.log(`\nUnknown command: /${command}. Type /help for available commands.\n`);
    }
  }

  private showHelp(): void {
    console.log(`
Available commands:
  /help              — Show this help message
  /clear             — Clear conversation history (start fresh)
  /persona <text>    — Change the bot's personality/instructions
  /config            — Show current configuration
  /model <name>      — Switch the Azure OpenAI deployment name
  /memory            — Show what the bot remembers about you
  /forget            — Clear all long-term memory
  /sessions          — List saved sessions
  /save              — Save current session to disk
  exit               — Save session, then quit
`);
  }

  private clearSession(): void {
    this.sessionManager.clear(CLI_SESSION_ID);
    this.sessionManager.getOrCreate(CLI_SESSION_ID, this.context.build());
    console.log("\nConversation cleared.\n");
  }

  private setPersona(text: string): void {
    if (!text) {
      console.log(`\nCurrent persona: ${this.context.getPersona()}`);
      console.log('Usage: /persona <new persona text>\n');
      return;
    }
    this.context.setPersona(text);
    this.config.persona = text;
    saveConfig(this.config);
    this.sessionManager.clear(CLI_SESSION_ID);
    this.sessionManager.getOrCreate(CLI_SESSION_ID, this.context.build());
    console.log(`\nPersona updated and saved. Conversation cleared.\n`);
  }

  private showConfig(): void {
    console.log(`
Current configuration:
  Persona:      ${this.context.getPersona().slice(0, 80)}${this.context.getPersona().length > 80 ? "..." : ""}
  Provider:     ${this.config.provider.name}
  Endpoint:     ${this.config.provider.endpoint || "(default)"}
  Model:        ${this.config.provider.model}
  Temperature:  ${this.config.agent.temperature}
  Max Tokens:   ${this.config.agent.maxTokens}
  Max Iters:    ${this.config.agent.maxIterations}
  Memory:       ${this.memory.readLongTermMemory() ? "has saved memories" : "empty"}
  Consolidate:  every ${this.memory.getConsolidateAfter()} user messages
  Config file:  data/config.json
`);
  }

  private setModel(name: string): void {
    if (!name) {
      console.log(`\nCurrent model: ${this.config.provider.model}`);
      console.log('Usage: /model <deployment-name>\n');
      return;
    }
    this.config.provider.model = name;
    saveConfig(this.config);
    console.log(`\nModel set to "${name}" and saved. Restart to apply.\n`);
  }

  private showMemory(): void {
    const mem = this.memory.readLongTermMemory();
    if (mem) {
      console.log(`\nLong-term memory:\n${mem}\n`);
    } else {
      console.log("\nNo long-term memories saved yet. Chat for a while and memories will be consolidated automatically.\n");
    }
  }

  private forgetMemory(): void {
    this.memory.writeLongTermMemory("");
    console.log("\nAll long-term memory cleared.\n");
  }

  private listSessions(): void {
    const sessions = this.sessionManager.listSessions();
    if (sessions.length === 0) {
      console.log("\nNo saved sessions.\n");
      return;
    }
    console.log(`\nSaved sessions:`);
    for (const id of sessions) {
      console.log(`  ${id}`);
    }
    console.log();
  }
}
