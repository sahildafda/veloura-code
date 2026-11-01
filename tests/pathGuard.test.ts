import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PathGuard } from "../src/security/pathGuard.js";

describe("PathGuard Traversal Prevention", () => {
  let projectDir: string;
  let guard: PathGuard;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-path-test-"));
    guard = new PathGuard(projectDir);
  });

  afterEach(() => {
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
    } catch {}
  });

  it("should allow safe relative paths inside the project", () => {
    const { safePath, relativePath } = guard.resolveSafe("src/index.ts");
    expect(safePath).toBe(path.join(projectDir, "src", "index.ts"));
    expect(relativePath).toBe(path.join("src", "index.ts"));
  });

  it("should block upward path traversal attempts (../)", () => {
    expect(() => guard.resolveSafe("../../Windows/System32/cmd.exe")).toThrow(/Path traversal denied/);
    expect(() => guard.resolveSafe("../secrets.json")).toThrow(/Path traversal denied/);
  });

  it("should reject paths containing null bytes", () => {
    expect(() => guard.resolveSafe("valid.txt\0evil.exe")).toThrow(/null byte/);
  });

  it("should block absolute paths outside project root", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\notepad.exe" : "/etc/passwd";
    expect(() => guard.resolveSafe(outside)).toThrow(/Path traversal denied/);
  });
});
