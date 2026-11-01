import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ModelRouter } from "../src/ai/router.js";
import { ModelRegistry } from "../src/ai/models.js";
import { LocalDatabase } from "../src/db/database.js";
import { DEFAULT_CONFIG } from "../src/config/config.js";
import { getVelouraPaths } from "../src/config/paths.js";

describe("ModelRouter & Intelligent Fallback", () => {
  let dataDir: string;
  let db: LocalDatabase;
  let registry: ModelRegistry;
  let router: ModelRouter;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-router-data-"));
    const paths = getVelouraPaths(dataDir, dataDir);
    db = new LocalDatabase(paths.dbFile);
    registry = new ModelRegistry(dataDir);
    router = new ModelRouter(registry, db, DEFAULT_CONFIG);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  });

  it("should classify task types accurately based on heuristics", () => {
    expect(router.classifyTask("Plan the microservice architecture")).toBe("planning");
    expect(router.classifyTask("Fix the null pointer exception in login")).toBe("debugging");
    expect(router.classifyTask("Write unit tests for the auth controller")).toBe("testing");
    expect(router.classifyTask("Refactor the payment gateway integration")).toBe("refactoring");
    expect(router.classifyTask("Create a new React navbar component")).toBe("code_generation");
    expect(router.classifyTask("Update the project README with setup instructions")).toBe("documentation");
  });

  it("should construct valid fallback chains ending with openrouter/free", () => {
    const freeModels = registry.getFreeModels();
    const chain = router.buildFallbackChain("qwen/qwen-2.5-coder-32b-instruct:free", freeModels);

    expect(chain.length).toBeGreaterThan(1);
    expect(chain).not.toContain("qwen/qwen-2.5-coder-32b-instruct:free");
    expect(chain[chain.length - 1]).toBe("openrouter/free");
  });

  it("should honor manual user model override", () => {
    const decision = router.selectModel("Write a quick script", "meta-llama/llama-3.3-70b-instruct:free");
    expect(decision.selectedModel.id).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(decision.reason).toContain("Manually requested by user");
  });
});
