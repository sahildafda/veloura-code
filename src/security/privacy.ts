import fs from "node:fs";
import path from "node:path";
import ignore, { Ignore } from "ignore";
import { SecretDetector } from "./secrets.js";
import { VelouraConfig } from "../config/config.js";
import { VelouraPaths } from "../config/paths.js";

export interface ContextFilterResult {
  included: boolean;
  reason?: string;
  sanitizedContent?: string;
  secretsDetected?: number;
}

export class PrivacyManager {
  private config: VelouraConfig;
  private paths: VelouraPaths;
  private projectRoot: string;
  private ig: Ignore;

  constructor(config: VelouraConfig, paths: VelouraPaths, projectRoot: string) {
    this.config = config;
    this.paths = paths;
    this.projectRoot = path.resolve(projectRoot);
    this.ig = ignore();
    this.loadIgnoreRules();
  }

  private loadIgnoreRules(): void {
    // Default ignored directories & files
    this.ig.add([
      ".git",
      ".git/**",
      "node_modules",
      "node_modules/**",
      "dist",
      "dist/**",
      "build",
      "build/**",
      "coverage",
      "coverage/**",
      ".next",
      ".next/**",
      ".nuxt",
      ".nuxt/**",
      "vendor",
      "vendor/**",
      ".cache",
      ".cache/**",
      "*.pyc",
      "__pycache__",
      "__pycache__/**",
      "*.class",
      "*.o",
      "*.obj",
      "*.exe",
      "*.dll",
      "*.so",
      "*.dylib",
      ".env*",
      "*.pem",
      "*.key",
      "package-lock.json",
      "yarn.lock",
      "pnpm-lock.yaml",
    ]);

    // Load .gitignore if present
    const gitignorePath = path.join(this.projectRoot, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      try {
        const content = fs.readFileSync(gitignorePath, "utf8");
        this.ig.add(content);
      } catch {
        // ignore
      }
    }

    // Load .velouraignore if present
    const velouraIgnorePath = path.join(this.projectRoot, ".velouraignore");
    if (fs.existsSync(velouraIgnorePath)) {
      try {
        const content = fs.readFileSync(velouraIgnorePath, "utf8");
        this.ig.add(content);
      } catch {
        // ignore
      }
    }
  }

  /**
   * Checks whether a relative path is ignored by gitignore or velouraignore.
   */
  public isIgnored(relativePath: string): boolean {
    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || normalized === ".") return false;
    return this.ig.ignores(normalized);
  }

  /**
   * Evaluates a file for inclusion in the AI context window, checking for secrets,
   * binary formats, size limits, and ignore rules.
   */
  public filterFileForContext(relativePath: string, content: string): ContextFilterResult {
    // 1. Secret file check
    if (SecretDetector.isSecretFile(relativePath)) {
      return {
        included: false,
        reason: `Excluded because filename '${relativePath}' matches sensitive secret pattern (.env, key, etc.)`,
      };
    }

    // 2. Ignore rule check
    if (this.isIgnored(relativePath)) {
      return {
        included: false,
        reason: `Excluded by .gitignore or .velouraignore: '${relativePath}'`,
      };
    }

    // 3. Binary detection
    if (this.isBinary(content)) {
      return {
        included: false,
        reason: `Excluded because '${relativePath}' appears to be a binary file`,
      };
    }

    // 4. File size limit (e.g. 200KB max per file in prompt context)
    if (content.length > 200_000) {
      return {
        included: false,
        reason: `Excluded because '${relativePath}' exceeds context file size limit (200KB)`,
      };
    }

    // 5. Redact secrets in content
    const { sanitized, count } = SecretDetector.redact(content);

    return {
      included: true,
      sanitizedContent: sanitized,
      secretsDetected: count,
    };
  }

  private isBinary(content: string): boolean {
    // Check first 1000 characters for null bytes or control characters
    const checkLength = Math.min(content.length, 1000);
    for (let i = 0; i < checkLength; i++) {
      const code = content.charCodeAt(i);
      if (code === 0 || (code < 7 && code !== 0) || (code > 14 && code < 32)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Formats privacy report for 'veloura privacy' command.
   */
  public getPrivacyReport(): {
    mode: "standard" | "strict";
    localDataPath: string;
    configPath: string;
    aiProvider: string;
    requiresApproval: boolean;
    storedLocally: string[];
    sentExternally: string[];
  } {
    return {
      mode: this.config.privacyMode,
      localDataPath: this.paths.dataDir,
      configPath: this.paths.configDir,
      aiProvider: "OpenRouter (https://openrouter.ai/api/v1)",
      requiresApproval: this.config.privacyMode === "strict" || this.config.requireCodeApproval,
      storedLocally: [
        "API keys & credentials (machine-encrypted or Windows Credential Vault)",
        "Configuration settings",
        "SQLite database (conversations, tasks, tool logs, checkpoints, diffs)",
        "Project memory and summaries",
        "Application audit logs",
      ],
      sentExternally: [
        "User prompts",
        "Targeted code snippets relevant to the task (with secrets redacted)",
        "Tool execution results required for task reasoning",
        "(In Strict Mode: prompts and code snippets are ONLY sent after explicit approval)",
      ],
    };
  }
}
