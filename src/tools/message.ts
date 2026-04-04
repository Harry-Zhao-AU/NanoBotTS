/**
 * Message Tool — Send a message to a chat channel.
 *
 * Allows the agent to proactively send messages to the user's channel
 * (e.g., notifications, follow-ups). The tool publishes to the outbound
 * MessageBus, which the ChannelManager routes to the correct channel.
 */

import { Tool, ToolParameters } from "./base.js";
import { MessageBus } from "../bus/queue.js";

export class MessageTool implements Tool {
  name = "message";
  readOnly = false;
  concurrencySafe = true;

  description =
    "Send a message to the user's chat channel. Use this to send " +
    "follow-up information, notifications, or multi-part responses. " +
    "You must specify the channel and chat_id.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "The message text to send",
      },
      channel: {
        type: "string",
        description: "Target channel name (e.g., 'cli', 'telegram')",
      },
      chat_id: {
        type: "string",
        description: "Target chat ID",
      },
    },
    required: ["text", "channel", "chat_id"],
  };

  private bus: MessageBus;

  constructor(bus: MessageBus) {
    this.bus = bus;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const text = args.text as string;
    const channel = args.channel as string;
    const chatId = args.chat_id as string;

    if (!text) {
      return "Error: No message text provided.";
    }

    this.bus.publishOutbound({
      channel,
      chatId,
      content: text,
      isDelta: false,
      isFinal: true,
    });

    return `Message sent to ${channel}:${chatId}`;
  }
}
