/**
 * CronService — Job scheduling with interval, cron-expression, and one-time support.
 *
 * Jobs are persisted to data/cron-jobs.json so they survive restarts.
 * Each job has a task string that gets published to the MessageBus
 * as an inbound message when triggered.
 *
 * Schedule types:
 *   - interval: every N seconds (e.g., "every 300" = every 5 minutes)
 *   - cron: cron expression (e.g., "0 9 * * *" = daily at 9am)
 *   - once: ISO timestamp for one-time execution
 */

import fs from "node:fs";
import path from "node:path";
import { MessageBus } from "../bus/queue.js";

const DATA_DIR = path.resolve("data");
const JOBS_FILE = path.join(DATA_DIR, "cron-jobs.json");

export interface CronJob {
  id: string;
  /** Human-readable name */
  name: string;
  /** The task/prompt to execute when triggered */
  task: string;
  /** Schedule type */
  type: "interval" | "cron" | "once";
  /** For interval: seconds between runs. For cron: cron expression. For once: ISO timestamp. */
  schedule: string;
  /** Channel to send results to */
  channel: string;
  /** Chat ID to send results to */
  chatId: string;
  /** When the job was created */
  createdAt: string;
  /** When the job last ran */
  lastRun?: string;
  /** Whether the job is active */
  enabled: boolean;
}

/** Parse a simple cron expression and check if it matches the current time */
function cronMatches(expr: string, now: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minExpr, hourExpr, dayExpr, monthExpr, dowExpr] = parts;
  const minute = now.getMinutes();
  const hour = now.getHours();
  const day = now.getDate();
  const month = now.getMonth() + 1;
  const dow = now.getDay(); // 0=Sunday

  return (
    fieldMatches(minExpr, minute) &&
    fieldMatches(hourExpr, hour) &&
    fieldMatches(dayExpr, day) &&
    fieldMatches(monthExpr, month) &&
    fieldMatches(dowExpr, dow)
  );
}

/** Check if a single cron field matches a value (supports *, star-slash-N, and exact numbers) */
function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;

  // */N — every N
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  // Comma-separated values
  const values = field.split(",").map((v) => parseInt(v.trim(), 10));
  return values.includes(value);
}

export class CronService {
  private jobs: Map<string, CronJob> = new Map();
  private timers: Map<string, ReturnType<typeof setInterval> | ReturnType<typeof setTimeout>> = new Map();
  private cronCheckTimer: ReturnType<typeof setInterval> | null = null;
  private bus: MessageBus;
  private running: boolean = false;

  constructor(bus: MessageBus) {
    this.bus = bus;
    this.loadJobs();
  }

  /** Start all enabled jobs. */
  start(): void {
    this.running = true;

    // Start interval and one-time jobs
    for (const job of this.jobs.values()) {
      if (job.enabled) this.scheduleJob(job);
    }

    // Check cron jobs every 60 seconds
    this.cronCheckTimer = setInterval(() => this.checkCronJobs(), 60000);

    const count = this.jobs.size;
    if (count > 0) {
      console.log(`CronService started with ${count} job(s).`);
    }
  }

  /** Stop all jobs. */
  stop(): void {
    this.running = false;
    for (const timer of this.timers.values()) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    this.timers.clear();
    if (this.cronCheckTimer) {
      clearInterval(this.cronCheckTimer);
      this.cronCheckTimer = null;
    }
  }

  /** Add a new job. */
  addJob(job: Omit<CronJob, "id" | "createdAt" | "enabled">): CronJob {
    const id = `cron_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const fullJob: CronJob = {
      ...job,
      id,
      createdAt: new Date().toISOString(),
      enabled: true,
    };

    this.jobs.set(id, fullJob);
    this.saveJobs();

    if (this.running) {
      this.scheduleJob(fullJob);
    }

    return fullJob;
  }

  /** Remove a job by ID. */
  removeJob(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer) {
      clearInterval(timer);
      clearTimeout(timer);
      this.timers.delete(id);
    }

    const deleted = this.jobs.delete(id);
    if (deleted) this.saveJobs();
    return deleted;
  }

  /** List all jobs. */
  listJobs(): CronJob[] {
    return Array.from(this.jobs.values());
  }

  /** Get a job by ID. */
  getJob(id: string): CronJob | undefined {
    return this.jobs.get(id);
  }

  /** Trigger a job — publish its task to the bus. */
  private triggerJob(job: CronJob): void {
    job.lastRun = new Date().toISOString();
    this.saveJobs();

    console.log(`  [Cron] Triggering "${job.name}"`);

    this.bus.publishInbound({
      channel: job.channel,
      sessionKey: `cron_${job.id}`,
      chatId: job.chatId,
      senderName: "CronService",
      content: `[Scheduled task: ${job.name}] ${job.task}`,
    });

    // Auto-remove one-time jobs after execution
    if (job.type === "once") {
      this.removeJob(job.id);
    }
  }

  /** Schedule a single job based on its type. */
  private scheduleJob(job: CronJob): void {
    switch (job.type) {
      case "interval": {
        const seconds = parseInt(job.schedule, 10);
        if (isNaN(seconds) || seconds <= 0) break;
        const timer = setInterval(() => this.triggerJob(job), seconds * 1000);
        this.timers.set(job.id, timer);
        break;
      }
      case "once": {
        const targetTime = new Date(job.schedule).getTime();
        const delay = targetTime - Date.now();
        if (delay <= 0) {
          // Already past — trigger immediately
          this.triggerJob(job);
        } else {
          const timer = setTimeout(() => this.triggerJob(job), delay);
          this.timers.set(job.id, timer);
        }
        break;
      }
      case "cron":
        // Cron jobs are checked by the periodic cronCheckTimer
        break;
    }
  }

  /** Check all cron-type jobs against the current time. */
  private checkCronJobs(): void {
    const now = new Date();
    for (const job of this.jobs.values()) {
      if (job.type === "cron" && job.enabled && cronMatches(job.schedule, now)) {
        // Avoid double-triggering within the same minute
        if (job.lastRun) {
          const lastRun = new Date(job.lastRun);
          if (now.getTime() - lastRun.getTime() < 60000) continue;
        }
        this.triggerJob(job);
      }
    }
  }

  /** Persist jobs to disk. */
  private saveJobs(): void {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const data = Array.from(this.jobs.values());
    fs.writeFileSync(JOBS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  /** Load jobs from disk. */
  private loadJobs(): void {
    try {
      const raw = fs.readFileSync(JOBS_FILE, "utf-8");
      const data = JSON.parse(raw) as CronJob[];
      for (const job of data) {
        // Skip expired one-time jobs
        if (job.type === "once" && new Date(job.schedule).getTime() < Date.now()) continue;
        this.jobs.set(job.id, job);
      }
    } catch {
      // No jobs file yet — that's fine
    }
  }
}
