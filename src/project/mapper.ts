import fs from "node:fs";
import path from "node:path";
import { ProjectDetector, ProjectMetadata } from "./detector.js";
import { PrivacyManager } from "../security/privacy.js";

export class ProjectMapper {
  private projectRoot: string;
  private detector: ProjectDetector;
  private privacyManager: PrivacyManager;

  constructor(projectRoot: string, privacyManager: PrivacyManager) {
    this.projectRoot = path.resolve(projectRoot);
    this.detector = new ProjectDetector(this.projectRoot);
    this.privacyManager = privacyManager;
  }

  public getMetadata(): ProjectMetadata {
    return this.detector.detect();
  }

  /**
   * Generates a concise directory tree string for context injection (depth <= 3).
   */
  public generateDirectoryTree(currentDir = this.projectRoot, depth = 0, maxDepth = 3): string {
    if (depth > maxDepth) return "";
    let tree = "";

    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      // Sort directories first, then files
      entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of entries) {
        const relPath = path.relative(this.projectRoot, path.join(currentDir, entry.name));
        if (this.privacyManager.isIgnored(relPath)) continue;

        const indent = "  ".repeat(depth);
        if (entry.isDirectory()) {
          tree += `${indent}📁 ${entry.name}/\n`;
          tree += this.generateDirectoryTree(path.join(currentDir, entry.name), depth + 1, maxDepth);
        } else {
          tree += `${indent}📄 ${entry.name}\n`;
        }
      }
    } catch {
      // Ignored
    }

    return tree;
  }

  /**
   * Builds the project prompt summary for the autonomous agent.
   */
  public buildProjectContextSummary(): string {
    const meta = this.getMetadata();
    const tree = this.generateDirectoryTree(this.projectRoot, 0, 2);

    let summary = `### Project Information\n`;
    summary += `- Project Root: ${this.projectRoot}\n`;
    summary += `- Primary Type: ${meta.projectType}\n`;
    summary += `- Languages: ${meta.languages.join(", ") || "None detected"}\n`;
    if (meta.frameworks.length > 0) {
      summary += `- Frameworks: ${meta.frameworks.join(", ")}\n`;
    }
    summary += `- Package Manager: ${meta.packageManager}\n`;
    if (meta.buildScript) summary += `- Build Command: \`${meta.buildScript}\`\n`;
    if (meta.testScript) summary += `- Test Command: \`${meta.testScript}\`\n`;
    if (meta.lintScript) summary += `- Lint Command: \`${meta.lintScript}\`\n`;
    if (meta.entryPoints.length > 0) {
      summary += `- Entry Points: ${meta.entryPoints.join(", ")}\n`;
    }

    summary += `\n### Project Structure:\n\`\`\`\n${tree.slice(0, 3000)}\`\`\`\n`;

    if (meta.instructions) {
      summary += `\n### Project Instructions (README/AGENT):\n${meta.instructions}\n`;
    }

    return summary;
  }
}
