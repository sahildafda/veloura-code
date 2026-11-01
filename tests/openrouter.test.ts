import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { OpenRouterClient } from "../src/ai/openrouter.js";
import { LocalDatabase } from "../src/db/database.js";
import { DEFAULT_CONFIG } from "../src/config/config.js";
import { getVelouraPaths } from "../src/config/paths.js";

describe("OpenRouterClient Response & Error Handling", () => {
  let dataDir: string;
  let db: LocalDatabase;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-openrouter-test-"));
    const paths = getVelouraPaths(dataDir, dataDir);
    db = new LocalDatabase(paths.dbFile);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  });

  it("should gracefully handle response with error payload instead of crashing on choices[0]", async () => {
    const client = new OpenRouterClient({
      apiKey: "test-api-key",
      db,
      config: { ...DEFAULT_CONFIG, autoFallback: false },
    });

    // Mock create returning an error body with no choices
    (client as any).openai = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            id: "gen-error",
            error: {
              message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
              code: 429,
            },
          }),
        },
      },
    };

    await expect(
      client.completeWithFallback({
        messages: [{ role: "user", content: "Hello" }],
        primaryModel: "qwen/qwen-2.5-coder-32b-instruct:free",
        fallbackChain: [],
      })
    ).rejects.toThrow(/Rate limit exceeded: free-models-per-day/);
  });

  it("should fail fast when free-models-per-day is encountered with all-free fallback chain", async () => {
    const client = new OpenRouterClient({
      apiKey: "test-api-key",
      db,
      config: { ...DEFAULT_CONFIG, autoFallback: true },
    });

    const createMock = vi.fn().mockResolvedValue({
      error: {
        message: "Rate limit exceeded: free-models-per-day. Add 10 credits to unlock 1000 free model requests per day",
        code: 429,
      },
    });

    (client as any).openai = {
      chat: {
        completions: {
          create: createMock,
        },
      },
    };

    await expect(
      client.completeWithFallback({
        messages: [{ role: "user", content: "Hello" }],
        primaryModel: "qwen/qwen-2.5-coder-32b-instruct:free",
        fallbackChain: [
          "meta-llama/llama-3.3-70b-instruct:free",
          "openrouter/free",
        ],
      })
    ).rejects.toThrow(/429 Rate limit exceeded: free-models-per-day/);

    // Notice: It should NOT try the remaining free models (only 1 attempt)
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("should throw descriptive error when response has empty choices array", async () => {
    const client = new OpenRouterClient({
      apiKey: "test-api-key",
      db,
      config: { ...DEFAULT_CONFIG, autoFallback: false },
    });

    (client as any).openai = {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            id: "gen-empty",
            choices: [],
          }),
        },
      },
    };

    await expect(
      client.completeWithFallback({
        messages: [{ role: "user", content: "Hello" }],
        primaryModel: "qwen/qwen-2.5-coder-32b-instruct:free",
        fallbackChain: [],
      })
    ).rejects.toThrow(/without choices/);
  });
});
