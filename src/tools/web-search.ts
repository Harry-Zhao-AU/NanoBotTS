/**
 * Web Search Tool — Search the web for information.
 *
 * Uses DuckDuckGo's HTML lite endpoint and parses the results.
 * The instant answer API (api.duckduckgo.com) only works for factual
 * lookups like "what is X" — it doesn't return general search results.
 * The HTML lite endpoint gives real search results for any query.
 *
 * Key concepts:
 * - `fetch()`: built-in Node.js function (since v18) for HTTP requests.
 * - HTML parsing: we use regex to extract links and titles from the
 *   lightweight HTML page. A full HTML parser (like cheerio) would be
 *   cleaner, but regex keeps our dependencies minimal.
 * - The tool returns results as text for the LLM to interpret and
 *   summarize for the user.
 */

import { Tool, ToolParameters } from "./base.js";

export class WebSearchTool implements Tool {
  name = "web_search";

  description = "Search the web for current information. Use this when the user asks about recent events, facts you're unsure about, or anything that requires up-to-date information.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
    },
    required: ["query"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;

    if (!query) {
      return "Error: No search query provided.";
    }

    try {
      // DuckDuckGo HTML lite — returns real search results, no API key needed
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        headers: {
          // DuckDuckGo requires a browser-like User-Agent
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        return `Search failed with status ${response.status}. Please try again.`;
      }

      const html = await response.text();

      // Parse results from the HTML lite page
      // Each result is in a <a class="result__a" href="...">title</a>
      // with a snippet in <a class="result__snippet">...</a>
      const results = this.parseResults(html);

      if (results.length === 0) {
        return `No results found for "${query}".`;
      }

      // Format results for the LLM
      const formatted = results.slice(0, 5).map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      );

      return `Search results for "${query}":\n\n${formatted.join("\n\n")}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return `Search error: ${message}`;
    }
  }

  /** Parse search results from DuckDuckGo HTML lite page */
  private parseResults(html: string): Array<{ title: string; url: string; snippet: string }> {
    const results: Array<{ title: string; url: string; snippet: string }> = [];

    // Match result links: <a rel="nofollow" class="result__a" href="URL">TITLE</a>
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
    // Match snippets: <a class="result__snippet" ...>SNIPPET</a>
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

    const links: Array<{ url: string; title: string }> = [];
    let match;

    while ((match = linkRegex.exec(html)) !== null) {
      links.push({
        url: this.decodeUrl(match[1]),
        title: this.stripHtml(match[2]),
      });
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(this.stripHtml(match[1]));
    }

    for (let i = 0; i < links.length; i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || "",
      });
    }

    return results;
  }

  /** Strip HTML tags and decode entities */
  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** DuckDuckGo wraps URLs in a redirect — extract the real URL */
  private decodeUrl(url: string): string {
    // DDG URLs look like: //duckduckgo.com/l/?uddg=https%3A%2F%2Freal-url.com&rut=...
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      return decodeURIComponent(uddgMatch[1]);
    }
    return url;
  }
}
