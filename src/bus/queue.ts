/**
 * MessageBus — Decoupled async communication between channels and agent.
 *
 * Instead of channels calling the agent directly, messages flow through
 * two async queues:
 *   - Inbound: channel → agent (user messages)
 *   - Outbound: agent → channel (bot responses, streaming deltas)
 *
 * This decoupling means:
 *   1. Adding a new channel doesn't require touching agent code
 *   2. Multiple channels can run concurrently
 *   3. The agent processes one message at a time per session
 *   4. Streaming deltas flow back through the same bus
 *
 * We use a simple async queue pattern with Promises — no external deps.
 */

/** A message arriving from a channel (user → agent) */
export interface InboundMessage {
  /** Which channel sent this (e.g., "cli", "telegram") */
  channel: string;
  /** Unique session key (e.g., "cli", "tg_12345") */
  sessionKey: string;
  /** Chat/conversation ID within the channel */
  chatId: string;
  /** The user's display name */
  senderName: string;
  /** The message text content */
  content: string;
}

/** A message going back to a channel (agent → user) */
export interface OutboundMessage {
  /** Which channel to send to */
  channel: string;
  /** Chat/conversation ID to reply to */
  chatId: string;
  /** The response content */
  content: string;
  /** If true, this is a streaming delta (partial), not the final message */
  isDelta: boolean;
  /** If true, this is the final message — the stream is complete */
  isFinal: boolean;
}

/**
 * Simple async queue — waiters block on dequeue() until an item is enqueued.
 */
class AsyncQueue<T> {
  private items: T[] = [];
  private waiters: Array<(item: T) => void> = [];

  /** Add an item to the queue. If someone is waiting, resolve immediately. */
  enqueue(item: T): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(item);
    } else {
      this.items.push(item);
    }
  }

  /** Wait for and remove the next item from the queue. */
  dequeue(): Promise<T> {
    const item = this.items.shift();
    if (item !== undefined) {
      return Promise.resolve(item);
    }
    return new Promise<T>((resolve) => {
      this.waiters.push(resolve);
    });
  }

  /** Number of items currently buffered. */
  get size(): number {
    return this.items.length;
  }
}

/**
 * MessageBus — The central nervous system connecting channels and agent.
 */
export class MessageBus {
  readonly inbound = new AsyncQueue<InboundMessage>();
  readonly outbound = new AsyncQueue<OutboundMessage>();

  /** Publish a user message from a channel to the agent. */
  publishInbound(msg: InboundMessage): void {
    this.inbound.enqueue(msg);
  }

  /** Publish a response from the agent back to a channel. */
  publishOutbound(msg: OutboundMessage): void {
    this.outbound.enqueue(msg);
  }

  /** Wait for the next inbound message (blocks until available). */
  async consumeInbound(): Promise<InboundMessage> {
    return this.inbound.dequeue();
  }

  /** Wait for the next outbound message (blocks until available). */
  async consumeOutbound(): Promise<OutboundMessage> {
    return this.outbound.dequeue();
  }
}
