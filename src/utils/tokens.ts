/**
 * Token estimation utilities.
 *
 * LLMs have a context window — a maximum number of tokens they can process.
 * We need to estimate token counts to know when to trim history or truncate
 * tool results. This uses a simple heuristic (~4 chars per token for English)
 * which is good enough for budget decisions without adding a tokenizer dependency.
 */

/** Approximate tokens in a string (~4 chars per token for English text) */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for a message (role overhead + content) */
export function estimateMessageTokens(message: { role: string; content: string | null }): number {
  // Each message has ~4 tokens of overhead (role, formatting)
  const overhead = 4;
  return overhead + estimateTokens(message.content ?? "");
}

/** Estimate total tokens for an array of messages */
export function estimateTotalTokens(messages: { role: string; content: string | null }[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
}

/**
 * Truncate text to fit within a token budget.
 * Appends a notice if truncation occurred.
 */
export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;

  const maxChars = maxTokens * 4;
  return text.slice(0, maxChars) + "\n\n[... truncated — output exceeded token budget]";
}
