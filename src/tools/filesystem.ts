/**
 * Filesystem Tools — read_file, write_file, edit_file, list_dir
 *
 * Gives the agent the ability to read, write, and modify files on disk.
 * All paths are resolved relative to the workspace root (cwd by default).
 */

import fs from "node:fs";
import path from "node:path";
import { Tool, ToolParameters } from "./base.js";

/** Resolve a path safely within the workspace */
function resolvePath(filePath: string): string {
  return path.resolve(filePath);
}

// ── read_file ──────────────────────────────────────────────────

export class ReadFileTool implements Tool {
  name = "read_file";
  readOnly = true;
  concurrencySafe = true;

  description =
    "Read the contents of a file. Returns the file content with line numbers. " +
    "Use `offset` and `limit` for large files to read specific sections.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to read",
      },
      offset: {
        type: "number",
        description: "Line number to start reading from (1-based, default: 1)",
      },
      limit: {
        type: "number",
        description: "Maximum number of lines to read (default: 200)",
      },
    },
    required: ["path"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = resolvePath(args.path as string);
    const offset = ((args.offset as number) || 1) - 1; // convert to 0-based
    const limit = (args.limit as number) || 200;

    try {
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) {
        return `Error: "${filePath}" is a directory. Use list_dir instead.`;
      }
      if (stat.size > 10 * 1024 * 1024) {
        return `Error: File too large (${Math.round(stat.size / 1024 / 1024)}MB). Use offset/limit to read portions.`;
      }

      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;
      const selected = lines.slice(offset, offset + limit);

      const numbered = selected
        .map((line, i) => `${offset + i + 1}\t${line}`)
        .join("\n");

      let result = numbered;
      if (offset + limit < totalLines) {
        result += `\n\n[... ${totalLines - offset - limit} more lines. Use offset=${offset + limit + 1} to continue.]`;
      }

      return result;
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return `Error: File not found: ${filePath}`;
      return `Error reading file: ${(err as Error).message}`;
    }
  }
}

// ── write_file ─────────────────────────────────────────────────

export class WriteFileTool implements Tool {
  name = "write_file";
  readOnly = false;
  concurrencySafe = false;

  description =
    "Write content to a file. Creates the file if it doesn't exist. " +
    "Creates parent directories automatically. Overwrites existing content.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
    required: ["path", "content"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = resolvePath(args.path as string);
    const content = args.content as string;

    // Auto-create parent directories
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, content, "utf-8");
    const lines = content.split("\n").length;
    return `File written: ${filePath} (${lines} lines)`;
  }
}

// ── edit_file ──────────────────────────────────────────────────

export class EditFileTool implements Tool {
  name = "edit_file";
  readOnly = false;
  concurrencySafe = false;

  description =
    "Edit a file by replacing a specific string with a new string. " +
    "The old_string must match exactly (including indentation). " +
    "Set replace_all to true to replace all occurrences.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Path to the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact text to find and replace",
      },
      new_string: {
        type: "string",
        description: "The text to replace it with",
      },
      replace_all: {
        type: "boolean",
        description: "Replace all occurrences (default: false, replaces first only)",
      },
    },
    required: ["path", "old_string", "new_string"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const filePath = resolvePath(args.path as string);
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) || false;

    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return `Error: File not found: ${filePath}`;
      return `Error reading file: ${(err as Error).message}`;
    }

    if (!content.includes(oldString)) {
      return `Error: old_string not found in ${filePath}. Make sure it matches exactly (including whitespace and indentation).`;
    }

    if (replaceAll) {
      content = content.split(oldString).join(newString);
    } else {
      content = content.replace(oldString, newString);
    }

    fs.writeFileSync(filePath, content, "utf-8");
    return `File edited: ${filePath}`;
  }
}

// ── list_dir ───────────────────────────────────────────────────

export class ListDirTool implements Tool {
  name = "list_dir";
  readOnly = true;
  concurrencySafe = true;

  description =
    "List files and directories at a given path. " +
    "Set recursive to true for a tree view (max 3 levels deep).";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list (default: current directory)",
      },
      recursive: {
        type: "boolean",
        description: "List recursively (default: false, max 3 levels)",
      },
    },
    required: [],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const dirPath = resolvePath((args.path as string) || ".");
    const recursive = (args.recursive as boolean) || false;

    try {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) {
        return `Error: "${dirPath}" is a file, not a directory.`;
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return `Error: Directory not found: ${dirPath}`;
      return `Error: ${(err as Error).message}`;
    }

    const lines: string[] = [];
    this.listEntries(dirPath, "", recursive ? 3 : 1, 0, lines);

    if (lines.length === 0) {
      return `(empty directory: ${dirPath})`;
    }

    return lines.join("\n");
  }

  private listEntries(
    dirPath: string,
    prefix: string,
    maxDepth: number,
    depth: number,
    lines: string[],
  ): void {
    if (depth >= maxDepth) return;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
      return;
    }

    // Sort: directories first, then files
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (lines.length >= 500) {
        lines.push("... (truncated at 500 entries)");
        return;
      }

      // Skip hidden and common noise
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }

      const isDir = entry.isDirectory();
      lines.push(`${prefix}${isDir ? entry.name + "/" : entry.name}`);

      if (isDir && depth + 1 < maxDepth) {
        this.listEntries(
          path.join(dirPath, entry.name),
          prefix + "  ",
          maxDepth,
          depth + 1,
          lines,
        );
      }
    }
  }
}
