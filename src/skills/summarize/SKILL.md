---
name: summarize
description: Summarize web pages, files, or conversations using web_fetch and read_file.
---

# Summarize

Summarize content from URLs or local files.

## Web page summarization

1. Use `web_fetch` to download the page content
2. Identify the main topic and key points
3. Present a concise summary

Example:
```
User: "summarize this article: https://example.com/article"
→ Use web_fetch to get the content, then summarize in 3-5 bullet points
```

## File summarization

1. Use `read_file` to read the file (use offset/limit for large files)
2. Identify structure, purpose, and key sections
3. Summarize based on what the user needs

Example:
```
User: "what does src/core/agent.ts do?"
→ Use read_file, then explain the file's purpose and key methods
```

## Guidelines

- Lead with the most important information
- Use bullet points for clarity
- Include specific numbers, names, and dates when relevant
- For long content, summarize first, then offer to expand specific sections
