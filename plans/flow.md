# NanoBotTS System Architecture

```mermaid
graph TB
    subgraph Channels["Channels (I/O Adapters)"]
        CLI["CLI Channel<br/><i>readline REPL</i><br/>/help /clear /memory /persona"]
        TG["Telegram Channel<br/><i>Telegraf bot</i><br/>/start /clear /memory /help"]
    end

    subgraph Core["Core Engine"]
        Agent["AgentRunner<br/><i>LLM + Tool Loop</i><br/>max 10 iterations"]
        Session["Session<br/><i>In-memory history</i><br/>max 20 messages"]
        Context["ContextBuilder<br/><i>System prompt assembly</i><br/>persona + memory + time + tools"]
        Memory["Memory<br/><i>2-tier persistence</i>"]
    end

    subgraph Provider["LLM Provider"]
        Azure["AzureOpenAIProvider<br/><i>GPT-4o</i><br/>chat · chatWithTools · chatStream"]
    end

    subgraph Tools["Tool Registry"]
        TimeTool["TimeTool<br/><i>get_current_time</i>"]
        WebSearch["WebSearchTool<br/><i>web_search</i><br/>DuckDuckGo"]
    end

    subgraph Storage["Persistence (data/)"]
        ConfigFile["config.json<br/><i>Settings</i>"]
        MemFile["memory.md<br/><i>Long-term memory</i>"]
        Sessions["sessions/*.jsonl<br/><i>Conversation history</i>"]
        ENV[".env<br/><i>Secrets</i>"]
    end

    subgraph External["External Services"]
        AzureAPI["Azure OpenAI API"]
        DDG["DuckDuckGo"]
        TGApi["Telegram Bot API"]
    end

    %% User flows
    User((User)) -->|text input| CLI
    User -->|messages| TG

    %% Channel → Core
    CLI --> Session
    TG --> Session
    CLI --> Context
    TG --> Context
    Context -->|system prompt| Agent
    Session -->|message history| Agent

    %% Agent loop
    Agent -->|chatWithTools| Azure
    Azure -->|LLMResponse| Agent
    Agent -->|execute| Tools
    Tools -->|result| Agent
    Agent -->|chatStream| Azure
    Azure -->|streamed tokens| Agent

    %% Agent responses back to channels
    Agent -->|final response| CLI
    Agent -->|final response| TG

    %% Memory consolidation
    CLI -->|every 5 msgs| Memory
    TG -->|every 5 msgs| Memory
    Memory -->|consolidation prompt| Agent
    Context -->|reads| Memory

    %% Storage I/O
    Memory -->|read/write| MemFile
    Memory -->|read/write| Sessions
    Config["config.ts"] -->|load/save| ConfigFile
    Config -->|read| ENV

    %% External connections
    Azure -->|API calls| AzureAPI
    WebSearch -->|HTTP| DDG
    TG -->|Telegraf| TGApi

    %% Styling
    classDef channel fill:#4A90D9,stroke:#2C5F8A,color:#fff
    classDef core fill:#5BA55B,stroke:#3D7A3D,color:#fff
    classDef provider fill:#D4A843,stroke:#A07E2E,color:#fff
    classDef tool fill:#9B6FCC,stroke:#6F4D99,color:#fff
    classDef storage fill:#888,stroke:#555,color:#fff
    classDef external fill:#D95B5B,stroke:#A03D3D,color:#fff

    class CLI,TG channel
    class Agent,Session,Context,Memory core
    class Azure provider
    class TimeTool,WebSearch tool
    class ConfigFile,MemFile,Sessions,ENV storage
    class AzureAPI,DDG,TGApi external
```

## Key Data Flow

1. **User input** → Channel (CLI/Telegram) → Session + ContextBuilder → **AgentRunner**
2. **Agent loop**: LLM call → if tool_calls → execute tool → feed result back → repeat
3. **Final response** streamed back to the channel → displayed to user
4. **Memory consolidation**: every 5 user messages, the LLM extracts key facts → saved to `memory.md`
5. **Session persistence**: full conversation saved as JSONL in `data/sessions/`
