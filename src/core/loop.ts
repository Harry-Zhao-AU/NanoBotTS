/**
 * AgentLoop — Central orchestrator.
 *
 * Sits between the MessageBus and the AgentRunner. Responsibilities:
 *   1. Consume inbound messages from the bus
 *   2. Manage per-session context (load session, build system prompt)
 *   3. Call AgentRunner to get a response
 *   4. Publish the response (with streaming deltas) to the outbound bus
 *   5. Save session and trigger memory consolidation
 *
 * Concurrency control:
 *   - Per-session lock: only one message processed per session at a time
 *   - Global semaphore: limits total concurrent agent runs
 */

import { MessageBus, InboundMessage, OutboundMessage } from "../bus/queue.js";
import { AgentRunner } from "./agent.js";
import { ContextBuilder } from "./context.js";
import { Memory } from "./memory.js";
import { SessionManager } from "../session/manager.js";

export class AgentLoop {
  private bus: MessageBus;
  private agent: AgentRunner;
  private context: ContextBuilder;
  private memory: Memory;
  private sessionManager: SessionManager;
  private running: boolean = false;

  /** Per-session locks — prevents concurrent processing for the same session */
  private sessionLocks: Map<string, Promise<void>> = new Map();
  /** Global concurrency limit */
  private maxConcurrent: number;
  private activeTasks: number = 0;

  constructor(
    bus: MessageBus,
    agent: AgentRunner,
    context: ContextBuilder,
    memory: Memory,
    sessionManager: SessionManager,
    maxConcurrent: number = 3,
  ) {
    this.bus = bus;
    this.agent = agent;
    this.context = context;
    this.memory = memory;
    this.sessionManager = sessionManager;
    this.maxConcurrent = maxConcurrent;
  }

  /** Start the loop — consumes from inbound bus indefinitely. */
  async start(): Promise<void> {
    this.running = true;
    console.log("AgentLoop started.");

    while (this.running) {
      const msg = await this.bus.consumeInbound();

      // Wait if at global concurrency limit
      while (this.activeTasks >= this.maxConcurrent) {
        await new Promise((r) => setTimeout(r, 50));
      }

      // Dispatch with per-session serialization
      this.dispatch(msg);
    }
  }

  /** Stop the loop gracefully. */
  stop(): void {
    this.running = false;
    this.sessionManager.saveAll();
    console.log("AgentLoop stopped.");
  }

  /**
   * Dispatch a message with per-session locking.
   * Messages for the same session are serialized; different sessions run concurrently.
   */
  private dispatch(msg: InboundMessage): void {
    const { sessionKey } = msg;

    // Chain onto the existing lock for this session (or start fresh)
    const previous = this.sessionLocks.get(sessionKey) ?? Promise.resolve();
    const current = previous.then(() => this.processMessage(msg));

    this.sessionLocks.set(sessionKey, current);

    // Clean up the lock entry when done
    current.then(() => {
      if (this.sessionLocks.get(sessionKey) === current) {
        this.sessionLocks.delete(sessionKey);
      }
    });
  }

  /** Process a single inbound message end-to-end. */
  private async processMessage(msg: InboundMessage): Promise<void> {
    this.activeTasks++;

    try {
      const { channel, sessionKey, chatId, content } = msg;

      // 1. Get or create session
      const session = this.sessionManager.getOrCreate(sessionKey, this.context.build());

      // 2. Refresh system prompt with latest memory/time
      this.refreshSystemPrompt(sessionKey);

      // 3. Add user message
      session.addMessage("user", content);

      // 4. Run the agent with streaming
      const response = await this.agent.run(
        session.getMessages(),
        (chunk) => {
          // Publish each streaming delta to the outbound bus
          this.bus.publishOutbound({
            channel,
            chatId,
            content: chunk,
            isDelta: true,
            isFinal: false,
          });
        },
      );

      // 5. Publish the final complete response
      const finalText = response || "I couldn't generate a response.";
      this.bus.publishOutbound({
        channel,
        chatId,
        content: finalText,
        isDelta: false,
        isFinal: true,
      });

      // 6. Save assistant response to session
      session.addMessage("assistant", finalText);

      // 7. Save session to disk
      this.sessionManager.save(sessionKey);

      // 8. Memory consolidation
      if (this.sessionManager.shouldConsolidate(sessionKey)) {
        await this.consolidateMemory(sessionKey);
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : "Unknown error";
      console.error(`AgentLoop error [${msg.sessionKey}]: ${errMsg}`);

      // Send error back to channel
      this.bus.publishOutbound({
        channel: msg.channel,
        chatId: msg.chatId,
        content: `Sorry, an error occurred: ${errMsg}`,
        isDelta: false,
        isFinal: true,
      });
    } finally {
      this.activeTasks--;
    }
  }

  /** Refresh the system prompt for a session with latest memory and time. */
  private refreshSystemPrompt(sessionKey: string): void {
    const session = this.sessionManager.get(sessionKey);
    if (!session) return;

    const messages = session.getMessages();
    session.clear();
    session.addMessage("system", this.context.build());
    for (const msg of messages) {
      if (msg.role !== "system") {
        session.addMessage(msg.role, msg.content);
      }
    }
  }

  /** Run memory consolidation for a session. */
  private async consolidateMemory(sessionKey: string): Promise<void> {
    const unconsolidated = this.sessionManager.getUnconsolidatedMessages(sessionKey);
    if (unconsolidated.length < 2) return;

    try {
      console.log(`  [Consolidating memory for ${sessionKey}...]`);
      const currentMemory = this.memory.readLongTermMemory();
      const consolidationMessages = this.memory.buildConsolidationPrompt(
        currentMemory,
        unconsolidated,
      );

      const updatedMemory = await this.agent.chatDirect(consolidationMessages);

      if (updatedMemory && updatedMemory.trim()) {
        this.memory.writeLongTermMemory(updatedMemory.trim());
        this.memory.appendHistory(unconsolidated);
        this.sessionManager.markConsolidated(sessionKey);
        console.log(`  [Memory updated for ${sessionKey}]`);
      }
    } catch {
      this.memory.appendHistory(unconsolidated);
      this.sessionManager.markConsolidated(sessionKey);
      console.error(`  [Memory consolidation failed for ${sessionKey} — history saved]`);
    }
  }
}
