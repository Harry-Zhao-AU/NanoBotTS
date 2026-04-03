# NanoBotTS - Phased Implementation Plan

## Context

Build a TypeScript CLI AI assistant inspired by [HKUDS/nanobot](https://github.com/HKUDS/nanobot) — an ultra-lightweight personal AI agent framework. The original nanobot (Python, ~4,000 lines) uses a clean 5-layer architecture: Channels → MessageBus → Agent Engine → LLM Providers → Tools. We'll port this philosophy to TypeScript, building incrementally across 6 phases so the user learns TypeScript and agent patterns along the way.

**Key decisions:**
- LLM: Azure OpenAI GPT-4o (API key auth, already deployed)
- CLI first, Telegram later
- Initial tools: web search + current time
- Ultra-lightweight: minimal dependencies, clean abstractions

---

## Project Structure (final target)

```
C:\NanoBotTS\
├── package.json
├── tsconfig.json
├── .env                     # Azure OpenAI credentials
├── .gitignore
├── src/
│   ├── index.ts             # Entry point
│   ├── types.ts             # Shared type definitions
│   ├── config.ts            # Configuration loader
│   ├── core/
│   │   ├── agent.ts         # AgentRunner (LLM ↔ tool loop)
│   │   ├── session.ts       # Session/conversation history manager
│   │   └── memory.ts        # Persistent memory (Phase 6)
│   ├── providers/
│   │   └── azure-openai.ts  # Azure OpenAI provider
│   ├── channels/
│   │   ├── base.ts          # BaseChannel interface
│   │   ├── cli.ts           # CLI channel (readline)
│   │   └── telegram.ts      # Telegram channel (Phase 5)
│   └── tools/
│       ├── base.ts          # Tool interface + registry
│       ├── time.ts          # Current time tool
│       └── web-search.ts    # Web search tool
└── data/                    # Sessions, memory (runtime)
```

---

## Phase 1: Project Setup + Hello World Chat ✅ 

**Goal:** Get a working CLI chatbot that talks to Azure OpenAI GPT-4o. Simplest possible thing that works.

**You will learn:** TypeScript project setup, npm, async/await, Azure OpenAI SDK basics.

### Files Created
- `package.json` — project manifest with openai, dotenv deps
- `tsconfig.json` — TypeScript config (ES2022, NodeNext, strict)
- `.env` — Azure OpenAI credentials (you fill in)
- `.gitignore` — ignore node_modules, dist, .env, data/
- `src/types.ts` — Message and Config type definitions
- `src/config.ts` — loads and validates .env config
- `src/providers/azure-openai.ts` — AzureOpenAI client wrapper
- `src/channels/cli.ts` — readline-based CLI interface
- `src/index.ts` — entry point wiring everything together

### How to run
```bash
npm install
npx tsx src/index.ts
```

---

## Phase 2: Conversation Memory + Streaming

**Goal:** Add conversation history so the bot remembers context within a session, and stream responses token-by-token for better UX.

**You will learn:** Array-based state management, async iterators, streaming API.

### Steps
1. Create `src/core/session.ts` — Session class with message history
2. Update `src/providers/azure-openai.ts` — Add `chatStream()` with async iterator
3. Update `src/channels/cli.ts` — Stream output with `process.stdout.write()`
4. Update `src/index.ts` — Wire session into the conversation loop

---

## Phase 3: Tool/Function Calling (Agent Loop)

**Goal:** Turn the chatbot into an agent. Implement: LLM → tool calls → execute → feed results → LLM responds.

**You will learn:** Function calling API, JSON Schema, the agent loop pattern.

### Steps
1. Create `src/tools/base.ts` — Tool interface + ToolRegistry
2. Create `src/tools/time.ts` — get_current_time tool
3. Create `src/tools/web-search.ts` — web_search tool
4. Create `src/core/agent.ts` — AgentRunner with tool-calling loop
5. Update provider and CLI to support tools

---

## Phase 4: System Prompt + Configuration + Persona

**Goal:** Configurable persona, model params, slash commands.

**You will learn:** JSON config files, file I/O, command parsing.

### Steps
1. Config file system (`data/config.json`)
2. Slash commands: /help, /clear, /persona, /config
3. Context builder for system prompt assembly

---

## Phase 5: Telegram Channel Support

**Goal:** Add Telegram as second interface, sharing the same agent core.

**You will learn:** Telegram Bot API, abstract interfaces, adapter pattern.

### Steps
1. Create `src/channels/base.ts` — Channel interface
2. Create `src/channels/telegram.ts` — Telegraf-based bot
3. Multi-channel startup from config

---

## Phase 6: Advanced Features

**Goal:** Persistent memory, session storage, MCP integration.

**You will learn:** File persistence, LLM-driven memory, MCP protocol.

### Steps
1. Two-tier memory system (memory.md + sessions)
2. Session persistence to JSONL
3. MCP client integration (stretch goal)
