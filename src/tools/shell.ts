/**
 * Shell Tool — Execute shell commands.
 *
 * Gives the agent the ability to run shell commands and see the output.
 * Includes a deny-list for dangerous commands and a configurable timeout.
 */

import { exec } from "node:child_process";
import { Tool, ToolParameters } from "./base.js";

/** Commands that should never be executed */
const DENY_LIST = [
  "rm -rf /",
  "rm -rf /*",
  "mkfs",
  "format",
  ":(){:|:&};:",  // fork bomb
  "dd if=/dev/zero",
  "dd if=/dev/random",
  "> /dev/sda",
  "chmod -R 777 /",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "init 0",
  "init 6",
];

/** Check if a command matches any deny-list pattern */
function isDenied(command: string): boolean {
  const normalized = command.trim().toLowerCase();
  return DENY_LIST.some((denied) => normalized.includes(denied.toLowerCase()));
}

const DEFAULT_TIMEOUT_MS = 30000; // 30 seconds

export class ExecTool implements Tool {
  name = "exec";
  readOnly = false;
  concurrencySafe = false;

  description =
    "Execute a shell command and return its output (stdout + stderr). " +
    "You are authorized to run commands. Use freely for git, npm, curl, " +
    "system info, file operations, and any other CLI tasks. " +
    "Dangerous commands are blocked automatically. Timeout: 30s.";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The shell command to execute",
      },
      timeout: {
        type: "number",
        description: "Timeout in milliseconds (default: 30000)",
      },
    },
    required: ["command"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const command = args.command as string;
    const timeout = (args.timeout as number) || DEFAULT_TIMEOUT_MS;

    if (!command) {
      return "Error: No command provided.";
    }

    if (isDenied(command)) {
      return `Error: Command denied for safety: "${command}"`;
    }

    return new Promise<string>((resolve) => {
      exec(
        command,
        { timeout, maxBuffer: 1024 * 1024 }, // 1MB output limit
        (error, stdout, stderr) => {
          const parts: string[] = [];

          if (stdout) parts.push(stdout.trimEnd());
          if (stderr) parts.push(`[stderr]\n${stderr.trimEnd()}`);

          if (error) {
            if (error.killed) {
              parts.push(`[Process killed — timeout after ${timeout}ms]`);
            } else if (!stdout && !stderr) {
              parts.push(`[Error] ${error.message}`);
            }
            // If we have stdout/stderr, the exit code is enough context
            parts.push(`[Exit code: ${error.code ?? 1}]`);
          } else {
            parts.push("[Exit code: 0]");
          }

          resolve(parts.join("\n"));
        },
      );
    });
  }
}
