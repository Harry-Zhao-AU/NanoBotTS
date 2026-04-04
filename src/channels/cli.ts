/**
 * CLI Channel — Interactive terminal interface.
 *
 * Phase 6 upgrades:
 * - Session persistence: conversation saved to disk, resumed on restart
 * - Memory consolidation: after N turns, extracts key facts to memory.md
 * - New commands: /memory, /sessions, /load, /save
 */

import readline from "node:readline";
import { AgentRunner } from "../core/agent.js";
import { ContextBuilder } from "../core/context.js";
import { Session } from "../core/session.js";
import { Memory } from "../core/memory.js";
import { SessionManager } from "../session/manager.js";
import { AppConfig } from "../types.js";
import { saveConfig } from "../config.js";
import type { Channel } from "./base.js";

const CLI_SESSION_ID = "cli";

export class CLIChannel implements Channel {
  private agent: AgentRunner;
  private session: Session;
  private context: ContextBuilder;
  private memory: Memory;
  private sessionManager: SessionManager;
  private config: AppConfig;
  private rl: readline.Interface;
  private turnCount: number = 0;

  constructor(
    agent: AgentRunner,
    context: ContextBuilder,
    memory: Memory,
    sessionManager: SessionManager,
    config: AppConfig,
  ) {
    this.agent = agent;
    this.context = context;
    this.memory = memory;
    this.sessionManager = sessionManager;
    this.config = config;

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // SessionManager handles load-from-disk automatically
    this.session = this.sessionManager.getOrCreate(CLI_SESSION_ID, this.context.build());

    const savedMsgs = this.session.getMessages();
    if (savedMsgs.length > 1) {
      console.log(`Resumed previous session (${savedMsgs.length} messages).`);
      console.log('Use /clear to start fresh or /sessions to manage sessions.\n');
    }
  }

  async start(): Promise<void> {
    console.log("NanoBot v0.7 — Foundation Hardened");
    console.log('Type a message, or /help for commands. "exit" to quit.\n');

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

  private promptLoop(): void {
    this.rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (trimmed.toLowerCase() === "exit") {
        this.sessionManager.save(CLI_SESSION_ID);
        await this.consolidateMemory();
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

      try {
        this.refreshSystemPrompt();
        this.session.addMessage("user", trimmed);

        process.stdout.write("\nBot: ");

        const response = await this.agent.run(
          this.session.getMessages(),
          (chunk) => process.stdout.write(chunk),
        );

        process.stdout.write("\n\n");
        this.session.addMessage("assistant", response);
        this.turnCount++;

        // Auto-save session after each turn
        this.sessionManager.save(CLI_SESSION_ID);

        // Check if we should consolidate memory
        if (this.sessionManager.shouldConsolidate(CLI_SESSION_ID)) {
          await this.consolidateMemory();
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(`\nError: ${error.message}\n`);
        } else {
          console.error("\nAn unexpected error occurred.\n");
        }
      }

      this.promptLoop();
    });
  }

  /**
   * Memory consolidation: ask the LLM to extract key facts from the
   * conversation and save them to memory.md.
   */
  private async consolidateMemory(): Promise<void> {
    const unconsolidated = this.sessionManager.getUnconsolidatedMessages(CLI_SESSION_ID);
    if (unconsolidated.length < 2) return;

    try {
      process.stdout.write("  [Consolidating memory...]\n");

      const currentMemory = this.memory.readLongTermMemory();
      const consolidationMessages = this.memory.buildConsolidationPrompt(
        currentMemory,
        unconsolidated,
      );

      const updatedMemory = await this.agent.chatDirect(consolidationMessages);

      if (updatedMemory && updatedMemory.trim()) {
        this.memory.writeLongTermMemory(updatedMemory.trim());
        this.memory.appendHistory(unconsolidated);
        this.sessionManager.markConsolidated(CLI_SESSION_ID);
        console.log("  [Memory updated]\n");
      }
    } catch (error) {
      // Fallback: still log to history even if LLM consolidation fails
      this.memory.appendHistory(unconsolidated);
      this.sessionManager.markConsolidated(CLI_SESSION_ID);
      console.error("  [Memory consolidation failed — history saved]\n");
    }
  }

  private refreshSystemPrompt(): void {
    const messages = this.session.getMessages();
    this.session.clear();
    this.session.addMessage("system", this.context.build());
    for (const msg of messages) {
      if (msg.role !== "system") {
        this.session.addMessage(msg.role, msg.content);
      }
    }
  }

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
      case "remember":
        await this.consolidateMemory();
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
  /remember          — Save memories now (without waiting for auto)
  /forget            — Clear all long-term memory
  /sessions          — List saved sessions
  /save              — Save current session to disk
  exit               — Save memories + session, then quit
`);
  }

  private clearSession(): void {
    this.sessionManager.clear(CLI_SESSION_ID);
    this.session = this.sessionManager.getOrCreate(CLI_SESSION_ID, this.context.build());
    this.turnCount = 0;
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
    this.session.clear();
    this.session.addMessage("system", this.context.build());
    console.log(`\nPersona updated and saved. Conversation cleared.\n`);
  }

  private showConfig(): void {
    console.log(`
Current configuration:
  Persona:      ${this.context.getPersona().slice(0, 80)}${this.context.getPersona().length > 80 ? "..." : ""}
  Endpoint:     ${this.config.provider.endpoint}
  Deployment:   ${this.config.provider.deploymentName}
  API Version:  ${this.config.provider.apiVersion}
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
      console.log(`\nCurrent model: ${this.config.provider.deploymentName}`);
      console.log('Usage: /model <deployment-name>\n');
      return;
    }
    this.config.provider.deploymentName = name;
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
