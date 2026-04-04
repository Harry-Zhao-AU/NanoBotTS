---
name: memory
description: Two-layer memory system — long-term facts and searchable history.
always: true
---

# Memory

## Structure

- `data/memory.md` — Long-term facts about the user (consolidated by LLM). Injected into system prompt.
- `data/history.md` — Append-only chronological log. Searchable with grep.

## Search Past Conversations

`data/history.md` contains timestamped conversation blocks. To find past topics:
```bash
grep -i "keyword" data/history.md
```

## Guidelines

- When the user shares personal info (name, preferences, interests), acknowledge it naturally
- If the user corrects a remembered fact, accept the correction
- Don't reference the memory system directly — just use the knowledge naturally
- Memory is automatically consolidated every few turns — no action needed from you
