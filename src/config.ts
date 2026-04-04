/**
 * Configuration loader.
 *
 * Phase 4: supports two config sources with fallback:
 * 1. `data/config.json` — persistent config file (preferred)
 * 2. `.env` — environment variables (fallback for provider credentials)
 *
 * On first run, if no config.json exists, we create one from .env values.
 * This lets you start with just a .env file, then customize via /config.
 *
 * Key concepts:
 * - `fs.readFileSync` / `fs.writeFileSync`: synchronous file I/O.
 *   Fine for config loading at startup (only happens once).
 * - JSON.parse / JSON.stringify: convert between JS objects and JSON text.
 * - Default values: we merge user config with defaults so missing fields
 *   don't crash the app.
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "./types.js";

const CONFIG_DIR = path.resolve("data");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

/** Default configuration values */
const DEFAULTS: AppConfig = {
  persona: "You are NanoBot, a helpful personal assistant. Be concise and friendly. You have access to tools — use them when appropriate.",
  provider: {
    endpoint: "",
    apiKey: "",
    deploymentName: "gpt-4o",
    apiVersion: "2024-10-21",
  },
  agent: {
    maxIterations: 200,
    temperature: 0.7,
    maxTokens: 2000,
  },
  channels: {
    cli: { enabled: true },
    telegram: { enabled: false, token: "" },
  },
};

/**
 * Load the app config.
 *
 * Priority: config.json > .env > defaults.
 * If config.json doesn't exist, creates one from .env + defaults.
 */
export function loadConfig(): AppConfig {
  // Ensure data directory exists
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Try loading existing config.json
  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    return mergeConfig(saved);
  }

  // No config.json — build from .env and save
  const config = configFromEnv();
  saveConfig(config);
  return config;
}

/** Save the current config to data/config.json */
export function saveConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Don't write secrets to the config file — keep them in .env only
  const toSave = {
    ...config,
    provider: {
      ...config.provider,
      apiKey: "(loaded from .env)",
    },
    channels: {
      ...config.channels,
      telegram: {
        ...config.channels.telegram,
        token: config.channels.telegram.token ? "(loaded from .env)" : "",
      },
    },
  };

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2), "utf-8");
}

/** Build config from environment variables + defaults */
function configFromEnv(): AppConfig {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

  // Validate required env vars
  const missing: string[] = [];
  if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
  if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
  if (!deploymentName) missing.push("AZURE_OPENAI_DEPLOYMENT_NAME");

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.join(", ")}`);
    console.error("Please fill in your .env file.");
    process.exit(1);
  }

  return {
    ...DEFAULTS,
    provider: {
      endpoint: endpoint!,
      apiKey: apiKey!,
      deploymentName: deploymentName!,
      apiVersion: apiVersion || DEFAULTS.provider.apiVersion,
    },
    channels: {
      cli: { enabled: true },
      telegram: {
        enabled: !!process.env.TELEGRAM_BOT_TOKEN,
        token: process.env.TELEGRAM_BOT_TOKEN || "",
      },
    },
  };
}

/**
 * Merge a partial saved config with defaults and .env.
 * The API key always comes from .env for security.
 */
function mergeConfig(saved: Partial<AppConfig>): AppConfig {
  const envApiKey = process.env.AZURE_OPENAI_API_KEY;
  if (!envApiKey) {
    console.error("Missing AZURE_OPENAI_API_KEY in .env file.");
    process.exit(1);
  }

  // Always load secrets from .env — the saved config has placeholder strings
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";

  return {
    persona: saved.persona ?? DEFAULTS.persona,
    provider: {
      endpoint: saved.provider?.endpoint || process.env.AZURE_OPENAI_ENDPOINT || DEFAULTS.provider.endpoint,
      apiKey: envApiKey,
      deploymentName: saved.provider?.deploymentName || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || DEFAULTS.provider.deploymentName,
      apiVersion: saved.provider?.apiVersion || process.env.AZURE_OPENAI_API_VERSION || DEFAULTS.provider.apiVersion,
    },
    agent: {
      maxIterations: saved.agent?.maxIterations ?? DEFAULTS.agent.maxIterations,
      temperature: saved.agent?.temperature ?? DEFAULTS.agent.temperature,
      maxTokens: saved.agent?.maxTokens ?? DEFAULTS.agent.maxTokens,
    },
    channels: {
      cli: { enabled: saved.channels?.cli?.enabled ?? DEFAULTS.channels.cli.enabled },
      telegram: {
        enabled: saved.channels?.telegram?.enabled ?? !!telegramToken,
        token: telegramToken,
      },
    },
  };
}
