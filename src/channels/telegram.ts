/**
 * Telegram Channel — Telegram Bot interface.
 *
 * Phase 2 rewrite: now a thin I/O adapter. The Telegram channel:
 *   1. Receives messages via Telegraf
 *   2. Publishes to the MessageBus inbound queue
 *   3. Receives outbound messages and sends/edits Telegram messages
 *
 * All agent logic, session management, and memory consolidation now
 * live in AgentLoop.
 */

import { Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import type { Channel } from "./base.js";
import type { OutboundMessage } from "../bus/queue.js";
import { MessageBus } from "../bus/queue.js";
import { Memory } from "../core/memory.js";
import { SessionManager } from "../session/manager.js";
import { ContextBuilder } from "../core/context.js";

const EDIT_THROTTLE_MS = 1000;

/** Tracks the state of a streaming response per chat */
interface StreamState {
  messageId: number;
  accumulated: string;
  lastEditTime: number;
}

export class TelegramChannel implements Channel {
  readonly name = "telegram";

  private bot: Telegraf;
  private bus: MessageBus;
  private memory: Memory;
  private sessionManager: SessionManager;
  private context: ContextBuilder;
  private botName: string = "NanoBot";

  /** Active streaming states per chatId */
  private streams: Map<string, StreamState> = new Map();

  private allowedUserIds: Set<string>;

  constructor(
    token: string,
    bus: MessageBus,
    context: ContextBuilder,
    memory: Memory,
    sessionManager: SessionManager,
    allowedUserIds?: string[],
  ) {
    this.bot = new Telegraf(token);
    this.bus = bus;
    this.context = context;
    this.memory = memory;
    this.sessionManager = sessionManager;
    this.allowedUserIds = new Set(allowedUserIds ?? []);

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
    this.sessionManager.saveAll();
    this.bot.stop("NanoBot shutting down");
    console.log("Telegram bot stopped. Sessions saved.");
  }

  /** Called by ChannelManager when a final response arrives. */
  async send(msg: OutboundMessage): Promise<void> {
    const stream = this.streams.get(msg.chatId);
    if (stream) {
      // Edit the streaming message with the final content
      try {
        await this.bot.telegram.editMessageText(
          Number(msg.chatId),
          stream.messageId,
          undefined,
          msg.content,
        );
      } catch {
        // If edit fails, send as new message
        await this.bot.telegram.sendMessage(Number(msg.chatId), msg.content);
      }
      this.streams.delete(msg.chatId);
    } else {
      // No streaming happened — just send the message
      await this.bot.telegram.sendMessage(Number(msg.chatId), msg.content);
    }
  }

  /** Called by ChannelManager for each streaming chunk. */
  async sendDelta(msg: OutboundMessage): Promise<void> {
    const chatId = msg.chatId;
    let stream = this.streams.get(chatId);

    if (!stream) {
      // First delta — send a placeholder message to edit later
      try {
        const sent = await this.bot.telegram.sendMessage(Number(chatId), "...");
        stream = {
          messageId: sent.message_id,
          accumulated: "",
          lastEditTime: 0,
        };
        this.streams.set(chatId, stream);
      } catch {
        return; // Can't send — skip this delta
      }
    }

    stream.accumulated += msg.content;

    // Throttle edits to avoid Telegram rate limits
    const now = Date.now();
    if (now - stream.lastEditTime >= EDIT_THROTTLE_MS) {
      stream.lastEditTime = now;
      this.bot.telegram.editMessageText(
        Number(chatId),
        stream.messageId,
        undefined,
        stream.accumulated + " ...",
      ).catch(() => {});
    }
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
      const sessionKey = `tg_${chatId}`;
      this.sessionManager.clear(sessionKey);
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
      const sessionKey = `tg_${chatId}`;
      const userName = ctx.from.first_name || `User ${chatId}`;
      const userMessage = ctx.message.text;

      if (this.allowedUserIds.size > 0 && !this.allowedUserIds.has(String(ctx.from.id))) {
        await ctx.reply("Sorry, you are not authorized to use this bot.");
        return;
      }

      console.log(`\n[@${this.botName}] ${userName}: ${userMessage}`);

      // Ensure session exists
      this.sessionManager.getOrCreate(sessionKey, this.context.build());

      // Publish to bus — AgentLoop handles the rest
      this.bus.publishInbound({
        channel: this.name,
        sessionKey,
        chatId: String(chatId),
        senderName: userName,
        content: userMessage,
      });
    });
  }
}
