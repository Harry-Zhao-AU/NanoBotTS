/**
 * Cron Tool — Schedule, list, and remove recurring tasks.
 *
 * Allows the agent to create scheduled jobs that run automatically.
 */

import { Tool, ToolParameters } from "./base.js";
import { CronService } from "../cron/service.js";

export class CronTool implements Tool {
  name = "cron";
  readOnly = false;
  concurrencySafe = true;

  description =
    "Manage scheduled tasks. Actions: " +
    "'add' to create a job, 'list' to show all jobs, 'remove' to delete a job. " +
    "Schedule types: 'interval' (every N seconds), 'cron' (cron expression), 'once' (ISO timestamp).";

  parameters: ToolParameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Action: 'add', 'list', or 'remove'",
      },
      name: {
        type: "string",
        description: "Job name (for 'add')",
      },
      task: {
        type: "string",
        description: "The task/prompt to execute when triggered (for 'add')",
      },
      type: {
        type: "string",
        description: "Schedule type: 'interval', 'cron', or 'once' (for 'add')",
      },
      schedule: {
        type: "string",
        description: "For interval: seconds (e.g., '300'). For cron: expression (e.g., '0 9 * * *'). For once: ISO timestamp.",
      },
      id: {
        type: "string",
        description: "Job ID (for 'remove')",
      },
    },
    required: ["action"],
  };

  private cronService: CronService;
  private defaultChannel: string;
  private defaultChatId: string;

  constructor(cronService: CronService, defaultChannel: string = "cli", defaultChatId: string = "cli") {
    this.cronService = cronService;
    this.defaultChannel = defaultChannel;
    this.defaultChatId = defaultChatId;
  }

  async execute(args: Record<string, unknown>): Promise<string> {
    const action = args.action as string;

    switch (action) {
      case "add":
        return this.addJob(args);
      case "list":
        return this.listJobs();
      case "remove":
        return this.removeJob(args);
      default:
        return `Unknown action "${action}". Use: add, list, remove.`;
    }
  }

  private addJob(args: Record<string, unknown>): string {
    const name = args.name as string;
    const task = args.task as string;
    const type = args.type as "interval" | "cron" | "once";
    const schedule = args.schedule as string;

    if (!name || !task || !type || !schedule) {
      return "Error: 'add' requires name, task, type, and schedule.";
    }

    if (!["interval", "cron", "once"].includes(type)) {
      return `Error: Invalid type "${type}". Use: interval, cron, once.`;
    }

    const job = this.cronService.addJob({
      name,
      task,
      type,
      schedule,
      channel: this.defaultChannel,
      chatId: this.defaultChatId,
    });

    return `Job created: "${job.name}" (${job.id})\nType: ${job.type}\nSchedule: ${job.schedule}`;
  }

  private listJobs(): string {
    const jobs = this.cronService.listJobs();
    if (jobs.length === 0) {
      return "No scheduled jobs.";
    }

    const lines = jobs.map((j) => {
      const status = j.enabled ? "active" : "paused";
      const lastRun = j.lastRun ? `last run: ${j.lastRun}` : "never run";
      return `- ${j.name} (${j.id})\n  ${j.type}: ${j.schedule} | ${status} | ${lastRun}`;
    });

    return `Scheduled jobs:\n${lines.join("\n")}`;
  }

  private removeJob(args: Record<string, unknown>): string {
    const id = args.id as string;
    if (!id) {
      return "Error: 'remove' requires an id. Use 'list' to see job IDs.";
    }

    if (this.cronService.removeJob(id)) {
      return `Job ${id} removed.`;
    }
    return `Job ${id} not found.`;
  }
}
