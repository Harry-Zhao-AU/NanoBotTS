# NanoBotTS

A lightweight, modular AI assistant framework built in TypeScript — inspired by [HKUDS/nanobot](https://github.com/HKUDS/nanobot).

This is a personal learning project, built incrementally to understand how AI agent systems work from the ground up.

## What I Learned (by Phase)

The project was built in incremental phases, each introducing a core concept of agent architecture:

### Phase 1 — Foundation Hardening
**Core concept: Tool system + context management**
- Built a formal `ToolRegistry` with schema validation and type casting
- Implemented token-aware context management — trimming old messages and capping tool results to stay within budget
- Created a two-tier memory system: LLM-consolidated facts (`memory.md`) + raw chronological log (`history.md`)
- Session persistence via JSONL files with consolidation tracking

### Phase 2 — MessageBus + AgentLoop
**Core concept: Decoupling I/O from reasoning**
- Built an async `MessageBus` with inbound/outbound queues — channels never talk to the agent directly
- Created `AgentLoop` as the central orchestrator with per-session locks and a global concurrency semaphore
- Refactored channels (CLI, Telegram) into thin I/O adapters that just publish/consume messages
- `ChannelManager` handles lifecycle and routes outbound messages to the correct channel

### Phase 3 — Provider Registry
**Core concept: Abstracting LLM providers**
- Built a `ProviderRegistry` with auto-detection from environment variables
- Implemented providers for Azure OpenAI and any OpenAI-compatible API (OpenAI, Groq, Ollama, etc.)
- Config-driven provider selection with automatic retry and backoff

### Phase 4 — Expanded Tool Suite
**Core concept: Giving the agent capabilities**
- Filesystem tools: read, write, edit, list directories
- Shell execution with a deny-list for dangerous commands
- Web fetch and search tools
- Concurrent execution of safe tools in parallel

### Phase 5 — Hooks + Templates
**Core concept: Lifecycle observability and prompt engineering**
- `AgentHook` interface with callbacks for each stage of the reasoning loop
- Template-based system prompt assembly from modular markdown files (SOUL.md, AGENTS.md, TOOLS.md, USER.md)
- `ContextBuilder` composes the final system prompt from templates + memory

### Phase 6 — Skills System
**Core concept: Progressive capability loading**
- Skills defined as markdown files with YAML frontmatter
- Two loading strategies: always-on (injected every prompt) vs. on-demand (agent discovers and loads as needed)
- Workspace skill overrides for project-specific behaviors

### Phase 7 — Background Services
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

## Acknowledgements

Inspired by [HKUDS/nanobot](https://github.com/HKUDS/nanobot) — a minimal yet capable AI agent that demonstrated how much you can achieve with a clean, focused architecture.

## License

MIT
