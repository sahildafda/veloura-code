import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { PathGuard } from "../security/pathGuard.js";
import { PrivacyManager } from "../security/privacy.js";
import { Patcher, PatchResult } from "./patcher.js";
import { LocalDatabase } from "../db/database.js";

export interface ReadFileResult {
  filePath: string;
  relativePath: string;
  content: string;
  hash: string;
  totalLines: number;
  linesIncluded: { start: number; end: number };
}

export interface EditResult {
  success: boolean;
  filePath: string;
  relativePath: string;
  oldHash: string;
  newHash: string;
  diff: string;
  linesAdded: number;
  linesRemoved: number;
  error?: string;
}

export class FileEditor {
  private projectRoot: string;
  private pathGuard: PathGuard;
  private privacyManager: PrivacyManager;
  private db: LocalDatabase;
  // In-memory cache of file hashes read during the current session
  private fileHashCache: Map<string, string> = new Map();

  constructor(projectRoot: string, privacyManager: PrivacyManager, db: LocalDatabase) {
    this.projectRoot = path.resolve(projectRoot);
    this.pathGuard = new PathGuard(this.projectRoot);
    this.privacyManager = privacyManager;
    this.db = db;
  }

  public computeHash(content: string): string {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex");
  }

  /**
   * Reads a file safely, caching its hash for concurrency checks.
   */
  public async readFile(
    targetPath: string,
    options: { startLine?: number; endLine?: number } = {}
  ): Promise<ReadFileResult> {
    const { safePath, relativePath } = this.pathGuard.resolveSafe(targetPath);

    if (!fsSync.existsSync(safePath)) {
      throw new Error(`File does not exist: '${relativePath}'`);
    }

    const stat = await fs.stat(safePath);
    if (stat.isDirectory()) {
      throw new Error(`Path is a directory, not a file: '${relativePath}'`);
    }

    const content = await fs.readFile(safePath, "utf8");
    const hash = this.computeHash(content);
    this.fileHashCache.set(safePath, hash);

    const lines = content.split(/\r?\n/);
    const totalLines = lines.length;

    let start = options.startLine ? Math.max(1, options.startLine) : 1;
    const isDefaultUnbounded = !options.endLine;
    let end = options.endLine ? Math.min(totalLines, options.endLine) : totalLines;

    // Guard against giant files swamping token budget
    let wasTruncated = false;
    if (isDefaultUnbounded && totalLines > 400) {
      end = 400;
      wasTruncated = true;
    }

    if (start > end) {
      start = 1;
      end = wasTruncated ? 400 : totalLines;
    }

    let selectedLines = lines.slice(start - 1, end).join("\n");
    if (wasTruncated) {
      selectedLines += `\n... [File has ${totalLines} lines. Showing lines 1-400. Use start_line and end_line to inspect specific sections.]`;
    }

    return {
      filePath: safePath,
      relativePath: relativePath.replace(/\\/g, "/"),
      content: selectedLines,
      hash,
      totalLines,
      linesIncluded: { start, end },
    };
  }

  /**
   * Writes content to a file. If file does not exist, creates it.
   */
  public async writeFile(
    targetPath: string,
    content: string,
    options: { taskId?: string; description?: string } = {}
  ): Promise<EditResult> {
    const { safePath, relativePath } = this.pathGuard.resolveSafe(targetPath);

    const exists = fsSync.existsSync(safePath);
    let oldContent = "";
    let oldHash = "";

    if (exists) {
      oldContent = await fs.readFile(safePath, "utf8");
      oldHash = this.computeHash(oldContent);
    }

    const newHash = this.computeHash(content);

    // If identical, no edit needed
    if (exists && oldHash === newHash) {
      return {
        success: true,
        filePath: safePath,
        relativePath: relativePath.replace(/\\/g, "/"),
        oldHash,
        newHash,
        diff: "",
        linesAdded: 0,
        linesRemoved: 0,
      };
    }

    // Ensure parent directory exists
    await fs.mkdir(path.dirname(safePath), { recursive: true });

    // Write file
    await fs.writeFile(safePath, content, "utf8");
    this.fileHashCache.set(safePath, newHash);

    const unifiedDiff = Patcher.createUnifiedDiff(relativePath, oldContent, content);

    // Record change in local database
    this.db.recordFileChange({
      taskId: options.taskId,
      filePath: relativePath.replace(/\\/g, "/"),
      projectPath: this.projectRoot,
      oldHash: exists ? oldHash : undefined,
      newHash,
      diff: unifiedDiff,
      description: options.description || (exists ? "Updated file" : "Created file"),
    });

    const lines = unifiedDiff.split("\n");
    let added = 0;
    let removed = 0;
    for (const l of lines) {
      if (l.startsWith("+") && !l.startsWith("+++")) added++;
      if (l.startsWith("-") && !l.startsWith("---")) removed++;
    }

    return {
      success: true,
      filePath: safePath,
      relativePath: relativePath.replace(/\\/g, "/"),
      oldHash,
      newHash,
      diff: unifiedDiff,
      linesAdded: added,
      linesRemoved: removed,
    };
  }

  /**
   * Performs targeted replacement inside an existing file.
   */
  public async editFile(
    targetPath: string,
    target: string,
    replacement: string,
    options: { taskId?: string; expectedHash?: string; description?: string } = {}
  ): Promise<EditResult> {
    const { safePath, relativePath } = this.pathGuard.resolveSafe(targetPath);

    if (!fsSync.existsSync(safePath)) {
      throw new Error(`File not found: '${relativePath}'`);
    }

    const currentContent = await fs.readFile(safePath, "utf8");
    const currentHash = this.computeHash(currentContent);

    // Concurrency check
    if (options.expectedHash && options.expectedHash !== currentHash) {
      throw new Error(
        `File conflict: '${relativePath}' was modified since it was last read. Please re-read the file before editing.`
      );
    }

    const patchResult = Patcher.applyTargetReplacement(
      relativePath,
      currentContent,
      target,
      replacement
    );

    if (!patchResult.success || patchResult.newContent === undefined) {
      return {
        success: false,
        filePath: safePath,
        relativePath: relativePath.replace(/\\/g, "/"),
        oldHash: currentHash,
        newHash: currentHash,
        diff: "",
        linesAdded: 0,
        linesRemoved: 0,
        error: patchResult.error || "Failed to locate target string in file",
      };
    }

    const newHash = this.computeHash(patchResult.newContent);
    await fs.writeFile(safePath, patchResult.newContent, "utf8");
    this.fileHashCache.set(safePath, newHash);

    this.db.recordFileChange({
      taskId: options.taskId,
      filePath: relativePath.replace(/\\/g, "/"),
      projectPath: this.projectRoot,
      oldHash: currentHash,
      newHash,
      diff: patchResult.diffText,
      description: options.description || "Targeted edit",
    });

    return {
      success: true,
      filePath: safePath,
      relativePath: relativePath.replace(/\\/g, "/"),
      oldHash: currentHash,
      newHash,
      diff: patchResult.diffText,
      linesAdded: patchResult.linesAdded,
      linesRemoved: patchResult.linesRemoved,
    };
  }

  /**
   * Applies unified diff patch to a file.
   */
  public async applyPatch(
    targetPath: string,
    patchString: string,
    options: { taskId?: string; description?: string } = {}
  ): Promise<EditResult> {
    const { safePath, relativePath } = this.pathGuard.resolveSafe(targetPath);

    if (!fsSync.existsSync(safePath)) {
      throw new Error(`File not found: '${relativePath}'`);
    }

    const currentContent = await fs.readFile(safePath, "utf8");
    const currentHash = this.computeHash(currentContent);

    const patchResult = Patcher.applyPatch(relativePath, currentContent, patchString);

    if (!patchResult.success || patchResult.newContent === undefined) {
      return {
        success: false,
        filePath: safePath,
        relativePath: relativePath.replace(/\\/g, "/"),
        oldHash: currentHash,
        newHash: currentHash,
        diff: "",
        linesAdded: 0,
        linesRemoved: 0,
        error: patchResult.error || "Patch failed to apply",
      };
    }

    const newHash = this.computeHash(patchResult.newContent);
    await fs.writeFile(safePath, patchResult.newContent, "utf8");
    this.fileHashCache.set(safePath, newHash);

    this.db.recordFileChange({
      taskId: options.taskId,
      filePath: relativePath.replace(/\\/g, "/"),
      projectPath: this.projectRoot,
      oldHash: currentHash,
      newHash,
      diff: patchResult.diffText,
      description: options.description || "Unified patch",
    });

    return {
      success: true,
      filePath: safePath,
      relativePath: relativePath.replace(/\\/g, "/"),
      oldHash: currentHash,
      newHash,
      diff: patchResult.diffText,
      linesAdded: patchResult.linesAdded,
      linesRemoved: patchResult.linesRemoved,
    };
  }

  /**
   * Deletes a file.
   */
  public async deleteFile(
    targetPath: string,
    options: { taskId?: string } = {}
  ): Promise<{ success: boolean; relativePath: string }> {
    const { safePath, relativePath } = this.pathGuard.resolveSafe(targetPath);

    if (!fsSync.existsSync(safePath)) {
      throw new Error(`File does not exist: '${relativePath}'`);
    }

    const content = await fs.readFile(safePath, "utf8");
    const oldHash = this.computeHash(content);

    await fs.unlink(safePath);
    this.fileHashCache.delete(safePath);

    this.db.recordFileChange({
      taskId: options.taskId,
      filePath: relativePath.replace(/\\/g, "/"),
      projectPath: this.projectRoot,
      oldHash,
      newHash: undefined,
      diff: `--- a/${relativePath}\n+++ /dev/null\n@@ -1,${content.split("\n").length} +0,0 @@\n`,
      description: "File deleted",
    });

    return {
      success: true,
      relativePath: relativePath.replace(/\\/g, "/"),
    };
  }

  /**
   * Moves or renames a file.
   */
  public async moveFile(
    sourcePath: string,
    destinationPath: string,
    options: { taskId?: string } = {}
  ): Promise<{ success: boolean; source: string; destination: string }> {
    const src = this.pathGuard.resolveSafe(sourcePath);
    const dst = this.pathGuard.resolveSafe(destinationPath);

    if (!fsSync.existsSync(src.safePath)) {
      throw new Error(`Source file does not exist: '${src.relativePath}'`);
    }

    await fs.mkdir(path.dirname(dst.safePath), { recursive: true });
    await fs.rename(src.safePath, dst.safePath);

    return {
      success: true,
      source: src.relativePath.replace(/\\/g, "/"),
      destination: dst.relativePath.replace(/\\/g, "/"),
    };
  }
}
