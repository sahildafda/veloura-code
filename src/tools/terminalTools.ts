import { z } from "zod";
import { AgentTool } from "./registry.js";
import { TerminalRunner } from "../terminal/runner.js";
import { ProjectDetector } from "../project/detector.js";

export function createTerminalTools(
  runner: TerminalRunner,
  projectDetector: ProjectDetector
): AgentTool[] {
  const runCommandTool: AgentTool = {
    name: "run_command",
    description: "Executes a terminal command safely inside the current project root.",
    permission: "execute",
    schema: z.object({
      command: z.string().describe("Terminal command line string to run"),
      timeout_ms: z.number().int().min(1000).max(300000).optional().default(60000),
    }),
    execute: async (input, ctx) => {
      const res = await runner.execute(input.command, {
        timeoutMs: input.timeout_ms,
        bypassApproval: ctx.autoApprove,
      });

      return {
        exit_code: res.exitCode,
        stdout: res.stdout,
        stderr: res.stderr,
        duration_ms: res.durationMs,
        timed_out: res.timedOut,
      };
    },
  };

  const runTestsTool: AgentTool = {
    name: "run_tests",
    description: "Runs the project test suite using the detected test runner (npm test, pytest, cargo test, etc.).",
    permission: "execute",
    schema: z.object({
      custom_command: z.string().optional().describe("Optional override test command (e.g., 'npm test -- -t auth')"),
    }),
    execute: async (input, ctx) => {
      const meta = projectDetector.detect();
      const testCmd = input.custom_command || meta.testScript || "npm test";

      const res = await runner.execute(testCmd, {
        timeoutMs: 120000,
        bypassApproval: ctx.autoApprove,
      });

      return {
        command: testCmd,
        exit_code: res.exitCode,
        passed: res.exitCode === 0,
        stdout: res.stdout,
        stderr: res.stderr,
      };
    },
  };

  const runBuildTool: AgentTool = {
    name: "run_build",
    description: "Runs the project build command (npm run build, cargo build, etc.) to verify compilation.",
    permission: "execute",
    schema: z.object({
      custom_command: z.string().optional().describe("Optional override build command"),
    }),
    execute: async (input, ctx) => {
      const meta = projectDetector.detect();
      const buildCmd = input.custom_command || meta.buildScript || "npm run build";

      const res = await runner.execute(buildCmd, {
        timeoutMs: 180000,
        bypassApproval: ctx.autoApprove,
      });

      return {
        command: buildCmd,
        exit_code: res.exitCode,
        success: res.exitCode === 0,
        stdout: res.stdout,
        stderr: res.stderr,
      };
    },
  };

  const runLintTool: AgentTool = {
    name: "run_lint",
    description: "Runs the project linter / type checker (npm run lint, tsc --noEmit, etc.).",
    permission: "execute",
    schema: z.object({
      custom_command: z.string().optional().describe("Optional override lint command"),
    }),
    execute: async (input, ctx) => {
      const meta = projectDetector.detect();
      const lintCmd = input.custom_command || meta.lintScript || "npm run lint";

      const res = await runner.execute(lintCmd, {
        timeoutMs: 60000,
        bypassApproval: ctx.autoApprove,
      });

      return {
        command: lintCmd,
        exit_code: res.exitCode,
        success: res.exitCode === 0,
        stdout: res.stdout,
        stderr: res.stderr,
      };
    },
  };

  return [runCommandTool, runTestsTool, runBuildTool, runLintTool];
}
