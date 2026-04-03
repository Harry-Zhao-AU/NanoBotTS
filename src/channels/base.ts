/**
 * Channel — Abstract interface for communication platforms.
 *
 * This is the adapter pattern: the agent core doesn't know whether it's
 * talking to a terminal, Telegram, Discord, or anything else. Each
 * channel implements this interface to bridge between its platform
 * and the agent.
 *
 * Key concepts:
 * - Interface: a TypeScript contract that says "any class implementing
 *   Channel must have these methods." The class decides HOW to implement them.
 * - Adapter pattern: each channel adapts a specific platform's API
 *   (readline, Telegraf, etc.) into a uniform interface the agent can use.
 * - This is exactly how nanobot's BaseChannel works — it defines start()
 *   and stop(), and each platform (Telegram, Discord, Slack) implements them.
 */

export interface Channel {
  /** Start listening for messages and processing them */
  start(): Promise<void>;

  /** Gracefully shut down the channel */
  stop(): Promise<void>;
}
