/**
 * Time Tool — Returns the current date and time.
 *
 * This is the simplest possible tool — a good starting point for
 * understanding how tools work. The LLM can ask "what time is it?"
 * and this tool provides the answer.
 *
 * Key concepts:
 * - The `parameters` object uses JSON Schema to describe what arguments
 *   the tool accepts. Here, `timezone` is optional.
 * - `execute()` receives parsed arguments and returns a string result.
 *   The result gets sent back to the LLM as a "tool" message.
 */

import { Tool, ToolParameters } from "./base.js";

export class TimeTool implements Tool {
  name = "get_current_time";

  description = "Get the current date and time. Optionally specify a timezone (e.g., 'America/New_York', 'Asia/Shanghai', 'Europe/London').";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      timezone: {
        type: "string",
        description: "IANA timezone name (e.g., 'America/New_York'). Defaults to the system's local timezone.",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const timezone = args.timezone as string | undefined;

    try {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZoneName: "short",
      };

      if (timezone) {
        options.timeZone = timezone;
      }

      const formatted = now.toLocaleString("en-US", options);
      return `Current time: ${formatted}`;
    } catch {
      return `Error: Invalid timezone "${timezone}". Use IANA format like "America/New_York".`;
    }
  }
}
