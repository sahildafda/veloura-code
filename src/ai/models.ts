import fs from "node:fs";
import path from "node:path";
import { getVelouraPaths } from "../config/paths.js";

export interface OpenRouterModelPricing {
  prompt: string;
  completion: string;
  image?: string;
  request?: string;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  description?: string;
  context_length: number;
  pricing: OpenRouterModelPricing;
  isFree: boolean;
  supportsTools: boolean;
}

export class ModelRegistry {
  private cacheFile: string;
  private cachedModels: OpenRouterModel[] = [];
  private lastFetched = 0;

  constructor(customCacheDir?: string) {
    const paths = getVelouraPaths(customCacheDir);
    this.cacheFile = path.join(paths.dataDir, "models_cache.json");
    this.loadCache();
  }

  private loadCache(): void {
    if (fs.existsSync(this.cacheFile)) {
      try {
        const raw = fs.readFileSync(this.cacheFile, "utf8");
        const parsed = JSON.parse(raw);
        this.cachedModels = parsed.models || [];
        this.lastFetched = parsed.lastFetched || 0;
      } catch {
        this.cachedModels = [];
      }
    }
  }

  private saveCache(): void {
    try {
      const data = {
        lastFetched: this.lastFetched,
        models: this.cachedModels,
      };
      fs.writeFileSync(this.cacheFile, JSON.stringify(data, null, 2), "utf8");
    } catch {
      // Ignored
    }
  }

  /**
   * Fetches the latest models directly from OpenRouter API.
   */
  public async fetchModels(apiKey?: string | null, forceRefresh = false): Promise<OpenRouterModel[]> {
    const oneHour = 3600_000;
    if (!forceRefresh && this.cachedModels.length > 0 && Date.now() - this.lastFetched < oneHour) {
      return this.cachedModels;
    }

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (apiKey) {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }

      const res = await fetch("https://openrouter.ai/api/v1/models", {
        method: "GET",
        headers,
      });

      if (!res.ok) {
        throw new Error(`OpenRouter API returned HTTP ${res.status}: ${res.statusText}`);
      }

      const body = (await res.json()) as { data: any[] };
      const rawList = body.data || [];

      const parsedModels: OpenRouterModel[] = rawList.map((m: any) => {
        const promptPrice = m.pricing?.prompt ? String(m.pricing.prompt) : "0";
        const completionPrice = m.pricing?.completion ? String(m.pricing.completion) : "0";

        const isFree =
          m.id.endsWith(":free") ||
          (promptPrice === "0" && completionPrice === "0");

        // Tool calling support is indicated in supported_parameters or architecture
        const supportedParams: string[] = m.supported_parameters || [];
        const supportsTools =
          supportedParams.includes("tools") ||
          supportedParams.includes("function_calling") ||
          m.id.includes("gpt") ||
          m.id.includes("claude") ||
          m.id.includes("mistral") ||
          m.id.includes("qwen") ||
          m.id.includes("llama-3");

        return {
          id: m.id,
          name: m.name || m.id,
          description: m.description,
          context_length: m.context_length || 4096,
          pricing: {
            prompt: promptPrice,
            completion: completionPrice,
          },
          isFree,
          supportsTools,
        };
      });

      // Sort free models first, then by name
      parsedModels.sort((a, b) => {
        if (a.isFree && !b.isFree) return -1;
        if (!a.isFree && b.isFree) return 1;
        return a.name.localeCompare(b.name);
      });

      this.cachedModels = parsedModels;
      this.lastFetched = Date.now();
      this.saveCache();

      return parsedModels;
    } catch (err: any) {
      // If network fails but we have cached models, return cache
      if (this.cachedModels.length > 0) {
        return this.cachedModels;
      }
      // Return known fallback list of free models
      return this.getHardcodedFallbackModels();
    }
  }

  public getCachedModels(): OpenRouterModel[] {
    if (this.cachedModels.length === 0) {
      return this.getHardcodedFallbackModels();
    }
    return this.cachedModels;
  }

  public getFreeModels(): OpenRouterModel[] {
    return this.getCachedModels().filter((m) => m.isFree);
  }

  public getModelById(modelId: string): OpenRouterModel | undefined {
    return this.getCachedModels().find((m) => m.id === modelId);
  }

  private getHardcodedFallbackModels(): OpenRouterModel[] {
    return [
      {
        id: "openrouter/free",
        name: "OpenRouter Free Router",
        description: "Automatic free model router provided by OpenRouter",
        context_length: 32768,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      },
      {
        id: "meta-llama/llama-3.3-70b-instruct:free",
        name: "Llama 3.3 70B Instruct (Free)",
        description: "Meta's flagship 70B parameter open weights model",
        context_length: 131072,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      },
      {
        id: "qwen/qwen-2.5-coder-32b-instruct:free",
        name: "Qwen 2.5 Coder 32B Instruct (Free)",
        description: "State-of-the-art open code generation model",
        context_length: 32768,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      },
      {
        id: "mistralai/mistral-small-24b-instruct-2501:free",
        name: "Mistral Small 24B Instruct (Free)",
        description: "High performance compact model by Mistral AI",
        context_length: 32768,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      },
      {
        id: "google/gemini-2.0-flash-exp:free",
        name: "Gemini 2.0 Flash Experimental (Free)",
        description: "Google's next-gen multimodal fast model",
        context_length: 1048576,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      },
      {
        id: "deepseek/deepseek-r1:free",
        name: "DeepSeek R1 (Free)",
        description: "High capability reasoning model",
        context_length: 65536,
        pricing: { prompt: "0", completion: "0" },
        isFree: true,
        supportsTools: true,
      },
    ];
  }
}
