import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { LocalDatabase } from "../src/db/database.js";

describe("SQLite Local Persistence", () => {
  let tempDir: string;
  let db: LocalDatabase;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-db-test-"));
    const dbPath = path.join(tempDir, "test.sqlite");
    db = new LocalDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("should create conversations and record messages", () => {
    const conv = db.createConversation("/test/project", "Test Conversation");
    expect(conv.id).toBeDefined();
    expect(conv.project_path).toBe("/test/project");

    const msg1 = db.addMessage(conv.id, "user", "Hello Veloura");
    const msg2 = db.addMessage(conv.id, "assistant", "Hello! How can I help with your code?");

    const messages = db.getMessages(conv.id);
    expect(messages.length).toBe(2);
    expect(messages[0].content).toBe("Hello Veloura");
    expect(messages[1].content).toBe("Hello! How can I help with your code?");
  });

  it("should create and update tasks with state transitions", () => {
    const conv = db.createConversation("/test/project");
    const task = db.createTask(conv.id, "/test/project", "Implement authentication");
    expect(task.state).toBe("Idle");

    db.updateTask(task.id, { state: "Executing", iteration_count: 5 });
    const updated = db.getTask(task.id);
    expect(updated?.state).toBe("Executing");
    expect(updated?.iteration_count).toBe(5);

    const latest = db.getLatestTask("/test/project");
    expect(latest?.id).toBe(task.id);
  });

  it("should store and retrieve project memory key-values", () => {
    db.setMemory("/test/project", "conventions", "code_style", "Prettier 2 spaces");
    db.setMemory("/test/project", "conventions", "framework", "React 19");

    const mem = db.getMemory("/test/project", "conventions");
    expect(mem.length).toBe(2);
    expect(mem.find((m) => m.key === "code_style")?.value).toBe("Prettier 2 spaces");

    // Overwrite existing key
    db.setMemory("/test/project", "conventions", "code_style", "ESLint Airbnb");
    const updatedMem = db.getMemory("/test/project", "conventions");
    expect(updatedMem.find((m) => m.key === "code_style")?.value).toBe("ESLint Airbnb");
  });

  it("should record model metrics and latency stats", () => {
    db.recordModelUsage({
      modelId: "test-model",
      success: true,
      promptTokens: 100,
      completionTokens: 50,
      latencyMs: 1200,
    });

    const metrics = db.getModelMetrics("test-model");
    expect(metrics).toBeDefined();
    expect(metrics?.total_calls).toBe(1);
    expect(metrics?.successful_calls).toBe(1);
    expect(metrics?.avg_latency_ms).toBe(1200);
  });
});
