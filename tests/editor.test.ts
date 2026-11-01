import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileEditor } from "../src/fs/editor.js";
import { PrivacyManager } from "../src/security/privacy.js";
import { LocalDatabase } from "../src/db/database.js";
import { DEFAULT_CONFIG } from "../src/config/config.js";
import { getVelouraPaths } from "../src/config/paths.js";

describe("FileEditor & Concurrency Tracking", () => {
  let projectDir: string;
  let dataDir: string;
  let db: LocalDatabase;
  let editor: FileEditor;

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-editor-proj-"));
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "veloura-editor-data-"));
    const paths = getVelouraPaths(dataDir, dataDir);
    db = new LocalDatabase(paths.dbFile);
    const privacy = new PrivacyManager(DEFAULT_CONFIG, paths, projectDir);
    editor = new FileEditor(projectDir, privacy, db);
  });

  afterEach(() => {
    db.close();
    try {
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(dataDir, { recursive: true, force: true });
    } catch {}
  });

  it("should create new files and record change in database", async () => {
    const res = await editor.writeFile("src/hello.ts", "console.log('hello');");
    expect(res.success).toBe(true);
    expect(fs.existsSync(path.join(projectDir, "src", "hello.ts"))).toBe(true);

    const changes = db.getFileChangesForProject(projectDir);
    expect(changes.length).toBe(1);
    expect(changes[0].file_path).toBe("src/hello.ts");
    expect(changes[0].new_hash).toBe(res.newHash);
  });

  it("should read files and compute hash for concurrency check", async () => {
    await editor.writeFile("math.js", "export const PI = 3.14;");
    const read = await editor.readFile("math.js");
    expect(read.content).toBe("export const PI = 3.14;");
    expect(read.hash.length).toBe(64); // SHA-256

    // Successful targeted edit using valid hash
    const editRes = await editor.editFile("math.js", "3.14", "3.14159", {
      expectedHash: read.hash,
    });
    expect(editRes.success).toBe(true);

    // Stale hash edit should be rejected to prevent overwriting modifications
    await expect(
      editor.editFile("math.js", "3.14159", "3.14", {
        expectedHash: "stale_outdated_hash_value",
      })
    ).rejects.toThrow(/File conflict/);
  });
});
