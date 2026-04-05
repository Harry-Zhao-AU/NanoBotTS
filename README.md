# NanoBotTS

A lightweight, modular AI assistant framework built in TypeScript — inspired by [HKUDS/nanobot](https://github.com/HKUDS/nanobot).

This is a personal learning project, built incrementally to understand how AI agent systems work from the ground up.

## What I Learned (by Phase)

The project was built in two rounds of incremental phases. The first round (plan.md) built the core from scratch. The second round (plan2.md) hardened and extended the architecture.

### Round 1 — Building the Core

#### Phase 1 — Project Setup + Hello World Chat

**Core concept: TypeScript basics + LLM API**

- TypeScript project setup with npm, async/await
- Azure OpenAI SDK integration — simplest working CLI chatbot

#### Phase 2 — Conversation Memory + Streaming

**Core concept: State management + async iterators**

- Session class with message history for multi-turn conversations
- Token-by-token streaming responses for better UX

#### Phase 3 — Tool/Function Calling (Agent Loop)

**Core concept: The agent loop pattern**

- Tool interface + `ToolRegistry` for registering capabilities
- `AgentRunner` implementing the core loop: LLM → tool calls → execute → feed results → LLM responds
- First tools: `get_current_time` and `web_search`

#### Phase 4 — System Prompt + Configuration

**Core concept: Prompt engineering + config management**

- Configurable persona and model parameters via `data/config.json`
- Slash commands (`/help`, `/clear`, `/persona`, `/config`)
- Context builder for system prompt assembly

#### Phase 5 — Telegram Channel

**Core concept: Adapter pattern + multi-channel**

- Abstract `BaseChannel` interface
- Telegram bot via Telegraf, sharing the same agent core as CLI

#### Phase 6 — Advanced Features

**Core concept: Persistence + memory**

- Two-tier memory system: LLM-consolidated facts (`memory.md`) + session JSONL files
- Session persistence across restarts

### Round 2 — Hardening & Extending

#### Phase 7 — Foundation Hardening

**Core concept: Tool system + context management**

- Formal `ToolRegistry` with schema validation and type casting
- Token-aware context management — trimming old messages and capping tool results to stay within budget
- `SessionManager` with consolidation tracking
- `HISTORY.md` searchable chronological log alongside `MEMORY.md`

#### Phase 8 — MessageBus + AgentLoop

**Core concept: Decoupling I/O from reasoning**

- Async `MessageBus` with inbound/outbound queues — channels never talk to the agent directly
- `AgentLoop` as central orchestrator with per-session locks and a global concurrency semaphore
- Channels refactored into thin I/O adapters that just publish/consume messages
- `ChannelManager` handles lifecycle and routes outbound messages to the correct channel

#### Phase 9 — Provider Registry

**Core concept: Abstracting LLM providers**

- `ProviderRegistry` with auto-detection from environment variables
- Providers for Azure OpenAI and any OpenAI-compatible API (OpenAI, Groq, Ollama, etc.)
- Config-driven provider selection with automatic retry and backoff

#### Phase 10 — Expanded Tool Suite

**Core concept: Giving the agent capabilities**

- Filesystem tools: read, write, edit, list directories
- Shell execution with a deny-list for dangerous commands
- Web fetch and search tools
- Concurrent execution of safe tools in parallel

#### Phase 11 — Hooks + Templates

**Core concept: Lifecycle observability and prompt engineering**

- `AgentHook` interface with callbacks for each stage of the reasoning loop
- Template-based system prompt assembly from modular markdown files (SOUL.md, AGENTS.md, TOOLS.md, USER.md)
- `ContextBuilder` composes the final system prompt from templates + memory

#### Phase 12 — Skills System

**Core concept: Progressive capability loading**

- Skills defined as markdown files with YAML frontmatter
- Two loading strategies: always-on (injected every prompt) vs. on-demand (agent discovers and loads as needed)
- Workspace skill overrides for project-specific behaviors

#### Phase 13 — Background Services

**Core concept: Autonomy and scheduling**

- `CronService` for interval, cron, and one-shot scheduled tasks
- `HeartbeatService` for lightweight autonomous monitoring (two-phase: cheap check first, full run only if needed)
- `SubagentManager` for spawning background worker agents with restricted tool access

## Architecture

```
User Input
    │
    ▼
Channel (CLI / Telegram)
    │
    ▼
MessageBus ──────────────────────────────┐
    │                                    │
    ▼                                    │
AgentLoop (per-session lock)             │
    │                                    │
    ▼                                    │
ContextBuilder ← Templates + Memory     │
    │                                    │
    ▼                                    │
AgentRunner (LLM + tool loop)           │
    │                                    │
    ├──→ Provider (Azure / OpenAI / ...) │
    ├──→ ToolRegistry (execute tools)    │
    └──→ Response ──────────────────────→┘
                                         │
                                         ▼
                                    Channel.send()
```

**Background services** (CronService, HeartbeatService, SubagentManager) inject messages into the bus independently, enabling autonomous behavior.

## Quick Start

```bash
# Install dependencies
npm install

# Configure (copy and fill in your API keys)
cp .env.example .env

# Run in CLI mode
npm start

# Run in Telegram mode
npm start -- --channel telegram

# Run both CLI and Telegram
npm start -- --channel all

# Development mode (auto-reload)
npm run dev
```

## Tech Stack

- **TypeScript** + **Node.js**
- **OpenAI SDK** — works with any OpenAI-compatible API
- **Telegraf** — Telegram bot framework
- **Zod** — runtime schema validation

## Roadmap

Phases 1–13 are complete. Here's what's next:

### Phase 14 — MCP Integration

Connect to external MCP servers and dynamically wrap their tools.

- MCP client supporting stdio, SSE, and streamable HTTP transports
- `MCPToolWrapper` to convert MCP server tools into nanobot tools at runtime
- Config-driven MCP server connections with lazy loading
- Tool namespacing to avoid collisions across servers

### Phase 15 — Security Layer

Protect against misuse and dangerous operations.

- SSRF protection — validate URLs against private IP ranges
- Workspace restriction — filesystem tools confined to configured directory
- Shell deny-list hardening
- Per-channel user/group permission allowlists

## Acknowledgements

Inspired by [HKUDS/nanobot](https://github.com/HKUDS/nanobot) — a minimal yet capable AI agent that demonstrated how much you can achieve with a clean, focused architecture.

## License

MIT
