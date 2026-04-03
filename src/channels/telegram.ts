/**
 * Telegram Channel — Telegram Bot interface.
 *
 * Phase 6 upgrades:
 * - Per-user session persistence (survives bot restarts)
 * - Memory consolidation for Telegram users too
 * - Sessions stored as data/sessions/tg_<chatId>.jsonl
 */

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import type { Channel } from "./base.js";
import { AgentRunner } from "../core/agent.js";
import { ContextBuilder } from "../core/context.js";
import { Session } from "../core/session.js";
import { Memory } from "../core/memory.js";

const EDIT_THROTTLE_MS = 1000;

export class TelegramChannel implements Channel {
  private bot: Telegraf;
  private agent: AgentRunner;
  private context: ContextBuilder;
  private memory: Memory;
  private sessions: Map<number, Session> = new Map();
  private botName: string = "NanoBot";

  constructor(token: string, agent: AgentRunner, context: ContextBuilder, memory: Memory) {
    this.bot = new Telegraf(token);
    this.agent = agent;
    this.context = context;
    this.memory = memory;

    this.setupHandlers();
  }

  async start(): Promise<void> {
    console.log("Telegram bot starting...");

    process.once("SIGINT", () => this.stop());
    process.once("SIGTERM", () => this.stop());

    await this.bot.launch();

    const botInfo = await this.bot.telegram.getMe();
    this.botName = botInfo.username || "NanoBot";
    console.log(`Telegram bot @${this.botName} is running. Send it a message!`);
  }

  async stop(): Promise<void> {
    // Save all active sessions and consolidate memory before shutting down
    for (const [chatId, session] of this.sessions) {
      this.memory.saveSession(`tg_${chatId}`, session.getMessages());
      await this.consolidateMemory(session);
    }
    this.bot.stop("NanoBot shutting down");
    console.log("Telegram bot stopped. Sessions and memory saved.");
  }

  private setupHandlers(): void {
    this.bot.command("start", (ctx) => {
      ctx.reply(
        "Hello! I'm NanoBot, your personal AI assistant.\n\n" +
        "Just send me a message and I'll respond.\n\n" +
        "Commands:\n" +
        "/clear — Reset conversation\n" +
        "/memory — Show what I remember about you\n" +
        "/help — Show help",
      );
    });

    this.bot.command("clear", (ctx) => {
      const chatId = ctx.chat.id;
      this.sessions.delete(chatId);
      this.memory.deleteSession(`tg_${chatId}`);
      ctx.reply("Conversation cleared. Let's start fresh!");
    });

    this.bot.command("memory", (ctx) => {
      const mem = this.memory.readLongTermMemory();
      if (mem) {
        ctx.reply(`What I remember:\n\n${mem}`);
      } else {
        ctx.reply("I don't have any saved memories yet. Chat with me and I'll start remembering!");
      }
    });

    this.bot.command("help", (ctx) => {
      ctx.reply(
        "NanoBot — AI Assistant\n\n" +
        "Just type a message and I'll respond using GPT-4o.\n" +
        "I can search the web, tell the time, and more.\n\n" +
        "Commands:\n" +
        "/clear — Reset conversation\n" +
        "/memory — Show what I remember\n" +
        "/help — Show this message",
      );
    });

    this.bot.on(message("text"), async (ctx) => {
      const chatId = ctx.chat.id;
      const userName = ctx.from.first_name || `User ${chatId}`;
      const userMessage = ctx.message.text;

      console.log(`\n[@${this.botName}] ${userName}: ${userMessage}`);

      const session = this.getSession(chatId);
      session.addMessage("user", userMessage);

      try {
        const sentMsg = await ctx.reply("...");

        let fullResponse = "";
        let lastEditTime = 0;
        let streamStarted = false;

        process.stdout.write(`[@${this.botName}] Bot: `);
        const response = await this.agent.run(
          session.getMessages(),
          (chunk) => {
            fullResponse += chunk;
            streamStarted = true;
            process.stdout.write(chunk);

            const now = Date.now();
            if (now - lastEditTime >= EDIT_THROTTLE_MS) {
              lastEditTime = now;
              ctx.telegram.editMessageText(
                chatId,
                sentMsg.message_id,
                undefined,
                fullResponse + " ...",
              ).catch(() => {});
            }
          },
        );

        const finalText = response || fullResponse || "I couldn't generate a response.";
        await ctx.telegram.editMessageText(
          chatId,
          sentMsg.message_id,
          undefined,
          finalText,
        ).catch(() => {
          ctx.reply(finalText);
        });

        if (!streamStarted) {
          console.log(finalText);
        } else {
          process.stdout.write("\n");
        }

        session.addMessage("assistant", finalText);

        // Auto-save session
        this.memory.saveSession(`tg_${chatId}`, session.getMessages());

        // Check if we should consolidate memory
        if (this.memory.shouldConsolidate(session.getMessages())) {
          await this.consolidateMemory(session);
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        console.error(`[@${this.botName}] Error (chat ${chatId}): ${errMsg}`);
        ctx.reply(`Sorry, an error occurred: ${errMsg}`);
      }
    });
  }

  private async consolidateMemory(session: Session): Promise<void> {
    const userMsgCount = session.getMessages().filter((m) => m.role === "user").length;
    if (userMsgCount < 2) return;

    try {
      console.log("  [Consolidating memory...]");
      const currentMemory = this.memory.readLongTermMemory();
      const consolidationMessages = this.memory.buildConsolidationPrompt(
        currentMemory,
        session.getMessages(),
      );
      const updatedMemory = await this.agent.chatDirect(consolidationMessages);
      if (updatedMemory && updatedMemory.trim()) {
        this.memory.writeLongTermMemory(updatedMemory.trim());
        console.log("  [Memory updated]");
      }
    } catch {
      console.error("  [Memory consolidation failed]");
    }
  }

  private getSession(chatId: number): Session {
    let session = this.sessions.get(chatId);
    if (!session) {
      session = new Session();

      // Try to load a saved session for this user
      const saved = this.memory.loadSession(`tg_${chatId}`);
      if (saved.length > 0) {
        for (const msg of saved) {
          session.addMessage(msg.role, msg.content);
        }
        console.log(`  [Resumed session for chat ${chatId}: ${saved.length} messages]`);
      } else {
        session.addMessage("system", this.context.build());
      }

      this.sessions.set(chatId, session);
    }
    return session;
  }
}
