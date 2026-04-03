/**
 * Session — Conversation history manager.
 *
 * Keeps track of all messages in the current conversation so the LLM
 * can "remember" what was said earlier. Without this, every message
 * would be treated as a brand new conversation.
 *
 * Key concepts:
 * - The LLM is stateless — it doesn't remember previous calls.
 *   We must send the FULL conversation history with every request.
 * - We cap history at `maxMessages` to avoid exceeding token limits.
 *   The system prompt is always included and doesn't count toward the cap.
 * - Messages are stored as an array: [system, user, assistant, user, assistant, ...]
 */

import { Message } from "../types.js";

export class Session {
  private messages: Message[] = [];
  private maxMessages: number;

  /**
   * @param maxMessages - Max number of user+assistant messages to keep.
   *   Older messages are dropped when this limit is exceeded.
   *   The system message is always kept and doesn't count toward this limit.
   */
  constructor(maxMessages: number = 20) {
    this.maxMessages = maxMessages;
  }

  /** Add a message to the conversation history. */
  addMessage(role: Message["role"], content: string): void {
    this.messages.push({ role, content });
    this.trimHistory();
  }

  /**
   * Get all messages, ready to send to the LLM.
   * Returns a copy so external code can't accidentally mutate our state.
   */
  getMessages(): Message[] {
    return [...this.messages];
  }

  /** Clear all messages (keeps nothing — system prompt re-added by caller). */
  clear(): void {
    this.messages = [];
  }

  /** Number of messages currently stored. */
  get length(): number {
    return this.messages.length;
  }

  /**
   * Trim history to stay within maxMessages.
   *
   * Strategy: keep the system message (first message, if it's "system" role),
   * then keep the most recent `maxMessages` non-system messages.
   * This ensures the LLM always has its instructions + recent context.
   */
  private trimHistory(): void {
    // Separate system messages from conversation messages
    const systemMessages = this.messages.filter((m) => m.role === "system");
    const conversationMessages = this.messages.filter((m) => m.role !== "system");

    // If conversation is within limits, nothing to do
    if (conversationMessages.length <= this.maxMessages) {
      return;
    }

    // Keep only the most recent messages
    const trimmed = conversationMessages.slice(-this.maxMessages);
    this.messages = [...systemMessages, ...trimmed];
  }
}
