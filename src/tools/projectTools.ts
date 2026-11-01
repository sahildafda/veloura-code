import { z } from "zod";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import { AgentTool } from "./registry.js";
import { ProjectDetector } from "../project/detector.js";
import { PathGuard } from "../security/pathGuard.js";

export function createProjectTools(
  detector: ProjectDetector,
  projectRoot: string
): AgentTool[] {
  const pathGuard = new PathGuard(projectRoot);

  const detectProjectTool: AgentTool = {
    name: "detect_project",
    description: "Inspects and identifies the current project type, language, package manager, and scripts.",
    permission: "read",
    schema: z.object({}),
    execute: async () => {
      return detector.detect();
    },
  };

  const analyzeDependenciesTool: AgentTool = {
    name: "analyze_dependencies",
    description: "Returns all detected dependencies and versions in the project.",
    permission: "read",
    schema: z.object({}),
    execute: async () => {
      const meta = detector.detect();
      return {
        package_manager: meta.packageManager,
        dependencies: meta.dependencies,
      };
    },
  };

  const readProjectInstructionsTool: AgentTool = {
    name: "read_project_instructions",
    description: "Reads instructions, design patterns, and conventions from README or guidelines files.",
    permission: "read",
    schema: z.object({}),
    execute: async () => {
      const meta = detector.detect();
      return {
        instructions: meta.instructions || "No custom instructions file found in project.",
      };
    },
  };

  const analyzeImportsTool: AgentTool = {
    name: "analyze_imports",
    description: "Parses a file's import/require statements to map its dependencies and external symbols.",
    permission: "read",
    schema: z.object({
      file_path: z.string().describe("Relative path of the source file to analyze"),
    }),
    execute: async (input) => {
      const { safePath, relativePath } = pathGuard.resolveSafe(input.file_path);

      if (!fsSync.existsSync(safePath)) {
        throw new Error(`File does not exist: '${relativePath}'`);
      }

      const content = await fs.readFile(safePath, "utf8");
      const lines = content.split("\n");
      const imports: string[] = [];

      const esmRegex = /import\s+(?:(?:[\w*\s{},]*)\s+from\s+)?['"]([^'"]+)['"]/g;
      const cjsRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
      const pyRegex = /(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g;

      let match: RegExpExecArray | null;
      while ((match = esmRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
      while ((match = cjsRegex.exec(content)) !== null) {
        imports.push(match[1]);
      }
      while ((match = pyRegex.exec(content)) !== null) {
        imports.push(match[1] || match[2]);
      }

      return {
        file: relativePath,
        total_imports: imports.length,
        imported_modules: Array.from(new Set(imports)),
      };
    },
  };

  return [
    detectProjectTool,
    analyzeDependenciesTool,
    readProjectInstructionsTool,
    analyzeImportsTool,
  ];
}
