import { ModelRegistry, OpenRouterModel } from "./models.js";
import { LocalDatabase } from "../db/database.js";
import { VelouraConfig } from "../config/config.js";

export type TaskCategory =
  | "planning"
  | "code_generation"
  | "code_editing"
  | "debugging"
  | "refactoring"
  | "testing"
  | "code_review"
  | "documentation"
  | "architecture_analysis";

export interface RoutingDecision {
  selectedModel: OpenRouterModel;
  fallbackChain: string[];
  category: TaskCategory;
  reason: string;
}

export class ModelRouter {
  private registry: ModelRegistry;
  private db: LocalDatabase;
  private config: VelouraConfig;

  constructor(registry: ModelRegistry, db: LocalDatabase, config: VelouraConfig) {
    this.registry = registry;
    this.db = db;
    this.config = config;
  }

  /**
   * Classifies task using keyword heuristics and complexity analysis.
   */
  public classifyTask(description: string): TaskCategory {
    const lower = description.toLowerCase();

    if (/\b(plans?|design|roadmap|strategy|break down)\b/.test(lower)) {
      return "planning";
    }
    if (/\b(debug|fix|errors?|exceptions?|fails?|crash|bugs?|issues?)\b/.test(lower)) {
      return "debugging";
    }
    if (/\b(tests?|unit tests?|integration tests?|vitest|jest|pytest)\b/.test(lower)) {
      return "testing";
    }
    if (/\b(refactor|clean up|restructure|optimize|simplify)\b/.test(lower)) {
      return "refactoring";
    }
    if (/\b(review|audit|inspect|security check)\b/.test(lower)) {
      return "code_review";
    }
    if (/\b(docs?|readme|comments?|document|api docs)\b/.test(lower)) {
      return "documentation";
    }
    if (/\b(architect|structure|patterns?|scaffold)\b/.test(lower)) {
      return "architecture_analysis";
    }
    if (/\b(edit|modify|update|change|add to|patch)\b/.test(lower)) {
      return "code_editing";
    }

    return "code_generation";
  }

  /**
   * Builds an intelligent fallback chain and selects the optimal model for the task.
   */
  public selectModel(
    taskDescription: string,
    manualOverrideModelId?: string
  ): RoutingDecision {
    const category = this.classifyTask(taskDescription);
    const availableFreeModels = this.registry.getFreeModels();
    const allModels = this.registry.getCachedModels();

    // 1. Manual user override takes top priority
    if (manualOverrideModelId) {
      const match = allModels.find((m) => m.id === manualOverrideModelId);
      const selected = match || {
        id: manualOverrideModelId,
        name: manualOverrideModelId,
        context_length: 32768,
        pricing: { prompt: "0", completion: "0" },
        isFree: manualOverrideModelId.endsWith(":free"),
        supportsTools: true,
      };

      return {
        selectedModel: selected,
        fallbackChain: this.buildFallbackChain(selected.id, availableFreeModels),
        category,
        reason: `Manually requested by user: ${selected.id}`,
      };
    }

    // 2. If configured default model is not openrouter/free, try it first
    if (this.config.defaultModel && this.config.defaultModel !== "openrouter/free") {
      const configured = allModels.find((m) => m.id === this.config.defaultModel);
      if (configured) {
        return {
          selectedModel: configured,
          fallbackChain: this.buildFallbackChain(configured.id, availableFreeModels),
          category,
          reason: `Configured default model: ${configured.id}`,
        };
      }
    }

    // 3. Category-specific intelligent selection among free models
    // High capability free coding models preferred for generation, editing, debugging
    const codingPreferred = [
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "deepseek/deepseek-r1:free",
      "mistralai/mistral-small-24b-instruct-2501:free",
      "openrouter/free",
    ];

    const reasoningPreferred = [
      "deepseek/deepseek-r1:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "openrouter/free",
    ];

    const targetPreference =
      category === "planning" || category === "architecture_analysis"
        ? reasoningPreferred
        : codingPreferred;

    let selectedModel: OpenRouterModel | undefined;

    for (const modelId of targetPreference) {
      const candidate = availableFreeModels.find((m) => m.id === modelId);
      if (candidate) {
        // Check historical metrics if model has a high failure rate recently
        const metrics = this.db.getModelMetrics(candidate.id);
        if (metrics && metrics.failed_calls > 3 && metrics.failed_calls > metrics.successful_calls * 2) {
          // Skip if failing persistently
          continue;
        }
        selectedModel = candidate;
        break;
      }
    }

    // If still none found, take first free model or default
    if (!selectedModel) {
      selectedModel = availableFreeModels[0] || {
        id: "openrouter/free",
        name: "OpenRouter Free Router",
        context_length: 32768,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      };
    }

    return {
      selectedModel,
      fallbackChain: this.buildFallbackChain(selectedModel.id, availableFreeModels),
      category,
      reason: `Intelligently routed for '${category}' task`,
    };
  }

  /**
   * Constructs the ordered list of fallback model IDs.
   */
  public buildFallbackChain(primaryModelId: string, availableModels: OpenRouterModel[]): string[] {
    const candidateIds = [
      "qwen/qwen-2.5-coder-32b-instruct:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "google/gemini-2.0-flash-exp:free",
      "mistralai/mistral-small-24b-instruct-2501:free",
      "deepseek/deepseek-r1:free",
      "openrouter/free",
    ];

    const chain: string[] = [];
    for (const id of candidateIds) {
      if (id !== primaryModelId && !chain.includes(id)) {
        chain.push(id);
      }
    }

    // Ensure openrouter/free is always at the end
    if (!chain.includes("openrouter/free") && primaryModelId !== "openrouter/free") {
      chain.push("openrouter/free");
    }

    return chain;
  }
}
