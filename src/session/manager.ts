/**
 * SessionManager — Centralized session persistence and lifecycle.
 *
 * Extracted from channels so that CLI, Telegram, and future channels
 * all share the same session management logic. Each session is identified
 * by a string key (e.g., "cli", "tg_12345") and persisted as JSONL.
 *
 * Key additions over the old approach:
 * - `lastConsolidated` offset: tracks which messages have already been
 *   archived to long-term memory, so we only consolidate new messages.
 * - Centralized save/load — channels don't touch the filesystem directly.
 */

import fs from "node:fs";
import path from "node:path";
import { Session } from "../core/session.js";
import { Message } from "../types.js";

const DATA_DIR = path.resolve("data");
const SESSIONS_DIR = path.join(DATA_DIR, "sessions");

/** Metadata stored alongside each session */
interface SessionMeta {
  session: Session;
  /** Count of user+assistant messages that have been consolidated */
  lastConsolidated: number;
}

export class SessionManager {
  private sessions: Map<string, SessionMeta> = new Map();

  constructor() {
    if (!fs.existsSync(SESSIONS_DIR)) {
      fs.mkdirSync(SESSIONS_DIR, { recursive: true });
    }
  }

  /**
   * Get or create a session by key.
   * On first access, loads from disk if a saved JSONL file exists.
   */
  getOrCreate(sessionKey: string, systemPrompt?: string): Session {
    const existing = this.sessions.get(sessionKey);
    if (existing) return existing.session;

    const session = new Session();
    let lastConsolidated = 0;

    // Try to load from disk
    const saved = this.loadFromDisk(sessionKey);
    if (saved.length > 0) {
      for (const msg of saved) {
        session.addMessage(msg.role, msg.content ?? "");
      }
      // Don't mark all messages as consolidated — we don't know which
      // were already archived. Start from 0 so the next threshold triggers.
      lastConsolidated = 0;
    } else if (systemPrompt) {
      session.addMessage("system", systemPrompt);
    }

    this.sessions.set(sessionKey, { session, lastConsolidated });
    return session;
  }

  /** Get a session without creating one. Returns undefined if not found. */
  get(sessionKey: string): Session | undefined {
    return this.sessions.get(sessionKey)?.session;
  }

  /** Save a session to disk as JSONL. */
  save(sessionKey: string): void {
    const meta = this.sessions.get(sessionKey);
    if (!meta) return;

    const messages = meta.session.getMessages();
    if (messages.length <= 1) return; // only system prompt

    const filePath = this.sessionPath(sessionKey);
    const lines = messages.map((m) => JSON.stringify(m));
    fs.writeFileSync(filePath, lines.join("\n") + "\n", "utf-8");
  }

  /** Save all active sessions to disk. */
  saveAll(): void {
    for (const key of this.sessions.keys()) {
      this.save(key);
    }
  }

  /** Get only user+assistant messages from a session (excludes system/tool). */
  private getConversationMessages(sessionKey: string): Message[] {
    const meta = this.sessions.get(sessionKey);
    if (!meta) return [];
    return meta.session.getMessages().filter(
      (m) => m.role === "user" || m.role === "assistant",
    );
  }

  /**
   * Get messages that haven't been consolidated yet.
   * Returns only user/assistant messages added since the last consolidation.
   */
  getUnconsolidatedMessages(sessionKey: string): Message[] {
    const meta = this.sessions.get(sessionKey);
    if (!meta) return [];
    return this.getConversationMessages(sessionKey).slice(meta.lastConsolidated);
  }

  /** Mark current messages as consolidated (update the offset). */
  markConsolidated(sessionKey: string): void {
    const meta = this.sessions.get(sessionKey);
    if (!meta) return;
    meta.lastConsolidated = this.getConversationMessages(sessionKey).length;
  }

  /**
   * Check if there are enough new messages to warrant consolidation.
   * Counts user messages only for the threshold (every N user turns).
   */
  shouldConsolidate(sessionKey: string, threshold: number = 5): boolean {
    const meta = this.sessions.get(sessionKey);
    if (!meta) return false;

    const unconsolidated = this.getUnconsolidatedMessages(sessionKey);
    const unconsolidatedUserMsgs = unconsolidated.filter((m) => m.role === "user").length;
    return unconsolidatedUserMsgs >= threshold;
  }

  /** Clear a session (in memory and on disk). */
  clear(sessionKey: string): void {
    this.sessions.delete(sessionKey);
    const filePath = this.sessionPath(sessionKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  /** List all saved session keys (from disk). */
  listSessions(): string[] {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    return fs
      .readdirSync(SESSIONS_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => f.replace(".jsonl", ""));
  }

  /** Load a session from a JSONL file on disk. */
  private loadFromDisk(sessionKey: string): Message[] {
    const filePath = this.sessionPath(sessionKey);
    if (!fs.existsSync(filePath)) return [];

    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return [];

    return content
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line) as Message;
        } catch {
          return null;
        }
      })
      .filter((m): m is Message => m !== null);
  }

  private sessionPath(sessionKey: string): string {
    const safe = sessionKey.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(SESSIONS_DIR, `${safe}.jsonl`);
  }
}
