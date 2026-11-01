import { describe, it, expect } from "vitest";
import { Patcher } from "../src/fs/patcher.js";

describe("Patcher & Unified Diff Engine", () => {
  it("should create valid unified diffs between two strings", () => {
    const original = "function add(a, b) {\n  return a - b;\n}\n";
    const modified = "function add(a, b) {\n  return a + b;\n}\n";

    const diffText = Patcher.createUnifiedDiff("math.js", original, modified);
    expect(diffText).toContain("--- math.js");
    expect(diffText).toContain("+++ math.js");
    expect(diffText).toContain("-  return a - b;");
    expect(diffText).toContain("+  return a + b;");
  });

  it("should perform targeted replacement accurately", () => {
    const original = `import React from 'react';

export function Header() {
  return <h1>Old Title</h1>;
}
`;
    const target = "return <h1>Old Title</h1>;";
    const replacement = "return <h1>Veloura Code</h1>;";

    const res = Patcher.applyTargetReplacement("Header.tsx", original, target, replacement);
    expect(res.success).toBe(true);
    expect(res.newContent).toContain("Veloura Code");
    expect(res.newContent).not.toContain("Old Title");
    expect(res.linesAdded).toBeGreaterThanOrEqual(1);
    expect(res.linesRemoved).toBeGreaterThanOrEqual(1);
  });

  it("should fail gracefully when target string is not found", () => {
    const original = "const x = 10;";
    const target = "const y = 999;";
    const replacement = "const y = 1000;";

    const res = Patcher.applyTargetReplacement("file.js", original, target, replacement);
    expect(res.success).toBe(false);
    expect(res.error).toContain("Target string was not found");
  });
});
