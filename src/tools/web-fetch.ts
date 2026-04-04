/**
 * Web Fetch Tool — Download a URL and return its content as text.
 *
 * Fetches a web page and strips HTML to return readable text content.
 * Complements web_search — search finds URLs, web_fetch reads them.
 */

import { Tool, ToolParameters } from "./base.js";
import { htmlToText, DEFAULT_USER_AGENT } from "../utils/html.js";

const MAX_CONTENT_LENGTH = 50000; // ~12.5K tokens

export class WebFetchTool implements Tool {
  name = "web_fetch";
  readOnly = true;
  concurrencySafe = true;

  description =
    "Fetch a web page URL and return its text content. " +
    "Use this after web_search to read the full content of a search result. " +
    "HTML is automatically converted to readable text.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const url = args.url as string;

    if (!url) {
      return "Error: No URL provided.";
    }

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (!response.ok) {
        return `Error: HTTP ${response.status} ${response.statusText}`;
      }

      const contentType = response.headers.get("content-type") || "";
      const raw = await response.text();

      let content: string;
      if (contentType.includes("text/html") || contentType.includes("application/xhtml")) {
        content = htmlToText(raw);
      } else {
        // Plain text, JSON, etc. — return as-is
        content = raw;
      }

      // Truncate if too long
      if (content.length > MAX_CONTENT_LENGTH) {
        content = content.slice(0, MAX_CONTENT_LENGTH) + "\n\n[... content truncated]";
      }

      return `Content from ${url}:\n\n${content}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Error fetching ${url}: ${message}`;
    }
  }
}
