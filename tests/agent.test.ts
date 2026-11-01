import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import { AgentEngine } from "../src/agent/engine.js";
import { ContextManager } from "../src/agent/context.js";
import { ToolRegistry } from "../src/tools/registry.js";
import { createFileTools } from "../src/tools/fileTools.js";
import { createTerminalTools } from "../src/tools/terminalTools.js";
import { createGitTools } from "../src/tools/gitTools.js";
import { createProjectTools } from "../src/tools/projectTools.js";
import { FileEditor } from "../src/fs/editor.js";
import { FileSearchEngine } from "../src/fs/search.js";
import { TerminalRunner } from "../src/terminal/runner.js";
import { GitManager } from "../src/git/git.js";
import { ProjectDetector } from "../src/project/detector.js";
import { ProjectMapper } from "../src/project/mapper.js";
import { PrivacyManager } from "../src/security/privacy.js";
import { LocalDatabase } from "../src/db/database.js";
import { ModelRegistry } from "../src/ai/models.js";
import { ModelRouter } from "../src/ai/router.js";
import { OpenRouterClient } from "../src/ai/openrouter.js";
import { DEFAULT_CONFIG } from "../src/config/config.js";
import { getVelouraPaths } from "../src/config/paths.js";

describe("Autonomous Agent Engine Integration", () => {
  let projectDir: string;
  let dataDir: string;
  let db: LocalDatabase;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-agent-proj-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-agent-data-"));
    const paths = getVelouraPaths(dataDir, dataDir);
    db = new LocalDatabase(paths.dbFile);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  });

  it("should autonomously execute multi-tool coding loop with mock AI responses", async () => {
    const paths = getVelouraPaths(dataDir, dataDir);
    const privacy = new PrivacyManager(DEFAULT_CONFIG, paths, projectDir);
    const editor = new FileEditor(projectDir, privacy, db);
    const searchEngine = new FileSearchEngine(projectDir, privacy);
    const runner = new TerminalRunner(projectDir);
    const gitManager = new GitManager(projectDir, db);
    const detector = new ProjectDetector(projectDir);
    const mapper = new ProjectMapper(projectDir, privacy);
    const contextManager = new ContextManager(privacy, DEFAULT_CONFIG);
    const registry = new ModelRegistry(dataDir);
    const router = new ModelRouter(registry, db, DEFAULT_CONFIG);

    const toolRegistry = new ToolRegistry();
    for (const t of [
      ...createFileTools(editor, searchEngine),
      ...createTerminalTools(runner, detector),
      ...createGitTools(gitManager),
      ...createProjectTools(detector, projectDir),
    ]) {
      toolRegistry.register(t);
    }

    // Mock OpenRouterClient responses
    let turn = 0;
    const mockOpenRouterClient = {
      completeWithFallback: vi.fn().mockImplementation(async () => {
        turn++;
        if (turn === 1) {
          // Model wants to create a file
          return {
            content: "I will create a greeting utility file.",
            toolCalls: [
              {
                id: "call_1",
                name: "write_file",
                arguments: {
                  path: "src/greet.ts",
                  content: "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n",
                  description: "Create greet function",
                },
              },
            ],
            modelUsed: "openrouter/free",
            promptTokens: 150,
            completionTokens: 80,
            latencyMs: 300,
          };
        } else {
          // Model finishes task
          return {
            content: "Task completed: Created src/greet.ts with greet(name) function.",
            toolCalls: [],
            modelUsed: "openrouter/free",
            promptTokens: 250,
            completionTokens: 40,
            latencyMs: 250,
          };
        }
      }),
    } as unknown as OpenRouterClient;

    const engine = new AgentEngine({
      projectRoot: projectDir,
      config: { ...DEFAULT_CONFIG, autoVerify: false, autoCheckpoint: false },
      db,
      toolRegistry,
      modelRouter: router,
      openRouterClient: mockOpenRouterClient,
      projectMapper: mapper,
      gitManager,
      contextManager,
    });

    const summary = await engine.runTask("Create a greeting module in src/greet.ts");

    expect(summary.state).toBe("Completed");
    expect(summary.iterations).toBe(2);
    expect(summary.toolsExecuted).toBe(1);
    expect(summary.filesModified).toContain("src/greet.ts");

    // Verify file actually created on disk
    const createdFile = path.join(projectDir, "src", "greet.ts");
    expect(fs.existsSync(createdFile)).toBe(true);
    const content = fs.readFileSync(createdFile, "utf8");
    expect(content).toContain("Hello, ${name}!");
  });

  it("should prevent secret leakage from appearing in AI context messages", () => {
    const paths = getVelouraPaths(dataDir, dataDir);
    const privacy = new PrivacyManager(DEFAULT_CONFIG, paths, projectDir);
    const contextManager = new ContextManager(privacy, DEFAULT_CONFIG);

    const rawApiKey = ["sk", "or", "v1", "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"].join("-");
    const dirtyMessages = [
      { role: "system" as const, content: "You are Veloura." },
      { role: "user" as const, content: `Please review my config with key: ${rawApiKey}` },
    ];

    const clean = contextManager.sanitizeMessages(dirtyMessages);
    expect(clean[1].content).not.toContain(rawApiKey);
    expect(clean[1].content).toContain("[REDACTED: OpenRouter API Key]");
  });
});
