import OpenAI from "openai";
import { LocalDatabase } from "../db/database.js";
import { VelouraConfig } from "../config/config.js";

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: any;
}

export interface ModelCompletionResult {
  content: string | null;
  toolCalls: ToolCallRequest[];
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  switchedFrom?: string;
}

export interface OpenRouterClientOptions {
  apiKey: string;
  db: LocalDatabase;
  config: VelouraConfig;
  onModelSwitch?: (fromModel: string, toModel: string, reason: string) => void;
  onChunk?: (token: string) => void;
}

export class OpenRouterClient {
  private openai: OpenAI;
  private db: LocalDatabase;
  private config: VelouraConfig;
  private onModelSwitch?: (fromModel: string, toModel: string, reason: string) => void;
  private onChunk?: (token: string) => void;

  constructor(options: OpenRouterClientOptions) {
    this.db = options.db;
    this.config = options.config;
    this.onModelSwitch = options.onModelSwitch;
    this.onChunk = options.onChunk;
    this.openai = this.createOpenAIInstance(options.apiKey, options.config.baseUrl);
  }

  public updateCredentials(apiKey: string, baseUrl?: string): void {
    if (baseUrl !== undefined) {
      this.config.baseUrl = baseUrl;
    }
    this.openai = this.createOpenAIInstance(apiKey, this.config.baseUrl);
  }

  private createOpenAIInstance(apiKey: string, baseUrl?: string): OpenAI {
    return new OpenAI({
      apiKey: apiKey || "dummy-key-for-local",
      baseURL: baseUrl || "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/veloura-code",
        "X-Title": "Veloura Code",
      },
      timeout: this.config.timeoutMs || 60000,
      maxRetries: 0, // We handle retries and fallback explicitly
    });
  }

  /**
   * Completes a conversation with tool calling, with automatic model fallback on errors.
   */
  public async completeWithFallback(params: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    primaryModel: string;
    fallbackChain: string[];
    abortSignal?: AbortSignal;
  }): Promise<ModelCompletionResult> {
    const modelsToTry = [params.primaryModel, ...params.fallbackChain];
    let lastError: any = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      const isFallback = i > 0;

      if (isFallback && this.onModelSwitch) {
        this.onModelSwitch(
          modelsToTry[i - 1],
          currentModel,
          lastError?.message || "Rate limit or connection failure"
        );
      }

      try {
        const result = await this.attemptCompletion({
          messages: params.messages,
          tools: params.tools,
          model: currentModel,
          abortSignal: params.abortSignal,
        });

        // Record success metrics
        this.db.recordModelUsage({
          modelId: currentModel,
          success: true,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          latencyMs: result.latencyMs,
        });

        if (isFallback) {
          result.switchedFrom = params.primaryModel;
        }

        return result;
      } catch (err: any) {
        lastError = err;

        // Record error metrics
        this.db.recordModelUsage({
          modelId: currentModel,
          success: false,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          error: err.message,
        });

        const isAbort = params.abortSignal?.aborted || err.name === "AbortError";
        if (isAbort) {
          throw err;
        }

        // Check for OpenRouter daily free tier limit
        const errMsg = String(err.message || "");
        const isFreeLimit =
          errMsg.includes("free-models-per-day") ||
          (errMsg.includes("429") && errMsg.includes("free-models"));

        if (isFreeLimit) {
          // Check if any remaining models in the chain are NON-free models
          const remainingNonFree = modelsToTry
            .slice(i + 1)
            .filter((m) => !m.endsWith(":free") && m !== "openrouter/free");

          if (remainingNonFree.length === 0) {
            // All remaining fallback models are free models!
            // Trying them will all fail with the exact same 429 quota error.
            throw new Error(
              `429 Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day`
            );
          }
        }

        // If user disabled auto fallback, don't try next models
        if (!this.config.autoFallback) {
          throw err;
        }

        // Brief delay before trying next fallback model
        await new Promise((resolve) => setTimeout(resolve, 800));
      }
    }

    throw new Error(
      `All models in fallback chain failed. Last error: ${lastError?.message || "Unknown error"}`
    );
  }

  private async attemptCompletion(params: {
    messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
    tools?: OpenAI.Chat.Completions.ChatCompletionTool[];
    model: string;
    abortSignal?: AbortSignal;
  }): Promise<ModelCompletionResult> {
    const startTime = Date.now();

    const response = await this.openai.chat.completions.create(
      {
        model: params.model,
        messages: params.messages,
        tools: params.tools && params.tools.length > 0 ? params.tools : undefined,
        tool_choice: params.tools && params.tools.length > 0 ? "auto" : undefined,
        stream: false,
      },
      {
        signal: params.abortSignal,
      }
    );

    const latencyMs = Date.now() - startTime;
    const raw = response as any;

    // Check if OpenRouter or gateway returned an error payload in the response body
    if (raw?.error) {
      const errMsg =
        typeof raw.error === "string"
          ? raw.error
          : raw.error.message || JSON.stringify(raw.error);
      throw new Error(`OpenRouter API error: ${errMsg}`);
    }

    // Validate choices array exists and is non-empty
    if (!response || !Array.isArray(response.choices) || response.choices.length === 0) {
      const details = JSON.stringify(raw || {});
      throw new Error(
        `OpenRouter returned an invalid response without choices: ${details.slice(0, 300)}`
      );
    }

    const choice = response.choices[0];
    if ((choice as any)?.error) {
      const choiceErrMsg =
        (choice as any).error.message || JSON.stringify((choice as any).error);
      throw new Error(`OpenRouter completion error: ${choiceErrMsg}`);
    }

    const message = choice?.message;

    const toolCalls: ToolCallRequest[] = [];
    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        if (tc.type === "function") {
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(tc.function.arguments || "{}");
          } catch {
            parsedArgs = { raw: tc.function.arguments };
          }
          toolCalls.push({
            id: tc.id,
            name: tc.function.name,
            arguments: parsedArgs,
          });
        }
      }
    }

    return {
      content: message?.content || null,
      toolCalls,
      modelUsed: response.model || params.model,
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      latencyMs,
    };
  }
}
