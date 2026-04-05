# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                         # CLI mode (default)
npm start -- --channel telegram   # Telegram mode
npm start -- --channel all        # Both CLI + Telegram
npm run dev                       # Development with auto-reload
npm run build                     # Compile TypeScript to dist/
npm test                          # Run all tests (vitest)
npm run test:watch                # Tests in watch mode
npx tsc --noEmit                  # Type-check without emitting
```

## Architecture

NanoBotTS is a TypeScript AI assistant framework. Messages flow through a decoupled bus:

```
Channel (CLI/Telegram)
  → MessageBus (inbound queue)
  → AgentLoop (per-session lock, max 3 concurrent)
  → AgentRunner (LLM + tool loop, max 200 iterations)
  → LLMProvider (Azure OpenAI / OpenAI-compat)
  → MessageBus (outbound queue)
  → Channel.send()
```

### Core systems (src/core/)

- **AgentRunner** (`agent.ts`): The agent loop — calls LLM, executes tool calls, feeds results back, repeats until final text. Supports hooks at each lifecycle point. Runs concurrency-safe tools in parallel via `Promise.all`.
- **AgentLoop** (`loop.ts`): Consumes from the inbound bus, manages per-session locking (Promise chaining), refreshes system prompt, runs AgentRunner, saves sessions, triggers memory consolidation.
- **ContextBuilder** (`context.ts`): Assembles system prompt from templates (`src/templates/`), always-on skills (`src/skills/`), long-term memory (`data/memory.md`), current time, and tool names.
- **Memory** (`memory.ts`): Two-tier persistence — `data/memory.md` (LLM-consolidated facts) + `data/history.md` (append-only searchable log).
- **SkillsLoader** (`skills.ts`): Scans `src/skills/` (built-in) and `./skills/` (workspace override) for SKILL.md files with YAML frontmatter. `always: true` skills are injected into every prompt; others are on-demand via `load_skill` tool.

### Key patterns

- **Adding a tool**: Implement the `Tool` interface from `tools/base.ts` (name, description, parameters as JSON Schema, execute), register in `index.ts`. Set `readOnly` and `concurrencySafe` flags.
- **Adding a provider**: Extend `LLMProvider` from `providers/base.ts` (implement `chat`, `chatWithTools`, `chatStream`), register in `providers/registry.ts` with keywords.
- **Adding a channel**: Implement the `Channel` interface from `channels/base.ts` (name, start, stop, send, sendDelta?), register in `index.ts`. Channels are thin I/O adapters — publish inbound to bus, receive outbound via send/sendDelta.
- **Adding a skill**: Create `src/skills/<name>/SKILL.md` with frontmatter (`name`, `description`, optional `always: true`). Workspace skills in `./skills/` override built-in by name.

### Token budgets

AgentRunner enforces two budgets:
- **Context budget** (120K tokens): `snipHistory()` trims oldest messages when approaching limit
- **Tool result budget** (8K tokens): `applyToolResultBudget()` truncates large tool outputs

Token estimation uses ~4 chars/token heuristic (`src/utils/tokens.ts`).

### Background services

- **CronService** (`cron/service.ts`): Interval, cron-expression, and one-time job scheduling. Persists to `data/cron-jobs.json`. Triggered jobs publish to the inbound bus.
- **HeartbeatService** (`heartbeat/service.ts`): 2-phase — reads `data/HEARTBEAT.md`, asks LLM "run or skip?", only publishes to bus if "run".
- **SubagentManager** (`core/subagent.ts`): Spawns background AgentRunner instances with limited tools (no message/spawn/cron). Used only by the `spawn` tool.

### Configuration

Priority: `data/config.json` > `.env` > defaults. Provider auto-detected from env vars:
- `AZURE_OPENAI_*` → azure-openai
- `OPENAI_API_KEY` → openai
- `PROVIDER_NAME` → explicit override

Secrets always loaded from `.env`, never persisted to config.json.

### Type system

`Message` is a union type (`types.ts`): `BaseMessage | AssistantMessage | ToolResultMessage`. The `AssistantMessage` variant has `content: string | null` and optional `tool_calls`. Use `msg.content ?? ""` when accessing content.
