/**
 * ChannelManager — Orchestrates channels and routes outbound messages.
 *
 * Responsibilities:
 *   1. Register and manage channel lifecycles (start/stop)
 *   2. Consume outbound messages from the MessageBus
 *   3. Route each outbound message to the correct channel
 *   4. Handle streaming deltas vs final messages
 */

import { MessageBus, OutboundMessage } from "../bus/queue.js";
import type { Channel } from "./base.js";
import { CLIChannel } from "./cli.js";

export class ChannelManager {
  private bus: MessageBus;
  private channels: Map<string, Channel> = new Map();
  private running: boolean = false;

  constructor(bus: MessageBus) {
    this.bus = bus;
  }

  /** Register a channel for management. */
  register(channel: Channel): void {
    this.channels.set(channel.name, channel);
  }

  /** Start all registered channels and begin outbound dispatch. */
  async startAll(): Promise<void> {
    this.running = true;

    // Start channels concurrently
    const startPromises = Array.from(this.channels.values()).map((ch) =>
      ch.start().catch((err) => {
        console.error(`${ch.name} channel failed to start: ${err.message}`);
        console.error("Other channels will continue running.\n");
      }),
    );

    await Promise.all(startPromises);

    // Start the outbound dispatch loop (non-blocking)
    this.dispatchOutbound();
  }

  /** Stop all channels. */
  async stopAll(): Promise<void> {
    this.running = false;
    for (const ch of this.channels.values()) {
      try {
        await ch.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error stopping ${ch.name}: ${msg}`);
      }
    }
  }

  /** Get a channel by name. */
  get(name: string): Channel | undefined {
    return this.channels.get(name);
  }

  /**
   * Outbound dispatch loop — consumes from the outbound bus and routes
   * each message to the correct channel.
   */
  private async dispatchOutbound(): Promise<void> {
    while (this.running) {
      const msg = await this.bus.consumeOutbound();
      const channel = this.channels.get(msg.channel);

      if (!channel) {
        console.error(`No channel registered for "${msg.channel}"`);
        continue;
      }

      try {
        if (msg.isDelta && !msg.isFinal) {
          // Streaming delta — let each channel handle its own output
          if (channel.sendDelta) {
            await channel.sendDelta(msg);
          }
        } else if (msg.isFinal) {
          // Final message
          await channel.send(msg);

          // If CLI channel, notify that the response is complete
          if (channel instanceof CLIChannel) {
            (channel as CLIChannel).notifyResponseComplete();
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown error";
        console.error(`Error dispatching to ${msg.channel}: ${errMsg}`);
      }
    }
  }
}
