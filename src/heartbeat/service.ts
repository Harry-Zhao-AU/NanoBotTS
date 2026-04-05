/**
 * HeartbeatService — Smart periodic autonomous task checking.
 *
 * 2-phase approach (inspired by the original nanobot):
 *   Phase 1: Read HEARTBEAT.md → ask the LLM "run or skip?"
 *   Phase 2: If "run" → publish to bus for full agent processing
 *
 * This avoids wasting tokens on full agent runs when there's nothing
 * to do, while still enabling autonomous monitoring and reminders.
 *
 * Usage:
 *   - Write tasks to data/HEARTBEAT.md (e.g., "Check deploy status")
 *   - HeartbeatService periodically asks the LLM if action is needed
 *   - If yes, the task is sent to the agent for full processing
 *   - Empty file = no checks, no token cost
 */

import fs from "node:fs";
import path from "node:path";
import { MessageBus } from "../bus/queue.js";
import { AgentRunner } from "../core/agent.js";
import { Message } from "../types.js";

const HEARTBEAT_FILE = path.resolve("data", "HEARTBEAT.md");
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export class HeartbeatService {
  private bus: MessageBus;
  private agent: AgentRunner;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private channel: string;
  private chatId: string;

  constructor(
    bus: MessageBus,
    agent: AgentRunner,
    channel: string = "cli",
    chatId: string = "cli",
    intervalMs: number = DEFAULT_INTERVAL_MS,
  ) {
    this.bus = bus;
    this.agent = agent;
    this.channel = channel;
    this.chatId = chatId;
    this.intervalMs = intervalMs;
  }

  /** Start the heartbeat timer. */
  start(): void {
    this.timer = setInterval(() => this.check(), this.intervalMs);
    this.check();
  }

  /** Stop the heartbeat timer. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Force an immediate check, skipping the LLM decision phase. */
  triggerNow(): void {
    const content = this.readFile();
    if (!content) {
      console.log("  [Heartbeat] HEARTBEAT.md is empty — nothing to do.");
      return;
    }
    this.execute(content);
  }

  /** 2-phase check: read file → LLM decision → conditional execution. */
  private async check(): Promise<void> {
    const content = this.readFile();
    if (!content) return;

    try {
      // Phase 1: Ask LLM if action is needed
      const shouldRun = await this.decide(content);

      if (shouldRun) {
        // Phase 2: Execute
        this.execute(content);
      } else {
        console.log("  [Heartbeat] LLM decided: skip");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error(`  [Heartbeat] Decision failed: ${msg} — skipping`);
    }
  }

  /**
   * Phase 1: Lightweight LLM call to decide "run" or "skip".
   * Costs ~500 tokens per check. Returns true if the agent should act.
   */
  private async decide(content: string): Promise<boolean> {
    const now = new Date().toISOString();

    const messages: Message[] = [
      {
        role: "system",
        content:
          "You are a task scheduler. Your ONLY job is to decide whether " +
          "the given tasks need attention right now. Respond with ONLY " +
          'the word "run" or "skip". No explanation.',
      },
      {
        role: "user",
        content:
          `Current time: ${now}\n\n` +
          `Active tasks:\n${content}\n\n` +
          "Should these tasks be checked/executed now? " +
          'Reply "run" or "skip".',
      },
    ];

    const response = await this.agent.chatDirect(messages);
    const decision = response.trim().toLowerCase();

    return decision.includes("run");
  }

  /** Phase 2: Publish the task to the bus for full agent processing. */
  private execute(content: string): void {
    console.log("  [Heartbeat] Triggering autonomous check");

    this.bus.publishInbound({
      channel: this.channel,
      sessionKey: "heartbeat",
      chatId: this.chatId,
      senderName: "HeartbeatService",
      content: `[Heartbeat check] ${content}`,
    });
  }

  /** Read HEARTBEAT.md, return trimmed content or empty string. */
  private readFile(): string {
    try {
      return fs.readFileSync(HEARTBEAT_FILE, "utf-8").trim();
    } catch {
      return "";
    }
  }
}
