/**
 * Configuration loader.
 *
 * Phase 3: supports multiple LLM providers via ProviderConfigType.
 * Backwards-compatible with old Azure-only .env vars.
 *
 * Provider selection priority:
 *   1. PROVIDER_NAME env var (e.g., "openai", "azure-openai")
 *   2. Auto-detect from available env vars (AZURE_* → azure-openai, OPENAI_* → openai)
 *   3. Default to "azure-openai" for backwards compatibility
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
    name: "azure-openai",
    endpoint: "",
    apiKey: "",
    model: "gpt-4o",
    extras: { apiVersion: "2024-10-21" },
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
 * Priority: config.json > .env > defaults.
 */
export function loadConfig(): AppConfig {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    return mergeConfig(saved);
  }

  const config = configFromEnv();
  saveConfig(config);
  return config;
}

/** Save the current config to data/config.json */
export function saveConfig(config: AppConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

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

/** Detect which provider to use based on available env vars */
function detectProviderName(): string {
  // Explicit override
  if (process.env.PROVIDER_NAME) {
    return process.env.PROVIDER_NAME.toLowerCase();
  }
  // Auto-detect
  if (process.env.AZURE_OPENAI_ENDPOINT || process.env.AZURE_OPENAI_API_KEY) {
    return "azure-openai";
  }
  if (process.env.OPENAI_API_KEY) {
    return "openai";
  }
  return "azure-openai"; // backwards compat default
}

/** Build provider config from env vars based on provider name */
function providerFromEnv(): AppConfig["provider"] {
  const name = detectProviderName();

  switch (name) {
    case "azure-openai":
    case "azure": {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_API_KEY;
      const model = process.env.AZURE_OPENAI_DEPLOYMENT_NAME;
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION;

      const missing: string[] = [];
      if (!endpoint) missing.push("AZURE_OPENAI_ENDPOINT");
      if (!apiKey) missing.push("AZURE_OPENAI_API_KEY");
      if (!model) missing.push("AZURE_OPENAI_DEPLOYMENT_NAME");
      if (missing.length > 0) {
        console.error(`Missing env vars for azure-openai: ${missing.join(", ")}`);
        process.exit(1);
      }

      return {
        name: "azure-openai",
        endpoint: endpoint!,
        apiKey: apiKey!,
        model: model!,
        extras: { apiVersion: apiVersion || "2024-10-21" },
      };
    }

    case "openai":
    case "groq":
    case "together":
    case "ollama":
    case "lmstudio":
    default: {
      // Generic OpenAI-compatible
      const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || "";
      const endpoint = process.env.OPENAI_BASE_URL || process.env.LLM_ENDPOINT || "";
      const model = process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4o";

      if (!apiKey && name !== "ollama" && name !== "lmstudio") {
        console.error(`Missing OPENAI_API_KEY or LLM_API_KEY for provider "${name}".`);
        process.exit(1);
      }

      return {
        name: name === "azure" ? "azure-openai" : (["groq", "together", "ollama", "lmstudio"].includes(name) ? "openai" : name),
        endpoint: endpoint || undefined,
        apiKey: apiKey || "not-needed",
        model,
      };
    }
  }
}

/** Build config from environment variables + defaults */
function configFromEnv(): AppConfig {
  return {
    ...DEFAULTS,
    provider: providerFromEnv(),
    channels: {
      cli: { enabled: true },
      telegram: {
        enabled: !!process.env.TELEGRAM_BOT_TOKEN,
        token: process.env.TELEGRAM_BOT_TOKEN || "",
      },
    },
  };
}

/** Merge a partial saved config with defaults and .env. */
function mergeConfig(saved: Partial<AppConfig>): AppConfig {
  // Build provider from env (always source of truth for secrets)
  const envProvider = providerFromEnv();

  // Merge saved non-secret fields with env secrets
  const provider: AppConfig["provider"] = {
    name: saved.provider?.name || envProvider.name,
    endpoint: saved.provider?.endpoint || envProvider.endpoint,
    apiKey: envProvider.apiKey, // always from env
    model: saved.provider?.model
      // Handle old config format that used "deploymentName" instead of "model"
      || (saved.provider as Record<string, string> | undefined)?.deploymentName
      || envProvider.model,
    extras: { ...envProvider.extras, ...saved.provider?.extras },
  };

  const telegramToken = process.env.TELEGRAM_BOT_TOKEN || "";

  return {
    persona: saved.persona ?? DEFAULTS.persona,
    provider,
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
    mcpServers: saved.mcpServers,
    security: saved.security,
  };
}
