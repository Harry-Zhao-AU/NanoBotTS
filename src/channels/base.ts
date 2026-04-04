/**
 * Channel — Abstract interface for communication platforms.
 *
 * Phase 2 upgrade: channels are now thin I/O adapters. They no longer
 * call the AgentRunner directly. Instead they:
 *   1. Receive messages from their platform (readline, Telegram, etc.)
 *   2. Publish InboundMessages to the MessageBus
 *   3. Subscribe to OutboundMessages and deliver them to the user
 *
 * The `send()` and `sendDelta()` methods are called by the ChannelManager
 * when outbound messages arrive for this channel.
 */

import { OutboundMessage } from "../bus/queue.js";

export interface Channel {
  /** Unique name for this channel (e.g., "cli", "telegram") */
  readonly name: string;

  /** Start listening for messages and processing them */
  start(): Promise<void>;

  /** Gracefully shut down the channel */
  stop(): Promise<void>;

  /** Send a complete response to a chat */
  send(msg: OutboundMessage): Promise<void>;

  /** Send a streaming delta (partial response) to a chat. Optional — defaults to buffering. */
  sendDelta?(msg: OutboundMessage): Promise<void>;
}
