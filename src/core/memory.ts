/**
 * Memory — Two-tier persistent memory system.
 *
 * Inspired by nanobot's MemoryStore, this gives the bot long-term memory
 * that survives across restarts. Without this, every time you restart
 * the bot, it forgets everything.
 *
 * Two tiers:
 * 1. **Long-term memory** (`data/memory.md`): consolidated facts about
 *    the user — name, preferences, key info. Injected into the system
 *    prompt so the LLM always has this context.
 * 2. **Session files** (`data/sessions/<id>.jsonl`): full conversation
 *    history saved to disk. Can be resumed across restarts.
 *
 * Key concepts:
 * - JSONL (JSON Lines): each line is a separate JSON object. This format
 *   is easy to append to (just add a line) and read (parse line by line).
 *   Used by nanobot, ChatGPT exports, and many logging systems.
 * - Memory consolidation: after N turns, we ask the LLM to extract key
 *   facts from the conversation and save them to memory.md. This keeps
 *   the memory concise — we don't store entire conversations, just the
 *   important bits.
 * - fs.appendFileSync: adds data to the end of a file without reading
 *   the whole file. Efficient for JSONL append operations.
 */

import fs from "node:fs";
import path from "node:path";
import { Message } from "../types.js";

const DATA_DIR = path.resolve("data");
const MEMORY_FILE = path.join(DATA_DIR, "memory.md");
const HISTORY_FILE = path.join(DATA_DIR, "history.md");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

export class Memory {
  /** How many user messages before triggering consolidation */
  private consolidateAfter: number;

  constructor(consolidateAfter: number = 5) {
    this.consolidateAfter = consolidateAfter;

    // Ensure directories exist
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  // ── Long-term Memory (memory.md) ──────────────────────────────

  /**
   * Read long-term memory. Returns empty string if no memory exists yet.
   * This gets injected into the system prompt.
   */
  readLongTermMemory(): string {
    if (!fs.existsSync(MEMORY_FILE)) {
      return "";
    }
    return fs.readFileSync(MEMORY_FILE, "utf-8").trim();
  }

  /**
   * Write long-term memory (replaces entire file).
   * Called after consolidation with the LLM's summary.
   */
  writeLongTermMemory(content: string): void {
    fs.writeFileSync(MEMORY_FILE, content, "utf-8");
  }

  // ── History Log (history.md) ─────────────────────────────────

  /**
   * Append a timestamped entry to the searchable history log.
   * Unlike memory.md (which is LLM-consolidated and concise),
   * history.md is a chronological append-only log you can grep through.
   */
  appendHistory(messages: Message[]): void {
    const timestamp = new Date().toISOString();
    const entries = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `[${m.role}] ${m.content}`)
      .join("\n");

    if (!entries) return;

    const block = `\n---\n### ${timestamp}\n${entries}\n`;
    fs.appendFileSync(HISTORY_FILE, block, "utf-8");
  }

  /** Read the full history log. Returns empty string if no history exists. */
  readHistory(): string {
    if (!fs.existsSync(HISTORY_FILE)) return "";
    return fs.readFileSync(HISTORY_FILE, "utf-8").trim();
  }

  /** Clear the history log. */
  clearHistory(): void {
    if (fs.existsSync(HISTORY_FILE)) {
      fs.writeFileSync(HISTORY_FILE, "", "utf-8");
    }
  }

  /**
   * Check if consolidation should happen based on message count.
   * We count only user messages (not system/assistant/tool).
   */
  shouldConsolidate(messages: Message[]): boolean {
    const userMessageCount = messages.filter((m) => m.role === "user").length;
    return userMessageCount > 0 && userMessageCount % this.consolidateAfter === 0;
  }

  /**
   * Build the consolidation prompt.
   *
   * We ask the LLM to read the conversation and extract key facts
   * about the user. The LLM returns updated memory content that
   * replaces the existing memory.md.
   */
  buildConsolidationPrompt(currentMemory: string, recentMessages: Message[]): Message[] {
    // Format recent conversation for the LLM to analyze
    const conversationText = recentMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const prompt = `You are a memory manager. Your job is to extract and maintain key facts about the user from conversations.

Current saved memory:
${currentMemory || "(empty — no memories saved yet)"}

Recent conversation:
${conversationText}

Instructions:
- Extract key facts about the user: name, preferences, interests, important details they shared.
- Merge new facts with existing memory. Update outdated info, remove contradictions.
- Keep it concise — bullet points, not paragraphs.
- Only include facts the user explicitly stated or strongly implied.
- If no new memorable facts were shared, return the existing memory unchanged.

Return ONLY the updated memory content (markdown bullet points). No explanation or preamble.`;

    return [
      { role: "system" as const, content: "You extract and maintain user memory from conversations." },
      { role: "user" as const, content: prompt },
    ];
  }

  // ── Session Persistence (JSONL files) ─────────────────────────

  /**
   * Save a session to a JSONL file.
   * Each line is one message as JSON: {"role":"user","content":"..."}
   *
   * @param sessionId - Unique ID for this session (e.g., "cli", chat ID)
   * @param messages - The full conversation history
   */
  saveSession(sessionId: string, messages: Message[]): void {
    const filePath = this.sessionPath(sessionId);
    const lines = messages.map((m) => JSON.stringify(m));
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  }

  /**
   * Load a session from a JSONL file. Returns empty array if not found.
   */
  loadSession(sessionId: string): Message[] {
    const filePath = this.sessionPath(sessionId);
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    return content.split("\n").map((line) => {
      try {
        return JSON.parse(line) as Message;
      } catch {
        return null;
      }
    }).filter((m): m is Message => m !== null);
  }

  /**
   * List all saved session IDs.
   */
  listSessions(): string[] {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs.readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""));
  }

  /**
   * Delete a session file.
   */
  deleteSession(sessionId: string): void {
    const filePath = this.sessionPath(sessionId);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /** Get the consolidation threshold */
  getConsolidateAfter(): number {
    return this.consolidateAfter;
  }

  private sessionPath(sessionId: string): string {
    // Sanitize the ID to prevent path traversal
    const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(SESSIONS_DIR, `${safe}.jsonl`);
  }
}
