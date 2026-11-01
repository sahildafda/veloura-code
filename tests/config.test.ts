import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConfigManager, ConfigSchema } from "../src/config/config.js";
import { getVelouraPaths } from "../src/config/paths.js";

describe("Configuration and Paths", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-config-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should validate default configuration using Zod schema", () => {
    const valid = ConfigSchema.parse({});
    expect(valid.provider).toBe("openrouter");
    expect(valid.defaultModel).toBe("openrouter/free");
    expect(valid.privacyMode).toBe("standard");
    expect(valid.maxIterations).toBe(50);
    expect(valid.autoFallback).toBe(true);
    expect(valid.autoCheckpoint).toBe(true);
  });

  it("should reject invalid configuration values", () => {
    expect(() =>
      ConfigSchema.parse({
        maxIterations: -5,
      })
    ).toThrow();

    expect(() =>
      ConfigSchema.parse({
        privacyMode: "invalid_mode",
      })
    ).toThrow();
  });

  it("should save and load configuration updates correctly", () => {
    const paths = getVelouraPaths(tempDir, tempDir);
    const mgr = new ConfigManager(paths);

    mgr.save({ defaultModel: "qwen/qwen-2.5-coder-32b-instruct:free", maxIterations: 30 });
    const loaded = mgr.get();

    expect(loaded.defaultModel).toBe("qwen/qwen-2.5-coder-32b-instruct:free");
    expect(loaded.maxIterations).toBe(30);

    // Toggle privacy mode
    mgr.setPrivacyMode("strict");
    expect(mgr.get().privacyMode).toBe("strict");
    expect(mgr.get().requireCodeApproval).toBe(true);

    // Reset configuration
    mgr.reset();
    expect(mgr.get().defaultModel).toBe("openrouter/free");
    expect(mgr.get().privacyMode).toBe("standard");
  });
});
