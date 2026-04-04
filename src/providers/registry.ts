/**
 * ProviderRegistry — Factory for creating LLM providers by name.
 *
 * Maps provider names/keywords to factory functions. When the user
 * specifies a provider in config (e.g., "azure-openai", "openai"),
 * the registry creates the correct provider instance.
 */

import { LLMProvider, ProviderConfig, GenerationSettings } from "./base.js";

/** A registered provider factory */
interface ProviderSpec {
  /** Canonical name (e.g., "azure-openai") */
  name: string;
  /** Keywords that match this provider (e.g., ["azure", "azure-openai"]) */
  keywords: string[];
  /** Factory function to create the provider (may be async for dynamic imports) */
  create: (config: ProviderConfig, settings: GenerationSettings) => Promise<LLMProvider>;
}

export class ProviderRegistry {
  private specs: ProviderSpec[] = [];

  /** Register a provider factory. */
  register(spec: ProviderSpec): void {
    this.specs.push(spec);
  }

  /**
   * Find a provider spec by name or keyword.
   * Matches against both the canonical name and keywords (case-insensitive).
   */
  find(nameOrKeyword: string): ProviderSpec | undefined {
    const lower = nameOrKeyword.toLowerCase();
    return this.specs.find(
      (s) =>
        s.name.toLowerCase() === lower ||
        s.keywords.some((k) => k.toLowerCase() === lower),
    );
  }

  /**
   * Create a provider instance by name.
   * Throws if the provider name is not recognized.
   */
  async create(config: ProviderConfig, settings: GenerationSettings): Promise<LLMProvider> {
    const spec = this.find(config.name);
    if (!spec) {
      const available = this.specs.map((s) => s.name).join(", ");
      throw new Error(
        `Unknown provider "${config.name}". Available: ${available}`,
      );
    }
    return spec.create(config, settings);
  }

  /** List all registered provider names. */
  listProviders(): string[] {
    return this.specs.map((s) => s.name);
  }
}

/** Create and populate the default provider registry. */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  // Azure OpenAI
  registry.register({
    name: "azure-openai",
    keywords: ["azure", "azureopenai"],
    create: async (config, settings) => {
      const { AzureOpenAIProvider } = await import("./azure-openai.js");
      return new AzureOpenAIProvider(config, settings);
    },
  });

  // OpenAI-compatible (covers OpenAI, Groq, Together, local LLMs, etc.)
  registry.register({
    name: "openai",
    keywords: ["openai-compat", "groq", "together", "local", "ollama", "lmstudio"],
    create: async (config, settings) => {
      const { OpenAICompatProvider } = await import("./openai-compat.js");
      return new OpenAICompatProvider(config, settings);
    },
  });

  return registry;
}
