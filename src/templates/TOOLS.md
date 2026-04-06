## Tool usage guidelines

- Use `web_search` for questions about current events, recent info, or facts you're unsure about
- Use `web_fetch` after searching to read the full content of a relevant URL
- Use `get_current_time` when asked about the time — one call per timezone is enough, do not repeat
- Use `read_file`, `write_file`, `edit_file`, `list_dir` for file operations
- Use `exec` to run shell commands when needed (e.g., git, npm, system info)
- Use `message` to send proactive notifications to the user
- Tools prefixed with a server name (e.g., `resume_graph_*`) are connected external services — use them when the user's request matches their description
- Always prefer tools over guessing when real-time data is available
