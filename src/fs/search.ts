import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import { PrivacyManager } from "../security/privacy.js";
import { PathGuard } from "../security/pathGuard.js";

export interface FileEntry {
  relativePath: string;
  size: number;
  isDirectory: boolean;
  modifiedAt: number;
}

export interface SearchMatch {
  file: string;
  line: number;
  content: string;
}

export class FileSearchEngine {
  private projectRoot: string;
  private privacyManager: PrivacyManager;
  private pathGuard: PathGuard;

  constructor(projectRoot: string, privacyManager: PrivacyManager) {
    this.projectRoot = path.resolve(projectRoot);
    this.privacyManager = privacyManager;
    this.pathGuard = new PathGuard(this.projectRoot);
  }

  /**
   * Lists files and folders in a directory, filtering out ignored entries.
   */
  public async listFiles(subDirectory = ".", maxDepth = 4): Promise<FileEntry[]> {
    const { safePath, relativePath } = this.pathGuard.resolveSafe(subDirectory);

    if (!fsSync.existsSync(safePath)) {
      throw new Error(`Directory does not exist: '${subDirectory}'`);
    }

    const stat = await fs.stat(safePath);
    if (!stat.isDirectory()) {
      return [
        {
          relativePath,
          size: stat.size,
          isDirectory: false,
          modifiedAt: stat.mtimeMs,
        },
      ];
    }

    const globPattern = "**/*";
    const entries = await fg(globPattern, {
      cwd: safePath,
      deep: maxDepth,
      dot: true,
      onlyFiles: false,
      markDirectories: true,
      stats: true,
      ignore: [
        "**/.git/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/coverage/**",
        "**/vendor/**",
      ],
    });

    const result: FileEntry[] = [];

    for (const entry of entries) {
      const entryRel = path.relative(
        this.projectRoot,
        path.join(safePath, entry.path)
      );

      if (this.privacyManager.isIgnored(entryRel)) {
        continue;
      }

      result.push({
        relativePath: entryRel.replace(/\\/g, "/"),
        size: entry.stats?.size || 0,
        isDirectory: entry.dirent.isDirectory(),
        modifiedAt: entry.stats?.mtimeMs || Date.now(),
      });
    }

    // Limit to reasonable count to avoid blowing token context
    return result.slice(0, 500);
  }

  /**
   * Searches for a string or regex pattern across project files.
   */
  public async searchCode(
    query: string,
    options: { isRegex?: boolean; fileFilter?: string; maxResults?: number } = {}
  ): Promise<SearchMatch[]> {
    const maxResults = options.maxResults || 100;
    const filter = options.fileFilter || "**/*";

    let regex: RegExp;
    try {
      regex = options.isRegex ? new RegExp(query, "i") : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    } catch (err: any) {
      throw new Error(`Invalid search pattern: ${err.message}`);
    }

    const files = await fg(filter, {
      cwd: this.projectRoot,
      dot: false,
      onlyFiles: true,
      ignore: [
        "**/.git/**",
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/coverage/**",
        "**/vendor/**",
        "package-lock.json",
        "yarn.lock",
        "pnpm-lock.yaml",
      ],
    });

    const matches: SearchMatch[] = [];

    for (const file of files) {
      if (this.privacyManager.isIgnored(file)) continue;

      try {
        const fullPath = path.join(this.projectRoot, file);
        const stat = await fs.stat(fullPath);
        if (stat.size > 500_000) continue; // Skip huge files

        const content = await fs.readFile(fullPath, "utf8");
        const lines = content.split("\n");

        for (let idx = 0; idx < lines.length; idx++) {
          const line = lines[idx];
          if (regex.test(line)) {
            matches.push({
              file: file.replace(/\\/g, "/"),
              line: idx + 1,
              content: line.trimEnd(),
            });

            if (matches.length >= maxResults) {
              return matches;
            }
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return matches;
  }
}
